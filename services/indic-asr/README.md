# Hindi and Marathi speech to text

AI4Bharat's [IndicConformer 600M](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual),
run beside the app and called over HTTP.

## Why

Whisper is good at English and bad at Marathi. Measured on 12 Marathi clips
with reference transcripts (`ylacombe/google-marathi`), scored by word error
rate:

| engine | WER | speed |
|---|---|---|
| **IndicConformer RNNT** | **0.067** | 0.12× realtime (CPU) |
| IndicConformer CTC | 0.101 | 0.07× realtime (CPU) |
| Whisper large-v3 | 0.653 | 0.19× realtime (network) |

About **ten times fewer errors**, and faster despite running locally on a CPU.

It is not only spelling. Whisper drops words and drifts into Hindi:

```
reference : आज लंडनमध्ये कमाल तापमान पंचवीस अंश सेल्सिअस असेल असा अंदाज आहे
IndicConf : आज लंडनमध्ये कमाल तापमान पंचवीस अंश सेल्सिअस असेल असा अंदाज आहे   ← exact
Whisper   : आज लंडव मदे कमाल तपमन 25 सिल्सियस असर असानदाजा है                ← 91% wrong
```

That last word is the giveaway: `है` is Hindi, the speaker said Marathi `आहे`.

## Why it is a separate service

The encoder and decoders are ONNX, but the feature front-end ships as
`assets/preprocessor.ts` — **TorchScript**, not TypeScript — so inference needs
PyTorch. Reimplementing NeMo's mel front-end in JavaScript would remove this
service, and would silently produce garbage if a window function or a
normalisation differed. Not worth it for one HTTP hop.

## Running it

The model is gated. Once, on the account whose token you will use: open the
[model page](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual)
signed in and accept the conditions (auto-approved). Then create a **Read**
token — a fine-grained token scoped to your own namespace will not work, since
the model lives under `ai4bharat`.

```bash
cd services/indic-asr
python -m venv .venv && . .venv/Scripts/activate      # Windows
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

HF_TOKEN=hf_... uvicorn app:app --host 127.0.0.1 --port 8081
```

First start downloads ~2.5 GB into the HuggingFace cache and takes a couple of
minutes; later starts reuse it and load in about 15 seconds. The model is
loaded at startup on purpose, so nobody's first spoken instruction pays for it.

Then point the app at it, in `.env`:

```
INDIC_ASR_URL=http://127.0.0.1:8081
INDIC_ASR_LANGS=hi,mr
```

## Checking it

```bash
curl http://127.0.0.1:8081/health

curl -X POST http://127.0.0.1:8081/transcribe \
  -F "audio=@clip.webm;filename=speech.webm" -F "lang=mr"
```

Browser recordings (webm/opus from Chrome and Firefox, mp4 from Safari) are
decoded by PyAV, which ships its own ffmpeg — nothing needs installing on the
host. WAV goes through soundfile.

## What the app does with it

`src/lib/agent/transcribe.ts` picks the engine per language. English stays on
Whisper. Hindi and Marathi come here **when `INDIC_ASR_URL` is set and this
service answers**; if it is unset, slow, down or erroring, the app uses Whisper
instead and the turn continues.

That fallback is deliberate. A worse transcript is recoverable — the values are
read aloud for approval before anything is written. No transcript at all, in a
yard, ends the conversation.

One thing this engine cannot do that Whisper can: take a vocabulary prompt. The
app compensates after the fact — `script.ts` folds Devanagari and Latin into one
comparable form so "कोमात्सु" still matches a record stored as "Komatsu PC200",
and `aliases.ts` remembers corrections the owner has already made.

## Deploying it

It needs roughly 3 GB of RAM and 2.5 GB of disk for the weights, and no GPU.
That does not fit the smallest instance tiers. Options, cheapest first: run it
only where Hindi and Marathi are actually used; put it on one small always-on
box shared by every tenant; or leave `INDIC_ASR_URL` unset in environments
where the extra instance is not worth it — the app degrades to exactly its
previous behaviour.

## Reproducing the benchmark

The harness that produced the table above is not checked in, because it pulls
clips from a dataset server and spends Groq credit. It is short: fetch N clips
with their reference transcripts, run each through `/transcribe` and through
Groq's Whisper with the same parameters the app uses, and score both with word
error rate (Levenshtein over words, punctuation stripped).
