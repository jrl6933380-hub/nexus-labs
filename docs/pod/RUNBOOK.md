# Nex Pod — First Session Runbook

Goal of session 1: get a strong open model serving on Justin's RunPod A100, reachable from Forge over an OpenAI-compatible API, locked with a key — then STOP the pod. No fine-tuning yet.

Budget target: under 1.5 hours of pod time (~$2.40 at $1.59/hr).

## Current setup (Justin, RunPod console)

| Item | Value |
|---|---|
| GPU | 1x A100 SXM 80GB — $1.59/hr |
| Template | Runpod PyTorch 2.8.0 |
| Network volume | 100GB, US-CA-2, mounted at `/workspace` (survives stop and delete) |
| Container disk | 30GB (wiped on stop — never keep anything important here) |

Rule: **everything that matters lives under `/workspace`** — the Python env, model weights, logs, and later the fine-tuned Nex.

## Before you tap Deploy

In the pod config, open **Edit Template** / the port + env settings:

1. **Expose HTTP port `8000`.** This is how Forge reaches the model. RunPod gives it a URL like `https://<POD_ID>-8000.proxy.runpod.net`.
2. **Add env vars:**
   - `HF_HOME=/workspace/hf` — keeps Hugging Face downloads on the volume.
   - `NEX_POD_KEY` — a long random secret. Use a RunPod **Secret** so it isn't shown in plain text. The same value later goes into Vercel as a sensitive env var. Never paste it in chat.
3. Enable MFA on the RunPod account first (there's money on the card).

## Session steps (web terminal or Jupyter terminal)

```bash
# 1. Persistent Python env on the volume (only needed the first time)
python -m venv /workspace/venv
source /workspace/venv/bin/activate
pip install --upgrade pip
pip install vllm   # large install — lives on the volume so it survives restarts

# 2. Download the starter model to the volume (only needed the first time)
pip install -U huggingface_hub
hf download Qwen/Qwen3-32B-AWQ --local-dir /workspace/models/qwen3-32b-awq

# 3. Serve it (OpenAI-compatible, locked with the key)
vllm serve /workspace/models/qwen3-32b-awq \
  --served-model-name nex-base \
  --host 0.0.0.0 --port 8000 \
  --api-key "$NEX_POD_KEY" \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.90 \
  --enable-auto-tool-choice --tool-call-parser hermes
```

On later sessions only step 3 is needed (plus `source /workspace/venv/bin/activate`) — no reinstall, no re-download.

### Why this model to start

- Qwen3-32B quantized (AWQ) is ~20GB, leaving most of the 80GB for batching many users at once.
- Supports tool calling, which Nex needs.
- It's a **placeholder base** to prove the pipeline (routing, fallback, key, schedule). The fine-tuned Nex replaces it later — same endpoint, same model name `nex-base` → `nex`.
- Check for a newer/better open model at session time; the steps are identical for any model vLLM supports.

## Test it (from any terminal)

```bash
curl https://<POD_ID>-8000.proxy.runpod.net/v1/chat/completions \
  -H "Authorization: Bearer $NEX_POD_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"nex-base","messages":[{"role":"user","content":"Say hi as Nex in one sentence."}]}'
```

Also confirm a request **without** the key is rejected (401). If it isn't, stop the pod and fix before anything else.

## End of session — do not skip

1. Stop vLLM (Ctrl+C).
2. **Stop the pod** in the RunPod console. GPU billing ends; only the volume (~$7/mo) keeps billing.
3. Post what happened on the Agent Board card (worked / broke / time used).

## Known gotchas

- A stopped pod may not get the same GPU back when restarted. If "no GPUs available," deploy a fresh A100 pod in **US-CA-2** and attach the same volume — nothing is lost.
- If vLLM runs out of memory, lower `--max-model-len` (e.g. 16384) before anything else.
- First model load takes a few minutes; later loads are faster.
