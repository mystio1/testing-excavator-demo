# Running this for free, in production

## Why it cannot go on Render's free tier

Measured on the real thing:

| | needs | Render free gives |
|---|---|---|
| RAM | **2.9 GB** | 512 MB |
| Disk | 2.4 GB | ephemeral |

Six times over the memory limit. Quantising the model would roughly halve it
and still not fit, so there is no tuning that rescues this.

**The app does not have to host it.** `INDIC_ASR_URL` is just a URL — the web
app stays on Render free and calls the sidecar wherever it lives. So the
question is only where a 3 GB process can live for nothing.

## Where it can live for free

| option | RAM | always on? | catch |
|---|---|---|---|
| **Oracle Cloud Always Free** | 24 GB | yes | ARM; card needed to verify identity (not charged); A1 capacity is scarce in some regions |
| Your own laptop + Cloudflare Tunnel | yours | only while it is on | fine for a pilot, not for customers |
| Hugging Face Spaces | 16 GB | no | **no longer free** — Gradio and Docker Spaces need PRO; only ZeroGPU Gradio Spaces remain free |
| AWS / Azure / GCP free | 1 GB | yes | too small, and the good tiers expire after 12 months |

Oracle's Always Free ARM instance is the only one that is both big enough and
free permanently. Up to 4 cores and 24 GB — this service needs one core and
3 GB, so one instance has room for this and plenty else.

## Oracle Cloud, start to finish

**1. Make the instance.** In the Oracle Cloud console: Compute → Instances →
Create. Change the image and shape to **Ampere (ARM)**, `VM.Standard.A1.Flex`,
with 1 OCPU and 6 GB (inside the Always Free allowance of 4 OCPU / 24 GB).
Choose Ubuntu. Download the SSH key it offers.

> If it says "out of capacity", try another availability domain or region —
> A1 is popular. It is worth retrying; nothing else on this list is free and
> big enough.

**2. Open the port.** Two places, and missing either one looks identical to a
broken service:

- the VCN's security list: add an ingress rule for TCP 8081
- the instance's own firewall:
  ```bash
  sudo iptables -I INPUT 6 -p tcp --dport 8081 -j ACCEPT
  sudo netfilter-persistent save
  ```

**3. Install Docker and run it.**

```bash
sudo apt update && sudo apt install -y docker.io git
sudo usermod -aG docker $USER && newgrp docker

git clone <your repo> excavator && cd excavator/services/indic-asr
docker build -t indic-asr .

# A long random string. Generate it, do not invent it.
TOKEN=$(openssl rand -hex 32)
echo "INDIC_ASR_TOKEN=$TOKEN"     # copy this into the app's .env

docker run -d --name indic-asr --restart unless-stopped \
  -p 8081:8081 \
  -e HF_TOKEN=hf_...  \
  -e INDIC_ASR_TOKEN="$TOKEN" \
  -v indic-models:/models \
  indic-asr
```

First start downloads ~2.4 GB of weights into the `indic-models` volume and
takes a few minutes. `--restart unless-stopped` brings it back after a reboot,
and the volume means it does not download again.

**4. Point the app at it.** In Render's environment settings:

```
INDIC_ASR_URL=http://<instance-public-ip>:8081
INDIC_ASR_TOKEN=<the same token>
INDIC_ASR_LANGS=hi,mr
```

**5. Check it.**

```bash
curl http://<ip>:8081/health
# {"status":"ok","secured":true,...}
```

`secured: true` is the one to look for. Without the token the service is open
to whoever finds the address, and on a free instance one abuser is the whole
instance.

## Put TLS in front of it before real customers

Plain HTTP across the internet sends the owner's recorded voice in clear, and
the bearer token with it. For a pilot that is a considered risk; for customers
it is not. The free fix is a Cloudflare Tunnel on the instance, which gives an
HTTPS hostname and means port 8081 never has to be open at all:

```bash
cloudflared tunnel --url http://localhost:8081
```

Then set `INDIC_ASR_URL` to the `https://...trycloudflare.com` address it
prints. A named tunnel (also free) gives a stable hostname instead of a
throwaway one.

## If you skip all of this

Leave `INDIC_ASR_URL` unset in production. Hindi and Marathi fall back to
Whisper, the app behaves exactly as it did before any of this existed, and
nothing breaks — Marathi is simply worse (WER 0.653 against 0.067). That is a
legitimate place to stop until there is a customer whose Marathi it has to get
right.
