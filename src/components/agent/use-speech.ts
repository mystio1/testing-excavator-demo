"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Capacitor } from "@capacitor/core";

import { apiUrl } from "@/lib/api-client";
import { MAX_RECORDING_MS as BUDGET_MAX_RECORDING_MS } from "@/lib/agent/budget";
import { BCP47, say, type AgentLang, type Localized } from "@/lib/agent/i18n";

/**
 * Speech, behind adapters so the provider can change without touching the
 * agent.
 *
 * Listening records a short clip and sends it to the server, which forwards it
 * to Whisper. It is done that way for one reason: the key stays on the server.
 * The browser's own SpeechRecognition would be free, but it is Chrome-only, it
 * ships audio to Google regardless, and its Marathi is poor.
 *
 * Speaking uses the browser's built-in voice. It costs nothing, works offline,
 * and the audio never leaves the phone — which also settles the "don't retain
 * recordings" question for the reply half entirely.
 */

/**
 * One language union for the whole assistant.
 *
 * It used to be its own three-value type, which quietly meant the panel could
 * offer a language the speech layer had never heard of. Aliased rather than
 * renamed because every call site already says SpeechLang.
 */
export type SpeechLang = AgentLang;

export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const speak = useCallback(
    (text: string, lang: SpeechLang) => {
      if (!supported || !text.trim()) return;
      // Whatever was mid-sentence is now stale; the newest answer wins.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = BCP47[lang];
      // A shade slower than default: these are numbers and names being read to
      // someone who may be in a noisy yard.
      utterance.rate = 0.95;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      // Marathi is missing on many devices. Falling back to a Hindi voice is
      // far more intelligible to a Marathi speaker than a default English one
      // reading Devanagari.
      const voices = window.speechSynthesis.getVoices();
      const exact = voices.find((v) => v.lang === BCP47[lang]);
      const fallback = lang === "mr" ? voices.find((v) => v.lang === "hi-IN") : undefined;
      if (exact ?? fallback) utterance.voice = (exact ?? fallback)!;

      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  useEffect(() => stop, [stop]);

  return { speak, stop, speaking, supported };
}

/**
 * Cut the device off mid-sentence.
 *
 * Reaches the same global the speaking hook uses, so it works whichever part
 * of the app happens to be talking — and tapping the microphone while the
 * assistant is still reading an answer is the ordinary way an owner interrupts
 * it. Guarded because a WebView without speech synthesis should not throw here.
 */
function silenceAnySpeech(): void {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch {
    /* a device that cannot speak has nothing to silence */
  }
}

export type ListenState = "idle" | "asking" | "recording" | "transcribing" | "error";

/** Spoken-to in their own language, errors included — an English apology in a
 * Hindi panel is exactly the moment someone decides the thing is not for them. */
const MIC_ERRORS: Localized<Record<"blocked" | "missing" | "failed" | "unheard" | "unsupported", string>> = {
  en: {
    blocked:
      "The microphone is blocked. Tap the lock icon next to the web address, allow the microphone, then try again. You can also just type.",
    missing: "No microphone was found on this device. You can still type.",
    failed: "The microphone would not start. You can still type.",
    unheard: "I didn't catch that. Please say it again.",
    unsupported: "This device cannot record audio. You can still type.",
  },
  hi: {
    blocked:
      "माइक बंद है. पते के पास वाले ताले के निशान पर दबाकर माइक चालू करें, फिर दोबारा कोशिश करें. आप लिखकर भी बता सकते हैं.",
    missing: "इस फ़ोन में माइक नहीं मिला. आप लिखकर बता सकते हैं.",
    failed: "माइक चालू नहीं हुआ. आप लिखकर बता सकते हैं.",
    unheard: "मैं सुन नहीं पाया. कृपया फिर से बोलें.",
    unsupported: "इस फ़ोन में आवाज़ रिकॉर्ड नहीं हो सकती. आप लिखकर बता सकते हैं.",
  },
  mr: {
    blocked:
      "माइक बंद आहे. पत्त्याजवळच्या कुलपाच्या चिन्हावर दाबून माइक सुरू करा, मग पुन्हा प्रयत्न करा. तुम्ही टाइपही करू शकता.",
    missing: "या फोनमध्ये माइक सापडला नाही. तुम्ही टाइप करू शकता.",
    failed: "माइक सुरू झाला नाही. तुम्ही टाइप करू शकता.",
    unheard: "मला ऐकू आले नाही. कृपया पुन्हा बोला.",
    unsupported: "या फोनमध्ये आवाज रेकॉर्ड होऊ शकत नाही. तुम्ही टाइप करू शकता.",
  },
  gu: {
      "blocked": "માઇક બંધ છે. સરનામા પાસેના તાળાના નિશાન પર દબાવી માઇક ચાલુ કરો, પછી ફરી પ્રયત્ન કરો. તમે લખીને પણ કહી શકો છો.",
      "missing": "આ ફોનમાં માઇક મળ્યો નહીં. તમે લખીને કહી શકો છો.",
      "failed": "માઇક ચાલુ થયો નહીં. તમે લખીને કહી શકો છો.",
      "unheard": "મને સંભળાયું નહીં. કૃપા કરી ફરી બોલો.",
      "unsupported": "આ ફોનમાં આવાજ રેકોર્ડ થઈ શકતો નથી. તમે લખીને કહી શકો છો."
  },
  ta: {
      "blocked": "மைக் அடைக்கப்பட்டுள்ளது. முகவரிக்கு அருகில் உள்ள பூட்டு அடையாளத்தை அழுத்தி மைக்கை அனுமதித்து, மீண்டும் முயற்சிக்கவும். நீங்கள் தட்டச்சு செய்யவும் முடியும்.",
      "missing": "இந்த ஃபோனில் மைக் கிடைக்கவில்லை. நீங்கள் தட்டச்சு செய்யலாம்.",
      "failed": "மைக் இயங்கவில்லை. நீங்கள் தட்டச்சு செய்யலாம்.",
      "unheard": "எனக்குக் கேட்கவில்லை. மீண்டும் சொல்லுங்கள்.",
      "unsupported": "இந்த ஃபோனில் ஒலி பதிவு செய்ய முடியாது. நீங்கள் தட்டச்சு செய்யலாம்."
  },
  te: {
      "blocked": "మైక్ ఆఫ్ ఉంది. చిరునామా పక్కనున్న తాళం గుర్తుపై నొక్కి మైక్ అనుమతించి, మళ్ళీ ప్రయత్నించండి. మీరు టైప్ చేసి కూడా చెప్పవచ్చు.",
      "missing": "ఈ ఫోన్లో మైక్ దొరకలేదు. మీరు టైప్ చేసి చెప్పవచ్చు.",
      "failed": "మైక్ ప్రారంభం కాలేదు. మీరు టైప్ చేసి చెప్పవచ్చు.",
      "unheard": "నాకు వినిపించలేదు. దయచేసి మళ్ళీ చెప్పండి.",
      "unsupported": "ఈ ఫోన్లో ఆడియో రికార్డ్ కాదు. మీరు టైప్ చేసి చెప్పవచ్చు."
  },
  kn: {
      "blocked": "ಮೈಕ್ ಬಂದ್ ಆಗಿದೆ. ವಿಳಾಸದ ಪಕ್ಕದ ಬೀಗದ ಗುರುತನ್ನು ಒತ್ತಿ ಮೈಕ್ ಅನುಮತಿಸಿ, ನಂತರ ಪುನಃ ಪ್ರಯತ್ನಿಸಿ. ನೀವು ಟೈಪ್ ಮಾಡಿಯೂ ಹೇಳಬಹುದು.",
      "missing": "ಈ ಫೋನ್‌ನಲ್ಲಿ ಮೈಕ್ ಸಿಗಲಿಲ್ಲ. ನೀವು ಟೈಪ್ ಮಾಡಿ ಹೇಳಬಹುದು.",
      "failed": "ಮೈಕ್ ಪ್ರಾರಂಭವಾಗಲಿಲ್ಲ. ನೀವು ಟೈಪ್ ಮಾಡಿ ಹೇಳಬಹುದು.",
      "unheard": "ನನಗೆ ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಪುನಃ ಹೇಳಿ.",
      "unsupported": "ಈ ಫೋನ್‌ನಲ್ಲಿ ಧ್ವನಿ ದಾಖಲಾಗುವುದಿಲ್ಲ. ನೀವು ಟೈಪ್ ಮಾಡಿ ಹೇಳಬಹುದು."
  },
  bn: {
      "blocked": "মাইক বন্ধ আছে। ঠিকানার পাশের তালার চিহ্নে চেপে মাইক চালু করুন, তারপর আবার চেষ্টা করুন। আপনি লিখেও বলতে পারেন।",
      "missing": "এই ফোনে মাইক পাওয়া যায়নি। আপনি লিখে বলতে পারেন।",
      "failed": "মাইক চালু হয়নি। আপনি লিখে বলতে পারেন।",
      "unheard": "আমি শুনতে পাইনি। দয়া করে আবার বলুন।",
      "unsupported": "এই ফোনে আওয়াজ রেকর্ড হতে পারে না। আপনি লিখে বলতে পারেন।"
  },
  pa: {
      "blocked": "ਮਾਈਕ ਬੰਦ ਹੈ। ਪਤੇ ਦੇ ਕੋਲ ਵਾਲੇ ਜਿੰਦਰੇ ਦੇ ਨਿਸ਼ਾਨ 'ਤੇ ਦਬਾ ਕੇ ਮਾਈਕ ਚਾਲੂ ਕਰੋ, ਫਿਰ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ। ਤੁਸੀਂ ਲਿਖ ਕੇ ਵੀ ਦੱਸ ਸਕਦੇ ਹੋ।",
      "missing": "ਇਸ ਫ਼ੋਨ ਵਿੱਚ ਮਾਈਕ ਨਹੀਂ ਮਿਲਿਆ। ਤੁਸੀਂ ਲਿਖ ਕੇ ਦੱਸ ਸਕਦੇ ਹੋ।",
      "failed": "ਮਾਈਕ ਚਾਲੂ ਨਹੀਂ ਹੋਇਆ। ਤੁਸੀਂ ਲਿਖ ਕੇ ਦੱਸ ਸਕਦੇ ਹੋ।",
      "unheard": "ਮੈਨੂੰ ਸੁਣਿਆ ਨਹੀਂ। ਕਿਰਪਾ ਕਰਕੇ ਫਿਰ ਬੋਲੋ।",
      "unsupported": "ਇਸ ਫ਼ੋਨ ਵਿੱਚ ਆਵਾਜ਼ ਰਿਕਾਰਡ ਨਹੀਂ ਹੋ ਸਕਦੀ। ਤੁਸੀਂ ਲਿਖ ਕੇ ਦੱਸ ਸਕਦੇ ਹੋ।"
  },
};

/** Whether the browser will put up its own permission box, has already said
 * yes, or has a standing no that only the user can undo in site settings. */
export type MicPermission = "unknown" | "granted" | "denied";

/**
 * On Android the OS decides before the WebView ever does.
 *
 * getUserMedia() inside a WebView cannot put up its own prompt: Android checks
 * the app's RECORD_AUDIO permission first and refuses outright without one, so
 * the browser-level prompt never appears. The native plugin asks the OS; on the
 * web this is undefined and the Permissions API answers instead.
 */
type MicPlugin = {
  check(): Promise<{ state: string }>;
  request(): Promise<{ state: string }>;
};

function nativeMic(): MicPlugin | null {
  if (!Capacitor.isNativePlatform()) return null;
  const registered = (Capacitor as unknown as { Plugins?: Record<string, MicPlugin> }).Plugins;
  return registered?.MicPermission ?? null;
}

const asPermission = (state: string): MicPermission =>
  state === "granted" ? "granted" : state === "denied" ? "denied" : "unknown";

export async function checkMicPermission(): Promise<MicPermission> {
  const native = nativeMic();
  if (native) {
    try {
      return asPermission((await native.check()).state);
    } catch {
      return "unknown";
    }
  }
  if (typeof navigator === "undefined" || !navigator.permissions) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted" ? "granted" : status.state === "denied" ? "denied" : "unknown";
  } catch {
    // Firefox and some WebViews do not expose the microphone descriptor. Not
    // knowing is fine — asking will reveal the answer.
    return "unknown";
  }
}

/**
 * Ask the OS, where there is an OS to ask. Returns what the answer was so the
 * caller can tell "they said no" from "there is nothing to ask".
 */
async function requestNativeMic(): Promise<MicPermission | null> {
  const native = nativeMic();
  if (!native) return null;
  try {
    return asPermission((await native.request()).state);
  } catch {
    return "unknown";
  }
}

/**
 * What the microphone is asked for, rather than whatever the browser felt like
 * giving. These are machines idling in a yard, not a quiet room: noise
 * suppression and automatic gain are the difference between a transcript and a
 * guess. Mono because Whisper mixes to mono anyway, and a stereo clip is just
 * twice the upload.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Opus first: it is what Whisper handles best and what Chrome and Firefox
 * produce. Safari and older iOS only do mp4/AAC, which is fine as long as the
 * file is labelled as such — the server names the upload from this type. */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function bestMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Speech at 48 kbps mono opus is already transparent for dictation. Leaving
 * it to the browser gives a different, sometimes much lower, rate per device. */
const AUDIO_BITS_PER_SECOND = 48_000;

/** Nobody dictates an instruction to this app for half a minute, but a mic
 * button left on by accident would run until the 8 MB limit rejects it. */
const MAX_RECORDING_MS = BUDGET_MAX_RECORDING_MS;

/** A tap-tap on the button. There is no instruction in four tenths of a
 * second, and sending it only gives Whisper room to invent a sentence. */
const MIN_RECORDING_MS = 400;

export function useListen(onText: (text: string) => void) {
  const [state, setState] = useState<ListenState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<MicPermission>("unknown");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supported =
    typeof window !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices;

  const stop = useCallback(() => {
    if (limitRef.current) {
      clearTimeout(limitRef.current);
      limitRef.current = null;
    }
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(
    async (lang: SpeechLang) => {
      const msg = say(MIC_ERRORS, lang);
      if (!supported) {
        setError(msg.unsupported);
        setState("error");
        return;
      }
      setError(null);
      // Stop talking before listening — barge-in.
      //
      // Without this the device carries on speaking into the microphone and
      // the clip contains the assistant's own voice, which Whisper then
      // transcribes: at best noise, at worst the assistant's words coming back
      // as if the owner had said them. Done here rather than at the call
      // sites because it is a property of starting to record, and there are
      // three places that start a recording.
      silenceAnySpeech();
      try {
        // The browser's own box can take a moment to appear, and a mic button
        // that looks dead while it does is a button people press again.
        setState("asking");
        // On Android the OS grant has to come first, or getUserMedia is refused
        // with no prompt and the owner is told the microphone is blocked when
        // nobody ever asked them.
        const granted = await requestNativeMic();
        if (granted === "denied") {
          setPermission("denied");
          setError(msg.blocked);
          setState("error");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        setPermission("granted");
        const mimeType = bestMimeType();
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
        });
        recorderRef.current = recorder;
        chunksRef.current = [];
        startedAtRef.current = Date.now();

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          // Release the microphone as soon as we stop: the indicator staying on
          // is alarming, and we have what we need.
          stream.getTracks().forEach((t) => t.stop());
          if (limitRef.current) {
            clearTimeout(limitRef.current);
            limitRef.current = null;
          }

          const spokenFor = Date.now() - startedAtRef.current;
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          chunksRef.current = [];
          if (spokenFor < MIN_RECORDING_MS || blob.size === 0) {
            setState("error");
            setError(msg.unheard);
            return;
          }

          setState("transcribing");
          const form = new FormData();
          // The extension has to match the bytes, or the decode fails in a way
          // that looks like a broken microphone.
          const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
          form.append("audio", blob, `speech.${ext}`);
          form.append("lang", lang);

          try {
            // apiUrl(), not a relative path: on the Android build this origin
            // has no API of its own. A raw fetch rather than apiFetch because
            // the browser must set the multipart boundary itself — apiFetch
            // forces Content-Type: application/json.
            const res = await fetch(apiUrl("/api/agent/listen"), {
              method: "POST",
              body: form,
              credentials: "include",
            });
            if (!res.ok) throw new Error(String(res.status));
            const { text } = (await res.json()) as { text: string };
            // An empty transcript is a real answer: the server screens out
            // text Whisper invented over silence rather than passing it on.
            if (text.trim()) {
              setState("idle");
              onText(text.trim());
            } else {
              setState("error");
              setError(msg.unheard);
            }
          } catch {
            setState("error");
            setError(msg.unheard);
          }
        };

        recorder.start();
        setState("recording");
        limitRef.current = setTimeout(stop, MAX_RECORDING_MS);
      } catch (err) {
        setState("error");
        // A refusal is permanent until the person changes it in site settings,
        // and the browser will not ask again — so saying "allow it" would send
        // them looking for a box that is never coming back.
        const refused = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        const noMic = err instanceof DOMException && err.name === "NotFoundError";
        if (refused) {
          setPermission("denied");
          setError(msg.blocked);
        } else if (noMic) {
          setError(msg.missing);
        } else {
          setError(msg.failed);
        }
      }
    },
    [onText, stop, supported],
  );

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    void checkMicPermission().then(setPermission);
  }, []);

  return { start, stop, state, error, supported, permission };
}
