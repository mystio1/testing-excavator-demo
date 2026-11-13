import { normalizeText } from "./text";
import type { AgentLang } from "./types";

/**
 * Turning a spoken day into a date the form will accept.
 *
 * This exists because of a measured failure: asked to record leave for
 * "Patil kal chutti pe tha", the model returned `fromDate: "kal"`. A browser
 * silently ignores an invalid value on `<input type="date">`, so the box stays
 * empty — and where the date is optional, the form's own default of today wins.
 * The owner says "yesterday" and the app records today, with nothing on screen
 * to show for it.
 *
 * So no date reaches a form until it is a real YYYY-MM-DD, and a word that
 * cannot be read becomes a question instead of a guess.
 *
 * The ambiguity is not a quirk of the model. In Hindi कल / "kal" means
 * yesterday AND tomorrow, and परसों / "parso" means the day before yesterday
 * AND the day after. Marathi distinguishes them (काल is yesterday, उद्या is
 * tomorrow), so the same syllable resolves differently depending on which
 * language the owner is speaking. Where it genuinely cannot be known, the only
 * correct answer is to ask: a job dated a day either side of the truth is
 * wrong on a bill.
 */

export type SpokenDate =
  | { kind: "date"; iso: string }
  /** Understood, but it names two different days. Ask which. */
  | { kind: "ambiguous" }
  /** Not a day we can read at all. Ask for it plainly. */
  | { kind: "unknown" };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar date, not UTC: a yard in India starting work at 09:00 IST
 * must not be recorded as the previous day. */
function isoOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const shift = (today: Date, days: number): SpokenDate => ({
  kind: "date",
  iso: isoOf(new Date(today.getTime() + days * DAY_MS)),
});

/**
 * Offsets in days from today, per language. `null` marks a word that names two
 * days at once — understood, but unanswerable without asking.
 *
 * Keys are normalized (lowercased, punctuation stripped), so both the Latin and
 * the Devanagari spelling of a word can appear.
 */
/**
 * Partial on purpose: a language with no table here cannot resolve a spoken
 * day at all, so `resolveSpokenDay` returns "unknown" and the app ASKS for the
 * date instead.
 *
 * That is the safe degradation, not a shortfall. Hindi "kal" means yesterday
 * AND tomorrow while Marathi keeps them apart — the ambiguity is specific to
 * each language, and guessing at it in a language nobody has checked would
 * date a record a day either side of the truth, which is wrong on a bill.
 * Refusing to interpret a word until a speaker confirms it is the same
 * discipline the rest of the agent follows.
 *
 * English stays in the fallback chain for every language, because people mix
 * and "today" is said everywhere.
 */
const WORDS: Partial<Record<AgentLang, Record<string, number | null>>> = {
  en: {
    today: 0,
    "to day": 0,
    now: 0,
    yesterday: -1,
    tomorrow: 1,
    "day before yesterday": -2,
    "day after tomorrow": 2,
  },
  hi: {
    aaj: 0,
    आज: 0,
    abhi: 0,
    अभी: 0,
    // Both. This is the word that started all this.
    kal: null,
    कल: null,
    parso: null,
    parson: null,
    परसों: null,
    // Said when the ambiguity is being resolved by the speaker themselves.
    "beeta kal": -1,
    "bita kal": -1,
    "बीता कल": -1,
    "pichla kal": -1,
    "aane wala kal": 1,
    "आने वाला कल": 1,
    "agla kal": 1,
  },
  mr: {
    aaj: 0,
    आज: 0,
    ata: 0,
    आता: 0,
    // Marathi keeps them apart, so these are answerable where Hindi's are not.
    kal: -1,
    काल: -1,
    udya: 1,
    उद्या: 1,
    // Still both ways in Marathi.
    parva: null,
    परवा: null,
  },
};

/** "3 din pehle", "2 days ago", "4 divas purvi" — and the forward forms. */
const RELATIVE =
  /^(\d{1,3})\s*(?:din|days?|divas|दिन|दिवस)(?:\s+(pehle|pahile|ago|back|purvi|पहले|पूर्वी|आधी|baad|nantar|later|बाद|नंतर))?$/;

/** A bare count looks back, because people report work that has already
 * happened. One of these has to be said to mean the future. */
const FORWARD = new Set(["baad", "nantar", "later", "बाद", "नंतर"]);

/** Digits only: a written date needs no reference point, so this takes no
 * `today`. Words go through resolveSpokenDay(). */
export function resolveSpokenDate(value: string | number): SpokenDate {
  const raw = String(value).trim();
  if (!raw) return { kind: "unknown" };

  // Already a real date: the common case once the model is told the format.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return isValid(raw) ? { kind: "date", iso: raw } : { kind: "unknown" };

  // Indian convention: 03/04/2026 is 3 April, never 4 March. Written dates in
  // this country are day-first, and reading them the other way would be wrong
  // about eleven months of the year.
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(raw);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    const candidate = `${year}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    return isValid(candidate) ? { kind: "date", iso: candidate } : { kind: "unknown" };
  }

  // Not a numeric date. It may still be a word, which resolveSpokenDay() reads.
  return { kind: "unknown" };
}

/** A date the calendar actually has: 2026-02-31 parses and then quietly
 * becomes 3 March, which is not what anybody said. */
function isValid(candidate: string): boolean {
  const [y, m, d] = candidate.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Words, which need to know which language is being spoken. `today` is injected
 * rather than read from the clock so this is testable and so one turn cannot
 * straddle midnight between two fields.
 */
export function resolveSpokenDay(value: string | number, lang: AgentLang, today: Date): SpokenDate {
  const numeric = resolveSpokenDate(value);
  if (numeric.kind === "date") return numeric;

  const key = normalizeText(String(value));
  if (!key) return { kind: "unknown" };

  // The chosen language first, then the others: an owner with the panel in
  // Hindi still says "today" sometimes, and "aaj" means the same in both.
  // The owner's own language first, then the ones whose day words are known.
  // A language absent from WORDS contributes nothing, so nothing is guessed.
  const order: AgentLang[] = [lang, ...(["en", "hi", "mr"] as AgentLang[]).filter((l) => l !== lang)];
  for (const candidateLang of order) {
    const table = WORDS[candidateLang];
    if (!table) continue;
    const offset = table[key];
    if (offset === null) return { kind: "ambiguous" };
    if (offset !== undefined) return shift(today, offset);
  }

  const relative = RELATIVE.exec(key);
  if (relative) {
    const days = Number(relative[1]);
    if (days > 366) return { kind: "unknown" };
    const forward = FORWARD.has(relative[2] ?? "");
    return shift(today, forward ? days : -days);
  }

  return { kind: "unknown" };
}
