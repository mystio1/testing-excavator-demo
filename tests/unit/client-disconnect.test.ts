import { describe, expect, it } from "vitest";
import { isClientDisconnect, isDatabaseUnavailable, withApi } from "@/lib/with-api";

/**
 * A phone that loses signal is not a server fault.
 *
 * Found by reading the dev-server log during a browser run: three requests to
 * /api/agent had been answered with 500 and "unhandled error in route handler"
 * while all 27 tests passed. The error was Node's own `aborted` — the browser
 * had closed the request.
 *
 * That is worth separating out here rather than filtering in a dashboard,
 * because of where this app runs. The owner uses it on a phone in a yard; a
 * dropped connection is the NORMAL case, not the exception. Counted as 500s
 * they would dominate the error rate, and the first real fault would arrive
 * looking like more of the same.
 */

/** Exactly what Node's http server throws from abortIncoming(). */
function clientHungUp(message = "aborted") {
  return Object.assign(new Error(message), { code: "ECONNRESET" });
}

describe("telling a hung-up client from a broken server", () => {
  it("recognises the abort Node actually throws", () => {
    expect(isClientDisconnect(clientHungUp())).toBe(true);
    expect(isClientDisconnect(clientHungUp("request aborted"))).toBe(true);
  });

  it("does not take a Groq timeout for a disconnect", () => {
    // The model and transcription calls abort themselves when they run past
    // their budget. That is the server being too slow, which must stay an
    // error — if it were swallowed here, the one failure the owner notices
    // most ("it just spun") would vanish from the logs.
    const timedOut = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(isClientDisconnect(timedOut)).toBe(false);
  });

  it("does not take a database connection reset for a disconnect", () => {
    const dbGone = Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });
    expect(isClientDisconnect(dbGone)).toBe(false);
    // And is still recognised as what it is.
    expect(isDatabaseUnavailable(dbGone)).toBe(true);
  });

  it("ignores a thrown non-Error", () => {
    expect(isClientDisconnect("aborted")).toBe(false);
    expect(isClientDisconnect(null)).toBe(false);
  });
});

describe("what the route answers", () => {
  const call = (error: unknown) =>
    withApi("test.op", async () => {
      throw error;
    })(new Request("http://localhost/api/test", { method: "POST" }), undefined);

  it("answers a hung-up client with 499, which is under the error threshold", async () => {
    const res = await call(clientHungUp());
    expect(res.status).toBe(499);
    // Below 500, so withApi logs it as a request rather than a failure. That
    // threshold is the whole point of the status.
    expect(res.status).toBeLessThan(500);
  });

  it("still answers a real database outage with a retryable 503", async () => {
    const res = await call(Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("still answers an unexpected fault with 500", async () => {
    const res = await call(new Error("something genuinely broke"));
    expect(res.status).toBe(500);
  });

  it("tells the client nothing about the error either way", async () => {
    const res = await call(new Error("secret: connection string postgres://user:pw@host"));
    expect(await res.text()).not.toContain("postgres://");
  });
});
