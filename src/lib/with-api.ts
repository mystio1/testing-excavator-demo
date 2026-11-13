import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import type { ZodType } from "zod";
import { ZodError } from "zod";
import { ApiHttpError, errorResponse, validationErrorResponse } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { runWithContext } from "@/lib/request-context";

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Wraps a Route Handler with the app-wide request lifecycle:
 *   - assigns/propagates a request id (x-request-id) into the logging context
 *   - turns thrown ApiHttpError / ZodError / known Prisma errors into the
 *     standard error contract (see api-error.ts)
 *   - converts anything unexpected into a generic 500 (INTERNAL_ERROR) with
 *     the real error logged server-side only — never a stack trace or a
 *     database message to the client
 *   - logs one structured line per request (method, route, status, duration)
 *
 *   export const POST = withApi("bills.create", async (req) => { … });
 *   export const GET  = withApi("bills.get", async (_req, { params }: { params: Promise<{ id: string }> }) => { … });
 */
export function withApi<C = unknown>(
  operation: string,
  handler: (req: Request, ctx: C) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const inbound = req.headers.get("x-request-id");
    const requestId = inbound && REQUEST_ID_RE.test(inbound) ? inbound : randomUUID();
    const started = Date.now();
    let pathname = "";
    try {
      pathname = new URL(req.url).pathname;
    } catch {
      // ignore — only used for logging
    }

    return runWithContext({ requestId, route: pathname, operation }, async () => {
      let response: Response;
      // A client that hung up is not a failure, and is kept out of the error
      // rate below. Decided here, before toErrorResponse, because that function
      // reads ECONNRESET as a database outage.
      let clientGone = false;
      try {
        response = await handler(req, ctx);
      } catch (error) {
        clientGone = isClientDisconnect(error);
        // 499, borrowed from nginx: the client closed the request. Nothing is
        // delivered either way; the status exists only to keep the log honest.
        response = clientGone ? new Response(null, { status: 499 }) : toErrorResponse(error);
      }
      try {
        response.headers.set("x-request-id", requestId);
      } catch {
        // immutable headers (e.g. a redirect Response) — the id is still in the logs
      }
      const durationMs = Date.now() - started;
      const fields = {
        method: req.method,
        status: response.status,
        durationMs,
        ...(clientGone ? { clientDisconnected: true } : {}),
      };
      if (response.status >= 500) logger.error("request failed", undefined, fields);
      else logger.info("request", fields);
      return response;
    });
  };
}

/**
 * True when the CLIENT went away mid-request: the phone lost signal, the owner
 * navigated, the tab closed. Node rejects the pending request with `aborted`
 * and code ECONNRESET from its own abortIncoming(), which reaches a route
 * handler looking exactly like a server fault.
 *
 * It is not one. Nothing is broken, nobody is listening, and no response can be
 * delivered whatever status is chosen. This matters more here than in most
 * apps: the owner uses this on a phone in a yard, so a dropped connection is an
 * ordinary event, and counting each one as a 500 makes the error rate a measure
 * of signal strength rather than of correctness. It was found by reading the
 * dev-server log during a browser run, where three of them were sitting among
 * 27 passing tests.
 *
 * Deliberately narrow. It matches Node's exact abort signature and nothing
 * else — in particular not a bare AbortError, because the Groq calls abort
 * themselves on a timeout and a server-side timeout must stay a server error.
 */
export function isClientDisconnect(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== "ECONNRESET" && code !== "ECONNABORTED") return false;
  return /^(request )?aborted$/i.test(error.message.trim());
}

/** Prisma codes that mean "could not talk to the database" (nothing was committed). */
const DB_UNREACHABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);
/** The driver adapter and the pool report connection trouble as plain errors; match their messages. */
const DB_UNREACHABLE_MESSAGE =
  /can't reach database server|timeout exceeded when trying to connect|connection terminated|connection refused|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EMAXCONNSESSION|too many clients|remaining connection slots/i;

/** True when the database was unreachable, timed out, or refused the connection (outage, pooler cap, restart).
 * Such a failure committed nothing, so the right answer is a retryable 503, not a "something went wrong" 500. */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError && DB_UNREACHABLE_CODES.has(error.code)) return true;
  const cause = (error as { cause?: unknown } | null)?.cause;
  const text = [error instanceof Error ? error.message : "", cause instanceof Error ? cause.message : ""].join(" ");
  return DB_UNREACHABLE_MESSAGE.test(text);
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiHttpError) {
    return errorResponse(error.code, error.message, {
      status: error.status,
      details: error.details,
      headers: error.headers,
    });
  }
  if (error instanceof ZodError) return validationErrorResponse(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return errorResponse("CONFLICT", "That record already exists");
    if (error.code === "P2025") return errorResponse("NOT_FOUND", "Record not found");
    // P2028: the interactive-transaction queue timed out (heavy contention / pool
    // exhausted). Nothing was committed; the request is safe to retry (financial
    // creates carry an Idempotency-Key), so answer 503 + Retry-After instead of a 500.
    if (error.code === "P2028") {
      logger.warn("transaction queue timed out", { code: error.code });
      return errorResponse("SERVICE_BUSY", "The server is busy right now. Please try again in a moment.", {
        headers: { "Retry-After": "2" },
        details: { retryAfterSec: 2 },
      });
    }
    // A database CHECK constraint refused the write (e.g. payments exceeding the
    // bill total on a legacy row). Postgres code 23514, surfaced by the driver
    // adapter as P2039. The rule is a business invariant, so tell the user in
    // plain words (409) instead of a generic 500 — the detail stays in the log.
    if (error.code === "P2039" || error.code === "P2004") {
      const pgCode = (error.meta as { driverAdapterError?: { cause?: { code?: string } } } | undefined)?.driverAdapterError
        ?.cause?.code;
      if (pgCode === "23514" || error.code === "P2004") {
        logger.warn("database check constraint refused a write", { operation: error.code, pgCode });
        return errorResponse(
          "CONFLICT",
          "This change would break a data rule (for example, payments adding up to more than the bill total). Check the amounts and try again.",
        );
      }
    }
  }
  if (isDatabaseUnavailable(error)) {
    logger.error("database unavailable", error);
    return errorResponse("SERVICE_BUSY", "The service is temporarily unavailable. Please try again in a moment.", {
      headers: { "Retry-After": "5" },
      details: { retryAfterSec: 5 },
    });
  }
  logger.error("unhandled error in route handler", error);
  return errorResponse("INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
}

/** Default cap for a JSON request body. Every ordinary payload in this app (a bill with
 * hundreds of rows is ~100 KB) fits comfortably; only the letterhead image upload needs
 * more and passes its own `maxBytes`. Bounds memory/CPU an unauthenticated or hostile
 * caller can make the server spend before validation even starts. */
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

/** Reads the body as text, refusing (413) as soon as it exceeds `maxBytes` — the declared
 * Content-Length is checked first, and the stream itself is counted because the header can
 * be absent (chunked) or a lie. */
async function readBodyText(req: Request, maxBytes: number, message?: string): Promise<string> {
  const tooLarge = () =>
    new ApiHttpError("PAYLOAD_TOO_LARGE", message ?? `That request is too large (limit ${Math.round(maxBytes / 1024)} KB)`);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Parses + validates a JSON request body. Throws ApiHttpError (400 for
 * malformed JSON, 413 for an oversized body, 422 for schema violations) — use
 * inside withApi(). */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
  opts?: { maxBytes?: number; tooLargeMessage?: string },
): Promise<T> {
  const text = await readBodyText(req, opts?.maxBytes ?? DEFAULT_MAX_BODY_BYTES, opts?.tooLargeMessage);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiHttpError("BAD_REQUEST", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

/** JSON success response (kept here so routes import one module). */
export function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}
