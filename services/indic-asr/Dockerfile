# Hindi and Marathi speech to text, as one container.
#
# Builds on both x86_64 and arm64 — the arm64 case is the one that matters,
# because the free host this is aimed at (Oracle Cloud's Always Free tier) is
# ARM, and that is also what makes it free rather than a 12-month trial.
#
#   docker build -t indic-asr .
#   docker run -d --restart unless-stopped -p 8081:8081 \
#     -e HF_TOKEN=hf_... -e INDIC_ASR_TOKEN=<a long random string> \
#     -v indic-models:/models indic-asr
FROM python:3.12-slim

# curl for the healthcheck below; nothing else is needed at runtime because
# PyAV carries its own ffmpeg.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# The CPU wheel on purpose. The model runs at 0.12x realtime on CPU, so a GPU
# buys nothing here, and the CUDA build would add ~2.3 GB to the image.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
      --extra-index-url https://download.pytorch.org/whl/cpu

COPY app.py .

# Weights live on a volume, not in the image: 2.4 GB baked into a layer is slow
# to push, slow to pull, and has to be rebuilt to update. Mounted, the first
# start downloads them once and every later start reuses them.
ENV HF_HOME=/models
VOLUME ["/models"]

ENV INDIC_ASR_MODE=rnnt
EXPOSE 8081

# Reports unhealthy until the weights are actually in memory. A process that is
# up but cannot transcribe is not healthy to the only caller it has.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8081/health | grep -q '"status":"ok"' || exit 1

# One worker. The model is ~2.9 GB resident and workers do not share it, so a
# second worker doubles the memory for a service that is answering one person
# at a time.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8081", "--workers", "1"]
