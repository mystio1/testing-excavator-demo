import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetTasks,
  handleConfirm,
  handleMessage,
  handleResult,
  type AskFn,
} from "@/lib/agent/orchestrator";
import type { Actor } from "@/lib/agent/policy";
import { GroqError } from "@/lib/agent/groq";
import type { AgentResponse } from "@/lib/agent/types";

/**
 * The whole turn loop, with the model injected. Every path to a write goes
 * through here, so this is where "it cannot save without being told to, and
 * cannot claim it saved without being shown" is actually proved.
 */

const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
const intruder: Actor = { kind: "owner", businessId: "b1", userId: "someone-else" };

/** A model that always answers the same thing. */
const always = (response: AgentResponse): AskFn => async () => response;

const startWorkAction: AgentResponse = {
  kind: "action",
  workflowId: "work.start",
  fields: { machine: "Komatsu PC200", customer: "cus_1", site: "Wakad", startHourMeter: 1200 },
};

const send = (text: string, ask: AskFn, taskId?: string) =>
  handleMessage({ taskId, text, lang: "en" }, owner, { ask });

beforeEach(__resetTasks);

describe("a complete job, start to saved", () => {
  it("asks for approval before touching anything, then runs and verifies", async () => {
    const proposed = await send("Komatsu ka kaam shuru karo, Wakad", always(startWorkAction));

    // Nothing to execute yet: a write is approved before it is planned.
    expect(proposed.state).toBe("READY_FOR_CONFIRMATION");
    expect(proposed.plan).toBeUndefined();
    expect(proposed.confirm?.summary).toContain("Wakad");

    const approved = await handleConfirm(proposed.taskId, owner);
    expect(approved.state).toBe("EXECUTING");
    expect(approved.plan?.operations[0]).toEqual({ action: "navigate", route: "/excavators" });
    expect(approved.plan?.verify).toBe("active-work-card");

    // The browser reports what the screen showed; only that can finish it.
    const done = await handleResult(proposed.taskId, owner, { verified: true });
    expect(done.state).toBe("SUCCEEDED");
    expect(done.say).toMatch(/saved/i);
  });

  it("will not claim success when the screen never showed it", async () => {
    const proposed = await send("start work", always(startWorkAction));
    await handleConfirm(proposed.taskId, owner);

    const unsure = await handleResult(proposed.taskId, owner, { verified: false });
    expect(unsure.state).toBe("NEEDS_RECOVERY");
    // Uncertain, and said as uncertain: "failed" would send the owner to redo
    // it by hand and risk a second record.
    expect(unsure.say).toMatch(/not sure/i);
    expect(unsure.say).not.toMatch(/^Done/);
    // And warned off the one thing that turns doubt into a duplicate.
    expect(unsure.say).toMatch(/twice/i);
  });

  it("reads the page back instead of telling a non-reader to go and read it", async () => {
    const proposed = await send("start work", always(startWorkAction));
    await handleConfirm(proposed.taskId, owner);

    const unsure = await handleResult(
      proposed.taskId,
      owner,
      { verified: false, screenText: "This machine is not on a job right now." },
      {
        answer: async ({ screenText }) => {
          expect(screenText).toContain("not on a job");
          return "The machine still shows no job.";
        },
      },
    );
    expect(unsure.state).toBe("NEEDS_RECOVERY");
    expect(unsure.say).toContain("The machine still shows no job.");
    // Still uncertain — reading the page is not the same as verifying it.
    expect(unsure.say).toMatch(/not sure/i);
  });

  it("falls back to plain wording when the page cannot be read back", async () => {
    const proposed = await send("start work", always(startWorkAction));
    await handleConfirm(proposed.taskId, owner);
    const unsure = await handleResult(
      proposed.taskId,
      owner,
      { verified: false, screenText: "something" },
      {
        answer: async () => {
          throw new Error("summariser down");
        },
      },
    );
    expect(unsure.say).toMatch(/not sure/i);
    expect(unsure.say).toMatch(/twice/i);
  });

  it("reports what went wrong on screen rather than a generic failure", async () => {
    const proposed = await send("start work", always(startWorkAction));
    await handleConfirm(proposed.taskId, owner);

    const failed = await handleResult(proposed.taskId, owner, {
      verified: false,
      error: "That button is not available yet.",
    });
    // Still specific — it says WHICH step failed, which is more use than
    // "something went wrong" — but in the owner's language and without the
    // name of the DOM control the controller was looking for. That id stays in
    // the trail and the log, where it is useful and nobody has to read it.
    expect(failed.say).toContain("button");
    expect(failed.say, "the control id must not be read aloud").not.toMatch(/-trigger|submit-|data-agent/);
  });
});

describe("a question gets an answer, not a receipt", () => {
  const dashboardAction: AgentResponse = {
    kind: "action",
    workflowId: "business.dashboard.view",
    fields: {},
  };

  it("answers from what the screen actually showed", async () => {
    const asked = await send("is mahine kitna kaam hua?", always(dashboardAction));
    // A read needs no approval, so it goes straight to a plan.
    expect(asked.state).toBe("EXECUTING");
    expect(asked.confirm).toBeUndefined();

    const answered = await handleResult(
      asked.taskId,
      owner,
      { verified: true, screenText: "Hours This Month 126.3 hrs · Revenue ₹4,75,000" },
      {
        answer: async ({ question, screenText }) => {
          // The question and the real screen text both reach the summariser.
          expect(question).toContain("kitna kaam");
          expect(screenText).toContain("126.3");
          return "Is mahine 126.3 ghante kaam hua hai.";
        },
      },
    );

    expect(answered.say).toBe("Is mahine 126.3 ghante kaam hua hai.");
    // "Done, it's saved" would be nonsense: nothing was saved.
    expect(answered.say).not.toMatch(/saved/i);
  });

  it("still confirms a save for a write", async () => {
    const proposed = await send("start work", always(startWorkAction));
    await handleConfirm(proposed.taskId, owner);
    const done = await handleResult(proposed.taskId, owner, { verified: true });
    expect(done.say).toMatch(/saved/i);
  });

  it("says so when the page held nothing to read", async () => {
    const asked = await send("dashboard dikhao", always(dashboardAction));
    const answered = await handleResult(asked.taskId, owner, { verified: true, screenText: "  " });
    expect(answered.say).toMatch(/nothing to read/i);
  });

  it("falls back to pointing at the page when the summary fails", async () => {
    const asked = await send("dashboard dikhao", always(dashboardAction));
    const answered = await handleResult(
      asked.taskId,
      owner,
      { verified: true, screenText: "Revenue ₹4,75,000" },
      {
        answer: async () => {
          throw new Error("summariser down");
        },
      },
    );
    // The page IS open and correct, so do not imply the lookup failed.
    expect(answered.say).toMatch(/opened it/i);
    expect(answered.state).toBe("SUCCEEDED");
  });
});

describe("it asks rather than assumes", () => {
  it("collects a missing detail instead of inventing one", async () => {
    const partial: AgentResponse = {
      kind: "action",
      workflowId: "work.start",
      fields: { machine: "Komatsu PC200" },
    };
    const reply = await send("Komatsu ka kaam shuru karo", always(partial));

    expect(reply.state).toBe("COLLECTING_DETAILS");
    expect(reply.plan).toBeUndefined();
    expect(reply.say).toBe("Which customer?");
  });

  it("passes a clarifying question straight through", async () => {
    const reply = await send(
      "Patil ka kaam",
      always({ kind: "clarify", field: "operator", question: "Banda Patil or Sagar Patil?" }),
    );
    expect(reply.say).toBe("Banda Patil or Sagar Patil?");
    expect(reply.plan).toBeUndefined();
  });

  it("answers in the chosen language when the model just replies", async () => {
    const reply = await send("namaskar", always({ kind: "reply", message: "नमस्कार" }));
    expect(reply.say).toBe("नमस्कार");
  });
});

describe("a day said in words never reaches a form raw", () => {
  const readingOn = (date: string): AgentResponse => ({
    kind: "action",
    workflowId: "reading.add",
    fields: { machine: "Komatsu PC200", date, endHourMeter: 1208 },
  });

  it("turns a day it understands into a real date", async () => {
    const proposed = await handleMessage({ text: "aaj ka reading", lang: "hi" }, owner, {
      ask: always(readingOn("aaj")),
    });
    const approved = await handleConfirm(proposed.taskId, owner);
    const filled = approved.plan!.operations.find(
      (o) => "control" in o && o.control === "date",
    ) as { value: string };
    // Not the word "aaj": an <input type="date"> silently ignores that.
    expect(filled.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("asks which day when the word means two days", async () => {
    // Hindi "kal" is yesterday AND tomorrow. Picking one would date a job
    // wrongly with nothing on screen to show for it.
    const reply = await handleMessage({ text: "kal ka reading daal do", lang: "hi" }, owner, {
      ask: always(readingOn("kal")),
    });
    expect(reply.plan).toBeUndefined();
    expect(reply.confirm).toBeUndefined();
    expect(reply.say).toContain("कौन सा दिन");
  });

  it("asks rather than letting the form's default stand in", async () => {
    // startDate is OPTIONAL on work.start, so an unreadable value dropped as
    // "absent" would silently record today for a job that started earlier.
    const reply = await send(
      "pichhle hafte se kaam chalu hai",
      always({
        kind: "action",
        workflowId: "work.start",
        fields: { ...startWorkAction.fields, startDate: "pichhle hafte" },
      }),
    );
    expect(reply.plan).toBeUndefined();
    expect(reply.confirm).toBeUndefined();
  });
});

describe("what the model cannot talk its way into", () => {
  it("refuses a capability the app does not have", async () => {
    const reply = await send(
      "add a trip from Wakad to Hinjawadi for 1200",
      always({ kind: "action", workflowId: "trip.create", fields: { amount: 1200 } }),
    );
    expect(reply.plan).toBeUndefined();
    expect(reply.say).toMatch(/can't do that/i);
  });

  it("refuses a workflow that is registered but not wired up", async () => {
    const reply = await send(
      "diesel daal do",
      always({ kind: "action", workflowId: "reading.add", fields: { machine: "JCB" } }),
    );
    expect(reply.plan).toBeUndefined();
  });

  it("drops fields the workflow never declared", async () => {
    const sneaky: AgentResponse = {
      kind: "action",
      workflowId: "work.start",
      fields: { ...startWorkAction.fields, isAdmin: "true", amount: 99999 },
    };
    const proposed = await send("start work", always(sneaky));
    const approved = await handleConfirm(proposed.taskId, owner);

    const touched = approved.plan!.operations.flatMap((o) => ("control" in o ? [o.control] : []));
    expect(touched).not.toContain("isAdmin");
    expect(touched).not.toContain("amount");
  });

  it("cannot execute without an approval, however the turn is replayed", async () => {
    const proposed = await send("start work", always(startWorkAction));
    // Same message again: still a confirmation, never a plan.
    const again = await send("start work", always(startWorkAction), proposed.taskId);
    expect(again.plan).toBeUndefined();
    expect(again.state).toBe("READY_FOR_CONFIRMATION");
  });
});

describe("a correction after approval", () => {
  it("needs approving again, and the old yes does not carry over", async () => {
    const first = await send("start work at Wakad", always(startWorkAction));
    expect(first.state).toBe("READY_FOR_CONFIRMATION");

    // "Hinjawadi, not Wakad" — same task, different values.
    const corrected: AgentResponse = {
      kind: "action",
      workflowId: "work.start",
      fields: { ...startWorkAction.fields, site: "Hinjawadi" },
    };
    const second = await send("Hinjawadi, not Wakad", always(corrected), first.taskId);

    expect(second.state).toBe("READY_FOR_CONFIRMATION");
    expect(second.confirm?.summary).toContain("Hinjawadi");
    expect(second.plan).toBeUndefined();

    const approved = await handleConfirm(second.taskId, owner);
    expect(approved.plan!.operations).toContainEqual({
      action: "fill",
      control: "siteName",
      value: "Hinjawadi",
    });
  });
});

describe("one owner's task is not another's", () => {
  it("will not let a different user approve it", async () => {
    const proposed = await send("start work", always(startWorkAction));
    const stolen = await handleConfirm(proposed.taskId, intruder);
    expect(stolen.plan).toBeUndefined();
    // Said in the language the request came in, not in English.
    expect(stolen.say).toMatch(/अनुरोध खत्म|expired/i);
  });

  it("will not let a different user report its result", async () => {
    const stolen = await handleResult("00000000-0000-4000-8000-000000000000", intruder, { verified: true });
    expect(stolen.state).toBe("FAILED");
  });
});

describe("when the model cannot be reached", () => {
  it("says so plainly and leaves the task alone", async () => {
    const failing: AskFn = async () => {
      throw new GroqError("nope", "http");
    };
    const reply = await send("kuch bhi", failing);
    expect(reply.plan).toBeUndefined();
    expect(reply.say).toMatch(/went wrong/i);
  });

  it("tells the owner to wait when the service is over its limit", async () => {
    const limited: AskFn = async () => {
      throw new GroqError("429", "rate_limited");
    };
    const reply = await handleMessage({ text: "kuch bhi", lang: "hi" }, owner, { ask: limited });
    // Not "something went wrong", which invites hammering it.
    expect(reply.say).toContain("थोड़ा रुककर");
    expect(reply.plan).toBeUndefined();
  });

  it("keeps a per-minute limit a blip, not an outage", async () => {
    // Clears in seconds. Pointing at the buttons for this would be noise, and
    // would teach the owner to distrust the microphone over nothing.
    const limited: AskFn = async () => {
      throw new GroqError("429", "rate_limited", 12);
    };
    const reply = await handleMessage({ text: "kuch bhi", lang: "hi" }, owner, { ask: limited });
    expect(reply.say).toContain("थोड़ा रुककर");
    expect(reply.degraded).toBeUndefined();
  });

  it("treats a spent daily allowance as the model being gone, and leads with the buttons", async () => {
    // The measured case: "tokens per day (TPD): Limit 200000, Used 199860.
    // Please try again in 9m25.92s." Told to "wait a moment" the owner would
    // come back every few minutes until midnight and be refused every time,
    // while the tappable reads worked the whole while.
    const spent: AskFn = async () => {
      throw new GroqError("429 tokens per day", "rate_limited", 565);
    };
    const reply = await handleMessage({ text: "kuch bhi", lang: "hi" }, owner, { ask: spent });

    expect(reply.degraded).toBe(true);
    // "the app is working, use the buttons below" — not "ask again shortly".
    expect(reply.say).toContain("बटन");
    expect(reply.say).not.toContain("थोड़ा रुककर");
    // And nothing was advanced on a guess.
    expect(reply.plan).toBeUndefined();
  });

  it("says it is not set up when there is no key", async () => {
    const noKey: AskFn = async () => {
      throw new GroqError("no key", "no_key");
    };
    const reply = await handleMessage({ text: "hello", lang: "hi" }, owner, { ask: noKey });
    expect(reply.say).toContain("सहायक");
  });
});

/**
 * Saying a second thing.
 *
 * Found by running the app, not by a test: the first spoken instruction
 * worked, and every one after it came back "Sorry, that did not go through"
 * with a 500 in the log —
 *
 *     TaskTransitionError: A task cannot go from SUCCEEDED to EXECUTING
 *
 * The panel sends the last task's id with every message, and `loadTask`
 * handed that finished task straight back to be driven again. SUCCEEDED,
 * FAILED and CANCELLED have no transitions out of them by design, so the
 * state machine was right to refuse; the bug was asking it to.
 *
 * It survived every existing test because each one does a single turn, and
 * because the tappable shortcuts go through handleRun, which always starts a
 * fresh task. Only a *typed or spoken* second sentence reached it — which is
 * to say, the ordinary way the thing is used.
 */
describe("a second instruction, after the first one finished", () => {
  const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
  const reads: AskFn = async () => ({ kind: "action", workflowId: "machine.list", fields: {} });

  /** Drive one read all the way to SUCCEEDED, as a real turn does. */
  async function completeATurn(): Promise<string> {
    const first = await handleMessage({ text: "meri machine", lang: "hi" }, owner, { ask: reads });
    expect(first.plan, "the first turn should have produced a plan").toBeDefined();
    const done = await handleResult(
      first.taskId,
      owner,
      { verified: true, screenText: "Komatsu PC200 — idle" },
      { answer: async () => "Komatsu PC200 is idle." },
    );
    expect(done.state).toBe("SUCCEEDED");
    return first.taskId;
  }

  it("does not fail just because the last one is finished", async () => {
    const finished = await completeATurn();

    // Exactly what the panel sends next: the same taskId, a new sentence.
    const second = await handleMessage(
      { taskId: finished, text: "mere customer dikhao", lang: "hi" },
      owner,
      { ask: async () => ({ kind: "action", workflowId: "customer.list", fields: {} }) },
    );

    expect(second.plan, "the second instruction produced no plan").toBeDefined();
    expect(second.say).not.toMatch(/went wrong|नहीं हो पाया/);
  });

  it("gives the new instruction a task of its own", async () => {
    const finished = await completeATurn();
    const second = await handleMessage(
      { taskId: finished, text: "mere customer dikhao", lang: "hi" },
      owner,
      { ask: async () => ({ kind: "action", workflowId: "customer.list", fields: {} }) },
    );
    // A finished task is finished. Carrying on in it would mean one row in the
    // trail covering two different instructions.
    expect(second.taskId).not.toBe(finished);
  });

  it("still carries on with a task that is mid-conversation", async () => {
    // The other half of the rule: when the app has asked for a missing detail,
    // the next sentence IS part of the same instruction and must not start over.
    const asked = await handleMessage({ text: "paise diye", lang: "hi" }, owner, {
      ask: async () => ({ kind: "clarify", question: "Kitne?", workflowId: "operator.transaction.add", fields: {} }),
    });
    // A clarify leaves the task mid-flight at RESOLVING_WORKFLOW — still
    // being composed, which is the point.
    expect(asked.state).toBe("RESOLVING_WORKFLOW");

    const answered = await handleMessage({ taskId: asked.taskId, text: "do hazaar", lang: "hi" }, owner, {
      ask: async () => ({ kind: "clarify", question: "Kisko?", workflowId: "operator.transaction.add", fields: {} }),
    });
    expect(answered.taskId, "an answer started a new task instead of continuing").toBe(asked.taskId);
  });
});
