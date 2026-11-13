import { comparable } from "./script";
import { normalizeText } from "./text";
/**
 * Turning what someone said into one record on screen.
 *
 * Kept pure so the rule that matters can actually be tested: when a name could
 * mean two people, the answer is a question, never a choice. "Patil ka trip
 * daal" with a Banda Patil and a Sagar Patil on the books has exactly one
 * correct behaviour, and it is to ask.
 */

export type Candidate = {
  /** Value the controller clicks or submits — an id, never a name. */
  value: string;
  /** What the person sees: "Komatsu PC200 (PC200-2)", "Banda Patil". */
  label: string;
};

export type MatchResult =
  | { kind: "unique"; match: Candidate }
  | { kind: "ambiguous"; matches: Candidate[] }
  | { kind: "none" };

/**
 * Lowercase, strip punctuation, collapse spaces. This is what makes "PC-200",
 * "pc 200" and "PC200" the same machine, and it has to run on both sides of
 * every comparison.
 *
 * Re-exported rather than written here: one shared implementation is the only
 * way the \p{M} rule it depends on stays true in every place that compares
 * text. See text.ts.
 */
export const normalize = normalizeText;


/**
 * The words of a name, in the form both scripts can be compared in.
 *
 * `comparable` runs FIRST, because normalising afterwards is what makes a
 * Devanagari transcript and a Latin record the same string. Said in Marathi,
 * a machine comes back as "कोमात्सु" and the record says "Komatsu"; without
 * this the app answers "I couldn't find that" about a record it is holding.
 * See script.ts.
 */
const tokens = (text: string): string[] =>
  normalize(comparable(text)).split(" ").filter(Boolean);

/** Spoken filler that carries no identifying information: "machine number 2"
 * and "2" mean the same machine, and "operator Patil" the same person. */
const NOISE = new Set([
  "machine",
  "no",
  "number",
  "num",
  "operator",
  "driver",
  "ka",
  "ki",
  "ke",
  "cha",
  "chi",
  "che",
  "la",
  "my",
  "mera",
  "meri",
  "maza",
  "majha",
  "the",
]);

const meaningful = (text: string): string[] => tokens(text).filter((t) => !NOISE.has(t));

/**
 * Which candidates the spoken name could mean, in order of how well they fit.
 *
 * Tried in narrowing order, and the FIRST tier that matches anything wins, so a
 * person who says the exact label is never also offered the loose matches. A
 * tier returning two candidates is ambiguity, not a ranking to pick the top of.
 */
export function matchEntity(query: string, candidates: Candidate[]): MatchResult {
  const q = meaningful(query);
  if (q.length === 0) return { kind: "none" };

  const scored = candidates.map((c) => ({ candidate: c, words: meaningful(c.label) }));

  // 1. The whole label, said exactly.
  const exact = scored.filter((s) => s.words.join(" ") === q.join(" "));
  // 2. Every word said appears in the label: "Patil" in "Banda Patil",
  //    "pc200 2" in "Komatsu PC200 PC200 2".
  const allWords = scored.filter((s) => q.every((word) => s.words.includes(word)));
  // 3. Every word said is a prefix of some word in the label, which is what
  //    rescues a half-heard "komat" or a shortened "hinja".
  const prefixes = scored.filter((s) =>
    q.every((word) => s.words.some((w) => w.startsWith(word) || word.startsWith(w))),
  );

  const tier = [exact, allWords, prefixes].find((t) => t.length > 0);
  if (!tier) return { kind: "none" };
  if (tier.length === 1) return { kind: "unique", match: tier[0]!.candidate };
  return { kind: "ambiguous", matches: tier.map((s) => s.candidate) };
}

/** "Did you mean Banda Patil or Sagar Patil?" — the labels, in the order shown. */
export function describeAmbiguity(matches: Candidate[], limit = 4): string[] {
  return matches.slice(0, limit).map((m) => m.label);
}
