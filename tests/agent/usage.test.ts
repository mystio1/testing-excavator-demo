import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { billingMonth, recordUsage, usageFor } from "@/lib/agent/usage";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";

/**
 * What the assistant has cost, and when it stops.
 *
 * Rate limits answer "how fast". This answers "how much", which is a different
 * question with a different failure: a yard can stay inside every per-minute
 * ring and still run a monthly bill nobody budgeted for, because the model is
 * billed by tokens and a month is a lot of minutes.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("usage");
});
afterAll(async () => {
  await cleanupTenant(tenant.businessId);
});

beforeEach(async () => {
  await db.agentUsage.deleteMany({ where: { businessId: tenant.businessId } });
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("counting what was spent", () => {
  it("starts at nothing", async () => {
    const usage = await usageFor(tenant.businessId);
    expect(usage).toMatchObject({ askCalls: 0, askTokens: 0, listenCalls: 0, listenSeconds: 0 });
  });

  it("counts tokens, not requests, because that is what is billed", async () => {
    await recordUsage(tenant.businessId, { askCalls: 1, askTokens: 1_500 });
    await recordUsage(tenant.businessId, { askCalls: 1, askTokens: 900 });

    const usage = await usageFor(tenant.businessId);
    expect(usage.askCalls).toBe(2);
    // A request count would be a comfortable number that is not the bill.
    expect(usage.askTokens).toBe(2_400);
  });

  it("counts speech in its own currency", async () => {
    // Whisper is billed by audio length, not by tokens.
    await recordUsage(tenant.businessId, { listenCalls: 1, listenSeconds: 12 });
    const usage = await usageFor(tenant.businessId);
    expect(usage).toMatchObject({ listenCalls: 1, listenSeconds: 12, askTokens: 0 });
  });

  it("adds to one row per business per month, rather than growing a table", async () => {
    for (let i = 0; i < 5; i += 1) await recordUsage(tenant.businessId, { askCalls: 1, askTokens: 10 });
    expect(await db.agentUsage.count({ where: { businessId: tenant.businessId } })).toBe(1);
  });

  it("keeps each business's spending to itself", async () => {
    const other = await createTenant("usage-other");
    try {
      await recordUsage(tenant.businessId, { askTokens: 500 });
      expect((await usageFor(other.businessId)).askTokens).toBe(0);
    } finally {
      await cleanupTenant(other.businessId);
    }
  });

  it("ignores a nonsense delta rather than storing it", async () => {
    await recordUsage(tenant.businessId, { askTokens: -100 });
    expect((await usageFor(tenant.businessId)).askTokens).toBe(0);
  });

  it("uses UTC months, so one business does not straddle two", async () => {
    // Near midnight, two instances in different places must agree on which
    // month a turn belongs to.
    expect(billingMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10");
    expect(billingMonth(new Date("2026-11-01T00:30:00Z"))).toBe("2026-11");
  });
});

describe("the cap", () => {
  /** The caps are read when the module loads, so it is reloaded per case. */
  async function withCap(tokens: string) {
    vi.stubEnv("AGENT_ASK_TOKENS_PER_MONTH", tokens);
    vi.resetModules();
    return import("@/lib/agent/usage");
  }

  it("allows a business that has spent less than its month", async () => {
    const usage = await withCap("1000");
    await usage.recordUsage(tenant.businessId, { askTokens: 100 });
    await expect(usage.assertWithinBudget(tenant.businessId, "ask", "en")).resolves.toBeUndefined();
  });

  it("stops one that has spent it, and says when it comes back", async () => {
    const usage = await withCap("1000");
    await usage.recordUsage(tenant.businessId, { askTokens: 1_000 });

    // Asserted by shape, not by `instanceof`: resetModules() gives the
    // reloaded module its own copy of the error class, so the identity check
    // fails on an error that is perfectly correct.
    await expect(usage.assertWithinBudget(tenant.businessId, "ask", "en")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Said as a state of the account with an end date, not as a fault — and it
    // says the rest of the app still works.
    const err = await usage.assertWithinBudget(tenant.businessId, "ask", "en").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/limit/i);
    expect((err as Error).message).toMatch(/next month/i);
    expect((err as Error).message).toMatch(/rest of the app/i);
  });

  it("says it in the owner's own language", async () => {
    const usage = await withCap("10");
    await usage.recordUsage(tenant.businessId, { askTokens: 50 });
    const err = await usage.assertWithinBudget(tenant.businessId, "ask", "mr").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/मर्यादा/);
  });

  it("can be switched off with zero, for an account that bills differently", async () => {
    const usage = await withCap("0");
    await usage.recordUsage(tenant.businessId, { askTokens: 10_000_000 });
    await expect(usage.assertWithinBudget(tenant.businessId, "ask", "en")).resolves.toBeUndefined();
  });

  it("caps speech separately from the model", async () => {
    // One running out must not take the other with it: typing still works when
    // the voice budget is gone.
    vi.stubEnv("AGENT_LISTEN_SECONDS_PER_MONTH", "10");
    vi.stubEnv("AGENT_ASK_TOKENS_PER_MONTH", "1000000");
    vi.resetModules();
    const usage = await import("@/lib/agent/usage");

    await usage.recordUsage(tenant.businessId, { listenSeconds: 20 });
    await expect(usage.assertWithinBudget(tenant.businessId, "listen", "en")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(usage.assertWithinBudget(tenant.businessId, "ask", "en")).resolves.toBeUndefined();
  });
});
