# Nex brain: one volume, one startup

Nex is one mind made of parts. Every part's files live on the one network volume (`/workspace`, 100GB, US-CA-2). A manifest says which parts run, and one script starts them in order. Your site only ever calls one endpoint, `nex`.

This replaces nothing yet. `RUNBOOK.md` still describes the first Qwen3-32B-AWQ session. This file is the plan for the next one.

## Chosen base: Qwen3.8-27B

- Dense 27B, Apache 2.0, takes images and video, 262K native context.
- Qwen reports Vision2Web (site from a visual) 62.9 vs 45.0 for Qwen3.6-27B. Scores are vendor-reported: run our own one-prompt site builds on it and on Qwen3-32B-AWQ before retiring the old model.
- Official model: `Qwen/Qwen3.8-27B` (bf16, about 55GB). Serve it with `--quantization fp8` so vLLM compresses it on load (about 28-30GB in GPU memory). No third-party quantized repo is needed.
- Thinking is on by default and uses about 2x the tokens of 3.6. The manifest turns it off for fast site builds. Switch a part to `"thinking": true` for harder jobs.

## Volume layout

```
/workspace/
  venv/        pinned vLLM install (see below)
  hf/          Hugging Face cache (HF_HOME)
  models/      qwen3.8-27b/   qwen3-32b-awq/   (one folder per base model)
  adapters/    <skill>/<version>/   small LoRAs, one per Nex skill
  brain/       manifest.json  start.sh  stop.sh  health.sh  run/
  training/    data packs, runs, checkpoints
  logs/
```

Space check: the 100GB volume holds the bf16 Qwen3.8-27B (about 55GB), the old 32B-AWQ (about 20GB) and the vLLM environment (10-15GB). That is tight. Once Qwen3.8-27B passes the side-by-side test, remove `models/qwen3-32b-awq`. Full-precision training copies will not fit without growing the volume.

## First-time setup (pod terminal)

```bash
source /workspace/venv/bin/activate
export HF_HOME=/workspace/hf
hf download Qwen/Qwen3.8-27B --local-dir /workspace/models/qwen3.8-27b
mkdir -p /workspace/brain /workspace/logs /workspace/adapters /workspace/training
# copy pod/brain/* from this repo into /workspace/brain/ and chmod +x *.sh
```

Pin the vLLM version in the venv (`pip install vllm==<version>`) and write the version here. The Qwen3.6 recipe needs vLLM 0.17.0 or later; check the Qwen3.8-27B model card for its requirement before you pick the pin. The pods today use `vllm/vllm-openai:latest`, which can change under you: use the venv or pin the image tag, not `latest`.

## Start, check, stop

```bash
export NEX_POD_KEY=...        # from the RunPod secret, never pasted in chat
bash /workspace/brain/start.sh
bash /workspace/brain/health.sh
bash /workspace/brain/stop.sh   # before stopping the pod
```

`start.sh` reads `manifest.json` and starts parts one at a time, in order. vLLM measures free GPU memory when it starts, so parts must not start together. It waits for each part's `/health` check before starting the next, and stops with an error if one does not come up in 10 minutes. Logs go to `/workspace/logs/<part>.log`.

To start on pod boot, put `bash /workspace/brain/start.sh` in the RunPod template's start command (after the pod key is set as a secret).

## Adding a part

Add an entry to `manifest.json` with its own `name`, `model` folder, `port` and `gpu_mem`. The `gpu_mem` values of all enabled parts must add up to 0.90 or less. LoRA adapters for skills go under `adapters/` and are served on the part whose base model they were trained on. Adapters cannot move between different base models.

## Parsers and flags to verify

The Qwen3.6 vLLM recipe uses `--reasoning-parser qwen3` and `--tool-call-parser qwen3_coder`. The Qwen3.8-27B card does not list parser flags, so confirm these on the first start (test one tool call) before relying on them. The old runbook's `hermes` parser is for the older Qwen3 line.

## Not done here

- No hosting for customer agents, credit ledger or metering. Agent payments stay off (`WAITLIST_AGENT_PAYMENTS`) until hosting exists.
- No router between parts yet: the first start is one part (`nex`).
- RunPod balance was below zero at last check, so nothing can start until it is topped up.
