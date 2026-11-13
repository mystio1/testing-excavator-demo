"""
Speech to text for Hindi and Marathi, using AI4Bharat's IndicConformer.

Why this exists as a separate service
-------------------------------------
The app is Next.js. This model is ONNX for the encoder and decoders, but its
feature front-end is a TorchScript module (`assets/preprocessor.ts` — that is
TorchScript, not TypeScript), so inference needs PyTorch. Rather than reimplement
NeMo's mel front-end in JavaScript and risk silently wrong features, the model
runs where it was meant to and the app calls it over HTTP.

Why it is worth the extra moving part
-------------------------------------
Measured on 12 Marathi clips against reference transcripts:

    IndicConformer RNNT   WER 0.067      0.12x realtime (CPU)
    IndicConformer CTC    WER 0.101      0.07x realtime (CPU)
    Whisper large-v3      WER 0.653      0.19x realtime (network)

Roughly ten times fewer errors, and faster. Whisper does not merely misspell
Marathi; it drops words and drifts into Hindi ("है" for "आहे").

Running it
----------
    pip install -r requirements.txt
    HF_TOKEN=hf_... uvicorn app:app --host 127.0.0.1 --port 8081

The model is gated: the account behind HF_TOKEN must have accepted the terms
at https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual once.
First start downloads ~2.5 GB into the HuggingFace cache; later starts reuse it.
"""

from __future__ import annotations

import io
import logging
import os
import time

import numpy as np
import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

MODEL_ID = os.environ.get("INDIC_ASR_MODEL", "ai4bharat/indic-conformer-600m-multilingual")

#: RNNT scored 0.067 against CTC's 0.101 on the benchmark above. CTC is roughly
#: twice as fast, but both are a fraction of realtime, and on a spoken
#: instruction that decides what gets written to a yard's books, accuracy is
#: worth more than half a second.
DEFAULT_MODE = os.environ.get("INDIC_ASR_MODE", "rnnt")

#: What the model was trained on, and what the app sends.
SAMPLE_RATE = 16_000

#: The languages this service is for. The app keeps English on Whisper, which
#: is better at it and costs nothing extra there.
SUPPORTED = {"hi", "mr", "gu", "ta", "te", "kn", "bn", "pa"}

#: A spoken instruction is seconds long. This is a ceiling on a stuck request.
MAX_SECONDS = float(os.environ.get("INDIC_ASR_MAX_SECONDS", "60"))

#: Shared secret, required once this is reachable from anywhere but localhost.
#:
#: Without it a public deployment is an open speech-to-text service: anybody
#: who finds the address can spend the CPU, and on a free instance that is the
#: whole instance. Unset is allowed deliberately, because binding to 127.0.0.1
#: on a developer machine needs no token and demanding one there would just get
#: it written into a script.
AUTH_TOKEN = os.environ.get("INDIC_ASR_TOKEN", "")


def _check(authorization: str | None) -> None:
    """Constant-time comparison: a token checked with == leaks its length and,
    slowly, its contents."""
    if not AUTH_TOKEN:
        return
    import hmac

    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not hmac.compare_digest(supplied, AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="not authorised")

log = logging.getLogger("indic-asr")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="IndicConformer ASR", version="1.0")

_model = None
_loaded_at: float | None = None


def _load():
    """Load once, on the first request or at startup — never per request."""
    global _model, _loaded_at
    if _model is None:
        from transformers import AutoModel

        started = time.time()
        log.info("loading %s ...", MODEL_ID)
        model = AutoModel.from_pretrained(MODEL_ID, trust_remote_code=True)
        model.eval()
        _model = model
        _loaded_at = time.time()
        log.info("loaded in %.1fs", _loaded_at - started)
    return _model


@app.on_event("startup")
def _warm() -> None:
    """Pay the load cost at boot, not on somebody's first spoken instruction."""
    try:
        _load()
    except Exception:  # noqa: BLE001
        # Deliberately not fatal: the app falls back to Whisper when this
        # service cannot answer, so a failure here degrades rather than breaks.
        log.exception("could not load the model at startup; will retry per request")


def _decode(raw: bytes, filename: str) -> np.ndarray:
    """
    Browser audio to 16 kHz mono float32.

    Browsers record webm/opus (Chrome, Firefox) or mp4 (Safari), neither of
    which soundfile can read, so PyAV does the decoding — it ships its own
    ffmpeg and needs nothing installed on the host. WAV still goes through
    soundfile, which is cheaper and is what the benchmark used.
    """
    if filename.lower().endswith(".wav"):
        import soundfile as sf

        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
    else:
        import av

        with av.open(io.BytesIO(raw)) as container:
            stream = next((s for s in container.streams if s.type == "audio"), None)
            if stream is None:
                raise HTTPException(status_code=400, detail="no audio stream in that file")
            sr = stream.codec_context.sample_rate
            chunks = []
            for frame in container.decode(stream):
                arr = frame.to_ndarray()
                # PyAV gives (channels, samples) for planar, (1, n*channels) packed.
                if arr.ndim == 2 and arr.shape[0] > 1:
                    arr = arr.mean(axis=0)
                chunks.append(np.asarray(arr, dtype=np.float32).reshape(-1))
            if not chunks:
                raise HTTPException(status_code=400, detail="that recording held no audio")
            mono = np.concatenate(chunks)
            # Integer PCM arrives unscaled; the model wants -1..1.
            if np.issubdtype(mono.dtype, np.integer) or np.max(np.abs(mono)) > 1.5:
                mono = mono / 32768.0

    if sr != SAMPLE_RATE:
        import torchaudio

        mono = (
            torchaudio.functional.resample(torch.from_numpy(mono).float(), sr, SAMPLE_RATE)
            .numpy()
        )
    return np.ascontiguousarray(mono, dtype=np.float32)


@app.get("/health")
def health() -> JSONResponse:
    """Liveness plus whether the weights are actually in memory, because a
    process that is up but cannot transcribe is not healthy for this caller."""
    return JSONResponse(
        {
            "status": "ok" if _model is not None else "loading",
            "secured": bool(AUTH_TOKEN),
            "model": MODEL_ID,
            "mode": DEFAULT_MODE,
            "languages": sorted(SUPPORTED),
        }
    )


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    lang: str = Form(...),
    mode: str | None = Form(None),
    authorization: str | None = Header(None),
) -> JSONResponse:
    _check(authorization)
    lang = (lang or "").lower().strip()
    if lang not in SUPPORTED:
        raise HTTPException(status_code=400, detail=f"language {lang!r} is not served here")

    decoding = (mode or DEFAULT_MODE).lower()
    if decoding not in ("ctc", "rnnt"):
        raise HTTPException(status_code=400, detail="mode must be ctc or rnnt")

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="the recording was empty")

    started = time.time()
    samples = _decode(raw, audio.filename or "speech.webm")
    seconds = len(samples) / SAMPLE_RATE
    if seconds > MAX_SECONDS:
        raise HTTPException(status_code=400, detail="that recording is too long")
    # Below this there is no speech, only container. Answering "" is honest and
    # the panel already knows how to say "I didn't catch that" kindly.
    if seconds < 0.2:
        return JSONResponse({"text": "", "lang": lang, "mode": decoding, "seconds": seconds})

    model = _load()
    wav = torch.from_numpy(samples).unsqueeze(0)
    with torch.no_grad():
        text = model(wav, lang, decoding)
    if isinstance(text, (list, tuple)):
        text = text[0] if text else ""

    took = time.time() - started
    log.info("transcribed %.1fs of %s in %.2fs (%s)", seconds, lang, took, decoding)
    return JSONResponse(
        {
            "text": str(text).strip(),
            "lang": lang,
            "mode": decoding,
            "seconds": round(seconds, 2),
            "ms": round(took * 1000),
        }
    )
