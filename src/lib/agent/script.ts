/**
 * Matching a name said in Devanagari against a name written in Latin.
 *
 * The owner's records are stored the way they were typed — "Komatsu PC200",
 * "Banda Patil", "Hinjawadi Phase 2". Speech does not come back that way. Ask
 * for a machine in Marathi and the transcript is "कोमात्सु", and `normalizeText`
 * compares that against "komatsu" as two completely different strings. The
 * instruction was understood, the name was heard correctly, and the app still
 * answers "I couldn't find that".
 *
 * That is a matching failure wearing the costume of a transcription failure,
 * which is why it is worth fixing here rather than by changing the speech
 * engine: every Indic ASR model worth using outputs Devanagari, so without
 * this, a better engine would match FEWER names, not more.
 *
 * ## What this is not
 *
 * It is not a romanizer. Nothing here is shown to anybody, and "correct"
 * transliteration is not the goal — a CONSISTENT one is. Both sides of every
 * comparison are put through the same deliberately lossy fold, so they only
 * have to meet in the middle:
 *
 *     "पाटील"  → paatiila → paatiil → patil
 *     "Patil"  →                      patil
 *
 *     "वाकड"   → vaakada  → vaakad  → vakad
 *     "Wakad"  →                      vakad
 *
 * Long and short vowels collapse because Latin spellings of Indian names are
 * not consistent either — the same person is Patil and Paatil, Shree and Shri,
 * Wakad and Vakad. Folding both sides is what makes those the same name.
 *
 * ## Why looseness is safe here
 *
 * A fold this aggressive will occasionally make two different records look
 * alike. That is survivable because of what the matcher does with it: two
 * matches is `ambiguous`, and ambiguous asks the owner which one they meant.
 * The cost of folding too hard is a question; the cost of folding too little
 * is "I couldn't find that" for a name that is sitting in the database.
 */

/** Devanagari, used by Hindi and Marathi alike. */
const DEVANAGARI = /[ऀ-ॿ]/;

export const hasDevanagari = (text: string): boolean => DEVANAGARI.test(text);

/** Vowels that stand on their own, at the start of a word. */
const VOWELS: Record<string, string> = {
  "अ": "a", // अ
  "आ": "aa", // आ
  "इ": "i", // इ
  "ई": "ii", // ई
  "उ": "u", // उ
  "ऊ": "uu", // ऊ
  "ऋ": "ri", // ऋ
  "ॠ": "ri", // ॠ
  "ए": "e", // ए
  "ऐ": "ai", // ऐ
  "ओ": "o", // ओ
  "औ": "au", // औ
  "ऍ": "e", // ऍ
  "ऑ": "o", // ऑ
  "ऎ": "e", // ऎ
  "ऒ": "o", // ऒ
};

/** The vowel signs that hang off a consonant. */
const MATRAS: Record<string, string> = {
  "ा": "aa", // ा
  "ि": "i", // ि
  "ी": "ii", // ी
  "ु": "u", // ु
  "ू": "uu", // ू
  "ृ": "ri", // ृ
  "े": "e", // े
  "ै": "ai", // ै
  "ो": "o", // ो
  "ौ": "au", // ौ
  "ॅ": "e", // ॅ
  "ॉ": "o", // ॉ
  "ॆ": "e", // ॆ
  "ॊ": "o", // ॊ
};

const CONSONANTS: Record<string, string> = {
  "क": "k", // क
  "ख": "kh", // ख
  "ग": "g", // ग
  "घ": "gh", // घ
  "ङ": "n", // ङ
  "च": "ch", // च
  "छ": "chh", // छ
  "ज": "j", // ज
  "झ": "jh", // झ
  "ञ": "n", // ञ
  "ट": "t", // ट
  "ठ": "th", // ठ
  "ड": "d", // ड
  "ढ": "dh", // ढ
  "ण": "n", // ण
  "त": "t", // त
  "थ": "th", // थ
  "द": "d", // द
  "ध": "dh", // ध
  "न": "n", // न
  "प": "p", // प
  "फ": "ph", // फ
  "ब": "b", // ब
  "भ": "bh", // भ
  "म": "m", // म
  "य": "y", // य
  "र": "r", // र
  "ल": "l", // ल
  "ळ": "l", // ळ — Marathi's retroflex L, in Patil and Hinjawadi alike
  "व": "v", // व
  "श": "sh", // श
  "ष": "sh", // ष
  "स": "s", // स
  "ह": "h", // ह
  // Precomposed nukta forms, which arrive from some keyboards as one character.
  "क़": "k", // क़
  "ख़": "kh", // ख़
  "ग़": "g", // ग़
  "ज़": "j", // ज़
  "ड़": "r", // ड़
  "ढ़": "rh", // ढ़
  "फ़": "ph", // फ़
  "य़": "y", // य़
};

const VIRAMA = "्"; // ्  — kills the inherent vowel
const NUKTA = "़"; // ़  — combining; folded into its base above
const ANUSVARA = "ं"; // ं
const CHANDRABINDU = "ँ"; // ँ
const VISARGA = "ः"; // ः

const DIGITS: Record<string, string> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

/**
 * Stands in for the inherent "a" until the end of the word.
 *
 * Every bare consonant carries one, but Hindi and Marathi drop the last one
 * when speaking: पाटील is "Patil", not "Patila". Marking them rather than
 * writing them means the final one can be removed once the word is known to
 * have ended — which is the difference between `patil` and `patila`, and so
 * between matching the record and not.
 */
const SCHWA = "\u0001";

/** Devanagari to a rough Latin. See the file comment: rough is the point. */
export function toLatin(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (CONSONANTS[ch]) {
      out += CONSONANTS[ch];
      // A combining nukta after the base: already folded, so just step over it.
      let next = text[i + 1];
      if (next === NUKTA) {
        i += 1;
        next = text[i + 1];
      }
      if (next === VIRAMA) {
        i += 1; // the vowel is suppressed
      } else if (next && MATRAS[next]) {
        out += MATRAS[next];
        i += 1;
      } else {
        out += SCHWA;
      }
      continue;
    }

    if (VOWELS[ch]) out += VOWELS[ch];
    else if (ANUSVARA === ch || CHANDRABINDU === ch) out += "n";
    else if (VISARGA === ch) out += "h";
    else if (DIGITS[ch]) out += DIGITS[ch];
    else if (ch === "।" || ch === "॥") out += " "; // । ॥
    else if (ch === "ऽ") continue; // ऽ avagraha carries no sound here
    else if (MATRAS[ch] || ch === VIRAMA || ch === NUKTA) continue; // stray mark
    else out += ch; // Latin, digits, spaces — left exactly as they are
  }

  // Drop the schwa that ends a word; keep the ones inside it.
  return out
    .split(" ")
    .map((word) => word.replace(new RegExp(`${SCHWA}$`), ""))
    .join(" ")
    .split(SCHWA)
    .join("a");
}

/**
 * The lossy part, applied to BOTH sides of every comparison.
 *
 * Each rule exists because the same name is really written both ways:
 * Patil/Paatil, Shree/Shri, Wakad/Vakad, Zahir/Jahir. Correctness is not the
 * test — doing the same thing to the spoken side and the stored side is.
 */
function fold(latin: string): string {
  return latin
    .replace(/a{2,}/g, "a")
    .replace(/(?:ii|ee|ie){1,}/g, "i")
    .replace(/i{2,}/g, "i")
    .replace(/(?:uu|oo){1,}/g, "u")
    .replace(/u{2,}/g, "u")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/f/g, "ph");
}

/**
 * The form two names are compared in, whichever script each was written in.
 *
 * Latin text is folded but never transliterated, so "Komatsu" is untouched
 * apart from the fold; Devanagari is transliterated first. A string holding
 * both — which is what mixed Hinglish speech looks like — comes out right
 * because toLatin passes Latin characters through unchanged.
 */
export function comparable(text: string): string {
  return fold(hasDevanagari(text) ? toLatin(text) : text.toLowerCase()).toLowerCase();
}
