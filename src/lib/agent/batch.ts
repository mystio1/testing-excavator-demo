import { db } from "@/lib/db";
import { say, type Localized } from "./i18n";
import { normalizeText } from "./text";
import type { AgentLang, TaskBatch, WorkflowField } from "./types";

/**
 * "सारी मशीन चालू करो" — one sentence, several jobs.
 *
 * The owner says it once and means five separate work records, each with its
 * own site, customer and starting hour meter. Before this, the app answered
 * "I can't do that in this app yet", which is honest and useless: it is the
 * most natural thing to ask for in a yard with five machines in it.
 *
 * ## It is a queue, not a bulk write
 *
 * Every record still goes the whole way round: its own questions, its own
 * approval card read aloud, its own verification against the screen. Five jobs
 * written from one misheard sentence is precisely the harm this app exists to
 * prevent, and a batch that skipped the approvals would be that harm wearing a
 * convenience label.
 *
 * What the batch removes is the owner having to START each one — saying "now
 * the JCB", "now the Tata", five times over, re-stating the instruction each
 * time. The checking stays.
 *
 * ## Where the list comes from
 *
 * The agent normally touches no database: it drives the app's own screens, and
 * that is what keeps it honest about what exists. Enumerating the machines is
 * the one read it does directly, because "which machines are there" is a
 * question the screen cannot answer without being navigated to first, and
 * navigating somewhere to count things is not an instruction the owner gave.
 *
 * Nothing is WRITTEN this way. The writes still go through the forms.
 */

/** What the record field holds when the owner said "all of them". */
export const ALL = "*";

/**
 * Did the owner say "all of them"?
 *
 * Decided here rather than left to the model, and that is deliberate. Asked
 * nicely in the prompt, the model got it right for the exact phrasing it was
 * shown and refused the variants — "मैं एक साथ सभी मशीनों को चालू नहीं कर
 * सकता" — because every capability it is given describes one record, and that
 * prior is stronger than a rule. The same lesson as the day words in dates.ts:
 * a thing the app can decide for itself should not be a thing the model is
 * asked to remember.
 *
 * The word list is short on purpose. These are the ordinary ways of saying
 * "all" in the three languages this is used in, including the Latin spellings
 * people actually type; anything subtler is better asked about than guessed.
 */
const ALL_WORDS = [
  "all",
  "every",
  "sari",
  "saari",
  "sary",
  "sabhi",
  "sab",
  "sarv",
  "sarva",
  "sagale",
  "sagali",
  "सारी",
  "सारे",
  "सभी",
  "सब",
  "सर्व",
  "सगळी",
  "सगळे",
];

export function meansAll(text: string): boolean {
  const words = normalizeText(text).split(" ");
  return words.some((w) => ALL_WORDS.includes(w));
}

/**
 * The field a batch iterates: the first required entity field of the workflow.
 *
 * For `work.start` that is the machine, which is the only thing that varies —
 * the site and the customer are asked per machine because they genuinely can
 * differ, and assuming otherwise is how five jobs land on the wrong site.
 */
export function batchField(fields: readonly WorkflowField[]): WorkflowField | null {
  return fields.find((f) => f.kind === "entity" && f.required) ?? null;
}

export type Candidate = { value: string; label: string };

/** Lists the records a batch will work through. Injectable so the turn loop
 * stays testable without a database. */
export type ListRecordsFn = (
  businessId: string,
  entityKind: string,
  workflowId: string,
) => Promise<Candidate[]>;

/**
 * The real lister.
 *
 * Filters to what the instruction can actually apply to, because offering to
 * start a machine that is already running wastes a whole round of questions
 * before the screen refuses it. A machine that is already working is not a
 * failure of the batch, it is simply not part of it.
 */
export const listRecords: ListRecordsFn = async (businessId, entityKind, workflowId) => {
  if (entityKind !== "machine") return [];

  const machines = await db.excavator.findMany({
    where: { businessId, isArchived: false },
    select: { id: true, name: true, machineNumber: true, workSessions: {
      where: { status: "ACTIVE" },
      select: { id: true },
      take: 1,
    } },
    orderBy: { name: "asc" },
  });

  const wantsIdle = workflowId === "work.start";
  const wantsBusy = workflowId === "work.stop" || workflowId === "reading.add";

  return machines
    .filter((m) => {
      const busy = m.workSessions.length > 0;
      if (wantsIdle) return !busy;
      if (wantsBusy) return busy;
      return true;
    })
    .map((m) => ({
      value: m.id,
      // The label is what the owner hears and what the matcher matches, so it
      // is the name as they would say it, not an id.
      label: m.machineNumber ? `${m.name} ${m.machineNumber}` : m.name,
    }));
};

export function newBatch(field: string, records: Candidate[]): TaskBatch | null {
  // One record is not a batch; it is just that record, and saying "1 of 1"
  // would be noise.
  if (records.length < 2) return null;
  const [current, ...remaining] = records;
  return { field, current: current!, remaining, done: [], failed: [] };
}

const NOTHING_TO_DO: Localized = {
  en: "There is nothing to do that to right now.",
  hi: "अभी ऐसा कुछ नहीं है जिस पर यह किया जा सके.",
  mr: "आत्ता असे काही नाही ज्यावर हे करता येईल.",
  gu: "અત્યારે એવું કંઈ નથી જેના પર આ કરી શકાય.",
  ta: "இப்போது இதைச் செய்ய ஏதும் இல்லை.",
  te: "ఇప్పుడు దీన్ని చేయడానికి ఏమీ లేదు.",
  kn: "ಈಗ ಇದನ್ನು ಮಾಡಲು ಏನೂ ಇಲ್ಲ.",
  bn: "এখন এটি করার মতো কিছু নেই।",
  pa: "ਹੁਣ ਅਜਿਹਾ ਕੁਝ ਨਹੀਂ ਜਿਸ ਉੱਤੇ ਇਹ ਕੀਤਾ ਜਾ ਸਕੇ।",
};

export const nothingToDo = (lang: AgentLang) => say(NOTHING_TO_DO, lang);

/**
 * "Starting with the Komatsu. 1 of 4."
 *
 * Said at the top of every item, because an owner who cannot see a progress
 * bar has no other way to know how much is left — and because knowing it is
 * four, not one, is what stops them thinking it has gone wrong halfway.
 */
export function startingLine(batch: TaskBatch, lang: AgentLang): string {
  const total = batch.done.length + batch.failed.length + 1 + batch.remaining.length;
  const position = batch.done.length + batch.failed.length + 1;
  const of: Localized = {
    en: `${batch.current.label} — ${position} of ${total}.`,
    hi: `${batch.current.label} — ${total} में से ${position}.`,
    mr: `${batch.current.label} — ${total} पैकी ${position}.`,
    gu: `${batch.current.label} — ${total} માંથી ${position}.`,
    ta: `${batch.current.label} — ${total} இல் ${position}.`,
    te: `${batch.current.label} — ${total} లో ${position}.`,
    kn: `${batch.current.label} — ${total} ರಲ್ಲಿ ${position}.`,
    bn: `${batch.current.label} — ${total} এর মধ্যে ${position}।`,
    pa: `${batch.current.label} — ${total} ਵਿੱਚੋਂ ${position}।`,
  };
  return say(of, lang);
}

/**
 * What is said when the last record is finished.
 *
 * Names the ones that did not work rather than giving a count. A number tells
 * the owner something went wrong; a name tells them which machine to go and
 * deal with, which is the only part they can act on.
 */
export function finishedLine(batch: TaskBatch, lang: AgentLang): string {
  const ok = batch.done.length;
  if (batch.failed.length === 0) {
    const all: Localized = {
      en: `All ${ok} done.`,
      hi: `सभी ${ok} हो गए.`,
      mr: `सर्व ${ok} झाले.`,
      gu: `બધા ${ok} થઈ ગયા.`,
      ta: `${ok} உம் முடிந்தது.`,
      te: `${ok} అన్నీ అయ్యాయి.`,
      kn: `ಎಲ್ಲಾ ${ok} ಆಯಿತು.`,
      bn: `সব ${ok} হয়ে গেছে।`,
      pa: `ਸਾਰੇ ${ok} ਹੋ ਗਏ।`,
    };
    return say(all, lang);
  }
  const names = batch.failed.join(", ");
  const some: Localized = {
    en: `${ok} done. These did not finish: ${names}.`,
    hi: `${ok} हो गए. ये पूरे नहीं हुए: ${names}.`,
    mr: `${ok} झाले. हे पूर्ण झाले नाहीत: ${names}.`,
    gu: `${ok} થઈ ગયા. આ પૂરા થયા નથી: ${names}.`,
    ta: `${ok} முடிந்தது. இவை முடியவில்லை: ${names}.`,
    te: `${ok} అయ్యాయి. ఇవి పూర్తి కాలేదు: ${names}.`,
    kn: `${ok} ಆಯಿತು. ಇವು ಪೂರ್ಣವಾಗಲಿಲ್ಲ: ${names}.`,
    bn: `${ok} হয়েছে। এগুলি শেষ হয়নি: ${names}।`,
    pa: `${ok} ਹੋ ਗਏ। ਇਹ ਪੂਰੇ ਨਹੀਂ ਹੋਏ: ${names}।`,
  };
  return say(some, lang);
}

/**
 * Move to the next record, recording how the last one went.
 *
 * Returns null when the queue is empty, which is the signal to say the closing
 * line instead of asking another question.
 */
export function advance(batch: TaskBatch, outcome: "done" | "failed"): TaskBatch | null {
  const done = outcome === "done" ? [...batch.done, batch.current.label] : batch.done;
  const failed = outcome === "failed" ? [...batch.failed, batch.current.label] : batch.failed;
  const [next, ...rest] = batch.remaining;
  if (!next) return { ...batch, done, failed, remaining: [] };
  return { field: batch.field, current: next, remaining: rest, done, failed };
}

/** True once every record has been attempted. */
export const isFinished = (batch: TaskBatch): boolean => batch.remaining.length === 0;
