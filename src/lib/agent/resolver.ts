import { APP_MANIFEST } from "./workflows";
import type { AgentLang, Workflow, WorkflowField } from "./types";
import { say } from "./i18n";

/**
 * Intent -> registered workflow, by direct lookup. The agent never searches the
 * app to work out where something lives: if an id is not in the registry the
 * answer is "no", not "go and find out".
 *
 * This is also the allowlist. Every model proposal passes through resolve(),
 * so an invented workflow id cannot reach the UI controller.
 */

const BY_ID = new Map(APP_MANIFEST.workflows.map((w) => [w.id, w]));

/** Only ready workflows resolve. A draft is visible in the registry for review
 * but is not a thing the agent can be talked into attempting. */
export function resolve(workflowId: string): Workflow | null {
  const workflow = BY_ID.get(workflowId);
  return workflow && workflow.status === "ready" ? workflow : null;
}

/** Including drafts — for the manifest test and for reporting coverage, never
 * for execution. */
export function allWorkflows(): Workflow[] {
  return APP_MANIFEST.workflows;
}

/**
 * The compact catalogue Grok is given: one line per capability, no routes, no
 * control ids, no field layouts. The full manifest stays server-side and out of
 * the prompt — it is large, it changes with the build, and the model has no use
 * for it when choosing between capabilities.
 */
export function capabilityCatalogue(): {
  id: string;
  effect: string;
  summary: string;
  fields: string;
}[] {
  return APP_MANIFEST.workflows
    .filter((w) => w.status === "ready")
    .map((w) => ({
      id: w.id,
      effect: w.effect,
      summary: w.summary,
      // Field NAMES only — never controls or routes. Without them the model
      // invents its own keys ("startingHourMeter" for "startHourMeter"), which
      // pickKnownFields then drops, and the owner is asked again for something
      // they already said. Names are not plumbing worth hiding; control ids are.
      fields: w.fields
        .map((f) => (f.required ? f.name : `${f.name} (optional)`))
        .join(", "),
    }));
}

/** Required fields with no value yet, in registry order so the agent asks for
 * them in the order the form wants them. */
export function missingFields(workflow: Workflow, fields: Record<string, unknown>): WorkflowField[] {
  return workflow.fields.filter((f) => {
    if (!f.required) return false;
    const value = fields[f.name];
    return value === undefined || value === null || value === "";
  });
}

/** The question to ask for the first missing field, in the user's language. */
export function nextQuestion(workflow: Workflow, fields: Record<string, unknown>, lang: AgentLang): string | null {
  const [first] = missingFields(workflow, fields);
  return first ? say(first.prompt, lang) : null;
}

/**
 * Field values a model proposed, keeping only names this workflow declares.
 * A model that returns `{ isAdmin: true }` or a field belonging to a different
 * workflow has those dropped here rather than carried into the form.
 */
export function pickKnownFields(
  workflow: Workflow,
  proposed: Record<string, string | number>,
): Record<string, string | number> {
  const allowed = new Set(workflow.fields.map((f) => f.name));
  const kept: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(proposed)) {
    if (allowed.has(name)) kept[name] = value;
  }
  return kept;
}

/** Entity fields still holding a typed name rather than a chosen record. Those
 * have to go through the app's own picker — two operators called Patil must be
 * a question to the user, never a guess. */
export function unresolvedEntities(workflow: Workflow, fields: Record<string, unknown>): WorkflowField[] {
  return workflow.fields.filter((f) => f.entityKind !== undefined && fields[f.name] !== undefined);
}

/**
 * The capabilities a tap can run on its own, with no model involved.
 *
 * Every one is a read that needs no values: there is nothing to extract from a
 * sentence, so there is nothing for a model to do. That makes them useful
 * twice over — a fast shortcut for the things owners ask most, and the thing
 * that still works when the model cannot be reached at all. A turn that runs
 * one of these is as safe as the owner tapping the menu themselves, which is
 * exactly what it is.
 *
 * Writes are deliberately absent. A tap is not an instruction to change
 * anything, and nothing here should ever be approvable without being asked for.
 */
export function tappableWorkflows(): { id: string; summary: string }[] {
  return allWorkflows()
    .filter((w) => w.status === "ready" && w.effect === "READ" && w.fields.length === 0)
    .map((w) => ({ id: w.id, summary: w.summary }));
}

/** Is this id one a tap may run? The allowlist is derived from the registry,
 * not written twice, so a workflow gaining a field drops out of it by itself. */
export function isTappable(workflowId: string): boolean {
  return tappableWorkflows().some((w) => w.id === workflowId);
}
