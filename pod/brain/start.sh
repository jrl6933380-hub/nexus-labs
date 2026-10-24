#!/usr/bin/env bash
# Start every enabled part in manifest.json, one at a time, waiting for each to be healthy.
set -euo pipefail

ROOT=/workspace
MANIFEST="${MANIFEST:-$ROOT/brain/manifest.json}"
RUN="$ROOT/brain/run"
LOGS="$ROOT/logs"
WAIT_SECONDS="${WAIT_SECONDS:-600}"

: "${NEX_POD_KEY:?NEX_POD_KEY must be set (use the RunPod secret)}"
source "$ROOT/venv/bin/activate"
export HF_HOME="$ROOT/hf"
mkdir -p "$RUN" "$LOGS"

python - "$MANIFEST" > "$RUN/parts.tsv" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for p in m["parts"]:
    if p.get("enabled", True):
        print("\t".join(str(x) for x in [
            p["name"], p["model"], p["served_name"], p["port"], p["gpu_mem"],
            p["max_len"], p.get("quantization") or "-", "1" if p.get("thinking", False) else "0",
        ]))
PY

while IFS=$'\t' read -r name model served port mem maxlen quant think <&3; do
  if [ -f "$RUN/$name.pid" ] && kill -0 "$(cat "$RUN/$name.pid")" 2>/dev/null; then
    echo "[$name] already running"
    continue
  fi
  args=(serve "$model" --served-model-name "$served" --host 0.0.0.0 --port "$port"
        --api-key "$NEX_POD_KEY" --max-model-len "$maxlen" --gpu-memory-utilization "$mem"
        --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_coder)
  [ "$quant" != "-" ] && args+=(--quantization "$quant")
  [ "$think" = "0" ] && args+=(--default-chat-template-kwargs '{"enable_thinking": false}')

  echo "[$name] starting on port $port"
  nohup vllm "${args[@]}" > "$LOGS/$name.log" 2>&1 < /dev/null &
  echo $! > "$RUN/$name.pid"

  waited=0
  until curl -fs "http://127.0.0.1:$port/health" > /dev/null; do
    if ! kill -0 "$(cat "$RUN/$name.pid")" 2>/dev/null; then
      echo "[$name] exited early. Last log lines:"; tail -n 20 "$LOGS/$name.log"; exit 1
    fi
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      echo "[$name] not healthy after ${WAIT_SECONDS}s. See $LOGS/$name.log"; exit 1
    fi
    sleep 5; waited=$((waited + 5))
  done
  echo "[$name] healthy after ${waited}s"
done 3< "$RUN/parts.tsv"

echo "Nex brain is up."
