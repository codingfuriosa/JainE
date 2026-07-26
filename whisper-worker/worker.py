#!/usr/bin/env python3
"""
JAIN-E offline-meeting transcription worker (self-hosted Whisper).

Polls the `whisper-jobs` Supabase edge function for meeting recordings that need
transcribing, runs faster-whisper locally (Hindi / English / Bengali, auto-detected,
including code-mixed speech), and posts the transcript back. Keep this running on an
always-on machine. A GPU makes it fast; CPU works for low volume (slower).

Config comes from environment variables (see .env.example / README.md).
"""
import os
import time
import tempfile
import traceback

import requests
from faster_whisper import WhisperModel

JOBS_URL = os.environ["WHISPER_JOBS_URL"].rstrip("/")   # https://<ref>.supabase.co/functions/v1/whisper-jobs
SECRET   = os.environ["WORKER_SECRET"]                   # must match the WORKER_SECRET set in Supabase
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")       # Supabase publishable/anon key (sent as apikey)
MODEL    = os.environ.get("WHISPER_MODEL", "large-v3")   # large-v3 = best quality; "small"/"medium" = faster
DEVICE   = os.environ.get("WHISPER_DEVICE", "auto")      # auto | cuda | cpu
COMPUTE  = os.environ.get("WHISPER_COMPUTE", "")         # e.g. float16 (GPU) / int8 (CPU); auto-picked if blank
POLL     = int(os.environ.get("POLL_SECONDS", "30"))
BATCH    = int(os.environ.get("JOB_BATCH", "3"))


def pick_device():
    if DEVICE != "auto":
        return DEVICE
    try:
        import torch  # optional, only used to auto-detect a CUDA GPU
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def headers():
    h = {"Content-Type": "application/json"}
    if ANON_KEY:
        h["apikey"] = ANON_KEY
        h["Authorization"] = "Bearer " + ANON_KEY
    return h


def post_result(log_id, text, status):
    try:
        requests.post(JOBS_URL, json={"action": "result", "secret": SECRET,
                                      "log_id": log_id, "transcript": text, "status": status},
                      headers=headers(), timeout=60)
        print(f"[worker]   -> posted {status} for log {log_id}")
    except Exception as e:
        print("[worker] result post error:", e)


def transcribe(model, path):
    # language=None -> auto-detect (handles hi / en / bn and code-mixing). vad_filter trims silence.
    segments, info = model.transcribe(path, vad_filter=True, beam_size=5)
    text = "".join(seg.text for seg in segments).strip()
    return text, getattr(info, "language", "?")


def main():
    device = pick_device()
    compute = COMPUTE or ("float16" if device == "cuda" else "int8")
    print(f"[worker] loading faster-whisper model={MODEL} device={device} compute={compute} ...")
    model = WhisperModel(MODEL, device=device, compute_type=compute)
    print("[worker] ready. polling", JOBS_URL, "every", POLL, "s")
    while True:
        try:
            r = requests.post(JOBS_URL, json={"action": "jobs", "secret": SECRET, "limit": BATCH},
                              headers=headers(), timeout=30)
            jobs = (r.json() or {}).get("jobs", [])
        except Exception as e:
            print("[worker] poll error:", e)
            time.sleep(POLL)
            continue

        if not jobs:
            time.sleep(POLL)
            continue

        for job in jobs:
            log_id = job.get("log_id")
            url = job.get("audio_url")
            print(f"[worker] job log_id={log_id} '{job.get('title')}' ({job.get('occurrence_date')})")
            path = None
            try:
                audio = requests.get(url, timeout=600)
                audio.raise_for_status()
                with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as f:
                    f.write(audio.content)
                    path = f.name
                text, lang = transcribe(model, path)
                print(f"[worker]   detected={lang} chars={len(text)}")
                post_result(log_id, text, "ready")
            except Exception:
                traceback.print_exc()
                post_result(log_id, "", "failed")
            finally:
                if path:
                    try:
                        os.unlink(path)
                    except Exception:
                        pass


if __name__ == "__main__":
    main()
