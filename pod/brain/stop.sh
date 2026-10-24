#!/usr/bin/env bash
# Stop every running part, newest first. Run before stopping the pod.
set -uo pipefail

RUN=/workspace/brain/run
[ -d "$RUN" ] || { echo "nothing to stop"; exit 0; }

for pidfile in $(ls -1t "$RUN"/*.pid 2>/dev/null); do
  name=$(basename "$pidfile" .pid)
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo "[$name] stopping"
    kill "$pid"
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
  fi
  rm -f "$pidfile"
done
echo "Nex brain stopped."
