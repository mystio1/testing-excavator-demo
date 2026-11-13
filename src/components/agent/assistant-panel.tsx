"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Send, Square, X, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { executePlan, readSettledControl, verifyResult } from "@/lib/agent/ui-controller";
import type { UiOperation } from "@/lib/agent/plan";
import { VOICE_NOTICE } from "@/lib/agent/consent";
// Imported as `inLang` because this file already has its own say(): that one
// pushes a turn and speaks it, this one picks a string for a language.
import { LANG_LABEL, offeredLangs, say as inLang, type Localized } from "@/lib/agent/i18n";
import { SHORTCUTS } from "@/lib/agent/shortcuts";
import { useListen, useSpeak, type SpeechLang } from "./use-speech";

/**
 * The assistant, as an owner meets it: a big microphone, a short transcript and
 * one clear question at a time.
 *
 * Deliberately not a developer console. No workflow ids, no field names, no
 * technical words — a form that rejected something says what is missing in
 * plain language, because the person reading it is in a yard, not a terminal.
 */

type Turn = { role: "user" | "assistant"; content: string };

type AgentReply = {
  taskId: string;
  state: string;
  say: string;
  plan?: { operations: UiOperation[]; verify: string };
  confirm?: { summary: string };
  /** The model is unreachable; lead with the shortcuts, which need no model. */
  degraded?: boolean;
};

type Labels = {
  title: string;
  ask: string;
  yes: string;
  no: string;
  listening: string;
  /** Said before the browser's own permission box, so it is not a surprise. */
  micWhy: string;
  micAllow: string;
  micLater: string;
  thinking: string;
  /** Header above the tappable shortcuts. */
  quick: string;
  /** Asked when two records could be meant. */
  whichOne: string;
  /**
   * The turn did not reach the server, or the server refused it.
   *
   * Says that nothing was saved, which is true of every path that uses it:
   * the model call, a shortcut, a correction and the approval tap all write
   * through a plan the BROWSER runs afterwards, so a request that never came
   * back cannot have written anything.
   */
  failed: string;
  /**
   * The plan already ran in the page and the report of it never arrived.
   *
   * The opposite case, and the dangerous one: the record may well exist. So
   * this must not say "nothing was saved" - it points at the one thing that
   * can settle it, which is asking what the assistant did. Saying it again is
   * exactly how one instruction becomes two records.
   */
  maybeSaved: string;
};

const LABELS: Localized<Labels> = {
  en: {
    title: "Assistant",
    ask: "Ask or tell me something",
    yes: "Yes, save it",
    no: "No",
    listening: "Listening...",
    micWhy: "To talk to me, your phone will ask to use the microphone. Please tap Allow.",
    micAllow: "Use microphone",
    micLater: "I'll type instead",
    thinking: "One moment...",
    quick: "Or tap one of these",
    whichOne: "Which one?",
    failed: "Sorry, that did not go through. Nothing was saved. Please try again.",
    maybeSaved:
      "I could not check whether that saved. Please do not enter it again — ask me what I did.",
  },
  hi: {
    title: "सहायक",
    ask: "कुछ पूछें या बताएं",
    yes: "हाँ, सेव करें",
    no: "नहीं",
    listening: "सुन रहा हूँ...",
    micWhy: "बोलकर बात करने के लिए फ़ोन माइक की अनुमति माँगेगा. कृपया Allow दबाएँ.",
    micAllow: "माइक चालू करें",
    micLater: "मैं लिखकर बताऊँगा",
    thinking: "एक मिनट...",
    quick: "या इनमें से कोई दबाएँ",
    whichOne: "कौन सा?",
    failed: "माय़ करें, यह नहीं हो पाया. कुछ भी सेव नहीं हुआ. कृपया फिर कोशिश करें.",
    maybeSaved:
      "मैं देख नहीं पाया कि यह सेव हुआ या नहीं. कृपया दोबारा न डालें — मुझसे पूछें कि मैंने क्या किया.",
  },
  mr: {
    title: "सहाय्यक",
    ask: "काही विचारा किंवा सांगा",
    yes: "हो, सेव्ह करा",
    no: "नाही",
    listening: "ऐकत आहे...",
    micWhy: "बोलून बोलण्यासाठी फोन माइकची परवानगी मागेल. कृपया Allow दाबा.",
    micAllow: "माइक सुरू करा",
    micLater: "मी टाइप करतो",
    thinking: "एक मिनिट...",
    quick: "किंवा यापैकी एक दाबा",
    whichOne: "कोणता?",
    failed: "माय़ करा, हे झाले नाही. काहीही सेव्ह झाले नाही. कृपया पुन्हा प्रयत्न करा.",
    maybeSaved:
      "हे सेव्ह झाले का नाही हे मला तपासता आले नाही. कृपया पुन्हा टाकू नका — मला विचारा मी काय केले.",
  },
  gu: {
      "title": "સહાયક",
      "ask": "કંઈ પૂછો કે કહો",
      "yes": "હા, સેવ કરો",
      "no": "ના",
      "listening": "સાંભળી રહ્યો છું...",
      "micWhy": "બોલીને વાત કરવા ફોન માઇકની પરવાનગી માંગશે. કૃપા કરી Allow દબાવો.",
      "micAllow": "માઇક ચાલુ કરો",
      "micLater": "હું લખીને કહીશ",
      "thinking": "એક મિનિટ...",
      "quick": "કે આમાંથી કોઈ દબાવો",
      "whichOne": "કયો?",
      "failed": "માફ કરો, આ થઈ શક્યું નહીં. કંઈ પણ સેવ થયું નથી. કૃપા કરી ફરી પ્રયાસ કરો.",
      "maybeSaved":
        "આ સેવ થયું કે નહીં તે હું તપાસી શક્યો નહીં. કૃપા કરી ફરીથી ન નાખો — મને પૂછો મેં શું કર્યું.",
  },
  ta: {
      "title": "உதவியாளர்",
      "ask": "ஏதாவது கேளுங்கள் அல்லது சொல்லுங்கள்",
      "yes": "ஆம், சேமியுங்கள்",
      "no": "இல்லை",
      "listening": "கேட்டுக் கொண்டிருக்கிறேன்...",
      "micWhy": "பேசிப் பேச ஃபோன் மைக் அனுமதி கேட்கும். Allow அழுத்துங்கள்.",
      "micAllow": "மைக் இயக்கு",
      "micLater": "நான் தட்டச்சு செய்கிறேன்",
      "thinking": "ஒரு நிமிடம்...",
      "quick": "அல்லது இதில் ஒன்றை அழுத்துங்கள்",
      "whichOne": "எது?",
      "failed": "மன்னிக்கவும், இது நடக்கவில்லை. எதுவும் சேமிக்கப்படவில்லை. மீண்டும் முயற்சிக்கவும்.",
      "maybeSaved":
        "இது சேமிக்கப்பட்டதா என்று என்னால் சரிபார்க்க முடியவில்லை. மீண்டும் உள்ளிட வேண்டாம் — நான் என்ன செய்தேன் என்று கேளுங்கள்.",
  },
  te: {
      "title": "సహాయకుడు",
      "ask": "ఏదైనా అడగండి లేదా చెప్పండి",
      "yes": "అవును, సేవ్ చేయండి",
      "no": "కాదు",
      "listening": "వింటున్నాను...",
      "micWhy": "మాట్లాడటానికి ఫోన్ మైక్ అనుమతి అడుగుతుంది. Allow నొక్కండి.",
      "micAllow": "మైక్ ఆన్ చేయండి",
      "micLater": "నేను టైప్ చేస్తాను",
      "thinking": "ఒక నిమిషం...",
      "quick": "లేదా ఇందులో ఒకటి నొక్కండి",
      "whichOne": "ఏది?",
      "failed": "క్షమించండి, ఇది జరగలేదు. ఏదీ సేవ్ కాలేదు. దయచేసి మళ్ళీ ప్రయత్నించండి.",
      "maybeSaved":
        "ఇది సేవ్ అయిందో లేదో నేను చూడలేకపోయాను. దయచేసి మళ్ళీ నమోదు చేయకండి — నేను ఏమి చేశానో అడగండి.",
  },
  kn: {
      "title": "ಸಹಾಯಕ",
      "ask": "ಏನಾದರೂ ಕೇಳಿ ಅಥವಾ ಹೇಳಿ",
      "yes": "ಹೌದು, ಉಳಿಸಿ",
      "no": "ಇಲ್ಲ",
      "listening": "ಕೇಳುತ್ತಿದ್ದೇನೆ...",
      "micWhy": "ಮಾತನಾಡಲು ಫೋನ್ ಮೈಕ್ ಅನುಮತಿ ಕೇಳುತ್ತದೆ. Allow ಒತ್ತಿ.",
      "micAllow": "ಮೈಕ್ ಆನ್ ಮಾಡಿ",
      "micLater": "ನಾನು ಟೈಪ್ ಮಾಡುತ್ತೇನೆ",
      "thinking": "ಒಂದು ನಿಮಿಷ...",
      "quick": "ಅಥವಾ ಇವುಗಳಲ್ಲಿ ಒಂದನ್ನು ಒತ್ತಿ",
      "whichOne": "ಯಾವುದು?",
      "failed": "ಕ್ಷಮಿಸಿ, ಇದು ಆಗಲಿಲ್ಲ. ಏನೂ ಸೇವ್ ಆಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
      "maybeSaved":
        "ಇದು ಸೇವ್ ಆಗಿದೆಯೇ ಎಂದು ನನಗೆ ಪರಿಶೀಲಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಹಾಕಬೇಡಿ — ನಾನು ಏನು ಮಾಡಿದೆ ಎಂದು ಕೇಳಿ.",
  },
  bn: {
      "title": "সহায়ক",
      "ask": "কিছু জিজ্ঞেস করুন বা বলুন",
      "yes": "হ্যাঁ, সেভ করুন",
      "no": "না",
      "listening": "শুনছি...",
      "micWhy": "বলে কথা বলতে ফোন মাইকের অনুমতি চাইবে। দয়া করে Allow চাপুন।",
      "micAllow": "মাইক চালু করুন",
      "micLater": "আমি লিখে বলব",
      "thinking": "এক মিনিট...",
      "quick": "অথবা এর একটি চাপুন",
      "whichOne": "কোনটি?",
      "failed": "দুঃখিত, এটি হয়নি. কিছুই সেভ হয়নি. আবার চেষ্টা করুন.",
      "maybeSaved":
        "এটি সেভ হয়েছে কিনা আমি দেখতে পারিনি. আবার দেবেন না — আমাকে জিজ্ঞাসা করুন আমি কী করেছি.",
  },
  pa: {
      "title": "ਸਹਾਇਕ",
      "ask": "ਕੁਝ ਪੁੱਛੋ ਜਾਂ ਦੱਸੋ",
      "yes": "ਹਾਂ, ਸੇਵ ਕਰੋ",
      "no": "ਨਹੀਂ",
      "listening": "ਸੁਣ ਰਿਹਾ ਹਾਂ...",
      "micWhy": "ਬੋਲ ਕੇ ਗੱਲ ਕਰਨ ਲਈ ਫ਼ੋਨ ਮਾਈਕ ਦੀ ਇਜਾਜ਼ਤ ਮੰਗੇਗਾ। ਕਿਰਪਾ ਕਰਕੇ Allow ਦਬਾਓ।",
      "micAllow": "ਮਾਈਕ ਚਾਲੂ ਕਰੋ",
      "micLater": "ਮੈਂ ਲਿਖ ਕੇ ਦੱਸਾਂਗਾ",
      "thinking": "ਇੱਕ ਮਿੰਟ...",
      "quick": "ਜਾਂ ਇਹਨਾਂ ਵਿੱਚੋਂ ਕੋਈ ਦਬਾਓ",
      "whichOne": "ਕਿਹੜਾ?",
      "failed": "ਮਾਫ਼ ਕਰੋ, ਇਹ ਨਹੀਂ ਹੋਇਆ. ਕੁਝ ਵੀ ਸੇਵ ਨਹੀਂ ਹੋਇਆ. ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ.",
      "maybeSaved":
        "ਇਹ ਸੇਵ ਹੋਇਆ ਜਾਂ ਨਹੀਂ, ਮੈਂ ਜਾਂਚ ਨਹੀਂ ਸਕਿਆ. ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਨਾ ਪਾਓ — ਮੈਨੂੰ ਪੁੱਛੋ ਮੈਂ કੀ કੀਤਾ.",
  },
};

export function AssistantPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /** The launcher, so closing hands focus back to where it came from rather
   * than dropping it at the top of the page. */
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [lang, setLang] = useState<SpeechLang>("en");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Sticky until the next answer comes back: the owner should not have to
  // guess whether it is worth speaking again.
  const [degraded, setDegraded] = useState(false);

  const [pendingConfirm, setPendingConfirm] = useState<{ taskId: string; summary: string } | null>(null);
  /** Which record did they mean? Answered with a tap, and remembered. */
  const [pendingChoice, setPendingChoice] = useState<{
    taskId: string;
    field: string;
    heard: string;
    choices: string[];
  } | null>(null);
  const taskId = useRef<string | undefined>(undefined);
  /**
   * Re-entry guard, as a ref rather than the `busy` state.
   *
   * `disabled={busy}` only takes effect after React re-renders, so two taps on
   * "Yes, save it" in the same frame both got through — two approvals, two
   * plans, two submits, two jobs in the database. A double-tap on a phone in a
   * yard is not an edge case. A ref is updated synchronously, so the second tap
   * sees it immediately.
   */
  const inFlight = useRef(false);

  const { speak, stop: stopSpeaking, speaking } = useSpeak();
  // Read once: the env var behind it cannot change while the panel is mounted.
  const offered = useMemo(() => offeredLangs(), []);

  /**
   * Keyboard reachability, in both directions.
   *
   * Opening moved nothing, so a keyboard or screen-reader user landed outside
   * a panel that had just appeared and had to tab through the whole page to
   * reach it. Closing dropped focus entirely. Escape did nothing, which is the
   * one key everybody tries.
   */
  useEffect(() => {
    if (open) panelRef.current?.focus();
    else launcherRef.current?.focus({ preventScroll: true });
  }, [open]);
  const t = inLang(LABELS, lang);

  const say = useCallback(
    (text: string) => {
      setTurns((prev) => [...prev, { role: "assistant", content: text }]);
      speak(text, lang);
    },
    [speak, lang],
  );

  /**
   * Through apiFetch, not a bare fetch to "/api/agent".
   *
   * The Android build has no server of its own: scripts/build-android.mjs
   * strips src/app/api and the bundle runs from a local origin, so a relative
   * path resolves to a file:// neighbour that does not exist. apiFetch is what
   * the rest of the app uses for exactly this reason — the assistant was the
   * only caller still assuming it was same-origin, which made it dead in the
   * APK while working perfectly on the web.
   */
  const post = useCallback(async (body: Record<string, unknown>): Promise<AgentReply | null> => {
    try {
      return await apiFetch<AgentReply>("/api/agent", {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  }, []);

  /** Run a plan in the page, then tell the server what the screen showed. The
   * server decides whether that counts as done — this only reports. */
  const runPlan = useCallback(
    async (reply: AgentReply) => {
      if (!reply.plan) return;
      // The verify control is handed in so the controller can record what it
      // looked like BEFORE the save: a list that already had rows was proof of
      // nothing on its own.
      const outcome = await executePlan(reply.plan.operations, (route) => router.push(route), {
        verify: reply.plan.verify,
      });

      if (outcome.status === "needs_choice") {
        // Either several records match or none does. The owner picks, and
        // nothing has been saved.
        //
        // Offered as BUTTONS, not read out as a list to repeat back. Being
        // asked to re-say a name the app has just demonstrated it cannot hear
        // is not a fix — and a tap also tells us what the mishearing meant, so
        // it resolves by itself next time.
        say(
          outcome.choices.length > 0
            ? `${t.whichOne} ${outcome.choices.join(", ")}`
            : `I couldn't find "${outcome.query}".`,
        );
        if (outcome.choices.length > 0) {
          setPendingChoice({
            taskId: reply.taskId,
            field: outcome.field,
            heard: outcome.query,
            choices: outcome.choices,
          });
        }
        return;
      }

      const verified =
        outcome.status === "done" ? await verifyResult(reply.plan.verify, outcome.before) : false;
      const error = outcome.status === "failed" ? outcome.reason : undefined;

      // What ended up on screen, whether or not it counted as verified.
      //
      // Sent on the UNVERIFIED path too, which is the point: "I couldn't
      // confirm whether that saved, please check the screen" is useless advice
      // for someone who cannot read the screen, and the only thing left to do
      // is say it again — which is how you get two jobs for one instruction.
      // With the page text, the server can say what it actually finds.
      // Settled, not merely present: the container renders before its data
      // arrives, and a read answered from "Loading…" is an answer made up out
      // of a placeholder.
      const screenText = (await readSettledControl(reply.plan.verify)) ?? undefined;

      const final = await post({
        action: "result",
        taskId: reply.taskId,
        lang,
        verified,
        error,
        screenText,
      });
      // The plan has ALREADY run in the page at this point, so this branch is
      // not "it failed" - it is "the record may exist and I cannot tell you".
      // Silence here was the worst outcome in the panel: for an owner who
      // cannot read the screen, nothing said means nothing happened, so they
      // tap again and the yard gets two jobs for one instruction.
      say(final ? final.say : t.maybeSaved);
    },
    [post, router, say, lang, t],
  );

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || inFlight.current) return;
      inFlight.current = true;
      setDraft("");
      setTurns((prev) => [...prev, { role: "user", content: text }]);
      setBusy(true);
      stopSpeaking();

      const reply = await post({
        action: "message",
        taskId: taskId.current,
        lang,
        text,
        // A short window is enough for follow-ups and keeps the request small.
        history: turns.slice(-6).map((t) => ({ speaker: t.role, content: t.content })),
      });

      if (!reply) {
        say(t.failed);
        inFlight.current = false;
        setBusy(false);
        return;
      }

      taskId.current = reply.taskId;
      setDegraded(!!reply.degraded);
      say(reply.say);

      if (reply.confirm) {
        setPendingConfirm({ taskId: reply.taskId, summary: reply.confirm.summary });
        // Read the VALUES out, not just the question.
        //
        // "Shall I save this?" was all that was ever spoken, with the figures
        // drawn on screen beside it. For an owner who cannot read the screen
        // — which is who this is built for — that is being asked to approve
        // something nobody told them. The whole safety model rests on the
        // approval being against exact values, so the exact values have to be
        // said out loud. The separator becomes a comma because "·" read
        // aloud is noise.
        speak(reply.confirm.summary.replace(/\s*·\s*/g, ", "), lang);
      }
      else if (reply.plan) await runPlan(reply);

      inFlight.current = false;
      setBusy(false);
    },
    [post, runPlan, say, speak, stopSpeaking, turns, lang, t],
  );

  /**
   * Run a shortcut. No model is involved, so this is the one path that still
   * works when the model cannot be reached — which is also why it is offered
   * most prominently in exactly that case.
   */
  const run = useCallback(
    async (workflowId: string, label: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setTurns((prev) => [...prev, { role: "user", content: label }]);
      setBusy(true);
      stopSpeaking();

      const reply = await post({ action: "run", workflowId, lang });
      if (reply) {
        taskId.current = reply.taskId;
        // A shortcut that worked proves the app is fine, whatever the model is
        // doing.
        setDegraded(false);
        say(reply.say);
        if (reply.plan) await runPlan(reply);
      } else {
        say(t.failed);
      }
      inFlight.current = false;
      setBusy(false);
    },
    [lang, post, runPlan, say, stopSpeaking, t],
  );

  const {
    start: startListening,
    stop: stopListening,
    state: listenState,
    error: listenError,
    permission: micPermission,
  } = useListen(send);

  /**
   * Two separate things, in order, and neither is a formality.
   *
   * First the voice notice: speaking sends a few seconds of audio — carrying
   * customers' names and numbers — to a speech service outside India. That is
   * a disclosure the owner is owed before the microphone is touched, and the
   * answer is recorded on the server so it is asked once and can be shown to
   * have been asked. The server refuses transcription without it either way.
   *
   * Only then the browser's own permission box. One appearing out of nowhere
   * gets refused, and in Chrome a refusal is permanent, so a reflexive "Block"
   * would cost voice for good.
   */
  const [askingConsent, setAskingConsent] = useState(false);
  const [askingMic, setAskingMic] = useState(false);
  const [consent, setConsent] = useState<"unknown" | "given" | "absent">("unknown");
  const recording = listenState === "recording";

  useEffect(() => {
    if (!open || consent !== "unknown") return;
    void (async () => {
      try {
        const res = await apiFetch<{ given: boolean }>("/api/agent/voice-consent");
        setConsent(res.given ? "given" : "absent");
      } catch {
        // Unknown stays unknown: the notice is shown again rather than skipped.
        setConsent("absent");
      }
    })();
  }, [open, consent]);

  const onMicTap = useCallback(() => {
    if (recording) {
      stopListening();
      return;
    }
    // Not told yet? Tell them, and record the answer before anything records
    // them.
    if (consent !== "given") {
      setAskingConsent(true);
      return;
    }
    // Already allowed once? Go straight to listening — explaining again would
    // be noise.
    if (micPermission === "granted") {
      void startListening(lang);
      return;
    }
    setAskingMic(true);
  }, [consent, lang, micPermission, recording, startListening, stopListening]);

  const answerConsent = useCallback(
    async (granted: boolean) => {
      setAskingConsent(false);
      try {
        await apiFetch("/api/agent/voice-consent", {
          method: "POST",
          body: JSON.stringify({ granted, lang }),
        });
      } catch {
        // If it could not be recorded, it has not been given. Better to ask
        // again than to record someone on a consent nobody can produce.
        setConsent("absent");
        return;
      }
      setConsent(granted ? "given" : "absent");
      if (granted) {
        if (micPermission === "granted") void startListening(lang);
        else setAskingMic(true);
      }
    },
    [lang, micPermission, startListening],
  );

  const choose = useCallback(
    async (chosen: string) => {
      if (!pendingChoice || inFlight.current) return;
      inFlight.current = true;
      const { taskId: id, field, heard } = pendingChoice;
      setPendingChoice(null);
      setTurns((prev) => [...prev, { role: "user", content: chosen }]);
      setBusy(true);
      stopSpeaking();

      const reply = await post({ action: "resolve", taskId: id, lang, field, heard, chosen });
      if (reply) {
        taskId.current = reply.taskId;
        say(reply.say);
        if (reply.confirm) {
          setPendingConfirm({ taskId: reply.taskId, summary: reply.confirm.summary });
          speak(reply.confirm.summary.replace(/\s*·\s*/g, ", "), lang);
        } else if (reply.plan) {
          await runPlan(reply);
        }
      } else {
        say(t.failed);
      }
      inFlight.current = false;
      setBusy(false);
    },
    [lang, pendingChoice, post, runPlan, say, speak, stopSpeaking, t],
  );

  const approve = useCallback(async () => {
    // The guard that matters most: this is the tap that authorises a write.
    if (!pendingConfirm || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const reply = await post({ action: "confirm", taskId: pendingConfirm.taskId, lang });
    setPendingConfirm(null);
    if (reply) {
      say(reply.say);
      if (reply.plan) await runPlan(reply);
    } else {
      // The most important silence of the lot: this is the tap that authorises
      // a write. The card has already been cleared above, the owner heard
      // nothing, and they have no way to tell whether their money entry went
      // in - so they enter it again.
      //
      // Nothing was saved, and that is safe to promise: the write itself is a
      // plan this request was supposed to hand back for the browser to run.
      // The card is NOT left up to retry, because confirm is not idempotent -
      // if the request did reach the server the task is already EXECUTING, and
      // a second confirm would throw. Starting over is the honest offer.
      say(t.failed);
    }
    inFlight.current = false;
    setBusy(false);
  }, [pendingConfirm, post, runPlan, say, lang, t]);


  if (!open) {
    return (
      <button
        type="button"
        ref={launcherRef}
        onClick={() => setOpen(true)}
        aria-label={t.title}
        aria-expanded={false}
        className="print-hidden fixed right-4 bottom-4 z-50 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        <Bot className="size-8" />
      </button>
    );
  }

  return (
    // A named region: without one, a screen reader announces this as an
    // unlabelled group of controls floating over the page.
    <div
      ref={panelRef}
      role="region"
      aria-label={t.title}
      // Focusable as a whole so opening can put focus inside it without
      // landing on a control and reading that control instead of the panel.
      tabIndex={-1}
      onKeyDown={(e) => {
        // Escape is the key everyone tries. It must not also close a dialog
        // the assistant opened behind the panel, so it stops here.
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      className="print-hidden fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-3xl border-t bg-card shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[420px] sm:rounded-3xl sm:border"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-lg font-bold">{t.title}</span>
        <div className="flex items-center gap-1">
          {/* The offered set, not a hard-coded three: six more languages exist
              in the strings but are not yet checked by a speaker, so they stay
              out of the picker until AGENT_LANGS_ENABLED says otherwise. See
              i18n.ts. */}
          {offered.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              aria-label={LANG_LABEL[l]}
              className={cn(
                "min-h-9 rounded-lg px-2.5 text-sm font-semibold",
                lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {l.toUpperCase()}
            </button>
          ))}
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* aria-live so a screen reader announces replies as they arrive. Polite
          rather than assertive because the app also speaks every reply through
          the device's own voice — the two will overlap, and interrupting is
          worse than following on. Announcing anyway, because that voice is
          missing for Marathi on many phones and can be silenced. */}
      <div
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3"
        aria-live="polite"
        aria-atomic="false"
      >
        {turns.length === 0 && <p className="py-6 text-center text-muted-foreground">{t.ask}</p>}

        {/* Tappable shortcuts. Offered when there is nothing to read yet, and
            again the moment the model says it cannot talk — these need no
            model at all, so they are the one thing that still works then.
            Someone who cannot read well gets a short list of real options
            rather than a text box and an apology. */}
        {(turns.length === 0 || degraded) && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted-foreground">{t.quick}</p>
            <div className="flex flex-col gap-2">
              {SHORTCUTS.map((shortcut) => (
                <Button
                  key={shortcut.id}
                  size="lg"
                  variant="outline"
                  className="h-12 justify-start text-base"
                  disabled={busy}
                  onClick={() => void run(shortcut.id, inLang(shortcut.label, lang))}
                >
                  {inLang(shortcut.label, lang)}
                </Button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-base",
              turn.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-muted text-foreground",
            )}
          >
            {turn.content}
          </div>
        ))}

        {pendingConfirm && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-3">
            <p className="text-base font-semibold">{pendingConfirm.summary}</p>
            <div className="mt-3 flex gap-2">
              <Button size="lg" className="h-12 flex-1 text-base" onClick={approve} disabled={busy}>
                {t.yes}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 flex-1 text-base"
                onClick={() => setPendingConfirm(null)}
                disabled={busy}
              >
                {t.no}
              </Button>
            </div>
          </div>
        )}

        {pendingChoice && (
          <div className="rounded-2xl border border-primary/40 bg-primary/5 px-3.5 py-3">
            <p className="text-base font-semibold">{t.whichOne}</p>
            <div className="mt-3 flex flex-col gap-2">
              {pendingChoice.choices.map((choice) => (
                <Button
                  key={choice}
                  size="lg"
                  variant="outline"
                  className="h-12 justify-start text-base"
                  disabled={busy}
                  onClick={() => void choose(choice)}
                >
                  {choice}
                </Button>
              ))}
            </div>
          </div>
        )}

        {askingConsent && (
          <div className="rounded-2xl border border-primary/40 bg-primary/5 px-3.5 py-3">
            <p className="text-base font-bold">{inLang(VOICE_NOTICE, lang).title}</p>
            <p className="mt-1 text-base">{inLang(VOICE_NOTICE, lang).body}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button size="lg" className="h-12 text-base" onClick={() => void answerConsent(true)}>
                {inLang(VOICE_NOTICE, lang).accept}
              </Button>
              {/* Declining is a button of the same size, not a close icon:
                  refusing has to be as easy as agreeing. */}
              <Button
                size="lg"
                variant="outline"
                className="h-12 text-base"
                onClick={() => void answerConsent(false)}
              >
                {inLang(VOICE_NOTICE, lang).decline}
              </Button>
            </div>
          </div>
        )}

        {askingMic && (
          <div className="rounded-2xl border border-primary/40 bg-primary/5 px-3.5 py-3">
            <p className="text-base">{t.micWhy}</p>
            <div className="mt-3 flex gap-2">
              <Button
                size="lg"
                className="h-12 flex-1 text-base"
                onClick={() => {
                  setAskingMic(false);
                  void startListening(lang);
                }}
              >
                {t.micAllow}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 flex-1 text-base"
                onClick={() => setAskingMic(false)}
              >
                {t.micLater}
              </Button>
            </div>
          </div>
        )}

        {/* An apology nobody hears is an apology nobody can act on: the mic
            errors all end in "you can type instead", which is the way out. */}
        {listenError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {listenError}
          </p>
        )}
        {/* Without this the panel goes silent while it works and there is no
            way to tell waiting from broken. */}
        <p role="status" className="sr-only">
          {listenState === "recording" ? t.listening : listenState === "transcribing" || busy ? t.thinking : ""}
        </p>
        {(listenState === "transcribing" || busy) && (
          <p aria-hidden="true" className="self-start text-sm text-muted-foreground">
            {t.thinking}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-3">
        <Button
          size="icon-lg"
          variant={recording ? "destructive" : "default"}
          aria-label={recording ? "Stop" : "Speak"}
          className="size-14 shrink-0 rounded-full"
          onClick={onMicTap}
          disabled={busy}
        >
          {recording ? <Square className="size-6" /> : <Mic className="size-7" />}
        </Button>

        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(draft)}
          placeholder={recording ? t.listening : t.ask}
          disabled={busy || recording}
          className="h-12 text-base"
        />

        <Button
          size="icon-lg"
          aria-label="Send"
          className="size-12 shrink-0"
          onClick={() => send(draft)}
          disabled={busy || !draft.trim()}
        >
          <Send className="size-5" />
        </Button>

        {speaking && (
          <Button size="icon-lg" variant="ghost" aria-label="Stop speaking" onClick={stopSpeaking}>
            <Square className="size-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
