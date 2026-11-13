import { describe, expect, it } from "vitest";
import { resolveSpokenDate, resolveSpokenDay } from "@/lib/agent/dates";

/**
 * A day, as someone says it.
 *
 * The case that matters most is the one that must NOT resolve: Hindi "kal" is
 * yesterday and tomorrow at once, and a job dated a day either side of the
 * truth is wrong on a bill. Guessing is worse than asking.
 */

// A Thursday, chosen so the week either side is easy to read.
const today = new Date(2026, 9, 23);

const iso = (value: string | number, lang: "en" | "hi" | "mr" = "en") =>
  resolveSpokenDay(value, lang, today);

describe("a day said in words", () => {
  it("reads today, yesterday and tomorrow in English", () => {
    expect(iso("today")).toEqual({ kind: "date", iso: "2026-10-23" });
    expect(iso("yesterday")).toEqual({ kind: "date", iso: "2026-10-22" });
    expect(iso("tomorrow")).toEqual({ kind: "date", iso: "2026-10-24" });
  });

  it("reads aaj in Hindi, in either script", () => {
    expect(iso("aaj", "hi")).toEqual({ kind: "date", iso: "2026-10-23" });
    expect(iso("आज", "hi")).toEqual({ kind: "date", iso: "2026-10-23" });
  });

  it("refuses to pick a day for Hindi kal, which means both", () => {
    // The measured failure that this whole module exists for.
    expect(iso("kal", "hi")).toEqual({ kind: "ambiguous" });
    expect(iso("कल", "hi")).toEqual({ kind: "ambiguous" });
    expect(iso("parso", "hi")).toEqual({ kind: "ambiguous" });
    expect(iso("परसों", "hi")).toEqual({ kind: "ambiguous" });
  });

  it("takes the speaker's own disambiguation when they give one", () => {
    expect(iso("beeta kal", "hi")).toEqual({ kind: "date", iso: "2026-10-22" });
    expect(iso("aane wala kal", "hi")).toEqual({ kind: "date", iso: "2026-10-24" });
  });

  it("reads kal as yesterday in Marathi, because Marathi says it only one way", () => {
    // काल is yesterday and उद्या is tomorrow — the same syllable, a different
    // answer, decided by which language the owner is speaking.
    expect(iso("kal", "mr")).toEqual({ kind: "date", iso: "2026-10-22" });
    expect(iso("काल", "mr")).toEqual({ kind: "date", iso: "2026-10-22" });
    expect(iso("udya", "mr")).toEqual({ kind: "date", iso: "2026-10-24" });
    expect(iso("उद्या", "mr")).toEqual({ kind: "date", iso: "2026-10-24" });
  });

  it("still refuses parva in Marathi, which is both ways there too", () => {
    expect(iso("parva", "mr")).toEqual({ kind: "ambiguous" });
    expect(iso("परवा", "mr")).toEqual({ kind: "ambiguous" });
  });

  it("understands an English word while the panel is in Hindi", () => {
    // People mix. "Today" in a Hindi sentence is still today.
    expect(iso("today", "hi")).toEqual({ kind: "date", iso: "2026-10-23" });
  });

  it("counts back a number of days", () => {
    expect(iso("3 din pehle", "hi")).toEqual({ kind: "date", iso: "2026-10-20" });
    expect(iso("2 days ago")).toEqual({ kind: "date", iso: "2026-10-21" });
    // A bare count is backward-looking: people report work that happened.
    expect(iso("4 din", "hi")).toEqual({ kind: "date", iso: "2026-10-19" });
    expect(iso("2 din baad", "hi")).toEqual({ kind: "date", iso: "2026-10-25" });
  });

  it("does not accept a count that is obviously not a day count", () => {
    expect(iso("5000 din", "hi")).toEqual({ kind: "unknown" });
  });

  it("asks rather than guessing at anything it cannot read", () => {
    expect(iso("jab machine aayi thi", "hi")).toEqual({ kind: "unknown" });
    expect(iso("")).toEqual({ kind: "unknown" });
    expect(iso("Diwali", "hi")).toEqual({ kind: "unknown" });
  });

  it("ignores punctuation and case around a word", () => {
    expect(iso("  Yesterday.  ")).toEqual({ kind: "date", iso: "2026-10-22" });
  });
});

describe("a date already written as digits", () => {
  it("passes a real ISO date straight through", () => {
    expect(resolveSpokenDate("2026-03-04")).toEqual({ kind: "date", iso: "2026-03-04" });
  });

  it("reads a written date day-first, as this country writes them", () => {
    // 03/04/2026 is 3 April. Reading it the American way would be wrong about
    // eleven months of the year.
    expect(resolveSpokenDate("03/04/2026")).toEqual({ kind: "date", iso: "2026-04-03" });
    expect(resolveSpokenDate("3-4-26")).toEqual({ kind: "date", iso: "2026-04-03" });
    expect(resolveSpokenDate("23.10.2026")).toEqual({ kind: "date", iso: "2026-10-23" });
  });

  it("refuses a date the calendar does not have", () => {
    // Left alone, this quietly becomes 3 March, which nobody said.
    expect(resolveSpokenDate("2026-02-31")).toEqual({ kind: "unknown" });
    expect(resolveSpokenDate("31/02/2026")).toEqual({ kind: "unknown" });
    expect(resolveSpokenDate("2026-13-01")).toEqual({ kind: "unknown" });
  });

  it("uses the local calendar day, not UTC", () => {
    // Late evening in India is already the next day in UTC. A job finished at
    // 11pm must not be recorded as tomorrow.
    const lateEvening = new Date(2026, 9, 23, 23, 30);
    expect(resolveSpokenDay("today", "hi", lateEvening)).toEqual({ kind: "date", iso: "2026-10-23" });
  });
});
