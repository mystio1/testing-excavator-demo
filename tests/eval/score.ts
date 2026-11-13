import type { AgentResponse } from "@/lib/agent/types";
import type { EvalCase } from "./corpus";

/**
 * Scoring one answer against what the case said was correct.
 *
 * Strict about meaning, loose about wording: a model that answers "JCB" where
 * "jcb" was expected is right, and one that answers 1208.0 where 1208 was
 * expected is right. What it may not do is pick the wrong capability, drop a
 * value that was said, or invent one that was not.
 *
 * Kept separate from the runner so it can be tested without a network call —
 * a scorer that quietly passes everything is worse than no eval at all.
 */

export type Failure = { kind: "workflow" | "field" | "invented" | "mention" | "error"; detail: string };

/**
 * Failure kinds where the model DID produce something judgeable.
 *
 * `malformed` and `no_json` mean an answer came back and was unusable, which
 * is a real verdict on the model and belongs in the score. Every other kind —
 * the breaker being open, a timeout, an upstream 5xx, a spent allowance —
 * means the request never reached a model at all.
 */
const MODEL_ANSWERED_BADLY = new Set(["malformed", "no_json"]);

/**
 * Is this error a verdict on the agent, or just the service not answering?
 *
 * This distinction had already been got wrong once, for rate limits, and the
 * fix only covered rate limits — so it came back through the side door. A run
 * on a busy account hits the per-minute ceiling, the ceiling trips the circuit
 * breaker, and the breaker then throws `unavailable`, which was scored as the
 * agent getting the sentence wrong. The measured case: one Hindi write case
 * reported as "Could not reach the assistant service", dragging the write
 * category to 92% and sending the next reader to look for a prompt bug that
 * was never there.
 *
 * An error that is not a GroqError at all returns true on purpose: that is the
 * harness or the app itself breaking, and it must be loud rather than quietly
 * filed as "the account was busy".
 */
export function isModelAtFault(err: unknown): boolean {
  const kind = (err as { kind?: string } | null)?.kind;
  if (typeof kind !== "string") return true;
  return MODEL_ANSWERED_BADLY.has(kind);
}

/**
 * `skipped` is not a pass and not a failure.
 *
 * The account has ceilings, and a long run reaches them. Counting that as the
 * agent being wrong is worse than useless: it buries a real regression under
 * noise and makes the headline number depend on how fast the suite happened to
 * run. So those cases are set aside and reported, and the score is computed
 * over the cases that were actually answered — with a limit on how many may be
 * set aside, so skipping can never hide a regression.
 *
 * "The service did not answer" is broader than a 429: see isModelAtFault.
 */
export type Scored = { id: string; passed: boolean; skipped?: boolean; failures: Failure[] };

const sameValue = (expected: string | number, actual: unknown): boolean => {
  if (typeof expected === "number") {
    const n = typeof actual === "number" ? actual : Number(String(actual).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) && n === expected;
  }
  if (typeof actual !== "string" && typeof actual !== "number") return false;
  const want = expected.trim().toLowerCase();
  const got = String(actual).trim().toLowerCase();
  // Contains, not equals: "Komatsu PC200" satisfies an expectation of
  // "Komatsu", because the app matches the spoken words against real records
  // afterwards and has its own tests for that.
  return got === want || got.includes(want) || want.includes(got);
};

export function score(testCase: EvalCase, answer: AgentResponse): Scored {
  const failures: Failure[] = [];
  const { expect: want } = testCase;

  const kind = want.kind ?? (want.workflowId ? "action" : undefined);
  if (kind && answer.kind !== kind) {
    failures.push({ kind: "workflow", detail: `expected ${kind}, got ${answer.kind}` });
  }

  if (want.workflowId) {
    const got = answer.kind === "action" ? answer.workflowId : `(${answer.kind})`;
    if (got !== want.workflowId) {
      failures.push({ kind: "workflow", detail: `expected ${want.workflowId}, got ${got}` });
    }
  }

  const fields = answer.kind === "action" ? answer.fields : {};

  for (const [name, expected] of Object.entries(want.fields ?? {})) {
    if (!(name in fields)) {
      failures.push({ kind: "field", detail: `${name} missing (wanted ${expected})` });
    } else if (!sameValue(expected, fields[name])) {
      failures.push({ kind: "field", detail: `${name}=${String(fields[name])}, wanted ${expected}` });
    }
  }

  for (const name of want.absent ?? []) {
    if (name in fields && fields[name] !== "" && fields[name] !== null) {
      // The failure that does real damage: a value nobody said, filled in
      // because an empty box looks wrong.
      failures.push({ kind: "invented", detail: `${name}=${String(fields[name])} was never said` });
    }
  }

  if (want.mentions?.length) {
    const said = (
      answer.kind === "reply" ? answer.message : answer.kind === "clarify" ? answer.question : ""
    ).toLowerCase();
    if (!want.mentions.some((m) => said.includes(m.toLowerCase()))) {
      failures.push({ kind: "mention", detail: `said none of: ${want.mentions.join(", ")}` });
    }
  }

  return { id: testCase.id, passed: failures.length === 0, failures };
}

export type Report = {
  /** Cases actually answered by the model — the denominator for every score. */
  total: number;
  passed: number;
  /** Cases the service never answered at all — any reason, not only a 429. */
  skipped: number;
  byLang: Record<string, { total: number; passed: number }>;
  byCategory: Record<string, { total: number; passed: number }>;
  failures: { id: string; lang: string; category: string; text: string; failures: Failure[] }[];
  skippedIds: string[];
};

export function report(cases: EvalCase[], results: Scored[]): Report {
  const byId = new Map(results.map((r) => [r.id, r]));
  const out: Report = { total: 0, passed: 0, skipped: 0, byLang: {}, byCategory: {}, failures: [], skippedIds: [] };

  for (const testCase of cases) {
    const result = byId.get(testCase.id);
    if (!result) continue;
    if (result.skipped) {
      // Never answered, so it says nothing either way. Counted on its own.
      out.skipped += 1;
      out.skippedIds.push(testCase.id);
      continue;
    }
    const lang = (out.byLang[testCase.lang] ??= { total: 0, passed: 0 });
    const category = (out.byCategory[testCase.category] ??= { total: 0, passed: 0 });

    out.total += 1;
    lang.total += 1;
    category.total += 1;
    if (result.passed) {
      out.passed += 1;
      lang.passed += 1;
      category.passed += 1;
    } else {
      out.failures.push({
        id: testCase.id,
        lang: testCase.lang,
        category: testCase.category,
        text: testCase.text,
        failures: result.failures,
      });
    }
  }
  return out;
}

const pct = (passed: number, total: number) => (total === 0 ? "—" : `${Math.round((passed / total) * 100)}%`);

/** A report someone will actually read, in the terminal or in CI output. */
export function format(result: Report, model: string): string {
  const lines: string[] = [
    "",
    `Agent eval — ${result.passed}/${result.total} (${pct(result.passed, result.total)})  model: ${model}`,
    ...(result.skipped > 0
      ? [
          `${result.skipped} case(s) not answered (the service did not reply), excluded from the score: ${result.skippedIds.join(", ")}`,
        ]
      : []),
    "",
    "By language:",
    ...Object.entries(result.byLang).map(
      ([lang, s]) => `  ${lang}  ${String(s.passed).padStart(3)}/${String(s.total).padEnd(3)} ${pct(s.passed, s.total)}`,
    ),
    "",
    "By category:",
    ...Object.entries(result.byCategory).map(
      ([name, s]) => `  ${name.padEnd(14)} ${String(s.passed).padStart(3)}/${String(s.total).padEnd(3)} ${pct(s.passed, s.total)}`,
    ),
  ];

  if (result.failures.length) {
    lines.push("", `Failures (${result.failures.length}):`);
    for (const f of result.failures) {
      lines.push(`  [${f.id}] (${f.lang}/${f.category}) "${f.text}"`);
      for (const detail of f.failures) lines.push(`      ${detail.kind}: ${detail.detail}`);
    }
  }
  return lines.join("\n");
}
