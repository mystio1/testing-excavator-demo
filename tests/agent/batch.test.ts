import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetTasks,
  handleConfirm,
  handleMessage,
  handleResult,
  type AskFn,
} from "@/lib/agent/orchestrator";
import {
  ALL,
  advance,
  finishedLine,
  meansAll,
  newBatch,
  startingLine,
  type ListRecordsFn,
} from "@/lib/agent/batch";
import type { Actor } from "@/lib/agent/policy";

/**
 * "सारी मशीन चालू करो" — one sentence, several jobs.
 *
 * The owner says it once and means a job on every idle machine, each with its
 * own site, customer and starting hour meter. The app used to answer "I can't
 * do that in this app yet", which is honest and useless in a yard with four
 * machines in it.
 *
 * What is tested here is that it is a QUEUE and not a bulk write. Every
 * machine still gets its own questions and its own approval; what the owner is
 * saved is having to start each one by hand.
 */

const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };

/** Four idle machines, as the database would report them. */
const machines: ListRecordsFn = async () => [
  { value: "m1", label: "Komatsu PC200" },
  { value: "m2", label: "JCB 3DX" },
  { value: "m3", label: "Tata Hitachi EX200" },
  { value: "m4", label: "Hyundai R215" },
];

/** The model understood "all machines" and marked the record field. */
const startsAll: AskFn = async () => ({
  kind: "action",
  workflowId: "work.start",
  fields: { machine: ALL },
});

beforeEach(() => __resetTasks());

describe("the queue itself", () => {
  const four = () =>
    newBatch("machine", [
      { value: "m1", label: "Komatsu PC200" },
      { value: "m2", label: "JCB 3DX" },
      { value: "m3", label: "Tata Hitachi EX200" },
    ])!;

  it("is not a batch when there is only one record", () => {
    // "1 of 1" is noise, and the ordinary single-record path already handles it.
    expect(newBatch("machine", [{ value: "m1", label: "Komatsu PC200" }])).toBeNull();
    expect(newBatch("machine", [])).toBeNull();
  });

  it("counts from one and says how many there are", () => {
    const b = four();
    expect(startingLine(b, "en")).toContain("Komatsu PC200");
    expect(startingLine(b, "en")).toContain("1 of 3");
  });

  it("moves on, remembering what was finished", () => {
    let b = four();
    b = advance(b, "done")!;
    expect(b.current.label).toBe("JCB 3DX");
    expect(b.done).toEqual(["Komatsu PC200"]);
    expect(startingLine(b, "en")).toContain("2 of 3");
  });

  it("keeps going past one that failed, and names it at the end", () => {
    // A machine that could not be started must not stop the other three, and
    // a count would hide which one needs doing by hand.
    let b = four();
    b = advance(b, "done")!;
    b = advance(b, "failed")!;
    b = advance(b, "done")!;
    expect(b.done).toEqual(["Komatsu PC200", "Tata Hitachi EX200"]);
    expect(b.failed).toEqual(["JCB 3DX"]);
    const line = finishedLine(b, "en");
    expect(line).toContain("JCB 3DX");
    expect(line).toContain("2 done");
  });

  it("says so plainly when every one worked", () => {
    let b = four();
    b = advance(b, "done")!;
    b = advance(b, "done")!;
    b = advance(b, "done")!;
    expect(finishedLine(b, "en")).toBe("All 3 done.");
  });
});

describe("asking for all of them", () => {
  it("starts on the first machine and says how many are coming", async () => {
    const reply = await handleMessage({ text: "sari machine chalu karo", lang: "hi" }, owner, {
      ask: startsAll,
      listRecords: machines,
    });

    // It names the machine it is on, and that there are four — somebody who
    // cannot see a progress bar has no other way to know.
    expect(reply.say).toContain("Komatsu PC200");
    expect(reply.say).toContain("4");
    // And it is asking this machine's own question, not writing anything.
    expect(reply.state).toBe("COLLECTING_DETAILS");
    expect(reply.plan).toBeUndefined();
  });

  it("does not become a batch when only one machine is idle", async () => {
    const one: ListRecordsFn = async () => [{ value: "m1", label: "Komatsu PC200" }];
    const reply = await handleMessage({ text: "sari machine chalu karo", lang: "hi" }, owner, {
      ask: startsAll,
      listRecords: one,
    });
    expect(reply.say).not.toContain("1 of 1");
    expect(reply.state).toBe("COLLECTING_DETAILS");
  });

  it("says there is nothing to do rather than starting an empty queue", async () => {
    const none: ListRecordsFn = async () => [];
    const reply = await handleMessage({ text: "sari machine chalu karo", lang: "hi" }, owner, {
      ask: startsAll,
      listRecords: none,
    });
    expect(reply.say).toMatch(/नहीं है|nothing/i);
    expect(reply.plan).toBeUndefined();
  });
});

describe("working through them", () => {
  /** Get a batch to the point where the first machine is saved. */
  async function firstMachineSaved() {
    const started = await handleMessage({ text: "sari machine chalu karo", lang: "hi" }, owner, {
      ask: startsAll,
      listRecords: machines,
    });

    // Fill in this machine's own answers, one at a time, as the owner would.
    let id = started.taskId;
    for (const [field, value] of [
      ["site", "Hinjawadi Phase 2"],
      ["customer", "Shree Constructions"],
      ["startHourMeter", 1200],
    ] as const) {
      const reply = await handleMessage({ taskId: id, text: String(value), lang: "hi" }, owner, {
        ask: async () => ({ kind: "action", workflowId: "work.start", fields: { [field]: value } }),
        listRecords: machines,
      });
      id = reply.taskId;
      // Once every answer is in, the approval card appears — a batch does not
      // skip it, which is the whole point.
      if (reply.state === "READY_FOR_CONFIRMATION") {
        const approved = await handleConfirm(id, owner, {}, "hi");
        expect(approved.plan, "approving should hand the browser a plan").toBeDefined();
        return approved.taskId;
      }
    }
    throw new Error("the first machine never reached its approval card");
  }

  it("moves to the next machine by itself once one is saved", async () => {
    const id = await firstMachineSaved();
    // Approving and running the plan is covered elsewhere; this is about what
    // happens the moment the browser reports the first one verified.
    const after = await handleResult(id, owner, { verified: true });

    // It does not stop at "saved" and wait to be told to do the next one.
    expect(after.say).toContain("JCB 3DX");
    // In Hindi, because the turn was: "4 में से 2" is "2 of 4".
    expect(after.say).toMatch(/4 में से 2|2 of 4/);
    // A NEW task, because SUCCEEDED is terminal by design and driving a
    // finished task again is the rule that stops a saved job being saved twice.
    expect(after.taskId).not.toBe(id);
    expect(after.state).toBe("COLLECTING_DETAILS");
  });

  it("asks the next machine its own questions, not the last one's answers", async () => {
    const id = await firstMachineSaved();
    const after = await handleResult(id, owner, { verified: true });
    // The site is per machine. Carrying Hinjawadi onto the JCB is how a whole
    // afternoon gets filed against the wrong job.
    expect(after.say).not.toContain("Hinjawadi");
  });
});

describe("spotting 'all of them' without asking the model", () => {
  /**
   * The model was asked nicely in the prompt and still refused the variants:
   * "मैं एक साथ सभी मशीनों को चालू नहीं कर सकता". Every capability it is shown
   * describes one record, and that prior beats a rule. So the app decides —
   * the same lesson as the day words in dates.ts.
   */
  const yes = [
    "sari machine chalu karo",
    "saari machine chalu karo",
    "सारी मशीन चालू करो",
    "sarva machine chalu kara",
    "सर्व मशीन चालू करा",
    "sab machine start karo",
    "start all machines",
    "सभी मशीन चालू करो",
  ];
  const no = [
    "Komatsu chalu karo",
    "machine chalu karo",
    "JCB ka kaam shuru karo",
    "Banda Patil ko 2000 diye",
  ];

  it.each(yes)("%s means all of them", (text) => {
    expect(meansAll(text)).toBe(true);
  });

  it.each(no)("%s does not", (text) => {
    expect(meansAll(text)).toBe(false);
  });
});
