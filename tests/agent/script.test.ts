import { describe, expect, it } from "vitest";
import { comparable, hasDevanagari, toLatin } from "@/lib/agent/script";
import { matchEntity, type Candidate } from "@/lib/agent/matching";

/**
 * A name said in Marathi, against a record typed in English.
 *
 * This is the half of "Marathi speech-to-text is not working" that is not
 * about speech at all. The transcript can be perfect — ask for the Komatsu in
 * Marathi and get "कोमात्सु", which is exactly right — and the app still says
 * "I couldn't find that", because the record is stored as "Komatsu PC200" and
 * the two strings have nothing in common byte for byte.
 *
 * It matters more than it looks: every Indic ASR model worth switching to
 * outputs Devanagari, so without this, a better speech engine would match
 * FEWER of the owner's records than Whisper does today, not more.
 */

describe("reading Devanagari as Latin", () => {
  it("drops the inherent vowel at the end of a word, as speech does", () => {
    // The rule that decides whether पाटील is "patil" or "patila" — and so
    // whether it matches the operator or nothing at all.
    expect(comparable("पाटील")).toBe("patil");
    expect(comparable("सागर")).toBe("sagar");
    expect(comparable("जाधव")).toBe("jadhav");
  });

  it("keeps the inherent vowel inside a word", () => {
    // वाकड is "vakad", not "vkd": only the last one is dropped.
    expect(comparable("वाकड")).toBe("vakad");
  });

  it("honours the virama, which is there to remove a vowel", () => {
    expect(comparable("कोमात्सु")).toBe("komatsu");
    expect(comparable("श्री")).toBe("shri");
  });

  it("reads the nasal and the Marathi retroflex L", () => {
    expect(comparable("हिंजवडी")).toBe("hinjavadi");
    expect(comparable("पाटील")).toContain("l");
  });

  it("reads Devanagari digits", () => {
    expect(toLatin("२००")).toBe("200");
  });

  it("leaves Latin alone apart from the fold", () => {
    expect(hasDevanagari("Komatsu PC200")).toBe(false);
    expect(comparable("Komatsu PC200")).toBe("komatsu pc200");
  });

  it("handles a sentence that mixes both scripts, which is how people speak", () => {
    expect(comparable("कोमात्सु PC200")).toBe("komatsu pc200");
  });
});

describe("the fold meets both spellings in the middle", () => {
  /** The same name really is written both ways; the fold is what makes them
   * one name. Neither side is "correct" — they only have to agree. */
  const pairs: [string, string][] = [
    ["वाकड", "Wakad"],
    ["श्री", "Shree"],
    ["पाटील", "Paatil"],
    ["हिंजवडी", "Hinjawadi"],
    ["कोमात्सु", "Komatsu"],
    ["सागर", "Saagar"],
  ];

  it.each(pairs)("%s and %s are the same name", (devanagari, latin) => {
    expect(comparable(devanagari)).toBe(comparable(latin));
  });
});

describe("finding the record that was asked for", () => {
  const machines: Candidate[] = [
    { value: "m1", label: "Komatsu PC200" },
    { value: "m2", label: "Tata Hitachi EX200" },
  ];
  const operators: Candidate[] = [
    { value: "o1", label: "Banda Patil" },
    { value: "o2", label: "Sagar Jadhav" },
  ];
  const sites: Candidate[] = [
    { value: "s1", label: "Hinjawadi Phase 2" },
    { value: "s2", label: "Wakad" },
  ];

  it("finds the machine asked for in Marathi", () => {
    expect(matchEntity("कोमात्सु", machines)).toEqual({ kind: "unique", match: machines[0] });
  });

  it("finds the operator asked for in Marathi", () => {
    expect(matchEntity("बंदा पाटील", operators)).toEqual({ kind: "unique", match: operators[0] });
    // And by surname alone, which is how anybody actually refers to them.
    expect(matchEntity("पाटील", operators)).toEqual({ kind: "unique", match: operators[0] });
  });

  it("finds the site asked for in Marathi, across the w/v spelling", () => {
    expect(matchEntity("वाकड", sites)).toEqual({ kind: "unique", match: sites[1] });
    expect(matchEntity("हिंजवडी", sites)).toEqual({ kind: "unique", match: sites[0] });
  });

  it("still asks when the Marathi name could mean two people", () => {
    // The rule the whole matcher exists for survives the new script: two
    // Patils is a question, never a guess, whichever alphabet it was said in.
    const twoPatils: Candidate[] = [
      { value: "o1", label: "Banda Patil" },
      { value: "o3", label: "Sagar Patil" },
    ];
    const result = matchEntity("पाटील", twoPatils);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.matches).toHaveLength(2);
  });

  it("still finds nothing when nothing matches", () => {
    expect(matchEntity("ट्रॅक्टर", machines).kind).toBe("none");
  });

  it("has not changed what Latin already did", () => {
    expect(matchEntity("Komatsu", machines)).toEqual({ kind: "unique", match: machines[0] });
    expect(matchEntity("komat", machines)).toEqual({ kind: "unique", match: machines[0] });
    expect(matchEntity("Patil", operators)).toEqual({ kind: "unique", match: operators[0] });
  });
});
