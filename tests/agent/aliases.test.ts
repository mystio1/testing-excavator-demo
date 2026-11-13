import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { knownAliases, rememberAlias, resolveAlias } from "@/lib/agent/aliases";
import {
  __resetTasks,
  handleConfirm,
  handleMessage,
  handleResolve,
  type AskFn,
  type LookupAliasFn,
  type RememberAliasFn,
} from "@/lib/agent/orchestrator";
import type { Actor } from "@/lib/agent/policy";
import type { AgentResponse } from "@/lib/agent/types";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";

/**
 * Learning what a mishearing meant.
 *
 * Measured earlier in this project: Whisper wrote "Bundapot" where the owner
 * said "Banda Patil", and a name spelled differently matches no record — so a
 * perfectly clear instruction ended in "I couldn't find that". The vocabulary
 * prompt reduces that; it does not eliminate it. What is being tested here is
 * that the owner never has to correct the same thing twice, and that nothing
 * is learned from a guess.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("alias");
});
afterAll(async () => {
  await cleanupTenant(tenant.businessId);
});

beforeEach(async () => {
  await db.agentNameAlias.deleteMany({ where: { businessId: tenant.businessId } });
  __resetTasks();
});

describe("remembering a correction", () => {
  it("resolves the same mishearing next time", async () => {
    await rememberAlias({
      businessId: tenant.businessId,
      kind: "operator",
      heard: "Bundapot",
      label: "Banda Patil",
    });
    expect(await resolveAlias(tenant.businessId, "operator", "Bundapot")).toBe("Banda Patil");
  });

  it("ignores spelling and case in the mishearing, as matching does", async () => {
    await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "Bundapot", label: "Banda Patil" });
    expect(await resolveAlias(tenant.businessId, "operator", "  bundapot!  ")).toBe("Banda Patil");
  });

  it("keeps a correction to one kind out of another", async () => {
    // A customer called "Patil" must never start resolving an operator.
    await rememberAlias({ businessId: tenant.businessId, kind: "customer", heard: "Pateel", label: "Patil Traders" });
    expect(await resolveAlias(tenant.businessId, "customer", "Pateel")).toBe("Patil Traders");
    expect(await resolveAlias(tenant.businessId, "operator", "Pateel")).toBeNull();
  });

  it("keeps one business's corrections out of another's", async () => {
    const other = await createTenant("alias-other");
    try {
      await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "Bundapot", label: "Banda Patil" });
      expect(await resolveAlias(other.businessId, "operator", "Bundapot")).toBeNull();
    } finally {
      await cleanupTenant(other.businessId);
    }
  });

  it("lets a second correction of the same mishearing win", async () => {
    // The owner is the authority on what they said, and the latest answer is
    // the best one available.
    await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "Patil", label: "Banda Patil" });
    await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "Patil", label: "Sagar Patil" });
    expect(await resolveAlias(tenant.businessId, "operator", "Patil")).toBe("Sagar Patil");
    // One row, not two.
    expect(await db.agentNameAlias.count({ where: { businessId: tenant.businessId } })).toBe(1);
  });

  it("learns nothing from a fragment, which would hijack every short answer", async () => {
    await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "a", label: "Banda Patil" });
    await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "2", label: "Banda Patil" });
    expect(await db.agentNameAlias.count({ where: { businessId: tenant.businessId } })).toBe(0);
  });

  it("learns nothing when it heard the name correctly anyway", async () => {
    await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "banda patil", label: "Banda Patil" });
    expect(await db.agentNameAlias.count({ where: { businessId: tenant.businessId } })).toBe(0);
  });

  it("offers the corrections for the speech prompt, most used first", async () => {
    await rememberAlias({ businessId: tenant.businessId, kind: "operator", heard: "Bundapot", label: "Banda Patil" });
    await rememberAlias({ businessId: tenant.businessId, kind: "machine", heard: "Kamatsu", label: "Komatsu PC200" });
    await resolveAlias(tenant.businessId, "machine", "Kamatsu");
    await resolveAlias(tenant.businessId, "machine", "Kamatsu");

    const aliases = await knownAliases(tenant.businessId);
    expect(aliases.map((a) => a.label)).toContain("Banda Patil");
    expect(aliases[0]!.label).toBe("Komatsu PC200");
  });
});

describe("the turn that does the correcting", () => {
  const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
  const always = (response: AgentResponse): AskFn => async () => response;

  const payPatil: AgentResponse = {
    kind: "action",
    workflowId: "operator.transaction.add",
    fields: { operator: "Bundapot", amount: 2000, category: "cat_1", date: "2026-10-23" },
  };

  it("remembers what was picked and carries on with it", async () => {
    const remembered: { heard: string; label: string; kind: string }[] = [];
    const remember: RememberAliasFn = async (input) => {
      remembered.push({ heard: input.heard, label: input.label, kind: input.kind });
    };

    const proposed = await handleMessage({ text: "Bundapot ko 2000 diya", lang: "hi" }, owner, {
      ask: always(payPatil),
    });

    const resolved = await handleResolve(
      {
        taskId: proposed.taskId,
        field: "operator",
        heard: "Bundapot",
        chosen: "Banda Patil",
        lang: "hi",
      },
      owner,
      { remember },
    );

    // Learned, under the right kind.
    expect(remembered).toEqual([{ heard: "Bundapot", label: "Banda Patil", kind: "operator" }]);
    // And the turn moved on rather than starting over — with the right name,
    // and still asking for approval because this is money.
    expect(resolved.confirm?.summary).toContain("Banda Patil");
    expect(resolved.confirm?.summary).toContain("2000");
    expect(resolved.state).toBe("READY_FOR_CONFIRMATION");
  });

  it("re-asks for approval against the corrected values, not the old ones", async () => {
    const proposed = await handleMessage({ text: "Bundapot ko 2000 diya", lang: "hi" }, owner, {
      ask: always(payPatil),
    });
    // An approval given before the correction must not cover it.
    await handleConfirm(proposed.taskId, owner);

    const resolved = await handleResolve(
      { taskId: proposed.taskId, field: "operator", heard: "Bundapot", chosen: "Banda Patil", lang: "hi" },
      owner,
      { remember: async () => undefined },
    );
    expect(resolved.state).toBe("READY_FOR_CONFIRMATION");
    expect(resolved.plan).toBeUndefined();
  });

  it("refuses a field the workflow does not have", async () => {
    const proposed = await handleMessage({ text: "Bundapot ko 2000 diya", lang: "hi" }, owner, {
      ask: always(payPatil),
    });
    const resolved = await handleResolve(
      { taskId: proposed.taskId, field: "not-a-field", heard: "x", chosen: "y", lang: "en" },
      owner,
      { remember: async () => undefined },
    );
    expect(resolved.plan).toBeUndefined();
    expect(resolved.confirm).toBeUndefined();
  });

  it("will not let another user correct someone else's turn", async () => {
    const proposed = await handleMessage({ text: "Bundapot ko 2000 diya", lang: "hi" }, owner, {
      ask: always(payPatil),
    });
    const intruder: Actor = { kind: "owner", businessId: "b1", userId: "someone-else" };
    const stolen = await handleResolve(
      { taskId: proposed.taskId, field: "operator", heard: "Bundapot", chosen: "Banda Patil", lang: "hi" },
      intruder,
      { remember: async () => undefined },
    );
    // Said in the language the request came in, not in English.
    expect(stolen.say).toMatch(/अनुरोध खत्म|expired/i);
  });
});

describe("a correction already made is applied without being asked again", () => {
  const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
  const always = (response: AgentResponse): AskFn => async () => response;

  it("rewrites the heard name before anything is shown for approval", async () => {
    const lookupAlias: LookupAliasFn = async (_b, kind, heard) =>
      kind === "operator" && heard === "Bundapot" ? "Banda Patil" : null;

    const proposed = await handleMessage({ text: "Bundapot ko 2000 diya", lang: "hi" }, owner, {
      ask: always({
        kind: "action",
        workflowId: "operator.transaction.add",
        fields: { operator: "Bundapot", amount: 2000, category: "cat_1", date: "2026-10-23" },
      }),
      lookupAlias,
    });

    // The owner is never asked about this mishearing a second time.
    expect(proposed.confirm?.summary).toContain("Banda Patil");
    expect(proposed.confirm?.summary).not.toContain("Bundapot");
  });

  it("leaves a name it has never been corrected on alone", async () => {
    const lookupAlias = vi.fn<LookupAliasFn>(async () => null);
    const proposed = await handleMessage({ text: "Patil ko 2000 diya", lang: "hi" }, owner, {
      ask: always({
        kind: "action",
        workflowId: "operator.transaction.add",
        fields: { operator: "Patil", amount: 2000, category: "cat_1", date: "2026-10-23" },
      }),
      lookupAlias,
    });
    expect(proposed.confirm?.summary).toContain("Patil");
    expect(lookupAlias).toHaveBeenCalledWith("b1", "operator", "Patil");
  });
});
