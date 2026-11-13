/**
 * The languages the assistant speaks, and how a string gets into them.
 *
 * The shape here is the point. A plain `Record<AgentLang, string>` means
 * adding a language is a compile error in twenty places at once, and the only
 * way to make it build is to produce two hundred translations in one sitting —
 * which is exactly how a product ends up with text nobody has ever read.
 *
 * So English is required and every other language is optional, resolved
 * through `say()`, which falls back to English. That makes a language
 * something you can fill in as a speaker confirms it, and it makes the gap
 * visible rather than silent: `tests/agent/i18n.test.ts` reports what is still
 * falling back, per language.
 *
 * Falling back to English is a deliberate choice over machine-translated text.
 * For an owner who may not read well, a sentence that is confidently wrong
 * about their money is worse than one they have to puzzle over — and worse
 * than a word they recognise from the rest of the app.
 */

/**
 * Hindi, Marathi and English are the market this was built for. The other six
 * are the next states over, and are NOT yet reviewed by a speaker — see
 * REVIEWED below, and docs/assistant.md.
 */
export const AGENT_LANGS = ["en", "hi", "mr", "gu", "ta", "te", "kn", "bn", "pa"] as const;
export type AgentLang = (typeof AGENT_LANGS)[number];

/**
 * Which languages a native speaker has actually checked.
 *
 * Recorded in the code rather than in somebody's memory, because "we added
 * Tamil" and "Tamil is right" are different claims and only one of them is
 * safe to tell a customer. Move a language in here when a speaker has read the
 * strings — not when the strings exist.
 */
export const REVIEWED: readonly AgentLang[] = ["en", "hi", "mr"];

/** What the owner sees in the language picker, in their own script. */
export const LANG_LABEL: Record<AgentLang, string> = {
  en: "English",
  hi: "हिंदी",
  mr: "मराठी",
  gu: "ગુજરાતી",
  ta: "தமிழ்",
  te: "తెలుగు",
  kn: "ಕನ್ನಡ",
  bn: "বাংলা",
  pa: "ਪੰਜਾਬੀ",
};

/** The model is told which language to answer in, by name. */
export const LANG_NAME: Record<AgentLang, string> = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi",
  gu: "Gujarati",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  bn: "Bengali",
  pa: "Punjabi",
};

/**
 * For the browser's own voice and for Whisper's language hint.
 *
 * The `-IN` region matters: "ta-IN" and "ta-LK" are different accents, and the
 * owner is in India. A device without the voice falls back in use-speech.ts
 * rather than reading Devanagari with an English voice.
 */
export const BCP47: Record<AgentLang, string> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
  gu: "gu-IN",
  ta: "ta-IN",
  te: "te-IN",
  kn: "kn-IN",
  bn: "bn-IN",
  pa: "pa-IN",
};

/**
 * A string in as many languages as somebody has confirmed. English is
 * required; everything else is optional and falls back to it.
 */
export type Localized<T = string> = { en: T } & Partial<Record<AgentLang, T>>;

/** The string for this language, or English. Never undefined, so no caller has
 * to handle a missing translation at the point of use. */
export function say<T>(text: Localized<T>, lang: AgentLang): T {
  return text[lang] ?? text.en;
}

/** True when this language would fall back — what the coverage test counts. */
export function isMissing<T>(text: Localized<T>, lang: AgentLang): boolean {
  return lang !== "en" && text[lang] === undefined;
}

/**
 * The languages offered in the picker.
 *
 * Reviewed ones by default. `AGENT_LANGS_ENABLED` overrides it, so the six
 * unreviewed languages can be switched on for a willing customer — or all of
 * them once somebody has read the strings — without a deploy for each step.
 */
export function offeredLangs(): AgentLang[] {
  const configured = (process.env.NEXT_PUBLIC_AGENT_LANGS_ENABLED ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter((l): l is AgentLang => (AGENT_LANGS as readonly string[]).includes(l));
  return configured.length > 0 ? configured : [...REVIEWED];
}
