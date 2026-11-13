import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The routes authenticate through the real requireBusinessApi() / session guard;
// only the NextAuth JWT decoder is replaced, so tests choose who is "signed in".
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));

import { db } from "@/lib/db";
import { GET as listCustomersRouteRaw, POST as createCustomerRouteRaw } from "@/app/api/customers/route";
import { PATCH as patchCustomer, DELETE as deleteCustomer } from "@/app/api/customers/[id]/route";
import { GET as customerOptionsRouteRaw } from "@/app/api/customers/options/route";
import { GET as customerDetailRouteRaw } from "@/app/api/customers/detail/route";
import { GET as searchRouteRaw } from "@/app/api/search/route";
import { GET as dashboardRouteRaw } from "@/app/api/dashboard/route";
import { GET as layoutRouteRaw } from "@/app/api/layout/route";
import { GET as siteAnalysisRouteRaw } from "@/app/api/site-analysis/route";
import { GET as settingsRouteRaw } from "@/app/api/settings/route";
import { PATCH as profileRouteRaw } from "@/app/api/settings/profile/route";
import { PATCH as letterheadRouteRaw } from "@/app/api/settings/letterhead/route";
import { PATCH as languageRouteRaw } from "@/app/api/settings/operator-language/route";
import { POST as regenerateRouteRaw } from "@/app/api/settings/business-code/regenerate/route";
import { POST as createAccountRouteRaw } from "@/app/api/settings/bank-accounts/route";
import { PATCH as patchAccountRoute, DELETE as deleteAccountRoute } from "@/app/api/settings/bank-accounts/[id]/route";
import { GET as serviceIntervalRouteRaw } from "@/app/api/settings/service-interval/route";
import * as appVersionModule from "@/app/api/app-version/route";
import { cleanupTenant, createTenant, fakeRequest, type TestTenant } from "../helpers/tenant";
import { makePng, toDataUrl } from "./image-fixtures";
import { insertBill, insertCustomer } from "./helpers";


// Handlers without route params still take the (unused) context argument.
const noCtx = (handler: (req: Request, ctx: undefined) => Promise<Response>) => (req: Request) => handler(req, undefined);
const listCustomersRoute = noCtx(listCustomersRouteRaw);
const createCustomerRoute = noCtx(createCustomerRouteRaw);
const customerOptionsRoute = noCtx(customerOptionsRouteRaw);
const customerDetailRoute = noCtx(customerDetailRouteRaw);
const searchRoute = noCtx(searchRouteRaw);
const dashboardRoute = noCtx(dashboardRouteRaw);
const layoutRoute = noCtx(layoutRouteRaw);
const siteAnalysisRoute = noCtx(siteAnalysisRouteRaw);
const settingsRoute = noCtx(settingsRouteRaw);
const serviceIntervalRoute = noCtx(serviceIntervalRouteRaw);
const profileRoute = noCtx(profileRouteRaw);
const letterheadRoute = noCtx(letterheadRouteRaw);
const languageRoute = noCtx(languageRouteRaw);
const regenerateRoute = noCtx(regenerateRouteRaw);
const createAccountRoute = noCtx(createAccountRouteRaw);

/**
 * Route handlers: standard error contract ({ error: string, code, requestId }),
 * right status codes, the additive pagination / version fields, the letterhead
 * limits end to end, and frozen-business behaviour.
 */

const BASE = "https://app.example.test/api";
let a: TestTenant;
let b: TestTenant;

const signInAs = (t: TestTenant | null) =>
  authMock.mockResolvedValue(t ? { user: { id: t.userId, businessId: t.businessId, role: "OWNER", tokenVersion: 0 } } : null);

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("routes-a"), createTenant("routes-b")]);
});

beforeEach(() => {
  signInAs(a);
});

afterAll(async () => {
  authMock.mockReset();
  await Promise.all([a, b].filter(Boolean).map((t) => cleanupTenant(t.businessId)));
  await db.$disconnect();
});

const ctx = (params: { id: string }) => ({ params: Promise.resolve(params) });
const get = (path: string) => fakeRequest(`${BASE}${path}`, { method: "GET" });
const send = (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
  fakeRequest(`${BASE}${path}`, { method, body, headers });

async function expectError(res: Response, status: number, code: string) {
  const body = await res.json();
  expect(res.status).toBe(status);
  expect(body.code).toBe(code);
  expect(typeof body.error).toBe("string"); // installed apps read `error` as text
  expect(typeof body.requestId).toBe("string");
  return body as { error: string; code: string; requestId: string };
}

describe("authentication", () => {
  it("every owned route answers 401 UNAUTHORIZED without a session", async () => {
    signInAs(null);
    const results = await Promise.all([
      listCustomersRoute(get("/customers")),
      customerOptionsRoute(get("/customers/options")),
      customerDetailRoute(get("/customers/detail?id=x")),
      searchRoute(get("/search?q=a")),
      dashboardRoute(get("/dashboard")),
      layoutRoute(get("/layout")),
      siteAnalysisRoute(get("/site-analysis")),
      settingsRoute(get("/settings")),
      serviceIntervalRoute(get("/settings/service-interval")),
      profileRoute(send("PATCH", "/settings/profile", {})),
      letterheadRoute(send("PATCH", "/settings/letterhead", {})),
    ]);
    for (const res of results) await expectError(res, 401, "UNAUTHORIZED");
  });

  it("a frozen business gets 423 everywhere except /api/layout, which still reports frozen", async () => {
    await db.business.update({ where: { id: b.businessId }, data: { frozen: true } });
    signInAs(b);
    try {
      await expectError(await listCustomersRoute(get("/customers")), 423, "ACCOUNT_FROZEN");
      await expectError(await dashboardRoute(get("/dashboard")), 423, "ACCOUNT_FROZEN");
      await expectError(await profileRoute(send("PATCH", "/settings/profile", {})), 423, "ACCOUNT_FROZEN");

      const layout = await layoutRoute(get("/layout"));
      expect(layout.status).toBe(200);
      expect(await layout.json()).toMatchObject({ frozen: true, alerts: [], hasPin: false });
    } finally {
      await db.business.update({ where: { id: b.businessId }, data: { frozen: false } });
    }
  });

  it("/api/layout keeps its keys for a normal business", async () => {
    const res = await layoutRoute(get("/layout"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Pinned on purpose: installed APKs keep an older UI for months, so a key
    // disappearing from here breaks clients that are still asking for it.
    // Adding one is additive and safe (see docs/api-conventions.md §10) —
    // assistantEnabled is the per-business switch the shell reads to decide
    // whether to mount the assistant panel at all.
    expect(Object.keys(body).sort()).toEqual([
      "alerts",
      "assistantEnabled",
      "businessName",
      "frozen",
      "hasPin",
      "ownerName",
    ]);
    expect(body.frozen).toBe(false);
  });
});

describe("app-version route", () => {
  it("is public and GET-only, and keeps its snake_case error strings", async () => {
    signInAs(null); // no session: must still answer (the app polls it before login)
    expect(Object.keys(appVersionModule).sort()).toEqual(["GET"]);

    const saved = process.env.GITHUB_RELEASE_REPO;
    delete process.env.GITHUB_RELEASE_REPO;
    try {
      const res = await appVersionModule.GET(get("/app-version"), undefined);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "not_configured" });
    } finally {
      if (saved !== undefined) process.env.GITHUB_RELEASE_REPO = saved;
    }
  });
});

describe("customers routes", () => {
  let first: string;

  beforeAll(async () => {
    for (const name of ["Route Delta", "Route Alpha", "Route Charlie", "Route Bravo"]) {
      await insertCustomer(a, name);
    }
  });

  it("POST creates a customer (existing response key) and validates with 422", async () => {
    const res = await createCustomerRoute(send("POST", "/customers", { name: "Route Created", mobile: "9300000001" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customer).toMatchObject({ name: "Route Created", version: 0 });
    first = body.customer.id;

    const bad = await expectError(await createCustomerRoute(send("POST", "/customers", { name: "", mobile: "9300000001" })), 422, "VALIDATION_FAILED");
    expect(bad.error).toMatch(/customer name/i);
    await expectError(await createCustomerRoute(send("POST", "/customers", { name: "x", mobile: "1" })), 422, "VALIDATION_FAILED");
  });

  it("GET without limit (older apps) keeps { customers } and adds nextCursor + summary", async () => {
    const body = await (await listCustomersRoute(get("/customers"))).json();
    expect(Array.isArray(body.customers)).toBe(true);
    expect(body.customers.length).toBeGreaterThanOrEqual(5);
    expect(body.nextCursor).toBeNull();
    expect(body.summary).toMatchObject({ totalCustomers: expect.any(Number) });
  });

  it("GET ?limit= pages through the list with nextCursor", async () => {
    const page1 = await (await listCustomersRoute(get("/customers?limit=2&q=Route"))).json();
    expect(page1.customers.map((c: { name: string }) => c.name)).toEqual(["Route Alpha", "Route Bravo"]);
    expect(typeof page1.nextCursor).toBe("string");
    expect(page1.summary.totalCustomers).toBe(5);

    const page2 = await (
      await listCustomersRoute(get(`/customers?limit=2&q=Route&cursor=${encodeURIComponent(page1.nextCursor)}`))
    ).json();
    expect(page2.customers.map((c: { name: string }) => c.name)).toEqual(["Route Charlie", "Route Created"]);
    expect(page2.summary).toBeNull();

    const page3 = await (
      await listCustomersRoute(get(`/customers?limit=2&q=Route&cursor=${encodeURIComponent(page2.nextCursor)}`))
    ).json();
    expect(page3.customers.map((c: { name: string }) => c.name)).toEqual(["Route Delta"]);
    expect(page3.nextCursor).toBeNull();
  });

  it("GET rejects a bad limit with 400 and a bad date with 422", async () => {
    await expectError(await listCustomersRoute(get("/customers?limit=0")), 400, "BAD_REQUEST");
    await expectError(await listCustomersRoute(get("/customers?limit=abc")), 400, "BAD_REQUEST");
    await expectError(await listCustomersRoute(get("/customers?tripDate=yesterday")), 422, "VALIDATION_FAILED");
  });

  it("GET /options is complete and flags truncation", async () => {
    const body = await (await customerOptionsRoute(get("/customers/options"))).json();
    expect(body.truncated).toBe(false);
    expect(body.customers.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(["Route Alpha", "Route Bravo", "Route Charlie", "Route Delta", "Route Created"]),
    );
  });

  it("PATCH with a stale expectedVersion is 409 RESOURCE_MODIFIED; the right one succeeds and bumps the version", async () => {
    const ok = await patchCustomer(
      send("PATCH", `/customers/${first}`, { name: "Route Edited", mobile: "9300000001", expectedVersion: 0 }),
      ctx({ id: first }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).customer).toMatchObject({ name: "Route Edited", version: 1 });

    const stale = await expectError(
      await patchCustomer(
        send("PATCH", `/customers/${first}`, { name: "Overwrite", mobile: "9300000001", expectedVersion: 0 }),
        ctx({ id: first }),
      ),
      409,
      "RESOURCE_MODIFIED",
    );
    expect(stale.error).toMatch(/changed by someone else/i);
    expect((await db.customer.findUniqueOrThrow({ where: { id: first } })).name).toBe("Route Edited");

    // No expectedVersion (installed apps): still works.
    const legacy = await patchCustomer(send("PATCH", `/customers/${first}`, { name: "Legacy Edit", mobile: "9300000001" }), ctx({ id: first }));
    expect(legacy.status).toBe(200);
    expect((await legacy.json()).customer.version).toBe(2);
  });

  it("PATCH validates the body (422) and an unknown id is 404", async () => {
    await expectError(await patchCustomer(send("PATCH", `/customers/${first}`, { name: "" }), ctx({ id: first })), 422, "VALIDATION_FAILED");
    await expectError(
      await patchCustomer(send("PATCH", `/customers/${first}`, { name: "N", mobile: "9300000001", expectedVersion: "abc" }), ctx({ id: first })),
      422,
      "VALIDATION_FAILED",
    );
    await expectError(
      await patchCustomer(send("PATCH", "/customers/nope", { name: "N", mobile: "9300000001" }), ctx({ id: "nope" })),
      404,
      "NOT_FOUND",
    );
  });

  it("tenant B gets 404 for tenant A's customer on detail / patch / delete", async () => {
    signInAs(b);
    await expectError(await customerDetailRoute(get(`/customers/detail?id=${first}`)), 404, "NOT_FOUND");
    await expectError(
      await patchCustomer(send("PATCH", `/customers/${first}`, { name: "Hijack", mobile: "9300000001" }), ctx({ id: first })),
      404,
      "NOT_FOUND",
    );
    await expectError(await deleteCustomer(send("DELETE", `/customers/${first}`), ctx({ id: first })), 404, "NOT_FOUND");
    const row = await db.customer.findUniqueOrThrow({ where: { id: first } });
    expect(row).toMatchObject({ name: "Legacy Edit", isArchived: false });
  });

  it("detail requires an id (422) and returns the detail for the owner", async () => {
    await expectError(await customerDetailRoute(get("/customers/detail")), 422, "VALIDATION_FAILED");
    const body = await (await customerDetailRoute(get(`/customers/detail?id=${first}`))).json();
    expect(body.detail.customer).toMatchObject({ id: first, version: 2 });
    expect(typeof body.detail.totalRevenue).toBe("number");
  });

  it("DELETE archives (existing { ok } shape) and writes an audit row", async () => {
    const res = await deleteCustomer(send("DELETE", `/customers/${first}`), ctx({ id: first }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await db.auditLog.findMany({ where: { businessId: a.businessId, entityId: first, action: "customer.archive" } });
    expect(rows).toHaveLength(1);
  });
});

describe("search route", () => {
  beforeAll(async () => {
    for (let i = 1; i <= 10; i++) await insertCustomer(a, `Searchable ${String(i).padStart(2, "0")}`);
    await insertBill(a, { total: "12.00" });
  });

  it("returns the first 8 hits per group plus nextCursors; q is required to match", async () => {
    const body = await (await searchRoute(get("/search?q=searchable"))).json();
    expect(body.results.customers).toHaveLength(8);
    expect(typeof body.results.nextCursors.customers).toBe("string");
    expect(body.results.nextCursors.excavators).toBeNull();
    expect(Object.keys(body.results).sort()).toEqual(["bills", "customers", "excavators", "nextCursors", "operators"]);

    const empty = await (await searchRoute(get("/search?q="))).json();
    expect(empty.results.customers).toEqual([]);
  });

  it("?type=customers pages one group with limit + cursor", async () => {
    const p1 = await (await searchRoute(get("/search?q=searchable&type=customers&limit=6"))).json();
    expect(p1.results.customers.map((c: { name: string }) => c.name)).toEqual(
      ["01", "02", "03", "04", "05", "06"].map((n) => `Searchable ${n}`),
    );
    expect(p1.results.excavators).toEqual([]);
    expect(typeof p1.nextCursor).toBe("string");

    const p2 = await (await searchRoute(get(`/search?q=searchable&type=customers&limit=6&cursor=${encodeURIComponent(p1.nextCursor)}`))).json();
    expect(p2.results.customers.map((c: { name: string }) => c.name)).toEqual(
      ["07", "08", "09", "10"].map((n) => `Searchable ${n}`),
    );
    expect(p2.nextCursor).toBeNull();
  });

  it("validates type (422) and an over-long query (422)", async () => {
    await expectError(await searchRoute(get("/search?q=a&type=nonsense")), 422, "VALIDATION_FAILED");
    await expectError(await searchRoute(get(`/search?q=${"a".repeat(101)}`)), 422, "VALIDATION_FAILED");
  });

  it("another tenant's search never finds these rows", async () => {
    signInAs(b);
    const body = await (await searchRoute(get("/search?q=searchable"))).json();
    expect(body.results.customers).toEqual([]);
    const own = await (await searchRoute(get("/search?q=test"))).json();
    expect(own.results.customers.map((c: { name: string }) => c.name)).toEqual(["Test Customer"]);
  });
});

describe("dashboard / site-analysis routes", () => {
  it("dashboard keeps its keys and returns plain numbers", async () => {
    const res = await dashboardRoute(get("/dashboard"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["activity", "alerts", "cards", "hoursTrend", "machineHours", "ownerName", "paymentCollection", "profit", "revenueTrend", "siteTotals", "topCustomers"].sort(),
    );
    expect(typeof body.cards.revenueThisMonth).toBe("number");
    expect(typeof body.cards.pendingPayments).toBe("number");
    expect(typeof body.profit.netProfit).toBe("number");
  });

  it("site-analysis keeps its keys", async () => {
    const body = await (await siteAnalysisRoute(get("/site-analysis"))).json();
    expect(Object.keys(body).sort()).toEqual(["customerOptions", "readings", "siteOptions"]);
  });
});

describe("settings routes", () => {
  it("GET /settings returns business, bankAccounts and hasPin", async () => {
    const body = await (await settingsRoute(get("/settings"))).json();
    expect(Object.keys(body).sort()).toEqual(["bankAccounts", "business", "hasPin"]);
    expect(body.business.id).toBe(a.businessId);
  });

  it("PATCH /settings/profile validates (422) and writes an audit row", async () => {
    await expectError(
      await profileRoute(send("PATCH", "/settings/profile", { name: "", ownerName: "O", phone: "9000000000", defaultServiceIntervalHrs: 250, maintenanceAlertThresholdHrs: 25 })),
      422,
      "VALIDATION_FAILED",
    );
    const ok = await profileRoute(
      send("PATCH", "/settings/profile", {
        name: "Route Business",
        ownerName: "Route Owner",
        phone: "9000000000",
        defaultServiceIntervalHrs: 250,
        maintenanceAlertThresholdHrs: 25,
      }),
    );
    expect(await ok.json()).toEqual({ ok: true });
    expect(await db.auditLog.count({ where: { businessId: a.businessId, action: "business.profile.update" } })).toBe(1);
  });

  it("PATCH /settings/operator-language rejects unknown languages", async () => {
    await expectError(await languageRoute(send("PATCH", "/settings/operator-language", { operatorLanguage: "fr" })), 422, "VALIDATION_FAILED");
    expect((await languageRoute(send("PATCH", "/settings/operator-language", { operatorLanguage: "mr" }))).status).toBe(200);
    expect(await db.auditLog.count({ where: { businessId: a.businessId, action: "business.operator_language.update" } })).toBe(1);
  });

  it("business-code regenerate rejects a malformed custom code and audits a valid one", async () => {
    await expectError(await regenerateRoute(send("POST", "/settings/business-code/regenerate", { customCode: "no spaces!" })), 422, "VALIDATION_FAILED");
    const custom = `RT${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
    const ok = await (await regenerateRoute(send("POST", "/settings/business-code/regenerate", { customCode: custom }))).json();
    expect(ok.business.code).toBe(custom);
    // Another business cannot take the same code: 409 CONFLICT.
    signInAs(b);
    await expectError(await regenerateRoute(send("POST", "/settings/business-code/regenerate", { customCode: custom })), 409, "CONFLICT");
    signInAs(a);
    expect(await db.auditLog.count({ where: { businessId: a.businessId, action: "business.code.regenerate" } })).toBe(1);
  });

  it("bank accounts: create / update / archive through the routes, each audited; other tenants get 404", async () => {
    const body = {
      label: "Route Bank",
      accountHolderName: "Owner",
      accountNumber: "555500001111",
      ifsc: "sbin0001234",
      bankName: "SBI",
    };
    const created = await (await createAccountRoute(send("POST", "/settings/bank-accounts", body))).json();
    expect(created.ok).toBe(true);
    const id = created.account.id as string;
    expect(created.account.ifsc).toBe("SBIN0001234");

    await expectError(await createAccountRoute(send("POST", "/settings/bank-accounts", { ...body, ifsc: "" })), 422, "VALIDATION_FAILED");

    const updated = await patchAccountRoute(send("PATCH", `/settings/bank-accounts/${id}`, { ...body, label: "Route Bank 2" }), ctx({ id }));
    expect((await updated.json()).account.label).toBe("Route Bank 2");

    signInAs(b);
    await expectError(await patchAccountRoute(send("PATCH", `/settings/bank-accounts/${id}`, { ...body, label: "Hijack" }), ctx({ id })), 404, "NOT_FOUND");
    await expectError(await deleteAccountRoute(send("DELETE", `/settings/bank-accounts/${id}`), ctx({ id })), 404, "NOT_FOUND");
    signInAs(a);

    const removed = await deleteAccountRoute(send("DELETE", `/settings/bank-accounts/${id}`), ctx({ id }));
    expect(await removed.json()).toEqual({ ok: true });

    const actions = (await db.auditLog.findMany({ where: { businessId: a.businessId, entityType: "BankAccount", entityId: id }, orderBy: { createdAt: "asc" } })).map((r) => r.action);
    expect(actions).toEqual(["bank_account.create", "bank_account.update", "bank_account.archive"]);
  });
});

describe("letterhead route: image limits end to end", () => {
  const letterhead = (images: Record<string, string>, extra: Record<string, unknown> = {}, headers?: Record<string, string>) =>
    letterheadRoute(send("PATCH", "/settings/letterhead", { billAccentColor: "#0B2B5E", ...images, ...extra }, headers));

  it("accepts a small PNG and stores it", async () => {
    const png = toDataUrl("image/png", makePng(50, 50));
    const res = await letterhead({ logoLeftUrl: png });
    expect(res.status).toBe(200);
    expect((await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).logoLeftUrl).toBe(png);
  });

  it("rejects SVG with 422 VALIDATION_FAILED and a clear message", async () => {
    const svg = toDataUrl("image/svg+xml", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
    const body = await expectError(await letterhead({ signatureUrl: svg }), 422, "VALIDATION_FAILED");
    expect(body.error).toMatch(/^Signature: SVG images are not allowed/);
  });

  it("rejects wrong magic bytes, oversize bytes and oversize dimensions with 422", async () => {
    const fake = toDataUrl("image/png", Buffer.from("this is not a png at all"));
    expect((await expectError(await letterhead({ logoRightUrl: fake }), 422, "VALIDATION_FAILED")).error).toMatch(/Right logo: .*does not match/);

    const big = toDataUrl("image/png", makePng(10, 10, 320 * 1024));
    expect((await expectError(await letterhead({ logoLeftUrl: big }), 422, "VALIDATION_FAILED")).error).toMatch(/too large/);

    const wide = toDataUrl("image/png", makePng(4000, 10));
    expect((await expectError(await letterhead({ logoLeftUrl: wide }), 422, "VALIDATION_FAILED")).error).toMatch(/4000 x 10 px/);
  });

  it("refuses an oversized request body up front with 413", async () => {
    const res = await letterheadRoute(
      send("PATCH", "/settings/letterhead", { billAccentColor: "#0B2B5E" }, { "content-length": String(10 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(typeof body.error).toBe("string");
  });

  it("accepts an image identical to the stored one even if it predates the limits", async () => {
    // Stored directly (as an old build could have saved it): ~340 KB PNG.
    const legacy = toDataUrl("image/png", makePng(10, 10, 340 * 1024));
    await db.business.update({ where: { id: a.businessId }, data: { logoRightUrl: legacy } });

    // An installed app resends all three images; only the tagline changed.
    const same = await letterhead({ logoRightUrl: legacy }, { billTagline: "New tagline" });
    expect(same.status).toBe(200);
    expect(await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).toMatchObject({
      logoRightUrl: legacy,
      billTagline: "New tagline",
    });

    // A different oversized image is still refused.
    const other = toDataUrl("image/png", makePng(11, 11, 340 * 1024));
    await expectError(await letterhead({ logoRightUrl: other }), 422, "VALIDATION_FAILED");
  });

  it("is audited, with a fingerprint instead of the image", async () => {
    const rows = await db.auditLog.findMany({ where: { businessId: a.businessId, action: "business.letterhead.update" } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(JSON.stringify(row.after)).not.toContain("data:image");
  });
});
