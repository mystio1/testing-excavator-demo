import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { cleanupTenant, createTenant, fakeRequest, type TestTenant } from "../helpers/tenant";
import type { AgentResponse } from "@/lib/agent/types";

/**
 * The per-business switch.
 *
 * The panel hides itself when the assistant is off, but that is politeness,
 * not a control: a client is something a person can keep a stale copy of, and
 * an installed APK keeps one for months. These check the server, which is the
 * thing that actually has to refuse.
 */

const auth = vi.hoisted(() => ({
  current: null as null | { businessId: string; userId: string; ownerName: string },
}));

vi.mock("@/lib/api-auth", () => ({
  requireBusinessApi: async () => {
    const s = auth.current;
    if (!s) {
      const { errorResponse } = await import("@/lib/api-error");
      return { session: null, error: errorResponse("UNAUTHORIZED", "Please log in again.") };
    }
    return {
      session: { ...s, businessFrozen: false, supportSessionId: null },
      actor: { type: "OWNER", id: s.userId, name: s.ownerName },
      error: null,
    };
  },
}));

const model = vi.hoisted(() => ({ reply: null as AgentResponse | null }));
vi.mock("@/lib/agent/groq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/groq")>();
  return { ...actual, askGroq: async () => model.reply ?? { kind: "reply", message: "ok" } };
});

const agent = await import("@/app/api/agent/route");
const consent = await import("@/app/api/agent/voice-consent/route");

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("switch");
});
afterAll(async () => {
  await cleanupTenant(tenant.businessId);
});

beforeEach(async () => {
  auth.current = { businessId: tenant.businessId, userId: tenant.userId, ownerName: "Test Owner" };
  model.reply = { kind: "reply", message: "ok" };
  await db.business.update({ where: { id: tenant.businessId }, data: { assistantEnabled: true } });
  await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'agent%'`;
});

const switchOff = () =>
  db.business.update({ where: { id: tenant.businessId }, data: { assistantEnabled: false } });

const ask = async () => {
  const res = await agent.POST(
    fakeRequest("http://t/api/agent", { body: { action: "message", lang: "en", text: "hello" } }) as never,
    {} as never,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const setConsent = async (granted: boolean) => {
  const res = await consent.POST(
    fakeRequest("http://t/api/agent/voice-consent", { body: { granted, lang: "en" } }) as never,
    {} as never,
  );
  return { status: res.status };
};

describe("when the assistant is switched on", () => {
  it("answers as usual", async () => {
    expect((await ask()).status).toBe(200);
  });
});

describe("when it is switched off for this business", () => {
  it("refuses a turn, and says the rest of the app is unaffected", async () => {
    await switchOff();
    const res = await ask();
    expect(res.status).toBe(403);
    // The wording matters: this is a state of the account, not the owner
    // having done something wrong.
    expect(String(res.body.error)).toMatch(/switched off/i);
    expect(String(res.body.error)).toMatch(/everything else works/i);
  });

  it("refuses before the model is ever called", async () => {
    // Otherwise a switched-off business still costs money on the shared
    // account every time someone taps.
    await switchOff();
    let called = false;
    model.reply = null;
    const groq = await import("@/lib/agent/groq");
    const spy = vi.spyOn(groq, "askGroq").mockImplementation(async () => {
      called = true;
      return { kind: "reply", message: "should not happen" };
    });
    await ask();
    expect(called).toBe(false);
    spy.mockRestore();
  });

  it("refuses to record a NEW voice consent", async () => {
    await switchOff();
    expect((await setConsent(true)).status).toBe(403);
  });

  it("still lets the owner WITHDRAW voice consent", async () => {
    // A permission you cannot take back while somebody else holds a switch is
    // not one you really gave.
    await setConsent(true);
    await switchOff();
    expect((await setConsent(false)).status).toBe(200);

    const row = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { voiceConsentAt: true },
    });
    expect(row?.voiceConsentAt).toBeNull();
  });

  it("is per business, not global", async () => {
    await switchOff();
    const other = await createTenant("switch-other");
    try {
      auth.current = { businessId: other.businessId, userId: other.userId, ownerName: "Other" };
      expect((await ask()).status).toBe(200);
    } finally {
      await cleanupTenant(other.businessId);
    }
  });
});

describe("the default", () => {
  it("is on, so nothing changes for anyone until someone turns it off", async () => {
    const fresh = await createTenant("switch-default");
    try {
      const row = await db.business.findUnique({
        where: { id: fresh.businessId },
        select: { assistantEnabled: true },
      });
      expect(row?.assistantEnabled).toBe(true);
    } finally {
      await cleanupTenant(fresh.businessId);
    }
  });
});
