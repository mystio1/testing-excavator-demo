import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { cleanupTenant, createTenant, fakeRequest, type TestTenant } from "../helpers/tenant";

/**
 * Voice consent, against a real database.
 *
 * The notice in the panel is the part a person sees; this is the part that
 * makes it a control rather than a courtesy. Speaking sends a few seconds of
 * audio — carrying customers' names and phone numbers — to a speech service
 * outside India, so the server refuses to transcribe without a recorded
 * consent, whatever the browser did or did not show.
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

const consent = await import("@/app/api/agent/voice-consent/route");
const listen = await import("@/app/api/agent/listen/route");

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("consent");
});
afterAll(async () => {
  await cleanupTenant(tenant.businessId);
});

beforeEach(async () => {
  auth.current = { businessId: tenant.businessId, userId: tenant.userId, ownerName: "Test Owner" };
  await db.user.update({
    where: { id: tenant.userId },
    data: { voiceConsentAt: null, voiceConsentText: null },
  });
  await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE ${`agent%${tenant.userId}`}`;
});

const get = async () => {
  const res = await consent.GET(fakeRequest("http://t/api/agent/voice-consent", { method: "GET" }) as never, {} as never);
  return { status: res.status, body: (await res.json()) as { given: boolean; noticeAgreed: string | null } };
};

const set = async (granted: boolean, lang = "hi") => {
  const res = await consent.POST(
    fakeRequest("http://t/api/agent/voice-consent", { body: { granted, lang } }) as never,
    {} as never,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

/** A clip big enough to get past the "they tapped twice" guard. */
const sendAudio = async () => {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(4096)], { type: "audio/webm" }), "speech.webm");
  form.append("lang", "hi");
  const req = new Request("http://t/api/agent/listen", { method: "POST", body: form });
  const res = await listen.POST(req as never, {} as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("the voice notice", () => {
  it("starts as not given, and is not assumed for an existing owner", async () => {
    // Nothing is backfilled: a consent nobody gave must never be inherited.
    expect((await get()).body.given).toBe(false);
  });

  it("records when it was given, and which wording was agreed to", async () => {
    expect((await set(true)).status).toBe(200);

    const after = await get();
    expect(after.body.given).toBe(true);
    // The version AND the language, so changing the notice later cannot
    // silently inherit this agreement.
    expect(after.body.noticeAgreed).toBe("voice-1:hi");

    const row = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { voiceConsentAt: true },
    });
    expect(row?.voiceConsentAt).toBeInstanceOf(Date);
  });

  it("can be withdrawn as easily as it was given", async () => {
    await set(true);
    await set(false);
    expect((await get()).body.given).toBe(false);
    const row = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { voiceConsentAt: true, voiceConsentText: true },
    });
    expect(row?.voiceConsentAt).toBeNull();
    expect(row?.voiceConsentText).toBeNull();
  });

  it("leaves both the giving and the withdrawing on the audit trail", async () => {
    // Scoped to the last two rows: AuditLog is append-only at the database
    // level, so earlier tests in this file cannot be cleared away — and a
    // trigger that refuses the attempt is the trail doing its job.
    await set(true);
    await set(false);
    const rows = await db.auditLog.findMany({
      where: { businessId: tenant.businessId, entityId: tenant.userId },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { action: true, details: true },
    });
    expect(rows.map((r) => r.action)).toEqual([
      "assistant.voice_consent.withdrawn",
      "assistant.voice_consent.given",
    ]);
    // The wording agreed to is on the record, not just the fact of agreeing.
    expect(JSON.stringify(rows[1]!.details)).toContain("voice-1:hi");
  });

  it("refuses an unauthenticated caller", async () => {
    auth.current = null;
    expect((await get()).status).toBe(401);
    expect((await set(true)).status).toBe(401);
  });
});

describe("transcription is gated on it, not on the browser", () => {
  it("refuses audio when no consent is recorded", async () => {
    // The disclosure has to be a control. A client that forgets to ask, or
    // chooses not to, still cannot send the owner's voice out of the country.
    const res = await sendAudio();
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/gsk_/);
  });

  it("stops refusing once consent is recorded", async () => {
    await set(true);
    const res = await sendAudio();
    // Past the gate. It fails later for want of a usable key or real audio,
    // which is a different thing entirely — what matters is that 403 is gone.
    expect(res.status).not.toBe(403);
  });

  it("refuses again after the consent is withdrawn", async () => {
    await set(true);
    await set(false);
    expect((await sendAudio()).status).toBe(403);
  });
});
