import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { QUOTAS, listenRules, turnRules } from "@/lib/agent/quota";

/**
 * Who is allowed how much of the shared account.
 *
 * The property that matters is fairness, and it is not obvious from reading
 * the rules: a per-user limit protected nothing, because a business with five
 * signed-in users simply got five times the allowance, and one busy yard could
 * spend the whole account's per-minute ceiling — handing every other customer
 * "Sorry, something went wrong" for something they had no part in.
 *
 * These exercise the real database-backed limiter, because the sliding window
 * and the key naming are where a fairness bug would actually hide.
 */

const keysOf = (rules: { key: string }[]) => rules.map((r) => r.key);

beforeEach(async () => {
  await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'agent%'`;
});

describe("the rings a turn is counted against", () => {
  const who = { userId: "u1", businessId: "b1" };

  it("counts a model call against the user, the business and the account", () => {
    const keys = keysOf(turnRules(who, true));
    expect(keys).toContain("agent:ask:u1");
    expect(keys).toContain("agent:ask:biz:b1");
    expect(keys).toContain("agent:ask:global");
  });

  it("does not spend the model allowance on bookkeeping beats", () => {
    // One spoken command is up to three requests — message, confirm, result —
    // and only the first reaches the model.
    const keys = keysOf(turnRules(who, false));
    expect(keys).not.toContain("agent:ask:u1");
    expect(keys).not.toContain("agent:ask:global");
    expect(keys).toContain("agent:user:u1");
  });

  it("keys every ring by business as well as user, so nothing is global by accident", () => {
    const keys = keysOf(turnRules(who, true));
    // A key that mentions neither is a key shared by tenants that should not
    // share one. Only the deliberate backstop may be unscoped.
    const unscoped = keys.filter((k) => !k.includes("u1") && !k.includes("b1"));
    expect(unscoped).toEqual(["agent:ask:global"]);
  });

  it("counts speech against its own rings, not the model's", () => {
    const keys = keysOf(listenRules(who));
    expect(keys).toContain("agent-listen:biz:b1");
    expect(keys).toContain("agent-listen:global");
    expect(keys.some((k) => k.startsWith("agent:ask"))).toBe(false);
  });
});

describe("one business cannot spend another's share", () => {
  it("stops the busy tenant and leaves the quiet one untouched", async () => {
    const { consumeRateLimit } = await import("@/lib/rateLimit");
    const busy = { userId: "busy-user", businessId: "busy-biz" };
    const quiet = { userId: "quiet-user", businessId: "quiet-biz" };

    // Spend the busy tenant's whole per-business minute, and then some.
    const perBusiness = turnRules(busy, true).find((r) => r.key === `agent:ask:biz:${busy.businessId}`)!;
    let refused = false;
    for (let i = 0; i < QUOTAS.askPerBusinessMinute + 2; i += 1) {
      const result = await consumeRateLimit(perBusiness);
      if (!result.allowed) refused = true;
    }
    expect(refused, "the busy tenant should be stopped by its own ring").toBe(true);

    // The quiet tenant's first request is still allowed. This is the whole
    // point: their allowance is theirs.
    const quietRule = turnRules(quiet, true).find((r) => r.key === `agent:ask:biz:${quiet.businessId}`)!;
    expect((await consumeRateLimit(quietRule)).allowed).toBe(true);
  });

  it("still has a backstop that protects the account itself", async () => {
    const { consumeRateLimit } = await import("@/lib/rateLimit");
    const globalRule = turnRules({ userId: "x", businessId: "y" }, true).find(
      (r) => r.key === "agent:ask:global",
    )!;

    let refused = false;
    for (let i = 0; i < QUOTAS.askGlobalMinute + 2; i += 1) {
      if (!(await consumeRateLimit(globalRule)).allowed) refused = true;
    }
    // Everyone waiting a moment is recoverable. An exhausted account is not.
    expect(refused).toBe(true);
  });
});

describe("the numbers themselves", () => {
  it("gives a business more than one user but keeps it under the account", () => {
    // Otherwise the rings are decoration: a business ring below a user ring
    // never fires, and one above the global ring lets a single tenant take
    // everything.
    expect(QUOTAS.askPerBusinessMinute).toBeGreaterThanOrEqual(QUOTAS.askPerUserMinute);
    expect(QUOTAS.askGlobalMinute).toBeGreaterThanOrEqual(QUOTAS.askPerBusinessMinute);
  });

  it("leaves room for one spoken command to be three requests", () => {
    expect(QUOTAS.turnPerUserMinute).toBeGreaterThan(QUOTAS.askPerUserMinute * 2);
  });
});
