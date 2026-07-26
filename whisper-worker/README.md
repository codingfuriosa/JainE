# JAIN-E Whisper transcription worker

Self-hosted transcription for **offline meeting recordings**. The JAIN-E portal records an
in-person meeting on the organiser's device, uploads the audio, and marks the log
`transcript_status = 'processing'`. This worker — running on **your own always-on machine** —
picks those up, transcribes them locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(Hindi / English / Bengali, auto-detected, incl. code-mixing), and writes the transcript back.

No per-minute fees. Audio is fetched over a short-lived signed URL; the worker never holds any
AWS or Supabase service keys — only the shared `WORKER_SECRET`.

```
JAIN-E portal ──upload audio──▶ Supabase (meeting_logs: processing)
                                      ▲                │
                                      │ transcript     │ signed audio URL + job
                                      └──── this worker ◀┘  (faster-whisper on your machine)
```

## 1. Machine

- **Any always-on PC/server.** A CUDA **GPU** transcribes a 1-hour meeting in a few minutes;
  **CPU-only** works too but is slower (fine as overnight/low-volume batch). A phone/tablet can't
  be the worker — those are only for *recording*.
- Install **Python 3.9+** and **ffmpeg** (faster-whisper needs ffmpeg on PATH).

## 2. Set the shared secret in Supabase (one time)

Pick a long random string and set it as a secret on the JAIN-E project so the edge function and
this worker agree:

```
supabase secrets set WORKER_SECRET="<your-long-random-string>" --project-ref rkxsgtauigjrpcjkmccu
```

(or add `WORKER_SECRET` under Project → Edge Functions → Secrets in the Supabase dashboard).
Put the **same** value in this worker's `.env`.

## 3. Install & configure

```bash
cd whisper-worker
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # then edit .env: set WORKER_SECRET (must match step 2)
```

GPU users: install a CUDA-enabled CTranslate2/cuDNN per the faster-whisper README, and set
`WHISPER_DEVICE=cuda` in `.env`.

## 4. Run

```bash
# load .env then start (Linux/mac):
set -a; . ./.env; set +a
python worker.py
```

Leave it running. It polls every `POLL_SECONDS`, transcribes any pending recordings, and posts
the text back — it appears automatically on the meeting's log page in the portal.

### Keep it running (optional)

- **Linux:** a `systemd` service (Restart=always) or `tmux`/`screen`.
- **Windows:** Task Scheduler ("At log on", restart on failure) or [NSSM](https://nssm.cc/).

## Model choice

| WHISPER_MODEL | Quality | Speed |
|---|---|---|
| `large-v3` (default) | Best for Hindi/Bengali/code-mixing | Slow on CPU, fast on GPU |
| `medium` | Good | ~2× faster |
| `small` | OK for clean English | Fast even on CPU |

Start with `large-v3` on a GPU box. On a CPU-only machine, try `small` or `medium` if `large-v3`
is too slow for your volume.

## Notes

- Recording quality depends on the device mic being near the speakers — see the in-app hint.
- If a recording fails to transcribe, the log is marked `failed` and shows a note; the audio is
  still on the log page for manual playback.
