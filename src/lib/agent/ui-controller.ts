"use client";

import { CONTROL_MS, SETTLE_MS, VERIFY_MS } from "./budget";
import { matchEntity, type Candidate } from "./matching";
import { isExecutableOperation, type UiOperation } from "./plan";

/**
 * The browser half: it runs an approved plan against the real, authenticated
 * page and reports what happened.
 *
 * Kept as thin as it can be: every decision worth getting right — which record
 * was meant, which operations are even allowed — is made in matching.ts and
 * plan.ts. This file does DOM, and nothing else.
 *
 * Tested against a real DOM in `tests/agent/ui-controller.test.ts` (jsdom).
 * That covers the behaviour, not the rendering: there is no React and no layout
 * there, so the value-setting path is proved through the events the app's own
 * onChange would receive. Driving the built app in a browser is still the gap.
 *
 * Two rules it will not bend:
 *  - it only touches elements carrying a data-agent-id the plan named;
 *  - it sets values the way a person would, through React's own change events,
 *    never by writing to .value and hoping, which would leave the form's state
 *    disagreeing with what is on screen.
 */

/**
 * What the verify control looked like just before the save was submitted.
 *
 * Presence alone is not proof. A transactions list is already on screen for an
 * operator who has transactions, so "the control appeared" was true whether or
 * not anything saved — and the owner was told "Done. It's saved." For someone
 * who cannot read the screen to check, that is the worst failure this product
 * has. So the before-state is captured and the after-state has to differ.
 */
export type ControlState = {
  /** Absent before the save? Then appearing at all is proof. */
  existed: boolean;
  /** Cheap shape signal: a new row changes the child count or the text length. */
  signature: string;
};

export type ExecutionOutcome =
  | { status: "done"; before?: ControlState }
  /**
   * The owner has to say which record is meant. Covers both "two could match"
   * and "nothing matches" — the second is the one that catches a hallucinated
   * value, because a name the model invented matches no real record and so
   * becomes a question instead of being typed into the form.
   */
  | { status: "needs_choice"; field: string; query: string; choices: string[] }
  | { status: "failed"; reason: string; at: UiOperation };

/** Enough to choose from without reading out a catalogue. */
const MAX_CHOICES = 6;

function stateOf(control: string): ControlState {
  const el = find(control);
  if (!el) return { existed: false, signature: "" };
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return { existed: true, signature: `${el.children.length}:${text.length}` };
}
/**
 * Control ids are a closed set written in this repository, and
 * `manifest.test.ts` only recognises `[a-zA-Z0-9_-]+` when it checks that each
 * one is annotated — so an id outside that shape could never have matched
 * anything anyway. Rejecting it here is both safer than escaping and honest:
 * it cannot build a selector out of whatever it was handed.
 *
 * This replaced `CSS.escape`, which is not defined outside a real browser and
 * is what made this file untestable.
 */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

const SELECTOR = (id: string) => `[data-agent-id="${id}"]`;

function find(id: string): HTMLElement | null {
  if (!SAFE_ID.test(id)) return null;
  return document.querySelector<HTMLElement>(SELECTOR(id));
}

function findAll(id: string): HTMLElement[] {
  if (!SAFE_ID.test(id)) return [];
  return [...document.querySelectorAll<HTMLElement>(SELECTOR(id))];
}

/** Waits for a control to exist. Dialogs mount, routes load, lists re-render —
 * so every step that depends on something appearing goes through here rather
 * than assuming the previous step finished painting. */
async function waitFor(id: string, timeoutMs = DEFAULT_WAIT_MS): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const el = find(id);
    if (el) return el;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 80));
  }
}

/**
 * Set a value the way React will notice.
 *
 * React tracks the previous value on the DOM node and skips its handler when it
 * thinks nothing changed, so assigning `.value` silently produces a field that
 * LOOKS filled and submits empty. Going through the prototype's setter clears
 * that tracker, and the dispatched event is what the app's own onChange sees.
 */
function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Options of a <select>, as the user sees them. */
function optionsOf(el: HTMLSelectElement): Candidate[] {
  return [...el.options]
    .filter((o) => o.value !== "")
    .map((o) => ({ value: o.value, label: o.textContent ?? o.value }));
}

/**
 * Close a dialog the plan opened, before handing the turn back to the owner.
 *
 * A modal dialog marks the rest of the page inert, and the assistant's panel is
 * part of the rest of the page. So when a plan stopped half way to ask "which
 * Patil did you mean?", the question was rendered behind the overlay: the owner
 * saw a partly filled form, no explanation, and no way to answer. Worse, the
 * form was still sitting there to be submitted by hand.
 *
 * Nothing has been saved at this point — the submit step is the last one — so
 * dismissing is safe, and it is the only way the question is actually asked.
 */
async function dismissOpenDialog(): Promise<void> {
  if (!document.querySelector('[role="dialog"]')) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  // Let the close animation finish, or the panel is still inert when the owner
  // looks at it.
  await new Promise((r) => setTimeout(r, 150));
}

export type NavigateFn = (route: string) => void | Promise<void>;

/** How long any one step waits for its control. Generous by default: a route
 * loads, a dialog mounts and a list re-renders between steps, on a phone on a
 * yard's connection. Overridable so tests need not sit through it. */
const DEFAULT_WAIT_MS = CONTROL_MS;

/**
 * Run the plan. Stops at the first operation that cannot be completed and says
 * which one — a half-finished form left alone is recoverable; one filled by
 * guesswork is not.
 */
export async function executePlan(
  operations: UiOperation[],
  navigate: NavigateFn,
  options: { waitMs?: number; verify?: string } = {},
): Promise<ExecutionOutcome> {
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  // Captured immediately before the submit, not at the start: the plan
  // navigates and opens a dialog first, so the verify control's state at the
  // start of the plan says nothing about the page the save lands on.
  let before: ControlState | undefined;
  for (const op of operations) {
    // The plan crossed the network to get here, so it is re-checked on arrival
    // rather than trusted for having come from the server.
    if (!isExecutableOperation(op)) {
      await dismissOpenDialog();
      return { status: "failed", reason: "That action is not allowed.", at: op };
    }

    switch (op.action) {
      case "navigate": {
        await navigate(op.route);
        break;
      }

      case "waitFor": {
        if (!(await waitFor(op.control, waitMs))) {
          await dismissOpenDialog();
          return { status: "failed", reason: `The screen did not show ${op.control}.`, at: op };
        }
        break;
      }

      case "click":
      case "submit": {
        if (op.action === "submit" && options.verify) before = stateOf(options.verify);
        const el = await waitFor(op.control, waitMs);
        if (!el) {
          await dismissOpenDialog();
          return { status: "failed", reason: `Could not find ${op.control}.`, at: op };
        }
        if (el instanceof HTMLButtonElement && el.disabled) {
          await dismissOpenDialog();
          return { status: "failed", reason: "That button is not available yet.", at: op };
        }
        el.click();
        break;
      }

      case "fill": {
        const el = await waitFor(op.control, waitMs);
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          await dismissOpenDialog();
          return { status: "failed", reason: `Could not type into ${op.control}.`, at: op };
        }
        setValue(el, op.value);
        break;
      }

      case "select": {
        const el = await waitFor(op.control, waitMs);
        if (!(el instanceof HTMLSelectElement)) {
          await dismissOpenDialog();
          return { status: "failed", reason: `Could not choose in ${op.control}.`, at: op };
        }
        // The value may already be an id (resolved earlier) or still a name.
        const byValue = [...el.options].find((o) => o.value === op.value);
        if (byValue) {
          setValue(el, byValue.value);
          break;
        }
        const options = optionsOf(el);
        const match = matchEntity(op.value, options);
        if (match.kind !== "unique") {
          // Nothing matched, or several did. Either way the owner picks — a
          // value that matches no real record was never theirs to begin with.
          await dismissOpenDialog();
          return {
            status: "needs_choice",
            field: op.control,
            query: op.value,
            choices: (match.kind === "ambiguous" ? match.matches : options)
              .slice(0, MAX_CHOICES)
              .map((m) => m.label),
          };
        }
        setValue(el, match.match.value);
        break;
      }

      case "pickFromList": {
        if (!(await waitFor(op.control, waitMs))) {
          await dismissOpenDialog();
          return { status: "failed", reason: "That list has not loaded.", at: op };
        }
        const items = findAll(op.control);
        const candidates: Candidate[] = items.map((el, i) => ({
          value: String(i),
          label: el.dataset.agentLabel ?? el.textContent?.trim() ?? "",
        }));

        const match = matchEntity(op.query, candidates);
        if (match.kind !== "unique") {
          // Two records could be meant, or none could. The controller stops
          // and the owner chooses; it never takes the first one.
          await dismissOpenDialog();
          return {
            status: "needs_choice",
            field: op.control,
            query: op.query,
            choices: (match.kind === "ambiguous" ? match.matches : candidates)
              .slice(0, MAX_CHOICES)
              .map((m) => m.label),
          };
        }
        items[Number(match.match.value)]!.click();
        break;
      }
    }
  }

  return { status: "done", before };
}

/**
 * Did the app actually do it? Called after the plan finishes, and its answer is
 * the only thing allowed to turn a task into a success.
 *
 * `before` is what the control looked like just before the save. Without it
 * this can only ask "is the control there", which was already true for any
 * list that had rows in it. With it, a control that was already present has to
 * have CHANGED — a new row moves the child count — and an unchanged list is
 * reported as unconfirmed rather than as saved.
 *
 * Omitting `before` keeps the old meaning, which is the right one for a
 * read-only workflow: there is no save, and the page being there is the answer.
 */
export async function verifyResult(
  control: string,
  before?: ControlState,
  // The most generous wait in the whole turn, on purpose: firing early here
  // means telling the owner "I couldn't confirm" about a record that saved
  // perfectly well, which sends them to do it again by hand.
  timeoutMs = VERIFY_MS,
): Promise<boolean> {
  if (!before?.existed) return (await waitFor(control, timeoutMs)) !== null;

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = stateOf(control);
    if (!now.existed) return false;
    if (now.signature !== before.signature) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 80));
  }
}

/** Visible text of a control, for read-only questions. Trimmed and bounded —
 * it is going into a prompt, and a whole page of markup is neither useful nor
 * safe to paste there. */
export function readControl(control: string, maxChars = 1200): string | null {
  const el = find(control);
  if (!el) return null;
  return (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/**
 * Text that looks like a page still fetching rather than a page with an
 * answer on it.
 *
 * Measured: asked when a machine's service was due, the assistant read back
 * "Loading…" — the verify control existed, because the control is the
 * container and the container renders before its data arrives. For a read, the
 * text IS the answer, so reading it a moment too early means answering from a
 * placeholder.
 */
const LOADING = /^(loading|please wait|…|\.\.\.)/i;

/**
 * Read a control once its contents have settled.
 *
 * Two conditions, both needed: the text must not look like a loading state,
 * and it must stop changing. A single non-loading sample is not enough — a
 * list that renders its first row and then four more would be quoted with one
 * row in it, and "you have one machine" is a wrong answer, not a partial one.
 *
 * Falls back to whatever is there when the time runs out. A late answer from a
 * slow page is still better than none, and the summariser is told to say when
 * it cannot find something.
 */
export async function readSettledControl(
  control: string,
  options: { maxChars?: number; timeoutMs?: number; intervalMs?: number; stableForMs?: number } = {},
): Promise<string | null> {
  // The same budget the verify step gets. A read's text IS its answer, so
  // giving up sooner than the app is allowed to take means answering from a
  // placeholder — which is how "Loading…" got read back to an owner who asked
  // when a service was due.
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
  const intervalMs = options.intervalMs ?? 120;
  // Unchanged for a window, not merely equal to the last sample: two samples
  // taken 50ms apart are both "JCB" while four more rows are still on their
  // way, and quoting one row out of five is a wrong answer rather than a
  // partial one — "you have one machine" when they have five.
  const stableForMs = options.stableForMs ?? SETTLE_MS;
  const deadline = Date.now() + timeoutMs;

  let last: string | null = null;
  let lastChangedAt = Date.now();
  for (;;) {
    const now = readControl(control, options.maxChars);
    if (now === null) return null;

    if (now !== last) {
      last = now;
      lastChangedAt = Date.now();
    }

    const looksReady = now.length > 0 && !LOADING.test(now);
    if (looksReady && Date.now() - lastChangedAt >= stableForMs) return now;

    if (Date.now() > deadline) return now;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
