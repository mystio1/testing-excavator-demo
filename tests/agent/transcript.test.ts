import { describe, expect, it } from "vitest";
import { usableTranscript, type WhisperBody } from "@/lib/agent/transcript";

/**
 * Whisper always writes a sentence, including when nobody said anything. These
 * are the cases where obeying it would invent work the owner never asked for.
 */

/** A confident, ordinary segment — the shape of someone actually speaking. */
const spoken = (text: string): WhisperBody["segments"] => [
  { text, avg_logprob: -0.18, no_speech_prob: 0.02, compression_ratio: 1.4 },
];

describe("what Whisper heard", () => {
  it("passes clear speech through", () => {
    expect(usableTranscript({ text: "x", segments: spoken("JCB ka kaam shuru karo") })).toBe(
      "JCB ka kaam shuru karo",
    );
  });

  it("joins the segments of one sentence", () => {
    const body: WhisperBody = {
      segments: [...spoken("Patil ko do hazaar"), ...spoken("advance diya")],
    };
    expect(usableTranscript(body)).toBe("Patil ko do hazaar advance diya");
  });

  it("throws away a sentence invented over silence", () => {
    // An idling engine: Whisper is sure there was no speech, and unsure of the
    // words it wrote regardless.
    const body: WhisperBody = {
      text: "Thank you for watching!",
      segments: [{ text: "Thank you for watching!", avg_logprob: -0.9, no_speech_prob: 0.95, compression_ratio: 1.1 }],
    };
    expect(usableTranscript(body)).toBe("");
  });

  it("throws away a decoder stuck in a loop", () => {
    const body: WhisperBody = {
      segments: [
        {
          text: "ha ha ha ha ha ha ha ha ha ha ha ha",
          avg_logprob: -0.3,
          no_speech_prob: 0.1,
          compression_ratio: 3.8,
        },
      ],
    };
    expect(usableTranscript(body)).toBe("");
  });

  it("throws away gibberish it had no confidence in", () => {
    const body: WhisperBody = {
      segments: [{ text: "mmhm grrr", avg_logprob: -1.6, no_speech_prob: 0.3, compression_ratio: 1.2 }],
    };
    expect(usableTranscript(body)).toBe("");
  });

  it("drops the vocabulary read back at us, which is silence wearing a costume", () => {
    const prompt = "Excavator business voice note: hour meter, diesel litres. Komatsu PC200, Banda Patil.";
    const body: WhisperBody = { segments: spoken("hour meter, diesel litres") };
    expect(usableTranscript(body, prompt)).toBe("");
  });

  it("keeps a one-word answer even though it is in the vocabulary", () => {
    // "Patil" is both a prompted name and a perfectly good reply to "which
    // operator?". Short answers must survive the echo check.
    const prompt = "Excavator business voice note. Komatsu PC200, Banda Patil, Sagar Patil.";
    expect(usableTranscript({ segments: spoken("Patil") }, prompt)).toBe("Patil");
  });

  it("throws away the caption phrase it says when it heard noise", () => {
    // Measured: three seconds of faint engine noise came back exactly like
    // this, with scores a real sentence also reaches. Confidence cannot tell
    // these apart, so the phrase is what gives it away.
    const body: WhisperBody = {
      segments: [{ text: "Thank you.", avg_logprob: -0.67, no_speech_prob: 0.053, compression_ratio: 0.58 }],
    };
    expect(usableTranscript(body)).toBe("");
  });

  it("throws away the Hindi and Marathi versions of the same phantom", () => {
    expect(usableTranscript({ segments: spoken("देखने के लिए धन्यवाद") })).toBe("");
    expect(usableTranscript({ segments: spoken("पाहिल्याबद्दल धन्यवाद") })).toBe("");
  });

  it("throws away subtitle credits, however they are worded", () => {
    expect(usableTranscript({ segments: spoken("Subtitles by the Amara.org community") })).toBe("");
  });

  it("keeps a thank-you that is part of a real sentence", () => {
    // Only the whole clip being a phantom means anything. Inside a sentence
    // these are the owner's words.
    const said = "Patil ko paise de diye, thank you";
    expect(usableTranscript({ segments: spoken(said) })).toBe(said);
  });

  it("never swallows a yes or a no", () => {
    // These are answers to the app's own question. Losing one is worse than
    // letting a stray phantom through.
    for (const answer of ["haan", "yes", "nahi", "ho", "ok"]) {
      expect(usableTranscript({ segments: spoken(answer) })).toBe(answer);
    }
  });

  it("screens the phantom even when the response carried no segments", () => {
    expect(usableTranscript({ text: "Thank you." })).toBe("");
  });

  it("keeps whole-response text when the model sent no segments", () => {
    expect(usableTranscript({ text: "  diesel daal do  " })).toBe("diesel daal do");
  });

  it("is empty, not undefined, when there is nothing at all", () => {
    expect(usableTranscript({})).toBe("");
    expect(usableTranscript({ segments: [] })).toBe("");
  });

  it("keeps the good half of a clip that started in noise", () => {
    const body: WhisperBody = {
      segments: [
        { text: "...", avg_logprob: -0.8, no_speech_prob: 0.9, compression_ratio: 1.0 },
        ...spoken("meter bara sau aath"),
      ],
    };
    expect(usableTranscript(body)).toBe("meter bara sau aath");
  });
});

/**
 * The three hallucinations a live clip of silence actually produced.
 *
 * Every one of these was handed back by whisper-large-v3 for a WAV of 32,000
 * zero samples or of room hiss — see tests/eval/listen.test.ts, which made the
 * calls. They are reproduced here with the confidence numbers Whisper really
 * reported, which is the whole point: those numbers say "this is clear
 * speech", so no threshold can catch these and only the shape of the words
 * can.
 *
 * Before the shape rules, all three got through, and the first one ends
 * "...शुरू करते हैं" — which is how an owner says "start it".
 */
describe("what the live endpoint really invents over silence", () => {
  /** The measured numbers: Whisper is CONFIDENT about each of these. */
  const invented = (text: string, compression = 2.35): WhisperBody["segments"] => [
    { text, avg_logprob: -0.443, no_speech_prob: 0.036, compression_ratio: compression },
  ];

  it("throws away the Hindi sentence it writes over digital silence", () => {
    // 21 words, 10 distinct. compression_ratio 2.35 — just under Whisper's own
    // 2.4 threshold, which is why the provider's own signal missed it.
    const said = "जब आप आपको अपना व्यासाय का व्यासाय का उठान है, तो आपको अपना व्यासाय का उठान में आपको उठान है।";
    expect(usableTranscript({ segments: invented(said) })).toBe("");
  });

  it("throws away a two-word chant from room hiss", () => {
    // compression_ratio was 1.36 here: far too short for a ratio to see the
    // repeat, so counting the words is the only thing that works.
    expect(usableTranscript({ segments: invented("प्रश्न प्रश्न", 1.36) })).toBe("");
  });

  it("throws away the vocabulary handed back with the names misspelt", () => {
    // The dangerous one. Silence produced the owner's own machines, operator,
    // site and customer — the exact values that get matched to records. The
    // old check was prompt.includes(segment) and missed it, because Whisper
    // wrote KOMATO for Komatsu and Saree for Shree, and a near-copy is not a
    // substring.
    const prompt =
      "जेसीबी-पोकलेन व्यवसाय का वॉइस नोट: आवर मीटर, डीजल लीटर. " +
      "Komatsu PC200, Tata Hitachi EX200, Banda Patil, Sagar Jadhav, Hinjawadi Phase 2, Shree Constructions.";
    const said =
      " KOMATO PC200, Tata Hitachi EX200, Banda Patil, Sagar Jadhav, Hinjawadi Phase 2, Saree Constructions.";
    expect(usableTranscript({ segments: invented(said) }, prompt)).toBe("");
  });
});

describe("and what it must still let through", () => {
  const spokenClearly = (text: string): WhisperBody["segments"] => [
    { text, avg_logprob: -0.42, no_speech_prob: 0.05, compression_ratio: 1.6 },
  ];

  /** The same vocabulary the echo rule is measured against. */
  const prompt =
    "जेसीबी-पोकलेन व्यवसाय का वॉइस नोट: आवर मीटर, डीजल लीटर, साइट, कस्टमर, ऑपरेटर. " +
    "Komatsu PC200, Tata Hitachi EX200, Banda Patil, Sagar Jadhav, Hinjawadi Phase 2, Shree Constructions.";

  it("keeps an instruction that names three different records", () => {
    // The closest real sentence to the echo above, and the case that decided
    // the threshold: it is 7 vocabulary words out of 11, because a real
    // instruction has to carry the verbs and particles a name list does not.
    const said = "Banda Patil ko Komatsu PC200 pe Hinjawadi Phase 2 bhejo";
    expect(usableTranscript({ segments: spokenClearly(said) }, prompt)).toBe(said);
  });

  it("keeps a long instruction made mostly of trade words", () => {
    // "site", "operator", "diesel" are all in the prompt's trade vocabulary,
    // so this is the other way the echo rule could have gone wrong.
    const said = "site pe operator ka diesel bees litre daal diya aaj subah";
    expect(usableTranscript({ segments: spokenClearly(said) }, prompt)).toBe(said);
  });

  it("keeps a command the owner said twice because they meant it", () => {
    // Four words, two distinct. People repeat themselves; a decoder loop is
    // long. Dropping this would answer "I didn't catch that" to someone who
    // said it more clearly than usual.
    for (const said of ["band karo band karo", "diesel daal diesel daal", "nahi nahi band karo"]) {
      expect(usableTranscript({ segments: spokenClearly(said) }), said).toBe(said);
    }
  });

  it("keeps an emphatic yes, which is a repeat and not a loop", () => {
    for (const said of ["haan haan", "haan haan haan", "yes yes", "हाँ हाँ"]) {
      expect(usableTranscript({ segments: spokenClearly(said) }), said).toBe(said);
    }
  });

  it("keeps a sentence that repeats a word the way people do", () => {
    // "do" appears twice and "hazaar" once; 8 words, 7 distinct. Normal
    // speech repeats, and the rule has to leave room for it.
    const said = "do hazaar do sau rupaye advance de diya";
    expect(usableTranscript({ segments: spokenClearly(said) }, prompt)).toBe(said);
  });

  it("screens a loop even when the response carried no segments at all", () => {
    // The json (not verbose_json) path had no screening but the phrase list.
    expect(usableTranscript({ text: "प्रश्न प्रश्न" })).toBe("");
    expect(usableTranscript({ text: "diesel daal do" })).toBe("diesel daal do");
  });
});
