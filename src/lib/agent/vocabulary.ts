import { db } from "@/lib/db";
import { knownAliases } from "./aliases";
import type { AgentLang } from "./types";
import { say, type Localized } from "./i18n";

/**
 * The words Whisper is told to expect before it hears anything.
 *
 * Without this it is guessing at every proper noun in the business. "Komatsu
 * PC200" comes back as "Kamatsu PC 200", "Patil" as "Patel" or "Pathil", and a
 * name that comes back spelled differently cannot be matched against the real
 * record — so a perfectly clear instruction ends in "I couldn't find that".
 * Whisper's `prompt` is prefix conditioning: feeding it the owner's actual
 * machine, operator, site and customer names makes it write them back the way
 * they are stored.
 *
 * Names go in EXACTLY as the database holds them, whatever language the panel
 * is set to. That is deliberate: it also keeps "JCB" out of Devanagari when
 * someone is speaking Hindi, which is the difference between matching the
 * record and not.
 */

/** Whisper only looks at roughly the last 224 tokens of the prompt, so this is
 * a budget, not a limit to grow into. Machines first — they are named in most
 * instructions and mangled the most. */
const MAX_NAME_CHARS = 420;

/** Four queries per spoken sentence would be absurd, and staleness costs
 * almost nothing here: this only biases the decoder, so a machine added two
 * minutes ago is simply named once more before Whisper learns to expect it.
 * That is why there is no invalidation hook in the write paths. */
const CACHE_TTL_MS = 2 * 60_000;

const cache = new Map<string, { at: number; names: string }>();

/** Shared vocabulary of the trade, in the script the transcript will come back
 * in. "hour meter" and "advance" are said in English inside Hindi sentences, so
 * they appear in both. */
const DOMAIN: Localized = {
  en: "Excavator business voice note: hour meter, diesel litres, advance, salary, site, customer, operator, service, shift, bucket, breaker, bill, payment.",
  hi: "जेसीबी-पोकलेन व्यवसाय का वॉइस नोट: आवर मीटर, डीजल लीटर, एडवांस, सैलरी, साइट, कस्टमर, ऑपरेटर, सर्विस, घंटे, बिल, पेमेंट.",
  mr: "जेसीबी-पोकलेन व्यवसायाची व्हॉइस नोट: आवर मीटर, डिझेल लिटर, अॅडव्हान्स, पगार, साईट, कस्टमर, ऑपरेटर, सर्व्हिस, तास, बिल, पेमेंट.",
  gu: "જેસીબી-પોકલેન ધંધાની વૉઇસ નોટ: આવર મીટર, ડીઝલ લીટર, એડવાન્સ, પગાર, સાઇટ, કસ્ટમર, ઓપરેટર, સર્વિસ, કલાક, બિલ, પેમેન્ટ.",
  ta: "ஜேசிபி-போக்லேன் வியாபார குரல் குறிப்பு: ஹவர் மீட்டர், டீசல் லிட்டர், அட்வான்ஸ், சம்பளம், சைட், கஸ்டமர், ஆபரேட்டர், சர்வீஸ், மணி, பில், பேமெண்ட்.",
  te: "జేసీబీ-పోక్లేన్ వ్యాపార వాయిస్ నోట్: అవర్ మీటర్, డీజిల్ లీటర్, అడ్వాన్స్, జీతం, సైట్, కస్టమర్, ఆపరేటర్, సర్వీస్, గంటలు, బిల్, పేమెంట్.",
  kn: "ಜೆಸಿಬಿ-ಪೋಕ್ಲೇನ್ ವ್ಯಾಪಾರದ ವಾಯ್ಸ್ ನೋಟ್: ಅವರ್ ಮೀಟರ್, ಡೀಸೆಲ್ ಲೀಟರ್, ಅಡ್ವಾನ್ಸ್, ಸಂಬಳ, ಸೈಟ್, ಕಸ್ಟಮರ್, ಆಪರೇಟರ್, ಸರ್ವೀಸ್, ಗಂಟೆ, ಬಿಲ್, ಪೇಮೆಂಟ್.",
  bn: "জেসিবি-পোকলেন ব্যবসার ভয়েস নোট: আওয়ার মিটার, ডিজেল লিটার, অ্যাডভান্স, বেতন, সাইট, কাস্টমার, অপারেটর, সার্ভিস, ঘণ্টা, বিল, পেমেন্ট।",
  pa: "ਜੇਸੀਬੀ-ਪੋਕਲੇਨ ਕਾਰੋਬਾਰ ਦੀ ਵੌਇਸ ਨੋਟ: ਆਵਰ ਮੀਟਰ, ਡੀਜ਼ਲ ਲੀਟਰ, ਐਡਵਾਂਸ, ਤਨਖ਼ਾਹ, ਸਾਈਟ, ਕਸਟਮਰ, ਆਪਰੇਟਰ, ਸਰਵਿਸ, ਘੰਟੇ, ਬਿਲ, ਪੇਮੈਂਟ।",
};

/**
 * Distinct, trimmed terms in the order given, stopping once the budget is
 * spent. Case-insensitive dedupe: "JCB" and "jcb" are one word to a listener.
 */
function pack(terms: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let used = 0;

  for (const raw of terms) {
    // Flattened before anything else. These are names people typed, so they
    // are third-party input reaching a model prompt: a record whose name
    // contains newlines could otherwise restructure the prompt it is quoted
    // in. Control characters and runs of whitespace collapse to one space,
    // and nothing else about the name is changed — mangling the owner's own
    // records to defend a prompt would be the worse bug.
    const term = raw?.replace(/\p{C}+/gu, " ").replace(/\s+/g, " ").trim();
    // One- and two-character fragments ("A", "2") teach Whisper nothing and
    // spend the budget that a real name needs.
    if (!term || term.length < 3) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (used + term.length + 2 > MAX_NAME_CHARS) break;
    seen.add(key);
    kept.push(term);
    used += term.length + 2;
  }
  return kept.join(", ");
}

/** The business's own names, cached. Scoped to one business — a name from
 * another account must never be put in front of this one's microphone. */
async function namesFor(businessId: string): Promise<string> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.names;

  const [machines, operators, sites, customers] = await Promise.all([
    db.excavator.findMany({
      where: { businessId, isArchived: false },
      select: { name: true, machineNumber: true, brand: true, model: true },
      orderBy: { sortOrder: "asc" },
      take: 30,
    }),
    db.operator.findMany({
      where: { businessId, isArchived: false },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 40,
    }),
    db.site.findMany({
      where: { businessId, status: "ACTIVE" },
      select: { name: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.customer.findMany({
      where: { businessId, isArchived: false },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 40,
    }),
  ]);

  // Corrections the owner has already made come FIRST, ahead of the raw
  // record names. A name Whisper has demonstrably mangled once is the one most
  // worth priming it with, and the prompt budget is small enough that order
  // decides what survives.
  const corrected = (await knownAliases(businessId)).map((a) => a.label);

  const names = pack([
    ...corrected,
    // A machine is spoken about by whichever of these the owner happens to use,
    // so all four earn a place.
    ...machines.flatMap((m) => [m.name, m.machineNumber, m.brand, m.model]),
    ...operators.map((o) => o.name),
    ...sites.map((s) => s.name),
    ...customers.map((c) => c.name),
  ]);

  cache.set(businessId, { at: Date.now(), names });
  return names;
}

/**
 * The prompt handed to Whisper for one clip. Never throws: a database hiccup
 * should degrade transcription, not silence the microphone.
 */
export async function speechPrompt(businessId: string, lang: AgentLang): Promise<string> {
  try {
    const names = await namesFor(businessId);
    return names ? `${say(DOMAIN, lang)} ${names}.` : say(DOMAIN, lang);
  } catch {
    return say(DOMAIN, lang);
  }
}

export const __testing = { pack, MAX_NAME_CHARS, DOMAIN, cache };
