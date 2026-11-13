import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { say, type Localized } from "./i18n";
import { recordTurnMetric } from "./metrics";
import { isEntityKind, rememberAlias, type EntityKind } from "./aliases";
import { resolveSpokenDay } from "./dates";
import { answerFromScreen, askGroq, GroqError, type GroqTurn } from "./groq";
import { planWorkflow, type UiOperation } from "./plan";
import { authorize, ownsTask, requiresConfirmation, type Actor } from "./policy";
import {
  ALL,
  advance,
  batchField,
  finishedLine,
  isFinished,
  listRecords as defaultListRecords,
  meansAll,
  newBatch,
  nothingToDo,
  startingLine,
  type ListRecordsFn,
} from "./batch";
import { isTappable, missingFields, nextQuestion, pickKnownFields, resolve } from "./resolver";
import { acceptsNewInstruction, confirm, newTask, setFields, transition } from "./task-state";
import { memoryTaskStore, type TaskStore } from "./task-store";
import { shouldRecord, type AgentTrailPhase, type RecordFn } from "./trail";
import type { AgentLang, AgentResponse, AgentTask } from "./types";

/**
 * The turn loop. Holds the task, asks Groq what the person meant, and decides
 * what happens next — which is always one of: ask a question, ask for approval,
 * hand the browser a plan, or report an outcome.
 *
 * Grok's reply is one input to that decision, never the decision itself. Every
 * path to execution goes through authorize(), and execution's result comes back
 * from the browser rather than from anything the model said.
 */

export type AgentReply = {
  taskId: string;
  state: AgentTask["state"];
  /** What to show, and speak. Short on purpose — it is read aloud. */
  say: string;
  /** Present when the browser should act. */
  plan?: { operations: UiOperation[]; verify: string };
  /** Present when the owner must approve first. */
  confirm?: { summary: string };
  /**
   * The model could not be reached, as opposed to one request failing. The
   * panel leads with its tappable shortcuts in this state, because those need
   * no model and are the only thing that still works.
   */
  degraded?: boolean;
};

/**
 * Where a half-finished turn waits.
 *
 * In-memory by default, which is what every test wants. The running app injects
 * the database-backed store instead: a Map in one process meant that a deploy,
 * a free-tier spin-down, or simply a second instance turned the owner's "Yes,
 * save it" into "That request has expired" — on the one action that cannot
 * happen without their approval. See task-store.ts.
 */
const defaultStore = memoryTaskStore();

/** An abandoned half-finished task should not sit holding a name and an amount
 * indefinitely. */
const TASK_TTL_MS = 30 * 60 * 1000;

/**
 * Fetching a task is also an authorization check: a task id is not a
 * capability, and one user's pending work can never be resumed by another.
 * The store scopes by business and user; this adds the state check.
 *
 * The state check is the second half of that sentence, and it has to be real.
 * The panel sends the last task's id with every message, so without it a
 * finished task reaches startExecuting and the turn dies with `A task cannot
 * go from SUCCEEDED to EXECUTING`.
 */
async function loadTask(
  store: TaskStore,
  taskId: string | undefined,
  actor: Actor,
  lang: AgentLang,
): Promise<AgentTask> {
  await store.sweep(new Date(Date.now() - TASK_TTL_MS));
  if (taskId) {
    const existing = await store.get(taskId, actor);
    // Still being composed → carry on with it. Finished, or already handed to
    // the browser → what was just said is a NEW instruction, so it gets a new
    // task instead of an error.
    if (existing && ownsTask(existing, actor) && acceptsNewInstruction(existing.state)) return existing;
  }
  return newTask({ id: randomUUID(), businessId: actor.businessId, userId: actor.userId, lang });
}

async function save(store: TaskStore, task: AgentTask): Promise<AgentTask> {
  await store.save(task);
  return task;
}

/** Asked when a day was named but names two days at once — Hindi "kal" is both
 * yesterday and tomorrow, and a job dated either side of the truth is wrong on
 * a bill. */
const WHICH_DAY: Localized = {
  en: "Which day exactly? Please say the date, or 'today' or 'yesterday'.",
  hi: "कौन सा दिन? तारीख बता दें, या 'आज' या 'बीता कल' कहें.",
  mr: "कोणता दिवस? तारीख सांगा, किंवा 'आज' किंवा 'काल' म्हणा.",
  gu: "કયો દિવસ? તારીખ કહો, કે 'આજ' કહો.",
  ta: "எந்த நாள்? தேதியைச் சொல்லுங்கள், அல்லது 'இன்று' என்று சொல்லுங்கள்.",
  te: "ఏ రోజు? తేదీ చెప్పండి, లేదా 'ఈ రోజు' అనండి.",
  kn: "ಯಾವ ದಿನ? ದಿನಾಂಕ ಹೇಳಿ, ಅಥವಾ 'ಇಂದು' ಎಂದು ಹೇಳಿ.",
  bn: "কোন দিন? তারিখ বলুন, বা 'আজ' বলুন।",
  pa: "ਕਿਹੜਾ ਦਿਨ? ਤਾਰੀਖ਼ ਦੱਸੋ, ਜਾਂ 'ਅੱਜ' ਕਹੋ।",
};

/**
 * Every date field turned into a real YYYY-MM-DD, or a question.
 *
 * Nothing unreadable is passed on and nothing is assumed, including for an
 * optional field: a date the app cannot read is not the same as a date nobody
 * gave, and treating it as absent would let the form's own default of today
 * stand in for the day the owner actually said.
 */
function readDates(
  workflow: { fields: { name: string; kind: string; prompt: Localized }[] },
  fields: Record<string, string | number>,
  lang: AgentLang,
  today: Date,
): { fields: Record<string, string | number>; ask?: string } {
  const out = { ...fields };
  for (const field of workflow.fields) {
    if (field.kind !== "date") continue;
    const given = out[field.name];
    if (given === undefined || given === "") continue;

    const read = resolveSpokenDay(given, lang, today);
    if (read.kind === "date") {
      out[field.name] = read.iso;
      continue;
    }
    // Ambiguous gets the sharper question; anything else gets the field's own,
    // which already says what day is wanted.
    return { fields: out, ask: read.kind === "ambiguous" ? say(WHICH_DAY, lang) : say(field.prompt, lang) };
  }
  return { fields: out };
}

/**
 * Rewrite any field the owner has already corrected once.
 *
 * Only fields that name a record, and only under that field's own kind, so a
 * correction made for a customer cannot leak into operators.
 */
async function applyAliases(
  workflow: { fields: { name: string; entityKind?: string }[] },
  fields: Record<string, string | number>,
  businessId: string,
  lookup: LookupAliasFn,
): Promise<Record<string, string | number>> {
  const out = { ...fields };
  for (const field of workflow.fields) {
    const heard = out[field.name];
    if (!field.entityKind || !isEntityKind(field.entityKind) || typeof heard !== "string") continue;
    const label = await lookup(businessId, field.entityKind, heard);
    if (label) out[field.name] = label;
  }
  return out;
}

/** Readable "Komatsu PC200, Wakad, 1200 hrs" for the approval card. */
function summarize(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([, value]) => String(value))
    .join(" · ");
}

const SORRY: Localized = {
  en: "Sorry, something went wrong. Please try again.",
  hi: "माफ़ कीजिए, कुछ गड़बड़ हुई. फिर से कोशिश करें.",
  mr: "माफ करा, काहीतरी चूक झाली. पुन्हा प्रयत्न करा.",
  gu: "માફ કરશો, કંઈક ખોટું થયું. ફરી પ્રયત્ન કરો.",
  ta: "மன்னிக்கவும், ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.",
  te: "క్షమించండి, ఏదో తప్పు జరిగింది. మళ్ళీ ప్రయత్నించండి.",
  kn: "ಕ್ಷಮಿಸಿ, ಏನೋ ತಪ್ಪಾಯಿತು. ಪುನಃ ಪ್ರಯತ್ನಿಸಿ.",
  bn: "দুঃখিত, কিছু ভুল হয়েছে। আবার চেষ্টা করুন।",
  pa: "ਮਾਫ਼ ਕਰਨਾ, ਕੁਝ ਗੜਬੜ ਹੋਈ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
};

const NOT_CONFIGURED: Localized = {
  en: "The assistant is not set up yet.",
  hi: "सहायक अभी चालू नहीं है.",
  mr: "सहाय्यक अजून सुरू झालेला नाही.",
  gu: "સહાયક હજી ચાલુ નથી.",
  ta: "உதவியாளர் இன்னும் இயக்கப்படவில்லை.",
  te: "సహాయకుడు ఇంకా ప్రారంభం కాలేదు.",
  kn: "ಸಹಾಯಕ ಇನ್ನೂ ಪ್ರಾರಂಭವಾಗಿಲ್ಲ.",
  bn: "সহায়ক এখনও চালু হয়নি।",
  pa: "ਸਹਾਇਕ ਹਾਲੇ ਚਾਲੂ ਨਹੀਂ ਹੋਇਆ।",
};

const TOO_BUSY: Localized = {
  en: "Too many questions at once. Please wait a moment and ask again.",
  hi: "एक साथ बहुत सवाल हो गए. थोड़ा रुककर फिर पूछें.",
  mr: "एकाच वेळी खूप प्रश्न झाले. जरा थांबून पुन्हा विचारा.",
  gu: "એકસાથે બહુ સવાલ થયા. થોડું થોભીને ફરી પૂછો.",
  ta: "ஒரே நேரத்தில் நிறைய கேள்விகள். சற்று பொறுத்து மீண்டும் கேளுங்கள்.",
  te: "ఒకేసారి చాలా ప్రశ్నలు. కొంచెం ఆగి మళ్ళీ అడగండి.",
  kn: "ಒಮ್ಮೆಗೇ ಬಹಳ ಪ್ರಶ್ನೆಗಳು. ಸ್ವಲ್ಪ ನಿಲ್ಲಿಸಿ ಪುನಃ ಕೇಳಿ.",
  bn: "একসাথে অনেক প্রশ্ন হয়ে গেছে। একটু থেমে আবার জিজ্ঞেস করুন।",
  pa: "ਇੱਕੋ ਵੇਲੇ ਬਹੁਤ ਸਵਾਲ ਹੋ ਗਏ। ਥੋੜ੍ਹਾ ਰੁਕ ਕੇ ਫਿਰ ਪੁੱਛੋ।",
};

/**
 * Said when the service itself is down, rather than when one request failed.
 *
 * Different from "something went wrong" on purpose: it tells them the app
 * still works, and it points at the thing they can actually do — which is why
 * the panel offers its tappable shortcuts in this state.
 */
const UNAVAILABLE: Localized = {
  en: "I can't talk just now, but the app is working. Use the buttons below, or try me again in a minute.",
  hi: "मैं अभी बात नहीं कर सकता, लेकिन ऐप चल रहा है. नीचे दिए बटन इस्तेमाल करें, या एक मिनट बाद फिर पूछें.",
  mr: "मी आता बोलू शकत नाही, पण अॅप चालू आहे. खालची बटणे वापरा, किंवा एका मिनिटाने पुन्हा विचारा.",
  gu: "હું હમણાં વાત કરી શકતો નથી, પણ એપ ચાલુ છે. નીચેનાં બટન વાપરો, કે એક મિનિટ પછી પૂછો.",
  ta: "நான் இப்போது பேச முடியாது, ஆனால் செயலி வேலை செய்கிறது. கீழே உள்ள பொத்தான்களைப் பயன்படுத்துங்கள், அல்லது ஒரு நிமிடம் கழித்துக் கேளுங்கள்.",
  te: "నేను ఇప్పుడు మాట్లాడలేను, కానీ యాప్ పని చేస్తోంది. కింద ఉన్న బటన్లు వాడండి, లేదా ఒక నిమిషం తరువాత అడగండి.",
  kn: "ನಾನು ಈಗ ಮಾತನಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ, ಆದರೆ ಆ್ಯಪ್ ಕೆಲಸ ಮಾಡುತ್ತಿದೆ. ಕೆಳಗಿನ ಬಟನ್‌ಗಳನ್ನು ಬಳಸಿ, ಅಥವಾ ಒಂದು ನಿಮಿಷದ ನಂತರ ಕೇಳಿ.",
  bn: "আমি এখন কথা বলতে পারছি না, কিন্তু অ্যাপ চালু আছে। নিচের বোতামগুলো ব্যবহার করুন, বা এক মিনিট পরে আবার জিজ্ঞেস করুন।",
  pa: "ਮੈਂ ਹੁਣ ਗੱਲ ਨਹੀਂ ਕਰ ਸਕਦਾ, ਪਰ ਐਪ ਚੱਲ ਰਿਹਾ ਹੈ। ਹੇਠਾਂ ਦਿੱਤੇ ਬਟਨ ਵਰਤੋ, ਜਾਂ ਇੱਕ ਮਿੰਟ ਬਾਅਦ ਪੁੱਛੋ।",
};

/**
 * The wait on a 429 that means "gone", not "slow down".
 *
 * A 429 is two different situations wearing one status code. The per-minute
 * allowance clears in seconds; the per-DAY token allowance does not. Measured:
 * "Rate limit reached ... on tokens per day (TPD): Limit 200000, Used 199860.
 * Please try again in 9m25.92s."
 *
 * 90 seconds sits well above any per-minute window and far below that, and is
 * the same figure the eval harness already uses to decide a run cannot carry
 * on. Below it, leading with the buttons would be noise for a blip; above it,
 * an owner who is not told meets "please wait a moment" every time they speak
 * until the allowance resets, with no hint that tapping still works.
 */
const LONG_WAIT_SEC = 90;

const BUSY_OR_SORRY: Record<GroqError["kind"], Localized> = {
  no_key: NOT_CONFIGURED,
  rate_limited: TOO_BUSY,
  http: SORRY,
  timeout: SORRY,
  malformed: SORRY,
  // Already retried once in askGroq; if it still cannot answer in the required
  // format there is nothing the owner can do differently.
  no_json: SORRY,
  unavailable: UNAVAILABLE,
};

/** Asked of the page when a write could not be confirmed. Not the owner's
 * words — this is the app interrogating its own screen on their behalf. */
const CHECK_QUESTION =
  "Does this screen show the record that was just being saved? Say plainly what it shows.";

const UNSURE: Localized = {
  en: "I'm not sure it saved.",
  hi: "मुझे पक्का नहीं है कि सेव हुआ.",
  mr: "सेव्ह झाले की नाही याची मला खात्री नाही.",
  gu: "મને ખાતરી નથી કે સેવ થયું.",
  ta: "சேமிக்கப்பட்டதா என்று எனக்கு உறுதியாகத் தெரியவில்லை.",
  te: "సేవ్ అయిందో లేదో నాకు ఖచ్చితంగా తెలియదు.",
  kn: "ಉಳಿಸಲಾಗಿದೆಯೇ ಎಂದು ನನಗೆ ಖಚಿತವಿಲ್ಲ.",
  bn: "সেভ হয়েছে কি না আমি নিশ্চিত নই।",
  pa: "ਮੈਨੂੰ ਪੱਕਾ ਨਹੀਂ ਕਿ ਸੇਵ ਹੋਇਆ।",
};

/** The one thing they must not do is repeat it blind: a second attempt on
 * something that did save leaves two records, and nobody notices until a bill
 * is wrong. */
/**
 * The screen did not do what the plan expected.
 *
 * What this used to say was `I couldn't finish that: Could not find
 * start-work-trigger.` — in English, to an owner who was speaking Hindi, with
 * the name of an internal DOM control in it. The panel's whole premise is that
 * it is not a developer console: no workflow ids, no field names, no technical
 * words, because the person reading it is in a yard and may not be reading at
 * all.
 *
 * The technical reason is not lost, it is just not shouted at the owner — it
 * goes to the audit trail and the log, where whoever is debugging this can
 * actually use it.
 */
const COULD_NOT_FINISH: Localized = {
  en: "I couldn't finish that on the screen.",
  hi: "मैं यह स्क्रीन पर पूरा नहीं कर पाया.",
  mr: "मी हे स्क्रीनवर पूर्ण करू शकलो नाही.",
  gu: "હું આ સ્ક્રીન પર પૂરું કરી શક્યો નહીં.",
  ta: "இதை என்னால் திரையில் முடிக்க முடியவில்லை.",
  te: "దీన్ని నేను స్క్రీన్‌పై పూర్తి చేయలేకపోయాను.",
  kn: "ಇದನ್ನು ನಾನು ಪರದೆಯ ಮೇಲೆ ಪೂರ್ಣಗೊಳಿಸಲು ಆಗಲಿಲ್ಲ.",
  bn: "আমি এটি স্ক্রিনে শেষ করতে পারিনি।",
  pa: "ਮੈਂ ਇਹ ਸਕਰੀਨ ਉੱਤੇ ਪੂਰਾ ਨਹੀਂ ਕਰ ਸਕਿਆ।",
};

/**
 * The four things the owner hears most, which were all in English.
 *
 * A Hindi-speaking owner was being shown "Shall I save this?" — the approval
 * for a money write — and "One moment..." and "Done. It's saved.", while the
 * panel around them was in Hindi. The whole safety model rests on the owner
 * understanding what they are approving, so this is not cosmetic: it is the
 * sentence that asks permission.
 */
const SHALL_I_SAVE: Localized = {
  en: "Shall I save this?",
  hi: "क्या मैं इसे सेव करूँ?",
  mr: "मी हे सेव्ह करू का?",
  gu: "શું હું આ સેવ કરું?",
  ta: "இதைச் சேமிக்கவா?",
  te: "దీన్ని సేవ్ చేయనా?",
  kn: "ಇದನ್ನು ಉಳಿಸಲೇ?",
  bn: "আমি কি এটি সেভ করব?",
  pa: "ਕੀ ਮੈਂ ਇਹ ਸੇਵ ਕਰਾਂ?",
};

const ONE_MOMENT: Localized = {
  en: "One moment...",
  hi: "एक मिनट...",
  mr: "एक मिनिट...",
  gu: "એક મિનિટ...",
  ta: "ஒரு நிமிடம்...",
  te: "ఒక నిమిషం...",
  kn: "ಒಂದು ನಿಮಿಷ...",
  bn: "এক মিনিট...",
  pa: "ਇੱਕ ਮਿੰਟ...",
};

const SAVED: Localized = {
  en: "Done. It's saved.",
  hi: "हो गया. सेव हो गया.",
  mr: "झाले. सेव्ह झाले.",
  gu: "થઈ ગયું. સેવ થઈ ગયું.",
  ta: "முடிந்தது. சேமிக்கப்பட்டது.",
  te: "అయింది. సేవ్ అయింది.",
  kn: "ಆಯಿತು. ಉಳಿಸಲಾಗಿದೆ.",
  bn: "হয়ে গেছে। সেভ হয়েছে।",
  pa: "ਹੋ ਗਿਆ। ਸੇਵ ਹੋ ਗਿਆ।",
};

/** The read happened and the page is right; only the spoken summary failed. */
const OPENED_IT: Localized = {
  en: "I've opened it for you — please have a look.",
  hi: "मैंने इसे खोल दिया है — कृपया देख लें.",
  mr: "मी ते उघडले आहे — कृपया पाहून घ्या.",
  gu: "મેં તે ખોલી દીધું છે — કૃપા કરી જોઈ લો.",
  ta: "அதைத் திறந்துவிட்டேன் — பார்த்துக் கொள்ளுங்கள்.",
  te: "దాన్ని తెరిచాను — దయచేసి చూడండి.",
  kn: "ಅದನ್ನು ತೆರೆದಿದ್ದೇನೆ — ದಯವಿಟ್ಟು ನೋಡಿ.",
  bn: "আমি এটি খুলে দিয়েছি — দেখে নিন।",
  pa: "ਮੈਂ ਇਹ ਖੋਲ੍ਹ ਦਿੱਤਾ ਹੈ — ਕਿਰਪਾ ਕਰਕੇ ਵੇਖੋ।",
};

/**
 * The honest "no".
 *
 * Said whenever the model names something that is not a registered capability
 * — including the things an owner most reasonably expects and the app does not
 * do yet, like starting every machine at once. Being told this in English was
 * the worst version of it: a refusal they could not even read.
 */
const CANNOT_DO: Localized = {
  en: "I can't do that in this app yet.",
  hi: "यह काम मैं अभी इस ऐप में नहीं कर सकता.",
  mr: "हे काम मी अजून या अॅपमध्ये करू शकत नाही.",
  gu: "આ કામ હું હજી આ એપમાં કરી શકતો નથી.",
  ta: "இதை இந்தச் செயலியில் என்னால் இன்னும் செய்ய முடியாது.",
  te: "దీన్ని ఈ యాప్‌లో నేను ఇంకా చేయలేను.",
  kn: "ಇದನ್ನು ಈ ಆ್ಯಪ್‌ನಲ್ಲಿ ನಾನು ಇನ್ನೂ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.",
  bn: "এই কাজ আমি এখনও এই অ্যাপে করতে পারি না।",
  pa: "ਇਹ ਕੰਮ ਮੈਂ ਹਾਲੇ ਇਸ ਐਪ ਵਿੱਚ ਨਹੀਂ ਕਰ ਸਕਦਾ।",
};

/** Understood, but the steps could not be worked out. */
const CANNOT_PLAN: Localized = {
  en: "I couldn't work out how to do that.",
  hi: "यह कैसे करना है, मैं समझ नहीं पाया.",
  mr: "हे कसे करायचे ते मला समजले नाही.",
  gu: "આ કેવી રીતે કરવું તે મને સમજાયું નહીં.",
  ta: "இதை எப்படிச் செய்வது என்று எனக்குப் புரியவில்லை.",
  te: "దీన్ని ఎలా చేయాలో నాకు అర్థం కాలేదు.",
  kn: "ಇದನ್ನು ಹೇಗೆ ಮಾಡಬೇಕೆಂದು ನನಗೆ ತಿಳಿಯಲಿಲ್ಲ.",
  bn: "এটি কীভাবে করতে হবে আমি বুঝতে পারিনি।",
  pa: "ਇਹ ਕਿਵੇਂ ਕਰਨਾ ਹੈ, ਮੈਨੂੰ ਸਮਝ ਨਹੀਂ ਆਇਆ।",
};

/** The page opened and is the right one, but it is empty. */
const NOTHING_TO_READ: Localized = {
  en: "I opened it, but found nothing to read.",
  hi: "मैंने इसे खोला, पर पढ़ने के लिए कुछ नहीं मिला.",
  mr: "मी ते उघडले, पण वाचण्यासारखे काही मिळाले नाही.",
  gu: "મેં તે ખોલ્યું, પણ વાંચવા જેવું કંઈ મળ્યું નહીં.",
  ta: "திறந்தேன், ஆனால் படிக்க ஒன்றும் இல்லை.",
  te: "తెరిచాను, కానీ చదవడానికి ఏమీ లేదు.",
  kn: "ತೆರೆದೆ, ಆದರೆ ಓದಲು ಏನೂ ಸಿಗಲಿಲ್ಲ.",
  bn: "খুলেছি, কিন্তু পড়ার মতো কিছু পাইনি।",
  pa: "ਮੈਂ ਖੋਲ੍ਹਿਆ, ਪਰ ਪੜ੍ਹਨ ਲਈ ਕੁਝ ਨਹੀਂ ਮਿਲਿਆ।",
};

const EXPIRED: Localized = {
  en: "That request has expired. Please start again.",
  hi: "यह अनुरोध खत्म हो गया. कृपया फिर से शुरू करें.",
  mr: "ही विनंती संपली आहे. कृपया पुन्हा सुरू करा.",
  gu: "આ વિનંતી પૂરી થઈ ગઈ. કૃપા કરી ફરી શરૂ કરો.",
  ta: "அந்தக் கோரிக்கை காலாவதியானது. மீண்டும் தொடங்குங்கள்.",
  te: "ఆ అభ్యర్థన ముగిసింది. దయచేసి మళ్ళీ మొదలుపెట్టండి.",
  kn: "ಆ ವಿನಂತಿ ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಾರಂಭಿಸಿ.",
  bn: "এই অনুরোধ শেষ হয়ে গেছে। আবার শুরু করুন।",
  pa: "ਇਹ ਬੇਨਤੀ ਖਤਮ ਹੋ ਗਈ। ਕਿਰਪਾ ਕਰਕੇ ਫਿਰ ਸ਼ੁਰੂ ਕਰੋ।",
};

const NOT_ON_SCREEN: Localized = {
  en: "What I needed wasn't on the screen.",
  hi: "जो चाहिए था वह स्क्रीन पर नहीं मिला.",
  mr: "जे हवे होते ते स्क्रीनवर दिसले नाही.",
  gu: "જે જોઈતું હતું તે સ્ક્રીન પર મળ્યું નહીં.",
  ta: "தேவையானது திரையில் இல்லை.",
  te: "కావలసింది స్క్రీన్‌పై కనిపించలేదు.",
  kn: "ಬೇಕಾಗಿದ್ದು ಪರದೆಯ ಮೇಲೆ ಸಿಗಲಿಲ್ಲ.",
  bn: "যা দরকার ছিল তা স্ক্রিনে পাইনি।",
  pa: "ਜੋ ਚਾਹੀਦਾ ਸੀ ਉਹ ਸਕਰੀਨ ਉੱਤੇ ਨਹੀਂ ਮਿਲਿਆ।",
};

const BUTTON_NOT_READY: Localized = {
  en: "That button wasn't ready yet.",
  hi: "वह बटन अभी तैयार नहीं था.",
  mr: "ते बटण अजून तयार नव्हते.",
  gu: "તે બટન હજી તૈયાર નહોતું.",
  ta: "அந்தப் பொத்தான் இன்னும் தயாராக இல்லை.",
  te: "ఆ బటన్ ఇంకా సిద్ధంగా లేదు.",
  kn: "ಆ ಬಟನ್ ಇನ್ನೂ ಸಿದ್ಧವಾಗಿರಲಿಲ್ಲ.",
  bn: "সেই বোতামটি তখনও তৈরি ছিল না।",
  pa: "ਉਹ ਬਟਨ ਹਾਲੇ ਤਿਆਰ ਨਹੀਂ ਸੀ।",
};

const LIST_NOT_LOADED: Localized = {
  en: "The list hadn't loaded yet.",
  hi: "सूची अभी लोड नहीं हुई थी.",
  mr: "यादी अजून लोड झाली नव्हती.",
  gu: "યાદી હજી લોડ થઈ નહોતી.",
  ta: "பட்டியல் இன்னும் ஏற்றப்படவில்லை.",
  te: "జాబితా ఇంకా లోడ్ కాలేదు.",
  kn: "ಪಟ್ಟಿ ಇನ್ನೂ ಲೋಡ್ ಆಗಿರಲಿಲ್ಲ.",
  bn: "তালিকাটি তখনও লোড হয়নি।",
  pa: "ਸੂਚੀ ਹਾਲੇ ਲੋਡ ਨਹੀਂ ਹੋਈ ਸੀ।",
};

const COULD_NOT_FILL: Localized = {
  en: "I couldn't fill that in on the form.",
  hi: "मैं फ़ॉर्म में वह भर नहीं पाया.",
  mr: "मी फॉर्ममध्ये ते भरू शकलो नाही.",
  gu: "હું ફોર્મમાં તે ભરી શક્યો નહીં.",
  ta: "படிவத்தில் அதை என்னால் நிரப்ப முடியவில்லை.",
  te: "ఫారంలో దాన్ని నేను నింపలేకపోయాను.",
  kn: "ಫಾರ್ಮ್‌ನಲ್ಲಿ ಅದನ್ನು ತುಂಬಲು ಆಗಲಿಲ್ಲ.",
  bn: "ফর্মে সেটি ভরতে পারিনি।",
  pa: "ਮੈਂ ਫਾਰਮ ਵਿੱਚ ਉਹ ਨਹੀਂ ਭਰ ਸਕਿਆ।",
};

/**
 * The controller's reason, turned into something the owner can hear.
 *
 * The controller reports what stopped it, and four of its seven reasons name
 * the DOM control they were looking for — "Could not find start-work-trigger."
 * That is the right level of detail for the trail and the log, which both keep
 * it, and exactly the wrong thing to read aloud to somebody in a yard.
 *
 * Mapping rather than replacing: saying WHICH step failed is genuinely more
 * use than "something went wrong", and it was deliberate before this. The id
 * is what gets dropped, not the meaning.
 */
const SCREEN_PROBLEMS: { match: RegExp; text: Localized }[] = [
  { match: /not available yet/i, text: BUTTON_NOT_READY },
  { match: /has not loaded/i, text: LIST_NOT_LOADED },
  { match: /not allowed/i, text: CANNOT_DO },
  { match: /could not (type|choose)/i, text: COULD_NOT_FILL },
  { match: /could not find|did not show/i, text: NOT_ON_SCREEN },
];

function screenProblem(reason: string, lang: AgentLang): string {
  const known = SCREEN_PROBLEMS.find((p) => p.match.test(reason));
  // Unrecognised reasons fall back to the vague sentence rather than being
  // echoed: a reason this does not know the shape of is exactly the kind that
  // might carry an id.
  return say(known?.text ?? COULD_NOT_FINISH, lang);
}

const DO_NOT_REPEAT: Localized = {
  en: "Please look before saying it again, or it may be saved twice.",
  hi: "दोबारा कहने से पहले देख लें, वरना दो बार सेव हो सकता है.",
  mr: "पुन्हा सांगण्यापूर्वी पाहून घ्या, नाहीतर दोन वेळा सेव्ह होईल.",
  gu: "ફરી કહેતા પહેલાં જોઈ લો, નહીં તો બે વાર સેવ થઈ શકે.",
  ta: "மீண்டும் சொல்வதற்கு முன் பார்த்துக் கொள்ளுங்கள், இல்லையெனில் இரண்டு முறை சேமிக்கப்படலாம்.",
  te: "మళ్ళీ చెప్పే ముందు చూసుకోండి, లేకపోతే రెండు సార్లు సేవ్ అవుతుంది.",
  kn: "ಪುನಃ ಹೇಳುವ ಮೊದಲು ನೋಡಿಕೊಳ್ಳಿ, ಇಲ್ಲದಿದ್ದರೆ ಎರಡು ಬಾರಿ ಉಳಿಯಬಹುದು.",
  bn: "আবার বলার আগে দেখে নিন, নইলে দুইবার সেভ হয়ে যেতে পারে।",
  pa: "ਦੁਬਾਰਾ ਕਹਿਣ ਤੋਂ ਪਹਿਲਾਂ ਵੇਖ ਲਵੋ, ਨਹੀਂ ਤਾਂ ਦੋ ਵਾਰ ਸੇਵ ਹੋ ਸਕਦਾ ਹੈ।",
};

export type AskFn = (input: { lang: AgentLang; history: GroqTurn[] }) => Promise<AgentResponse>;

/** Injected so the turn loop can be tested without a database. */
export type LookupAliasFn = (
  businessId: string,
  kind: EntityKind,
  heard: string,
) => Promise<string | null>;

/** Injected so the turn loop can be tested without a database. */
export type RememberAliasFn = (input: {
  businessId: string;
  kind: EntityKind;
  heard: string;
  label: string;
}) => Promise<void>;

/** Injected in tests so the read-answer path needs no key either. */
export type AnswerFn = (input: {
  question: string;
  screenText: string;
  lang: AgentLang;
}) => Promise<string>;

/**
 * One user message. `ask` is injectable so the whole loop can be tested without
 * a key or a network call.
 */
export async function handleMessage(
  input: { taskId?: string; text: string; lang: AgentLang; history?: GroqTurn[] },
  actor: Actor,
  deps: {
    ask?: AskFn;
    record?: RecordFn;
    store?: TaskStore;
    lookupAlias?: LookupAliasFn;
    listRecords?: ListRecordsFn;
  } = {},
): Promise<AgentReply> {
  const store = deps.store ?? defaultStore;
  const task = await loadTask(store, input.taskId, actor, input.lang);
  const ask = deps.ask ?? ((args) => askGroq(args));

  let understood: AgentResponse;
  try {
    understood = await ask({
      lang: input.lang,
      history: [...(input.history ?? []), { role: "user", content: input.text }],
    });
  } catch (err) {
    const kind = err instanceof GroqError ? err.kind : "http";
    // Is this a blip or a wall? See LONG_WAIT_SEC: the daily token allowance
    // reports minutes, the per-minute one reports seconds, and the owner needs
    // to be told different things.
    const stuck = (err instanceof GroqError ? (err.retryAfterSec ?? 0) : 0) > LONG_WAIT_SEC;
    // A failure to understand leaves the task where it was rather than
    // advancing it on a guess.
    recordTurnMetric({ outcome: "failed", lang: input.lang, reason: kind });
    return {
      taskId: (await save(store, task)).id,
      state: task.state,
      // UNAVAILABLE rather than TOO_BUSY for a wall: "the app is working, use
      // the buttons below" is the actionable half, and it is already said in
      // every language. Its "try again in a minute" tail is optimistic for an
      // allowance that resets tomorrow — but the buttons it points at do keep
      // working, which is the part the owner can act on.
      say: say(stuck ? UNAVAILABLE : BUSY_OR_SORRY[kind], input.lang),
      // Not merely "that failed": the service is down, so lead with what does
      // work. Timeouts count too — four taps of a 12-second wait is a minute
      // of staring at a phone.
      ...(kind === "unavailable" || kind === "timeout" || kind === "http" || stuck
        ? { degraded: true }
        : {}),
    };
  }

  if (understood.kind === "reply") {
    recordTurnMetric({ outcome: "replied", lang: input.lang });
    return { taskId: (await save(store, task)).id, state: task.state, say: understood.message };
  }

  if (understood.kind === "clarify") {
    const asking = await save(
      store,
      task.state === "IDLE"
        ? transition(transition(task, "UNDERSTANDING"), "RESOLVING_WORKFLOW")
        : task,
    );
    recordTurnMetric({ outcome: "asked", lang: input.lang });
    return { taskId: asking.id, state: asking.state, say: understood.question };
  }

  // --- a proposed action ---------------------------------------------------
  const workflow = resolve(understood.workflowId);
  if (!workflow) {
    // Either invented, or registered but not wired up. Both are "no", and
    // neither is explained to the owner in those terms.
    return {
      taskId: (await save(store, task)).id,
      state: task.state,
      say: say(CANNOT_DO, task.lang),
    };
  }

  // Only fields this workflow declares survive; anything else the model
  // returned is dropped rather than carried toward a form.
  const accepted = pickKnownFields(workflow, understood.fields);

  // A mishearing the owner has already corrected once is rewritten here,
  // before anything is matched or shown. They should not have to correct the
  // same thing twice — and the label still goes through the normal matching
  // afterwards, so a record since renamed or archived fails honestly rather
  // than resolving to something that is gone.
  const corrected = deps.lookupAlias
    ? await applyAliases(workflow, accepted, actor.businessId, deps.lookupAlias)
    : accepted;

  // Spoken days become real dates here, before anything is shown for approval.
  // A word a form would silently ignore has to become a question now: by the
  // time it reaches an <input type="date"> it is either dropped on the floor or
  // replaced by the form's default of today, and neither is what was said.
  const dated = readDates(workflow, corrected, input.lang, new Date());
  if (dated.ask) {
    const asking = await save(
      store,
      task.state === "IDLE"
        ? transition(transition(task, "UNDERSTANDING"), "RESOLVING_WORKFLOW")
        : task,
    );
    return { taskId: asking.id, state: asking.state, say: dated.ask };
  }
  // Keep what was actually asked: a read-only task has to answer THIS from the
  // screen later, and by then the wording is gone.
  let working = setFields({ ...task, workflowId: workflow.id, question: input.text }, dated.fields);

  if (working.state === "IDLE") {
    working = transition(transition(working, "UNDERSTANDING"), "RESOLVING_WORKFLOW");
  }

  // A task already waiting on a yes goes back to collecting when the owner says
  // something else. "Hinjawadi, not Wakad" is a correction, and it has to be
  // re-presented and re-approved rather than quietly amending what was already
  // put in front of them.
  if (working.state === "READY_FOR_CONFIRMATION") {
    working = transition(working, "COLLECTING_DETAILS");
  }

  recordTurnMetric({
    outcome: "understood",
    workflowId: workflow.id,
    effect: workflow.effect,
    lang: input.lang,
  });

  // "All of them." The model marks the record field with ALL; the records
  // themselves are looked up here, and the task becomes a queue that gets
  // worked through one at a time. Nothing is written in bulk — see batch.ts.
  const forEach = batchField(workflow.fields);
  // The marker, or the owner's own words. The model is asked for "*" and
  // sometimes gives it; meansAll() is what makes this work when it does not.
  const wantsAll =
    !!forEach && (working.fields[forEach.name] === ALL || meansAll(input.text));
  if (forEach && wantsAll) {
    const lister = deps.listRecords ?? defaultListRecords;
    const records = await lister(actor.businessId, forEach.entityKind ?? "", workflow.id);
    const batch = newBatch(forEach.name, records);
    if (!batch) {
      // Nothing matched, or only one did. One is not a batch: fall through
      // with that single record filled in and let the ordinary path run.
      const only = records[0];
      if (!only) {
        return { taskId: (await save(store, working)).id, state: working.state, say: nothingToDo(input.lang) };
      }
      working = setFields(working, { [forEach.name]: only.label });
    } else {
      working = { ...setFields(working, { [forEach.name]: batch.current.label }), batch };
    }
  }

  const stillNeeded = missingFields(workflow, working.fields);
  if (stillNeeded.length > 0) {
    working = await save(store, transition(working, "COLLECTING_DETAILS"));
    const question = nextQuestion(workflow, working.fields, input.lang) ?? "";
    return {
      taskId: working.id,
      state: working.state,
      // In a batch, say which record this is and how far in: somebody who
      // cannot see a progress bar has no other way to know four are coming.
      say: working.batch ? `${startingLine(working.batch, input.lang)} ${question}`.trim() : question,
    };
  }

  if (requiresConfirmation(workflow)) {
    working = await save(store, transition(working, "READY_FOR_CONFIRMATION"));
    return {
      taskId: working.id,
      state: working.state,
      say: say(SHALL_I_SAVE, task.lang),
      confirm: { summary: summarize(working.fields) },
    };
  }

  // Only a read can reach here: requiresConfirmation() sends every write to
  // the owner first. The recorder is passed anyway so that if that policy ever
  // loosens, the approval entry is not quietly lost with it.
  return startExecuting(store, working, actor, deps.record);
}

/**
 * The owner picked the record a mishearing meant.
 *
 * Two things happen, and the order matters: the correction is remembered so
 * the same mishearing resolves by itself next time, and THIS turn carries on
 * with the right record instead of making them start over. Being asked to
 * re-say a name the app has just demonstrated it cannot hear is not a fix.
 *
 * The chosen label is not taken on trust. It has to be one of the labels the
 * browser offered, and those were built from the owner's own records, so a
 * payload cannot name a record the owner was never shown.
 */
export async function handleResolve(
  input: { taskId: string; field: string; heard: string; chosen: string; lang: AgentLang },
  actor: Actor,
  deps: { record?: RecordFn; store?: TaskStore; remember?: RememberAliasFn } = {},
): Promise<AgentReply> {
  const store = deps.store ?? defaultStore;
  const task = await store.get(input.taskId, actor);
  if (!task || !ownsTask(task, actor) || !task.workflowId) {
    return { taskId: input.taskId, state: "FAILED", say: say(EXPIRED, input.lang) };
  }

  const workflow = resolve(task.workflowId);
  const field = workflow?.fields.find((f) => f.name === input.field || f.control === input.field);
  if (!workflow || !field) {
    return { taskId: task.id, state: task.state, say: say(CANNOT_DO, task.lang) };
  }

  // Remembered only for fields that name a record, and under that kind: a
  // customer called "Patil" must never start resolving an operator.
  if (field.entityKind && isEntityKind(field.entityKind)) {
    const remember = deps.remember ?? rememberAlias;
    await remember({
      businessId: actor.businessId,
      kind: field.entityKind,
      heard: input.heard,
      label: input.chosen,
    });
  }

  // The turn resumes with the record they picked, under the field's own name.
  const corrected = setFields({ ...task }, { ...task.fields, [field.name]: input.chosen });
  // Back to collecting, from wherever the correction arrived. A plan that
  // stopped to ask which record was meant is mid-flight (EXECUTING) and has
  // submitted nothing; one still awaiting a yes is READY_FOR_CONFIRMATION.
  // Either way the old approval cannot carry over to the new values.
  const ready =
    corrected.state === "READY_FOR_CONFIRMATION" || corrected.state === "EXECUTING"
      ? transition(corrected, "COLLECTING_DETAILS")
      : corrected;

  // A write still needs approving — against the corrected values, not the old
  // ones. The fingerprint moved when the field did, so an earlier yes cannot
  // cover this.
  if (requiresConfirmation(workflow)) {
    const waiting = await save(store, transition(ready, "READY_FOR_CONFIRMATION"));
    return {
      taskId: waiting.id,
      state: waiting.state,
      say: say(SHALL_I_SAVE, corrected.lang),
      confirm: { summary: summarize(waiting.fields) },
    };
  }
  return startExecuting(store, ready, actor, deps.record);
}

/** How far back "that was wrong" can reach. Beyond this the owner is better
 * served by being asked which thing they mean than by a guess. */
const UNDO_WINDOW_MS = 60 * 60 * 1000;

const NOTHING_TO_UNDO: Localized = {
  en: "I haven't saved anything recently, so there's nothing for me to take back.",
  hi: "मैंने हाल में कुल सेव नहीं किया, तो वापस लेने के लिये कुछ नहीं है.",
  mr: "मी नुकतेज काही सेव्ह केलेले नाही, म्हणून मागे घेण्यासारखे काही नाही.",
  gu: "મેં હાલમાં કંઈ સેવ કર્યું નથી, તો પાછું લેવા જેવું કંઈ નથી.",
  ta: "நான் சமீபத்தில் எதையும் சேமிக்கவில்லை, எனவே திரும்பப் பெற ஒன்றும் இல்லை.",
  te: "నేను ఇటీవల ఏదీ సేవ్ చేయలేదు, కాబట్టి వెనక్కి తీసుకోవడానికి ఏమీ లేదు.",
  kn: "ನಾನು ಇತ್ತೀಚೆಗೆ ಏನನ್ನೂ ಉಳಿಸಿಲ್ಲ, ಹಾಗಾಗಿ ಹಿಂತೆಗೆದುಕೊಳ್ಳಲು ಏನೂ ಇಲ್ಲ.",
  bn: "আমি সম্প্রতি কিছু সেভ করিনি, তাই ফিরিয়ে নেওয়ার কিছু নেই।",
  pa: "ਮੈਂ ਹਾਲ ਵਿੱਚ ਕੁਝ ਸੇਵ ਨਹੀਂ ਕੀਤਾ, ਸੋ ਵਾਪਸ ਲੈਣ ਲਈ ਕੁਝ ਨਹੀਂ ਹੈ।",
};

/** Said when the owner is taken to the record. Deliberately does NOT claim to
 * have removed anything — see handleUndo for why it cannot. */
const SHOWING_IT: Localized = {
  en: "I've opened where it is. The entry showing",
  hi: "मैंने वह जगह खोल दी है. जिस में लिखा है",
  mr: "मी ती जागा उघडली आहे. ज्यात लिहिले आहे",
  gu: "મેં તે જગ્યા ખોલી છે. જેમાં લખ્યું છે",
  ta: "அது இருக்கும் இடத்தைத் திறந்துவிட்டேன். எதில் உள்ளது",
  te: "అది ఉన్న చోటు తెరిచాను. ఏదిలో ఉంది",
  kn: "ಅದು ಇರುವ ಜಾಗ ತೆರೆದಿದ್ದೇನೆ. ಯಾವುದರಲ್ಲಿ ಇದೆ",
  bn: "আমি সেই জায়গা খুলে দিয়েছি। যাতে লেখা আছে",
  pa: "ਮੈਂ ਉਹ ਥਾਂ ਖੋਲ੍ਹ ਦਿੱਤੀ ਹੈ। ਜਿਸ ਵਿੱਚ ਲਿਖਿਆ ਹੈ",
};

const REMOVE_THERE: Localized = {
  en: "is the one I just saved — you can remove it from here.",
  hi: "वही मैंने अभी सेव की थी — इसे यहीं से हटा सकते हैं.",
  mr: "तीज मी आता सेव्ह केली होती — ती इथूनज काढू शकता.",
  gu: "એ મેં હમણાં સેવ કરી હતી — તેને અહીંથી કાઢી શકો છો.",
  ta: "அதையே நான் இப்போது சேமித்தேன் — அதை இங்கிருந்தே நீக்கலாம்.",
  te: "అదే నేను ఇప్పుడు సేవ్ చేశాను — దాన్ని ఇక్కడినుంచే తొలగించవచ్చు.",
  kn: "ಅದನ್ನೇ ನಾನು ಈಗ ಉಳಿಸಿದ್ದೆ — ಅದನ್ನು ಇಲ್ಲಿಂದಲೇ ತೆಗೆಯಬಹುದು.",
  bn: "সেটাই আমি এখন সেভ করেছিলাম — সেটা এখান থেকেই মুছে ফেলতে পারেন।",
  pa: "ਉਹੀ ਮੈਂ ਹੁਣੇ ਸੇਵ ਕੀਤੀ ਸੀ — ਉਸਨੂੰ ਇੱਥੋਂ ਹੀ ਹਟਾ ਸਕਦੇ ਹੋ।",
};

/**
 * "That was wrong" — take the owner to the thing just saved.
 *
 * It does NOT delete anything, and that is a decision rather than a shortfall.
 * The assistant drives the app's own forms and never calls its API, so it
 * never learns the id of the row a save created; the only way to delete "the
 * one I just added" would be to assume the newest row in a list is it. On an
 * operator's money, or a day's hours, a wrong guess there is worse than no
 * undo at all — and silently removing the wrong record is exactly the kind of
 * harm someone who cannot read the screen could not catch.
 *
 * So it does the honest thing: opens the page where the record lives, names it
 * by the values that were approved, and leaves the removing to the owner, who
 * has a delete control there already. A way back that cannot pick the wrong
 * record.
 */
export async function handleUndo(
  input: { lang: AgentLang },
  actor: Actor,
  deps: { store?: TaskStore } = {},
): Promise<AgentReply> {
  const store = deps.store ?? defaultStore;
  const last = await store.lastWrite(actor, new Date(Date.now() - UNDO_WINDOW_MS));
  const workflow = last?.workflowId ? resolve(last.workflowId) : null;

  if (!last || !workflow || workflow.effect === "READ") {
    return { taskId: randomUUID(), state: "FAILED", say: say(NOTHING_TO_UNDO, input.lang) };
  }

  const plan = planWorkflow(workflow.id, last.fields);
  if (!plan.ok) {
    return { taskId: last.id, state: last.state, say: say(NOTHING_TO_UNDO, input.lang) };
  }

  // Everything that gets there, and nothing that fills or saves: a navigation
  // built from the real plan with the form-touching half removed. The dialog
  // is not even opened — the record is on the page behind it.
  const openWith = workflow.openWith;
  const operations = plan.operations.filter(
    (op) =>
      op.action === "navigate" ||
      op.action === "pickFromList" ||
      op.action === "waitFor" ||
      (op.action === "click" && op.control !== openWith),
  );

  return {
    taskId: last.id,
    state: last.state,
    say: `${say(SHOWING_IT, input.lang)} ${summarize(last.fields)} ${say(REMOVE_THERE, input.lang)}`,
    plan: { operations, verify: plan.verify },
  };
}

/**
 * The owner tapped a shortcut instead of saying anything.
 *
 * No model is involved, which is the point: these are the reads that need no
 * values, so there is nothing to extract and nothing to get wrong. It is a
 * faster path for the things owners ask most, and the only path that still
 * works when the model cannot be reached.
 *
 * The id is checked against the registry's own allowlist — reads with no
 * fields — so a tap can never reach a write, however the request was shaped.
 */
export async function handleRun(
  input: { workflowId: string; lang: AgentLang },
  actor: Actor,
  deps: { record?: RecordFn; store?: TaskStore } = {},
): Promise<AgentReply> {
  const store = deps.store ?? defaultStore;
  if (!isTappable(input.workflowId)) {
    // Not something a tap may run. Said the same way as any other refusal, so
    // a probe learns nothing from the wording.
    return { taskId: randomUUID(), state: "FAILED", say: say(CANNOT_DO, input.lang) };
  }

  const fresh = newTask({
    id: randomUUID(),
    businessId: actor.businessId,
    userId: actor.userId,
    lang: input.lang,
  });
  const ready = setFields(
    {
      ...transition(transition(fresh, "UNDERSTANDING"), "RESOLVING_WORKFLOW"),
      workflowId: input.workflowId,
      // What a tap "asked" is the capability's own summary, so the read can
      // still be answered from the screen afterwards.
      question: resolve(input.workflowId)?.summary ?? input.workflowId,
    },
    {},
  );
  return startExecuting(store, ready, actor, deps.record);
}

/** The owner said yes. The approval is minted here, against the values as they
 * stand right now, so a later change cannot ride in on it. */
export async function handleConfirm(
  taskId: string,
  actor: Actor,
  deps: { record?: RecordFn; store?: TaskStore } = {},
  /** For the one reply that cannot read it off the task: the task is gone. */
  lang: AgentLang = "en",
): Promise<AgentReply> {
  const store = deps.store ?? defaultStore;
  const task = await store.get(taskId, actor);
  if (!task || !ownsTask(task, actor)) {
    return { taskId, state: "FAILED", say: say(EXPIRED, lang) };
  }
  return startExecuting(store, confirm(task), actor, deps.record);
}

async function startExecuting(
  store: TaskStore,
  task: AgentTask,
  actor: Actor,
  record?: RecordFn,
): Promise<AgentReply> {
  const decision = authorize(task, actor, task.workflowId!);
  if (!decision.allow) {
    const stopped = await save(store, task);
    return { taskId: stopped.id, state: stopped.state, say: decision.message };
  }

  const plan = planWorkflow(task.workflowId!, task.fields);
  if (!plan.ok) {
    const failed = await save(store, transition(task, "FAILED"));
    return { taskId: failed.id, state: failed.state, say: say(CANNOT_PLAN, task.lang) };
  }

  const executing = await save(store, transition(task, "EXECUTING", new Date()));
  // Recorded BEFORE the browser is handed anything, and against the values the
  // owner was actually shown. An entry written afterwards could not prove what
  // was approved, only what happened.
  await trail(record, executing, "approved");
  recordTurnMetric({
    outcome: "approved",
    workflowId: task.workflowId,
    effect: resolve(task.workflowId!)?.effect ?? null,
    lang: task.lang,
  });
  return {
    taskId: executing.id,
    state: executing.state,
    say: say(ONE_MOMENT, task.lang),
    plan: { operations: plan.operations, verify: plan.verify },
  };
}

/** One trail entry, if there is a recorder and the workflow is worth recording.
 * Never throws: the trail is a record of the owner's work, not a gate on it. */
async function trail(
  record: RecordFn | undefined,
  task: AgentTask,
  phase: AgentTrailPhase,
  detail?: string,
): Promise<void> {
  if (!record || !task.workflowId) return;
  const workflow = resolve(task.workflowId);
  if (!workflow || !shouldRecord(workflow.effect)) return;
  try {
    await record({
      taskId: task.id,
      workflowId: workflow.id,
      effect: workflow.effect,
      fields: task.fields,
      phase,
      detail,
    });
  } catch (err) {
    // agentTrail() swallows its own failures, but the guarantee belongs here
    // too: whatever recorder is injected, a turn the owner is waiting on must
    // not die because the trail could not be written. Loudly logged, never
    // raised.
    logger.error("agent.trail_failed", err, { taskId: task.id, workflowId: workflow.id, phase });
  }
}

/**
 * The browser reports back. This is the ONLY way a task reaches SUCCEEDED, and
 * `verified` comes from the app's own screen, not from anything a model said.
 */
/**
 * Finish one record of a batch and set up the next.
 *
 * Each record gets a FRESH task rather than reusing this one. That is not
 * tidiness: SUCCEEDED and FAILED are terminal by design — the state machine
 * refuses to drive a finished task, and it is right to — so continuing in the
 * same task would mean punching a hole in exactly the rule that stops a saved
 * job being saved again. A new task per record keeps every guarantee the
 * single-record path has, and the queue is the only thing that travels.
 *
 * Returns null when the batch is over, so the caller says the closing line.
 */
async function nextInBatch(
  store: TaskStore,
  task: AgentTask,
  outcome: "done" | "failed",
  lang: AgentLang,
): Promise<AgentReply | null> {
  if (!task.batch) return null;
  const moved = advance(task.batch, outcome);
  if (!moved || isFinished(moved)) {
    return {
      taskId: task.id,
      state: task.state,
      say: finishedLine(moved ?? task.batch, lang),
    };
  }

  const workflow = task.workflowId ? resolve(task.workflowId) : null;
  if (!workflow) return null;

  // A new task, carrying only the queue and the record it is now on. The site,
  // the customer and the hour meter are deliberately NOT carried over: they
  // are per-machine, and copying one machine's site onto the next is how a
  // whole afternoon ends up filed against the wrong job.
  const fresh: AgentTask = {
    ...newTask({ id: randomUUID(), businessId: task.businessId, userId: task.userId, lang }),
    workflowId: workflow.id,
    fields: { [moved.field]: moved.current.label },
    batch: moved,
    question: task.question,
  };
  const ready = await save(
    store,
    transition(transition(fresh, "UNDERSTANDING"), "RESOLVING_WORKFLOW"),
  );

  const stillNeeded = missingFields(workflow, ready.fields);
  if (stillNeeded.length === 0) {
    // Nothing left to ask for this record. Rare, but it must not silently
    // stall: hand it back as a fresh turn the caller can confirm.
    return {
      taskId: ready.id,
      state: ready.state,
      say: startingLine(moved, lang),
    };
  }

  const collecting = await save(store, transition(ready, "COLLECTING_DETAILS"));
  const question = nextQuestion(workflow, collecting.fields, lang) ?? "";
  return {
    taskId: collecting.id,
    state: collecting.state,
    say: `${startingLine(moved, lang)} ${question}`.trim(),
  };
}

export async function handleResult(
  taskId: string,
  actor: Actor,
  result: { verified: boolean; error?: string; screenText?: string },
  deps: { answer?: AnswerFn; record?: RecordFn; store?: TaskStore } = {},
  /** For the one reply that cannot read it off the task: the task is gone. */
  lang: AgentLang = "en",
): Promise<AgentReply> {
  const store = deps.store ?? defaultStore;
  const task = await store.get(taskId, actor);
  if (!task || !ownsTask(task, actor)) {
    return { taskId, state: "FAILED", say: say(EXPIRED, lang) };
  }

  const verifying = transition(task, "VERIFYING");
  if (result.verified) {
    const done = await save(store, transition(verifying, "SUCCEEDED"));
    const workflow = task.workflowId ? resolve(task.workflowId) : null;
    await trail(deps.record, done, "executed");
    recordTurnMetric({
      outcome: "saved",
      workflowId: task.workflowId,
      effect: workflow?.effect ?? null,
      lang: task.lang,
    });

    // A question deserves the answer, not a receipt. "Done, it's saved" is for
    // something that was saved; being asked when a service is due and told
    // that is nonsense.
    if (workflow?.effect === "READ") {
      if (!result.screenText?.trim()) {
        return { taskId: done.id, state: done.state, say: say(NOTHING_TO_READ, done.lang) };
      }
      try {
        const answer = deps.answer
          ? await deps.answer({ question: task.question ?? "", screenText: result.screenText, lang: task.lang })
          : await answerFromScreen({
              question: task.question ?? "",
              screenText: result.screenText,
              lang: task.lang,
            });
        return { taskId: done.id, state: done.state, say: answer };
      } catch {
        // The page is open and correct even when the summary fails, so say so
        // rather than implying the lookup itself went wrong.
        return { taskId: done.id, state: done.state, say: say(OPENED_IT, done.lang) };
      }
    }

    // One of several? Say this one is done and ask the next one's questions,
    // rather than leaving the owner to start each machine by hand.
    if (done.batch) {
      const next = await nextInBatch(store, done, "done", task.lang);
      if (next) return { ...next, say: `${say(SAVED, task.lang)} ${next.say}` };
    }

    return { taskId: done.id, state: done.state, say: say(SAVED, task.lang) };
  }

  // Not verified is not the same as not saved. Saying "it failed" could send
  // the owner to do it again by hand and end up with two.
  const unsure = await save(store, transition(verifying, "NEEDS_RECOVERY"));
  // The most important entry in the trail: something may or may not have been
  // written, and whoever reconciles this later needs to know it was in doubt.
  await trail(deps.record, unsure, "unverified", result.error);
  // The number worth watching: something may or may not have been written, and
  // a rising count here is the feature quietly stopping working.
  recordTurnMetric({
    outcome: "unconfirmed",
    workflowId: task.workflowId,
    lang: task.lang,
    reason: result.error ? "screen_error" : "not_shown",
  });

  // "Please check the screen before trying again" is useless advice for
  // someone who cannot read the screen, and the only thing left for them to do
  // is say it again — which is how one instruction becomes two jobs. So when
  // the page sent its text, read it back to them instead of sending them to
  // look. Saying what is actually there is the only way they can decide.
  if (!result.error && result.screenText?.trim()) {
    try {
      const found = deps.answer
        ? await deps.answer({ question: CHECK_QUESTION, screenText: result.screenText, lang: task.lang })
        : await answerFromScreen({
            question: CHECK_QUESTION,
            screenText: result.screenText,
            lang: task.lang,
          });
      return { taskId: unsure.id, state: unsure.state, say: `${say(UNSURE, task.lang)} ${found}` };
    } catch {
      /* fall through to the plain wording below */
    }
  }

  return {
    taskId: unsure.id,
    state: unsure.state,
    // The reason is in the trail above and in the log; it is deliberately not
    // in what the owner hears. See COULD_NOT_FINISH.
    say: result.error
      ? `${screenProblem(result.error, task.lang)} ${say(DO_NOT_REPEAT, task.lang)}`
      : `${say(UNSURE, task.lang)} ${say(DO_NOT_REPEAT, task.lang)}`,
  };
}

/** Test seam for the default in-memory store. The running app injects the
 * database-backed one and has nothing to reset. */
export function __resetTasks() {
  defaultStore.clear();
}
