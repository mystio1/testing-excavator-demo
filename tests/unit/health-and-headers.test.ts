import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Health endpoints and the response headers configured in next.config.ts.
 *
 * - /api/health is LIVENESS: no database, always 200 while the process runs.
 * - /api/health/ready is READINESS: database + configuration, 503 otherwise, never leaks values.
 * - next.config.ts headers(): HSTS + CSP in production only; the API is never cacheable; the Android
 *   static build defines no headers() at all (the APK serves local assets).
 *
 * These assert the CONFIGURATION. That the running server actually sends them is checked by
 * scripts/check-headers.mjs (CI starts the production server and runs it; run it against the live URL
 * after a deploy — whether Render's edge adds/strips headers can only be seen there).
 */

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw } }));

const SECRET_MARKER = "super-secret-marker-value-do-not-leak-0123456789";

async function loadReady() {
  vi.resetModules();
  return (await import("@/app/api/health/ready/route")).GET;
}

describe("GET /api/health (liveness)", () => {
  it("answers 200 {status:ok} without touching the database", async () => {
    queryRaw.mockReset();
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("GET /api/health/ready (readiness)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    queryRaw.mockReset();
    process.env.AUTH_SECRET = SECRET_MARKER;
    process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.useRealTimers();
  });

  it("200 ready when the database answers and the configuration is valid", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await (await loadReady())();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", checks: { database: "ok", config: "ok" } });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("503 when the database query fails", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"));
    const res = await (await loadReady())();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable", checks: { database: "failed", config: "ok" } });
  });

  it("503 when the database does not answer within 3 s (a hung database cannot hang the probe)", async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => undefined)); // never settles
    const pending = (await loadReady())();
    await vi.advanceTimersByTimeAsync(3_100);
    const res = await pending;
    expect(res.status).toBe(503);
    expect((await res.json()).checks.database).toBe("failed");
  });

  it("503 when required configuration is invalid, and the response never contains a value", async () => {
    queryRaw.mockResolvedValue([{}]);
    process.env.AUTH_SECRET = "replace-me";
    process.env.DATABASE_URL = `mysql://u:${SECRET_MARKER}@host/db`;
    const res = await (await loadReady())();
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text).checks.config).toBe("failed");
    expect(text).not.toContain(SECRET_MARKER);
    expect(text).not.toContain("replace-me");
  });
});

describe("next.config.ts response headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  type Rule = { source: string; headers: { key: string; value: string }[] };
  async function headersFor(env: { NODE_ENV: string; BUILD_TARGET?: string }) {
    vi.stubEnv("NODE_ENV", env.NODE_ENV);
    vi.stubEnv("BUILD_TARGET", env.BUILD_TARGET ?? "");
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    return config.headers ? ((await config.headers()) as Rule[]) : null;
  }
  const value = (rule: Rule | undefined, key: string) => rule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

  it("production: every page gets HSTS, a strict CSP, and the framing/sniffing/referrer/permission headers", async () => {
    const rules = (await headersFor({ NODE_ENV: "production" }))!;
    const pages = rules.find((r) => r.source === "/:path*");
    expect(Number(/max-age=(\d+)/.exec(value(pages, "Strict-Transport-Security") ?? "")?.[1])).toBeGreaterThanOrEqual(31_536_000);
    const csp = value(pages, "Content-Security-Policy") ?? "";
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/(^|[\s;])(\*|https?:)(\s|;|$)/); // no wildcard / scheme-wide source
    expect(value(pages, "X-Frame-Options")).toBe("DENY");
    expect(value(pages, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(pages, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value(pages, "Cross-Origin-Opener-Policy")).toBe("same-origin");
    const permissions = value(pages, "Permissions-Policy")!;
    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("geolocation=()");
    // The assistant's voice input needs the microphone on this origin. An empty
    // allowlist makes the browser refuse without ever prompting, so voice could
    // not work at all; (self) keeps it away from third-party frames.
    expect(permissions).toContain("microphone=(self)");
    expect(permissions).not.toContain("microphone=*");
  });

  it("the API is never cacheable by a shared cache", async () => {
    const rules = (await headersFor({ NODE_ENV: "production" }))!;
    const api = rules.find((r) => r.source === "/api/:path*");
    expect(value(api, "Cache-Control")).toMatch(/private/);
    expect(value(api, "Cache-Control")).toMatch(/no-store/);
  });

  it("development does not send HSTS or CSP (HMR needs eval/websockets; HTTP localhost)", async () => {
    const rules = (await headersFor({ NODE_ENV: "development" }))!;
    const pages = rules.find((r) => r.source === "/:path*");
    expect(value(pages, "Strict-Transport-Security")).toBeUndefined();
    expect(value(pages, "Content-Security-Policy")).toBeUndefined();
    expect(value(pages, "X-Frame-Options")).toBe("DENY"); // the cheap ones still apply
  });

  it("does not advertise the framework (X-Powered-By off)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    expect((await import("../../next.config")).default.poweredByHeader).toBe(false);
  });

  it("the Android static build defines no headers() (output: export does not support it)", async () => {
    expect(await headersFor({ NODE_ENV: "production", BUILD_TARGET: "android" })).toBeNull();
  });
});
