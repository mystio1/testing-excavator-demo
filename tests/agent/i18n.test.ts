import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_LANGS,
  BCP47,
  LANG_LABEL,
  LANG_NAME,
  REVIEWED,
  isMissing,
  offeredLangs,
  say,
  type Localized,
} from "@/lib/agent/i18n";
import { SHORTCUTS } from "@/lib/agent/shortcuts";
import { VOICE_NOTICE } from "@/lib/agent/consent";
import { allWorkflows } from "@/lib/agent/resolver";

/**
 * Nine languages, and an honest account of which strings exist in each.
 *
 * The shape being tested is the point of the whole thing. A plain
 * `Record<AgentLang, string>` would make adding a language a compile error in
 * twenty places, so the only way to build would be to produce two hundred
 * translations in one sitting — which is how a product ends up shipping text
 * nobody has read. English required, the rest optional, resolved through say().
 *
 * These tests do two jobs: they hold the invariants that must never slip, and
 * they PRINT what is still falling back, so the gap is a number somebody can
 * look at rather than a surprise a customer finds.
 */

const localizedTables: { name: string; value: Localized<unknown> }[] = [
  { name: "VOICE_NOTICE", value: VOICE_NOTICE },
  ...SHORTCUTS.map((s) => ({ name: `shortcut:${s.id}`, value: s.label })),
  ...allWorkflows()
    .filter((w) => w.status === "ready")
    .flatMap((w) => w.fields.map((f) => ({ name: `prompt:${w.id}.${f.name}`, value: f.prompt }))),
];

describe("the language set", () => {
  it("has a name, a label and a voice code for every language", () => {
    // A language in the union with no BCP47 code would be offered and then be
    // silent, and one with no label would show as a bare code.
    for (const lang of AGENT_LANGS) {
      expect(LANG_NAME[lang], `${lang} has no English name for the model`).toBeTruthy();
      expect(LANG_LABEL[lang], `${lang} has no label in its own script`).toBeTruthy();
      expect(BCP47[lang], `${lang} has no speech code`).toMatch(/^[a-z]{2}-IN$/);
    }
  });

  it("says which languages a speaker has actually checked", () => {
    // "We added Tamil" and "Tamil is right" are different claims, and only one
    // is safe to tell a customer.
    expect(REVIEWED).toContain("en");
    for (const lang of REVIEWED) expect(AGENT_LANGS).toContain(lang);
  });

  it("offers only the reviewed ones by default", () => {
    expect(offeredLangs().sort()).toEqual([...REVIEWED].sort());
  });
});

describe("resolving a string", () => {
  const text: Localized = { en: "Machines", hi: "मशीनें" };

  it("gives the language when it is there", () => {
    expect(say(text, "hi")).toBe("मशीनें");
  });

  it("falls back to English rather than to nothing", () => {
    // An owner meeting an English word they recognise from the rest of the app
    // is better served than one meeting a sentence that is confidently wrong
    // about their money.
    expect(say(text, "ta")).toBe("Machines");
    expect(say(text, "pa")).toBe("Machines");
  });

  it("reports a fallback as missing, so the gap can be counted", () => {
    expect(isMissing(text, "ta")).toBe(true);
    expect(isMissing(text, "hi")).toBe(false);
    // English is never "missing" — it is the floor.
    expect(isMissing(text, "en")).toBe(false);
  });
});

describe("what the owner meets first", () => {
  it("has the panel's own words in every language", async () => {
    // The labels, the mic errors and the voice notice are what somebody sees
    // before they have typed anything. A fallback there is the whole panel in
    // the wrong language.
    for (const lang of AGENT_LANGS) {
      expect(say(VOICE_NOTICE, lang).title, `voice notice title (${lang})`).toBeTruthy();
      expect(isMissing(VOICE_NOTICE, lang), `voice notice (${lang}) falls back`).toBe(false);
    }
  });

  it("has every shortcut in every language", () => {
    // These are the buttons that work when the model does not, so they are the
    // last thing that should be in a language the owner did not choose.
    for (const shortcut of SHORTCUTS) {
      for (const lang of AGENT_LANGS) {
        expect(isMissing(shortcut.label, lang), `${shortcut.id} (${lang}) falls back`).toBe(false);
      }
    }
  });
});

describe("coverage", () => {
  it("reports what is still falling back, per language", () => {
    const report = AGENT_LANGS.filter((l) => l !== "en").map((lang) => {
      const missing = localizedTables.filter((t) => isMissing(t.value, lang));
      return { lang, missing: missing.length, of: localizedTables.length, examples: missing.slice(0, 3).map((m) => m.name) };
    });

    const lines = report.map(
      (r) =>
        `  ${r.lang}  ${r.of - r.missing}/${r.of} translated` +
        (r.missing > 0 ? `  — still English: ${r.examples.join(", ")}${r.missing > 3 ? ` (+${r.missing - 3})` : ""}` : ""),
    );
    console.log(`\nAssistant string coverage (${localizedTables.length} strings)\n${lines.join("\n")}\n`);

    // Not an assertion on completeness: field prompts fall back to English on
    // purpose until a speaker confirms them. What IS asserted is that the
    // reviewed languages are complete, because those are the ones offered.
    for (const lang of REVIEWED) {
      const missing = localizedTables.filter((t) => isMissing(t.value, lang));
      expect(missing.map((m) => m.name), `${lang} is offered but incomplete`).toEqual([]);
    }
  });

  it("never leaves a string with no English at all", () => {
    // English is the floor every fallback lands on; without it say() returns
    // undefined and the owner meets a blank.
    for (const table of localizedTables) {
      expect(table.value.en, `${table.name} has no English`).toBeTruthy();
    }
  });
});

describe("the speech layer speaks the same languages", () => {
  /**
   * Checked by reading the source, which is the only way to check it.
   *
   * This test used to assert `typeof speech extends never ? never : AgentLang`,
   * a conditional that always resolves to AgentLang and therefore could not
   * fail — it tested nothing while reading as though it did. A type cannot be
   * caught drifting at runtime, so the drift is caught where it would be
   * written instead.
   *
   * The drift is real: use-speech once had its own three-value union, so the
   * panel could offer a language the speech layer had never heard of. The
   * owner picked it, the panel relabelled itself, and nothing was ever spoken.
   */
  const source = readFileSync("src/components/agent/use-speech.ts", "utf8");

  it("takes its language type from the shared union instead of declaring one", () => {
    expect(source).toMatch(/export type SpeechLang = AgentLang;/);
  });

  it("declares no language union of its own", () => {
    // A union of quoted two-letter codes is what the old type looked like.
    const ownUnion = /type\s+\w*Lang\w*\s*=\s*"[a-z]{2}"(\s*\|\s*"[a-z]{2}")+/;
    expect(ownUnion.test(source), "use-speech declares its own language union again").toBe(false);
  });

  it("can say every language the panel is allowed to offer", () => {
    // The consequence that matters, independent of how the type is spelled:
    // offeredLangs() is what the panel renders, BCP47 is what the browser is
    // handed, and a gap between them is silence.
    for (const lang of offeredLangs()) {
      expect(BCP47[lang], `${lang} is offered but has no speech code`).toBeTruthy();
    }
  });
});


/**
 * Nothing the owner hears is written in English in the code.
 *
 * Found by looking at a real screenshot: the panel was in Hindi — सहायक across
 * the top, Hindi down the whole conversation — and the app answered "Shall I
 * save this?", "One moment...", "Done. It's saved." and, worst of all,
 * "I couldn't finish that: Could not find start-work-trigger.".
 *
 * The approval line is the one that matters. The entire safety model is that
 * the owner is told what is about to be written and says yes; asking them in a
 * language they do not read is asking for a yes to nothing. And the last one
 * put the name of an internal DOM control in front of somebody standing in a
 * yard.
 *
 * Checked lexically rather than by behaviour, because the failure is a string
 * literal sitting where a `say(...)` should be, and that is exactly what a
 * grep can see and a type cannot.
 */
describe("the owner is never answered in English by accident", () => {
  const source = readFileSync("src/lib/agent/orchestrator.ts", "utf8");

  it("has no hardcoded reply text", () => {
    // `say: "Some sentence"` — a literal where a lookup belongs.
    const literals = [...source.matchAll(/say:\s*"([A-Z][^"]{4,})"/g)].map((m) => m[1]);
    expect(literals, `these are shown to the owner in English: ${literals.join(" | ")}`).toEqual([]);
  });

  it("never builds a reply out of an internal error", () => {
    // The controller's reasons name DOM controls ("Could not find
    // start-work-trigger"). They belong in the trail and the log, which keep
    // them, and never in what is read aloud.
    expect(source).not.toMatch(/say:\s*`[^`]*\$\{result\.error\}/);
  });
});
