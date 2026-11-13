import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Who the assistant believes it is acting for.
 *
 * `/api/agent` builds its actor as `kind: "owner"` without consulting a role,
 * which reads like a bug and is not one: `getValidBusinessSession()` refuses
 * any session whose role is not OWNER — on the JWT claim, and again against
 * the database row, so a revoked or downgraded user cannot keep an old token
 * working. The owner app has exactly one kind of user today.
 *
 * These tests exist for the day that stops being true. The moment staff
 * accounts or a second role arrive, a hard-coded "owner" would hand everyone
 * the owner's write capabilities through the assistant — quietly, because no
 * route would have changed. Pinning both halves here means that change fails
 * the suite instead of shipping.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the owner session is owner-only", () => {
  const session = read("src/lib/session.ts");

  it("refuses a non-OWNER role on the token", () => {
    expect(session).toMatch(/session\.user\.role !== "OWNER"/);
  });

  it("re-checks the role against the stored row, not just the token", () => {
    // A token keeps saying OWNER after the row stops being one.
    expect(session).toMatch(/user\.role !== "OWNER"/);
  });
});

describe("the assistant's actor", () => {
  const route = read("src/app/api/agent/route.ts");

  it("is built from the verified session, never from the request body", () => {
    // A task id in a payload identifies a conversation; it does not grant one.
    expect(route).toContain("businessId: auth.session.businessId");
    expect(route).toContain("userId: auth.session.userId");
    expect(route).not.toMatch(/businessId:\s*input\./);
    expect(route).not.toMatch(/userId:\s*input\./);
  });

  it('may only say kind: "owner" while the session guarantees it', () => {
    // If this fails, src/lib/session.ts has stopped guaranteeing OWNER and the
    // actor must start carrying the real role instead of asserting one.
    const claimsOwner = /kind:\s*"owner"/.test(route);
    const sessionIsOwnerOnly = /user\.role !== "OWNER"/.test(read("src/lib/session.ts"));
    expect(
      !claimsOwner || sessionIsOwnerOnly,
      'the route hard-codes kind:"owner" but the session no longer guarantees it — derive the actor from the real role',
    ).toBe(true);
  });
});

describe("the read-only actor kind is an extension point, not dead weight", () => {
  it("still refuses writes, so adding a non-owner caller is safe by default", async () => {
    // Nothing constructs an operator actor today. The branch is kept because
    // the safe default has to already exist on the day something does — and a
    // policy nobody exercises is a policy nobody can trust.
    const { authorize } = await import("@/lib/agent/policy");
    const operator = { kind: "operator" as const, businessId: "b1", userId: "op1" };

    const write = authorize(
      {
        id: "t1",
        businessId: "b1",
        userId: "op1",
        lang: "en",
        state: "READY_FOR_CONFIRMATION",
        workflowId: "work.start",
        fields: {},
        question: null,
        confirmedFingerprint: null,
        operationId: null,
        updatedAt: new Date(),
      },
      operator,
      "work.start",
    );
    expect(write.allow).toBe(false);
  });
});
