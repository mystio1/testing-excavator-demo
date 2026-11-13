import { ApiHttpError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { AgentLang } from "./types";
import { say, type Localized } from "./i18n";

/**
 * What the assistant has cost this business, and when to stop.
 *
 * Rate limits answer "how fast", which is a different question from "how
 * much". A yard can stay comfortably inside every per-minute ring and still
 * run a bill nobody budgeted for, because Groq charges by tokens and a month
 * is a lot of minutes. Without this there is no number to look at when an
 * invoice arrives and no ceiling to stop it arriving.
 *
 * Counted in the currency each service actually bills in: tokens for the
 * reasoning model, audio seconds for speech. A request count would be a
 * comfortable number that is not the bill.
 *
 * The cap is checked BEFORE a call and recorded AFTER it, which means the last
 * call of the month can cross the line. That is deliberate: the alternative is
 * reserving tokens nobody has spent and refusing work that would have fitted.
 * One turn of overshoot is cheaper than being wrong in that direction.
 */

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

export const CAPS = {
  /** 0 disables the cap. Generous by default: this is a backstop against a
   * runaway, not a product tier. */
  askTokensPerMonth: int(process.env.AGENT_ASK_TOKENS_PER_MONTH, 2_000_000),
  listenSecondsPerMonth: int(process.env.AGENT_LISTEN_SECONDS_PER_MONTH, 36_000),
} as const;

/** UTC, so a business near midnight does not straddle two months depending on
 * which instance served the request. */
export function billingMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type Usage = {
  month: string;
  askCalls: number;
  askTokens: number;
  listenCalls: number;
  listenSeconds: number;
};

export async function usageFor(businessId: string, month = billingMonth()): Promise<Usage> {
  const row = await db.agentUsage.findUnique({
    where: { businessId_month: { businessId, month } },
    select: { askCalls: true, askTokens: true, listenCalls: true, listenSeconds: true },
  });
  return {
    month,
    askCalls: row?.askCalls ?? 0,
    askTokens: row?.askTokens ?? 0,
    listenCalls: row?.listenCalls ?? 0,
    listenSeconds: row?.listenSeconds ?? 0,
  };
}

const OVER_BUDGET: Localized = {
  en: "The assistant has reached this month's limit. It will work again next month, and the rest of the app is unaffected.",
  hi: "सहायक की इस महीने की सीमा पूरी हो गई है. अगले महीने फिर चालू हो जाएगा; बाकी ऐप वैसे ही चलता रहेगा.",
  mr: "सहाय्यकाची या महिन्याची मर्यादा संपली आहे. पुढच्या महिन्यात पुन्हा सुरू होईल; बाकी अॅप तसेच चालू राहील.",
  gu: "સહાયકની આ મહિનાની મર્યાદા પૂરી થઈ ગઈ છે. આવતા મહિને ફરી ચાલુ થશે; બાકીની એપ એમ જ ચાલશે.",
  ta: "உதவியாளரின் இந்த மாத வரம்பு முடிந்துவிட்டது. அடுத்த மாதம் மீண்டும் இயங்கும்; மற்ற செயலி அப்படியே வேலை செய்யும்.",
  te: "సహాయకుడి ఈ నెల పరిమితి పూర్తయింది. వచ్చే నెల మళ్ళీ ప్రారంభమవుతుంది; మిగతా యాప్ అలాగే పని చేస్తుంది.",
  kn: "ಸಹಾಯಕನ ಈ ತಿಂಗಳ ಮಿತಿ ಮುಗಿದಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಪುನಃ ಪ್ರಾರಂಭವಾಗುತ್ತದೆ; ಉಳಿದ ಆ್ಯಪ್ ಹಾಗೇ ಕೆಲಸ ಮಾಡುತ್ತದೆ.",
  bn: "সহায়কের এই মাসের সীমা শেষ হয়ে গেছে। পরের মাসে আবার চালু হবে; বাকি অ্যাপ একইভাবে চলবে।",
  pa: "ਸਹਾਇਕ ਦੀ ਇਸ ਮਹੀਨੇ ਦੀ ਹੱਦ ਪੂਰੀ ਹੋ ਗਈ ਹੈ। ਅਗਲੇ ਮਹੀਨੇ ਫਿਰ ਚਾਲੂ ਹੋਵੇਗਾ; ਬਾਕੀ ਐਪ ਉਸੇ ਤਰ੍ਹਾਂ ਚੱਲੇਗਾ।",
};

/** Throws a 403 when this business has spent its month. Says so as a state of
 * the account with an end date, not as a fault. */
export async function assertWithinBudget(
  businessId: string,
  what: "ask" | "listen",
  lang: AgentLang = "en",
): Promise<void> {
  const cap = what === "ask" ? CAPS.askTokensPerMonth : CAPS.listenSecondsPerMonth;
  if (cap === 0) return;

  const usage = await usageFor(businessId);
  const spent = what === "ask" ? usage.askTokens : usage.listenSeconds;
  if (spent < cap) return;

  logger.warn("agent.budget_exhausted", { businessId, what, spent, cap, month: usage.month });
  throw new ApiHttpError("FORBIDDEN", say(OVER_BUDGET, lang));
}

/**
 * Add to the running total. One atomic upsert, so two instances counting the
 * same business at the same moment cannot lose one of them.
 *
 * Never throws: failing to record what something cost must not fail the thing
 * the owner asked for. It is logged loudly instead, because silently losing
 * usage is how a cap stops being a cap.
 */
export async function recordUsage(
  businessId: string,
  delta: { askCalls?: number; askTokens?: number; listenCalls?: number; listenSeconds?: number },
): Promise<void> {
  const month = billingMonth();
  const add = {
    askCalls: Math.max(0, Math.round(delta.askCalls ?? 0)),
    askTokens: Math.max(0, Math.round(delta.askTokens ?? 0)),
    listenCalls: Math.max(0, Math.round(delta.listenCalls ?? 0)),
    listenSeconds: Math.max(0, Math.round(delta.listenSeconds ?? 0)),
  };
  if (Object.values(add).every((n) => n === 0)) return;

  try {
    await db.agentUsage.upsert({
      where: { businessId_month: { businessId, month } },
      create: { businessId, month, ...add, updatedAt: new Date() },
      update: {
        askCalls: { increment: add.askCalls },
        askTokens: { increment: add.askTokens },
        listenCalls: { increment: add.listenCalls },
        listenSeconds: { increment: add.listenSeconds },
      },
    });
  } catch (err) {
    logger.error("agent.usage_not_recorded", err, { businessId, month, ...add });
  }
}
