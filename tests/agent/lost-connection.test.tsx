// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * What the owner is told when the turn does not come back.
 *
 * This is a yard, on a phone. The connection drops mid-request as a matter of
 * course — the dev-server log for one browser run had three requests to
 * /api/agent ending in Node's own `aborted` while every test passed.
 *
 * The panel's answer to all of that used to be SILENCE. `post()` swallows the
 * error and returns null, and two of the call sites did nothing with the null:
 * the approval tap, and the report of a plan that had already run. For an
 * owner who cannot read the screen, nothing said means nothing happened — so
 * they say it again, and the yard gets two jobs, or two payments, for one
 * instruction. That is the single harm this whole feature is built to avoid.
 *
 * What is asserted here is that every dead end SPEAKS, that it speaks in the
 * owner's own language, and — the part that needed care — that it says the
 * right one of two different things:
 *
 *   - nothing was saved, try again          (the request never got anywhere)
 *   - it may have saved, do not repeat it   (the plan already ran in the page)
 *
 * Getting those two the wrong way round would be worse than silence.
 */

/** Queued answers for apiFetch, in order. `null` means the request fails. */
const calls = vi.hoisted(() => ({ queue: [] as (unknown | null)[], sent: [] as Record<string, unknown>[] }));

vi.mock("@/lib/api-client", () => ({
  apiFetch: async (url: string, init?: { body?: string }) => {
    // The panel asks whether voice consent was given as soon as it opens.
    // Answered separately, or it would eat the queued turn.
    if (url.includes("voice-consent")) return { given: true };
    calls.sent.push(init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {});
    const next = calls.queue.shift();
    // How a dropped connection actually arrives: fetch rejects. The panel's
    // post() turns it into null, which is what every branch here is about.
    if (next === null || next === undefined) throw new Error("Failed to fetch");
    return next;
  },
  ApiError: class ApiError extends Error {},
  swrFetcher: async () => ({}),
  newIdempotencyKey: () => "test-idempotency-key",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));

const { AssistantPanel } = await import("@/components/agent/assistant-panel");

/** Everything the device was asked to say out loud. The turn list is only half
 * the answer: the owner this is built for is not reading it. */
let spoken: string[] = [];

beforeEach(() => {
  calls.queue = [];
  calls.sent = [];
  spoken = [];

  Object.defineProperty(window, "speechSynthesis", {
    value: {
      speak: (u: { text: string }) => spoken.push(u.text),
      cancel: () => undefined,
      getVoices: () => [],
      speaking: false,
    },
    writable: true,
    configurable: true,
  });
  class FakeUtterance {
    text: string;
    lang = "";
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    writable: true,
    configurable: true,
  });
});

afterEach(cleanup);

/** Open the panel, as the owner does. */
function openPanel() {
  render(<AssistantPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
}

/** Type something and send it. */
function ask(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask or tell me something"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

const SAID_NOTHING_SAVED = /nothing was saved/i;
const SAID_MAY_HAVE_SAVED = /could not check whether that saved/i;

describe("a turn that never comes back", () => {
  it("says so, instead of going quiet", async () => {
    calls.queue = [null];
    openPanel();
    ask("Komatsu kaha hai");

    await waitFor(() => expect(spoken.join(" ")).toMatch(SAID_NOTHING_SAVED));
    // Drawn as well as spoken — a sighted helper looking over their shoulder
    // should see the same thing.
    expect(screen.getByText(SAID_NOTHING_SAVED)).toBeTruthy();
  });

  it("lets the owner try again rather than wedging the panel", async () => {
    calls.queue = [null];
    openPanel();
    ask("Komatsu kaha hai");
    await waitFor(() => expect(spoken.join(" ")).toMatch(SAID_NOTHING_SAVED));

    // The re-entry guard has to be released on the failure path too, or the
    // next tap is ignored and the panel looks dead.
    calls.queue = [{ taskId: "t2", state: "DONE", say: "It is in the yard." }];
    ask("phir se");
    await waitFor(() => expect(spoken.join(" ")).toMatch(/in the yard/));
  });
});

describe("the approval tap, which is the one that authorises a write", () => {
  /** Get the panel to the point where the amber approval card is showing. */
  async function reachApproval() {
    calls.queue = [
      {
        taskId: "t1",
        state: "READY_FOR_CONFIRMATION",
        say: "Shall I save this?",
        confirm: { summary: "Banda Patil · 2000 · today" },
      },
    ];
    openPanel();
    ask("Patil ko 2000 diye");
    await waitFor(() => screen.getByRole("button", { name: "Yes, save it" }));
  }

  it("tells the owner nothing was saved when the approval does not get through", async () => {
    await reachApproval();
    calls.queue = [null];
    fireEvent.click(screen.getByRole("button", { name: "Yes, save it" }));

    await waitFor(() => expect(spoken.join(" ")).toMatch(SAID_NOTHING_SAVED));
    // And it must NOT be the other message: nothing can have been written,
    // because the write is a plan this request was supposed to hand back.
    expect(spoken.join(" ")).not.toMatch(SAID_MAY_HAVE_SAVED);
  });

  it("confirms exactly the task it was showing", async () => {
    await reachApproval();
    calls.queue = [null];
    fireEvent.click(screen.getByRole("button", { name: "Yes, save it" }));

    await waitFor(() => expect(spoken.join(" ")).toMatch(SAID_NOTHING_SAVED));
    const confirmCall = calls.sent.find((c) => c.action === "confirm");
    expect(confirmCall?.taskId).toBe("t1");
  });
});

describe("a plan that ran, and a report that did not arrive", () => {
  it("warns that the record may exist, and not to enter it again", async () => {
    // The verify control is on the page, so as far as the browser can tell the
    // save landed. Only the REPORT of it is lost — which is precisely the case
    // where "nothing was saved" would be a lie that costs a second record.
    const card = document.createElement("div");
    card.setAttribute("data-agent-id", "active-work-card");
    card.textContent = "Working since today";
    document.body.appendChild(card);

    calls.queue = [
      {
        taskId: "t1",
        state: "EXECUTING",
        say: "One moment...",
        plan: { operations: [{ action: "navigate", route: "/excavators" }], verify: "active-work-card" },
      },
      // The result report: lost.
      null,
    ];

    openPanel();
    ask("Komatsu ka kaam shuru karo");

    await waitFor(() => expect(spoken.join(" ")).toMatch(SAID_MAY_HAVE_SAVED), { timeout: 10_000 });
    expect(spoken.join(" ")).not.toMatch(SAID_NOTHING_SAVED);

    // It reported a verified result before the connection died, which is what
    // makes this the dangerous case rather than the harmless one.
    const result = calls.sent.find((c) => c.action === "result");
    expect(result?.verified).toBe(true);

    card.remove();
  });
});

describe("in the owner's own language", () => {
  it("does not apologise in English to someone who asked in Marathi", async () => {
    calls.queue = [null];
    openPanel();

    // The language picker, as the owner would use it: a labelled button per
    // language, in that language's own script.
    fireEvent.click(screen.getByRole("button", { name: "मराठी" }));
    fireEvent.change(screen.getByPlaceholderText("काही विचारा किंवा सांगा"), {
      target: { value: "Komatsu kuthe aahe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // An English sentence is not an answer for someone who cannot read and
    // does not speak it. This is the one path where being understood matters
    // most, and it was the last one still hard-coded in English.
    await waitFor(() => expect(spoken.join(" ")).toMatch(/काहीही सेव्ह झाले नाही/));
    expect(spoken.join(" ")).not.toMatch(/Nothing was saved/);
  });
});
