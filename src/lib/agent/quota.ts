import { enforceRateLimits, type RateRule } from "@/lib/rateLimit";
import type { AgentLang } from "./types";
import { say, type Localized } from "./i18n";

/**
 * Who is allowed how much of the assistant.
 *
 * Every tenant shares one Groq account, so a per-user limit protects nothing
 * that matters: a business with five signed-in users gets five times the
 * allowance, and one busy yard can spend the whole account's per-minute
 * ceiling and hand every other customer "Sorry, something went wrong". That is
 * not a fair-use question, it is an outage for people who did nothing.
 *
 * So three rings, narrowest first:
 *
 *   per user      — one person cannot loop, and a bug in one browser is
 *                   contained to that browser.
 *   per business  — the fairness control. One tenant's share is theirs, and
 *                   spending it cannot reach anybody else.
 *   global        — the backstop that keeps the shared account alive. If this
 *                   is ever hit, everyone is asked to wait a moment, which is
 *                   recoverable; an exhausted account is not.
 *
 * All three are checked from the VERIFIED session, never from a request body.
 *
 * The numbers are deliberately in one place and overridable, because the right
 * values depend on the account's own tier — which changes, and which is not
 * discoverable from here. The defaults are conservative: a person speaking to
 * this thing manages a handful of turns a minute, not dozens.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const QUOTAS = {
  /** Model calls. The expensive beat, and the one the account caps. */
  askPerUserMinute: int(process.env.AGENT_ASK_PER_USER_MIN, 20),
  askPerBusinessMinute: int(process.env.AGENT_ASK_PER_BUSINESS_MIN, 30),
  askPerBusinessHour: int(process.env.AGENT_ASK_PER_BUSINESS_HOUR, 400),
  /** The shared account's backstop. Set it below whatever the tier allows. */
  askGlobalMinute: int(process.env.AGENT_ASK_GLOBAL_MIN, 60),

  /** Bookkeeping beats: confirm and result. Cheap, but one spoken command is
   * up to three requests, so this is the looser ring by design. */
  turnPerUserMinute: int(process.env.AGENT_TURN_PER_USER_MIN, 90),
  turnPerUserHour: int(process.env.AGENT_TURN_PER_USER_HOUR, 600),

  /** Speech. Costs a Whisper call and up to 8 MB of upload each time. */
  listenPerUserMinute: int(process.env.AGENT_LISTEN_PER_USER_MIN, 20),
  listenPerUserHour: int(process.env.AGENT_LISTEN_PER_USER_HOUR, 200),
  listenPerBusinessMinute: int(process.env.AGENT_LISTEN_PER_BUSINESS_MIN, 30),
  listenGlobalMinute: int(process.env.AGENT_LISTEN_GLOBAL_MIN, 60),
} as const;

/** Said the way the panel says everything else: read aloud, to someone who did
 * nothing wrong. */
export const TOO_BUSY: Localized = {
  en: "Too many requests just now. Please wait a moment and try again.",
  hi: "अभी बहुत सवाल आ गए हैं. थोड़ा रुककर फिर कोशिश करें.",
  mr: "आता खूप विनंत्या आल्या आहेत. जरा थांबून पुन्हा प्रयत्न करा.",
  gu: "અત્યારે બહુ વિનંતીઓ આવી ગઈ છે. થોડું થોભીને ફરી પ્રયત્ન કરો.",
  ta: "இப்போது நிறைய கோரிக்கைகள் வந்துவிட்டன. சற்று பொறுத்து மீண்டும் முயற்சிக்கவும்.",
  te: "ఇప్పుడు చాలా అభ్యర్థనలు వచ్చాయి. కొంచెం ఆగి మళ్ళీ ప్రయత్నించండి.",
  kn: "ಈಗ ಬಹಳ ವಿನಂತಿಗಳು ಬಂದಿವೆ. ಸ್ವಲ್ಪ ನಿಲ್ಲಿಸಿ ಪುನಃ ಪ್ರಯತ್ನಿಸಿ.",
  bn: "এখন অনেক অনুরোধ এসে গেছে। একটু থেমে আবার চেষ্টা করুন।",
  pa: "ਹੁਣ ਬਹੁਤ ਬੇਨਤੀਆਂ ਆ ਗਈਆਂ ਹਨ। ਥੋੜ੍ਹਾ ਰੁਕ ਕੇ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
};

export type Who = { userId: string; businessId: string };

/** One turn of the conversation. `costsAModelCall` is true only for the beat
 * that actually reaches the model. */
export function turnRules(who: Who, costsAModelCall: boolean): RateRule[] {
  const rules: RateRule[] = [
    { key: `agent:user:${who.userId}`, limit: QUOTAS.turnPerUserMinute, windowMs: MINUTE },
    { key: `agent:user:hour:${who.userId}`, limit: QUOTAS.turnPerUserHour, windowMs: HOUR },
  ];
  if (!costsAModelCall) return rules;
  return [
    ...rules,
    { key: `agent:ask:${who.userId}`, limit: QUOTAS.askPerUserMinute, windowMs: MINUTE },
    { key: `agent:ask:biz:${who.businessId}`, limit: QUOTAS.askPerBusinessMinute, windowMs: MINUTE },
    { key: `agent:ask:biz:hour:${who.businessId}`, limit: QUOTAS.askPerBusinessHour, windowMs: HOUR },
    // Last, and shared by everyone. Counted even when a narrower ring would
    // have allowed it, because the account's ceiling does not care whose
    // request it was.
    { key: "agent:ask:global", limit: QUOTAS.askGlobalMinute, windowMs: MINUTE },
  ];
}

export function listenRules(who: Who): RateRule[] {
  return [
    { key: `agent-listen:user:${who.userId}`, limit: QUOTAS.listenPerUserMinute, windowMs: MINUTE },
    { key: `agent-listen:user:hour:${who.userId}`, limit: QUOTAS.listenPerUserHour, windowMs: HOUR },
    { key: `agent-listen:biz:${who.businessId}`, limit: QUOTAS.listenPerBusinessMinute, windowMs: MINUTE },
    { key: "agent-listen:global", limit: QUOTAS.listenGlobalMinute, windowMs: MINUTE },
  ];
}

/** Throws a 429 with Retry-After as soon as any ring is exhausted. */
export async function enforceAgentQuota(rules: RateRule[], lang: AgentLang = "en") {
  await enforceRateLimits(rules, say(TOO_BUSY, lang));
}
