#!/usr/bin/env bash
# Report each enabled part as up or down. Exit 1 if any part is down.
set -uo pipefail

ROOT=/workspace
MANIFEST="${MANIFEST:-$ROOT/brain/manifest.json}"

status=0
while IFS=$'\t' read -r name port; do
  if curl -fs "http://127.0.0.1:$port/health" > /dev/null; then
    echo "[$name] up (port $port)"
  else
    echo "[$name] DOWN (port $port)"; status=1
  fi
done < <(python - "$MANIFEST" <<'PY'
import json, sys
for p in json.load(open(sys.argv[1]))["parts"]:
    if p.get("enabled", True):
        print(p["name"], p["port"], sep="\t")
PY
)
exit $status
