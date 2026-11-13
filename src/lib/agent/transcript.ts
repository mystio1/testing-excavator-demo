import { normalizeText } from "./text";

/**
 * Deciding whether Whisper actually heard something.
 *
 * Whisper never returns "nothing". Handed a few seconds of an idling engine it
 * writes a fluent sentence anyway — commonly a scrap of its own prompt, or one
 * phrase repeated until the clip runs out. Acted on, that invents work the
 * owner never asked for, so a transcript has to earn its way out of here.
 *
 * verbose_json gives per-segment confidence, which is the only honest signal
 * available: silence scores very differently from speech.
 */

export type WhisperSegment = {
  text?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  compression_ratio?: number;
};

export type WhisperBody = { text?: string; segments?: WhisperSegment[] };

/**
 * Whisper's own published thresholds. They catch a loop and an outright silent
 * clip, and that is all they catch here: measured against this provider, three
 * seconds of engine noise came back as "Thank you." with no_speech_prob 0.053
 * and avg_logprob -0.67 — scores real speech also reaches (-0.42 to -0.56 on a
 * clear sentence). There is no threshold between those two that does not also
 * throw away what the owner said, so the confidence rules are the floor and the
 * phrase list below is what actually does this job.
 */
const NO_SPEECH_PROB = 0.6;
const QUIET_LOGPROB = -0.4;
const GIBBERISH_LOGPROB = -1.0;
const REPEAT_RATIO = 2.4;

/**
 * Measured against the live endpoint, from a clip of pure digital silence —
 * 32,000 zero samples, nothing to hear at all:
 *
 *     no_speech_prob = 0.036   avg_logprob = -0.443   compression = 2.35
 *     "जब आप आपको अपना व्यासाय का व्यासाय का उठान है, तो आपको अपना ..."
 *
 * Read those numbers again. On a file that is literally silent, Whisper
 * reported a 3.6% chance of there being no speech, and a confidence in its
 * invented sentence BETTER than it gives a clear real one (-0.42 to -0.56).
 * Every confidence rule above is blind here, and no amount of tuning fixes it:
 * there is no threshold that rejects -0.443 and keeps -0.42.
 *
 * The phrase list below is blind too. It holds caption boilerplate, and this
 * is not boilerplate — three runs of the same silent clip produced three
 * different Hindi sentences, one of them ending "...शुरू करते हैं", which is
 * how an owner says "start it".
 *
 * So the rules that actually carry this are the two below, and they judge the
 * SHAPE of the words rather than the provider's opinion of them. See
 * tests/eval/listen.test.ts, which is what measured all of this.
 */

/**
 * A loop needs this many words before a low distinct-count means anything.
 *
 * Set above conversational repetition, not just above a short answer. People
 * say a command twice when they mean it — "band karo band karo" is four words
 * and two distinct, which the ratio below would otherwise throw away, and an
 * owner being emphatic is not a decoder stuck in a loop. The hallucinations
 * actually measured were either a single word chanted (handled on its own
 * below, at any length) or long: the silence sentence is 21 words. There is
 * plenty of room between the two.
 */
const LOOP_MIN_WORDS = 8;
/**
 * Distinct words ÷ total, at or below which a stretch is going round in
 * circles. Measured: the silence sentence above is 10 distinct words in 21
 * (0.48). Real instructions do not come close — "Patil ko do hazaar advance
 * diya" is 6 in 6, and "JCB ka kaam shuru karo" is 5 in 5.
 */
const LOOP_DISTINCT_RATIO = 0.55;

/**
 * The vocabulary prompt, handed back as though it were speech.
 *
 * Measured from silence: `" KOMATO PC200, Tata Hitachi EX200, Banda Patil,
 * Sagar Jadhav, Hinjawadi Phase 2, Saree Constructions."` — the owner's own
 * machines, operator, site and customer, which are exactly the values that get
 * matched against real records.
 *
 * The old check was `prompt.includes(segment)`, and it missed this because
 * Whisper mangled two names: KOMATO for Komatsu, Saree for Shree. A near-copy
 * is not a substring, so an exact test is the wrong instrument. What is
 * reliable is that almost every word came from the prompt (12 of 14 here),
 * while a real instruction has to carry verbs and particles that the
 * vocabulary does not contain.
 */
const ECHO_MIN_WORDS = 8;
const ECHO_OVERLAP = 0.8;

/**
 * The only words allowed to fill a whole clip by repeating.
 *
 * "haan haan" is emphasis, not a decoder loop, and these are complete answers
 * to a real question — the same reason they are kept out of PHANTOMS. Without
 * this, saying yes twice would be thrown away.
 */
const ANSWER_WORDS = new Set([
  "haan",
  "han",
  "ha",
  "haa",
  "yes",
  "ok",
  "okay",
  "nahi",
  "nahin",
  "na",
  "no",
  "theek",
  "thik",
  "achha",
  "acha",
  "हाँ",
  "हां",
  "हो",
  "नहीं",
  "नाही",
  "ठीक",
  "बरोबर",
]);

/** Short enough to be a real one-word answer ("Patil", "haan", "JCB"), and
 * those must survive the prompt-echo check below. */
const ECHO_MIN_CHARS = 15;

/**
 * What Whisper says when it has heard nothing. These are not guesses at the
 * owner's words — they are fragments of the video captions it was trained on,
 * and they surface on silence and on background noise alike.
 *
 * Matched against the WHOLE transcript only, never a part of it. "Thank you"
 * inside a sentence is the owner speaking; "Thank you" as the entire clip is
 * the decoder filling a gap. Each of these is also a complete non-instruction,
 * so dropping one costs the owner nothing even in the rare case they said it.
 *
 * Deliberately absent: "haan", "yes", "ok", "nahi". Those are real answers to
 * a real question and must always get through.
 */
const PHANTOMS = new Set([
  "thank you",
  "thanks",
  "thank you very much",
  "thank you for watching",
  "thanks for watching",
  "thank you for watching this video",
  "please subscribe",
  "subscribe to my channel",
  "like and subscribe",
  "see you in the next video",
  "dhanyavad",
  "shukriya",
  "धन्यवाद",
  "शुक्रिया",
  "आपका धन्यवाद",
  "देखने के लिए धन्यवाद",
  "पाहिल्याबद्दल धन्यवाद",
  "अगले वीडियो में मिलेंगे",
]);

/** Caption boilerplate that arrives with a credit attached rather than as a
 * fixed phrase ("Subtitles by the Amara.org community"). */
const PHANTOM_PATTERNS = [/\bamara\s*org\b/, /\bsubtitle[sd]?\s+by\b/, /\bsubscribe\b.*\bchannel\b/];

const norm = normalizeText;

const wordsOf = (text: string): string[] => {
  const n = norm(text);
  return n ? n.split(" ") : [];
};

/**
 * The same few words coming round again — a decoder filling a clip rather than
 * a person giving an instruction.
 *
 * Whisper's own compression_ratio is supposed to catch this and does not: the
 * measured silence loop scored 2.35 against a threshold of 2.4, and the
 * two-word case ("प्रश्न प्रश्न", from room hiss) scored 1.36, because a ratio
 * needs length before repetition shows up in it. Counting the words works at
 * any length.
 */
function goesRoundInCircles(words: string[]): boolean {
  if (words.length < 2) return false;
  const distinct = new Set(words);
  if (distinct.size === 1) return !ANSWER_WORDS.has(words[0]!);
  return words.length >= LOOP_MIN_WORDS && distinct.size / words.length <= LOOP_DISTINCT_RATIO;
}

/**
 * Nearly every word came out of the vocabulary we supplied, which means we are
 * being read our own prompt back. Length-guarded, because a one or two word
 * answer IS usually a name from the vocabulary and must survive.
 */
function recitesTheVocabulary(words: string[], promptWords: Set<string>): boolean {
  if (words.length < ECHO_MIN_WORDS || promptWords.size === 0) return false;
  const fromPrompt = words.filter((w) => promptWords.has(w)).length;
  return fromPrompt / words.length >= ECHO_OVERLAP;
}

/** Both shape rules, for a segment or for a whole response. */
function looksInvented(text: string, promptWords: Set<string>): boolean {
  const words = wordsOf(text);
  return goesRoundInCircles(words) || recitesTheVocabulary(words, promptWords);
}

function heard(segment: WhisperSegment, promptNorm: string, promptWords: Set<string>): boolean {
  const text = segment.text?.trim();
  if (!text) return false;

  const logprob = segment.avg_logprob ?? 0;
  const noSpeech = segment.no_speech_prob ?? 0;
  const ratio = segment.compression_ratio ?? 1;

  // Confident that there was no speech, and unconfident about the words it
  // wrote anyway: that is the signature of a clip of background noise.
  if (noSpeech > NO_SPEECH_PROB && logprob < QUIET_LOGPROB) return false;
  if (logprob < GIBBERISH_LOGPROB) return false;
  // Highly compressible text means the same phrase over and over — a decoder
  // stuck in a loop, never a person giving an instruction.
  if (ratio > REPEAT_RATIO) return false;
  // Giving Whisper the owner's vocabulary makes it more likely to hand a piece
  // of that vocabulary straight back when it has nothing else to say.
  const segmentNorm = norm(text);
  if (segmentNorm.length >= ECHO_MIN_CHARS && promptNorm.includes(segmentNorm)) return false;
  // The rules that do the real work. Kept last so the cheap numeric checks
  // above still short-circuit, and applied again to the joined text below in
  // case a loop is spread across segments.
  if (looksInvented(text, promptWords)) return false;

  return true;
}

/**
 * The part of the response worth acting on, or "" when the clip held no
 * speech. An empty string is a real answer here — the panel says "I didn't
 * catch that", which is the truth and is better than obeying a hallucination.
 *
 * A response with no segments (a plain `json` format, or a model that omits
 * them) falls back to the whole text: screening is an improvement on trust,
 * not a precondition for it.
 */
export function usableTranscript(body: WhisperBody, prompt = ""): string {
  const segments = body.segments;
  const promptNorm = norm(prompt);
  const promptWords = new Set(promptNorm ? promptNorm.split(" ") : []);
  // No segments means no confidence to judge by, but the phrase screen below
  // still applies — a phantom is a phantom whichever format asked for it.
  const text = segments?.length
    ? segments
        .filter((s) => heard(s, promptNorm, promptWords))
        .map((s) => s.text!.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : (body.text ?? "").trim();

  const key = norm(text);
  if (!key) return "";
  if (PHANTOMS.has(key)) return "";
  if (PHANTOM_PATTERNS.some((re) => re.test(key))) return "";
  // Also on the whole answer: a response with no segments at all has had no
  // screening until here, and a loop split across two segments only shows up
  // once they are joined.
  if (looksInvented(text, promptWords)) return "";
  return text;
}
