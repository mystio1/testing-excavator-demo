import { beforeEach, describe, expect, it } from "vitest";
import { identifyMachine, machineLabel, type MachineRecord } from "@/lib/agent/machines";
import { __resetTasks, handleConfirm, handleMessage, handleResult, type AskFn } from "@/lib/agent/orchestrator";
import type { Actor } from "@/lib/agent/policy";
import type { AgentResponse } from "@/lib/agent/types";
import { formatBills, formatCustomers, formatOperators } from "@/lib/agent/facts";

/**
 * Which machine the owner means, settled BEFORE they are asked to approve —
 * by name, by the operator on it, or by the site it is at — and read back so a
 * wrong one is caught. Two that fit is a question; none is a question that asks
 * for the operator or the site.
 */

const m = (over: Partial<MachineRecord> & Pick<MachineRecord, "id" | "name">): MachineRecord => ({
  machineNumber: null,
  operator: null,
  site: null,
  status: "WORKING",
  hasActiveJob: true,
  ...over,
});

const FLEET: MachineRecord[] = [
  m({ id: "m1", name: "JCB", machineNumber: "MH12-01", operator: "Banda Patil", site: "Wakad" }),
  m({ id: "m2", name: "JCB", machineNumber: "MH12-02", operator: "Sagar Jadhav", site: "Hinjawadi" }),
  m({ id: "m3", name: "Komatsu PC200", operator: "Ramesh More", site: "Wakad", hasActiveJob: false, status: "IDLE" }),
];

describe("identifyMachine", () => {
  it("finds a machine by its name when only one fits", () => {
    expect(identifyMachine(FLEET, { machine: "komatsu" })).toMatchObject({ kind: "found", machine: { id: "m3" }, via: "machine" });
  });

  it("finds it by its number", () => {
    expect(identifyMachine(FLEET, { machine: "MH12 02" })).toMatchObject({ kind: "found", machine: { id: "m2" } });
  });

  it("asks which one when two machines share the name", () => {
    const r = identifyMachine(FLEET, { machine: "JCB" });
    expect(r.kind).toBe("choose");
    expect(r.kind === "choose" && r.options.map((o) => o.id)).toEqual(["m1", "m2"]);
  });

  it("uses the operator to tell two of the same name apart", () => {
    expect(identifyMachine(FLEET, { machine: "JCB", operator: "Patil" })).toMatchObject({ kind: "found", machine: { id: "m1" } });
  });

  it("uses the site to tell them apart", () => {
    expect(identifyMachine(FLEET, { machine: "JCB", site: "Hinjawadi" })).toMatchObject({ kind: "found", machine: { id: "m2" } });
  });

  it("finds a machine by its operator alone ('Patil wali machine')", () => {
    expect(identifyMachine(FLEET, { operator: "Patil" })).toMatchObject({ kind: "found", machine: { id: "m1" }, via: "operator" });
  });

  it("treats a name that is no machine as an operator or a site ('Sagar wala')", () => {
    expect(identifyMachine(FLEET, { machine: "Sagar" })).toMatchObject({ kind: "found", machine: { id: "m2" }, via: "operator" });
    expect(identifyMachine(FLEET, { machine: "Hinjawadi" })).toMatchObject({ kind: "found", machine: { id: "m2" }, via: "site" });
  });

  it("asks which one when a site has two machines", () => {
    expect(identifyMachine(FLEET, { site: "Wakad" }).kind).toBe("choose");
  });

  it("reports what was heard when nothing matches, so the question can name it", () => {
    expect(identifyMachine(FLEET, { machine: "Volvo" })).toEqual({ kind: "unknown", heard: "Volvo" });
    expect(identifyMachine(FLEET, {})).toEqual({ kind: "unknown" });
  });

  it("matches a Marathi transcript against the Latin record", () => {
    expect(identifyMachine(FLEET, { operator: "पाटील" })).toMatchObject({ kind: "found", machine: { id: "m1" } });
  });

  it("assumes the only machine when nothing was said, and still reads it back", () => {
    expect(identifyMachine([FLEET[2]!], {})).toMatchObject({ kind: "found", via: "only" });
  });

  it("labels a machine exactly as its card does", () => {
    expect(machineLabel(FLEET[0]!)).toBe("JCB MH12-01");
    expect(machineLabel(FLEET[2]!)).toBe("Komatsu PC200");
  });
});

// --- the turn loop -----------------------------------------------------------

const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
const always = (response: AgentResponse): AskFn => async () => response;
const listMachines = async () => FLEET;
const send = (text: string, response: AgentResponse, lang: "en" | "hi" | "mr" = "en", taskId?: string) =>
  handleMessage({ text, lang, taskId }, owner, { ask: always(response), listMachines });

const reading = (fields: Record<string, string | number>): AgentResponse => ({
  kind: "action",
  workflowId: "reading.add",
  fields: { date: "2026-11-27", endHourMeter: 1208, tool: "Bucket", ...fields },
});

beforeEach(__resetTasks);

describe("a reading, with the machine settled before approval", () => {
  it("reads back the machine with its operator and site, then asks to save", async () => {
    const r = await send("Patil wali machine 1200 se 1208, 30 litre", reading({ machineOperator: "Patil", startHourMeter: 1200, dieselLiters: 30 }));
    expect(r.state).toBe("READY_FOR_CONFIRMATION");
    expect(r.say).toContain("JCB MH12-01 (operator Banda Patil, site Wakad)");
    expect(r.say).toMatch(/save/i);
    // The card label is what goes forward, so the browser lands on that card.
    expect(r.confirm?.summary).toContain("JCB MH12-01");
  });

  it("carries the start meter and diesel into the form after the yes", async () => {
    const r = await send("x", reading({ machine: "JCB", machineSite: "Wakad", startHourMeter: 1200, dieselLiters: 30 }));
    const approved = await handleConfirm(r.taskId, owner);
    const fills = (approved.plan?.operations ?? []).filter((o) => o.action === "fill") as { control: string; value?: unknown }[];
    expect(fills.map((f) => f.control)).toEqual(expect.arrayContaining(["reading-startHourMeter", "endHourMeter", "dieselLiters"]));
  });

  it("asks which machine when two fit, naming each by operator and site", async () => {
    const r = await send("JCB ka reading", reading({ machine: "JCB" }));
    expect(r.state).toBe("COLLECTING_DETAILS");
    expect(r.say).toMatch(/Which machine/);
    expect(r.say).toContain("Banda Patil");
    expect(r.say).toContain("Sagar Jadhav");
    expect(r.confirm).toBeUndefined();
  });

  it("settles it on the follow-up ('Patil wala') and keeps everything else said", async () => {
    const first = await send("JCB 1208, bucket", reading({ machine: "JCB" }));
    const second = await send("Patil wala", { kind: "action", workflowId: "reading.add", fields: { machine: "Patil" } }, "en", first.taskId);
    expect(second.state).toBe("READY_FOR_CONFIRMATION");
    expect(second.say).toContain("JCB MH12-01");
    expect(second.confirm?.summary).toContain("1208");
  });

  it("asks for the operator or site when the name matches no machine", async () => {
    const r = await send("Volvo ka reading", reading({ machine: "Volvo" }));
    expect(r.say).toMatch(/couldn't find a machine called "Volvo"/);
    expect(r.say).toMatch(/operator|site/);
  });

  it("asks which machine, offering operator or site, when none was said", async () => {
    const r = await send("aaj ka reading 1208", reading({}), "hi");
    expect(r.say).toContain("ऑपरेटर या साइट");
  });

  it("refuses up front when the machine has no job running", async () => {
    const r = await send("Komatsu 1208", reading({ machine: "Komatsu" }));
    expect(r.say).toMatch(/no job running/);
    expect(r.confirm).toBeUndefined();
  });

  it("never takes the operator BEING ASSIGNED as a clue to the machine", async () => {
    const r = await send("Komatsu pe Sagar ko lagao", {
      kind: "action",
      workflowId: "machine.allocate_operator",
      fields: { machine: "Komatsu", operator: "Sagar" },
    });
    expect(r.say).toContain("Komatsu PC200");
    expect(r.confirm?.summary).toContain("Sagar");
  });

  it("works as before when no machine list is available", async () => {
    const r = await handleMessage({ text: "x", lang: "en" }, owner, { ask: always(reading({ machine: "JCB" })) });
    expect(r.state).toBe("READY_FOR_CONFIRMATION");
    expect(r.say).not.toMatch(/Machine:/);
  });
});

// --- answering list questions from the real rows -----------------------------

describe("figures for list questions", () => {
  it("lists customers most-owed first, so 'who owes the most' names someone", () => {
    const text = formatCustomers([
      { name: "Alpha Infra", totalRevenue: 50000, pending: 5000 },
      { name: "Shree Constructions", totalRevenue: 300000, pending: 120000 },
      { name: "Paid Up Ltd", totalRevenue: 10000, pending: 0 },
    ]);
    const lines = text.split("\n");
    expect(lines[1]).toContain("2 of 3 customers owe money");
    expect(lines[2]).toMatch(/^1\. Shree Constructions — owes ₹1,20,000/);
    expect(text).not.toContain("Paid Up Ltd");
  });

  it("lists unpaid bills largest balance first", () => {
    const text = formatBills([
      { billNumber: "NG-0001", customer: "A", billDate: new Date("2026-11-01"), total: 1000, paid: 900 },
      { billNumber: "NG-0002", customer: "B", billDate: new Date("2026-11-02"), total: 5000, paid: 0 },
      { billNumber: "NG-0003", customer: "C", billDate: new Date("2026-11-03"), total: 700, paid: 700 },
    ]);
    expect(text.split("\n")[2]).toMatch(/^1\. NG-0002 — B/);
    expect(text).not.toContain("NG-0003");
  });

  it("puts the most-owed operator first and says overpaid plainly", () => {
    const text = formatOperators([
      { name: "A", machine: null, remaining: -500 },
      { name: "B", machine: "JCB", remaining: 12000 },
    ]);
    expect(text.split("\n")[1]).toContain("B: machine JCB, owed ₹12,000");
    expect(text).toContain("overpaid ₹500");
  });

  it("hands the answer the figures ahead of the cut-off screen text", async () => {
    const asked = await handleMessage(
      { text: "सर्वात जास्त पेमेंट कोणाचे बाकी आहे?", lang: "mr" },
      owner,
      { ask: always({ kind: "action", workflowId: "customer.list", fields: {} }) },
    );
    let seen = "";
    const done = await handleResult(asked.taskId, owner, { verified: true, screenText: "Total Customers 5 With Pending Dues 4" }, {
      facts: async (workflowId) => (workflowId === "customer.list" ? "CUSTOMERS, most owed first.\n1. Shree Constructions — owes ₹1,20,000" : null),
      answer: async ({ screenText }) => {
        seen = screenText;
        return "Shree Constructions, ₹1,20,000.";
      },
    });
    expect(seen.indexOf("Shree Constructions")).toBeLessThan(seen.indexOf("With Pending Dues"));
    expect(done.say).toBe("Shree Constructions, ₹1,20,000.");
  });
});
