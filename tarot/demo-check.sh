#!/bin/bash
# Pre-demo check: connects the LLM tunnel, warms up the model, and tests Furhat.
# Usage: bash demo-check.sh

cd "$(dirname "$0")" || exit 1

OLLAMA="http://127.0.0.1:11434"
FURHAT="http://127.0.0.1:54321/furhat"
problems=0

ok() { echo "  OK    $1"; }
bad() { echo "  FAIL  $1"; [ -n "$2" ] && echo "        -> $2"; problems=$((problems + 1)); }
llm_up() { curl -s -m 5 "$OLLAMA/api/tags" | grep -q '"gemma4:latest"'; }

echo "1. LLM tunnel"
if llm_up; then
  ok "already connected"
else
  # A tunnel can stay open but dead after sleep or a Wi-Fi change.
  pkill -f "ssh -f -N -L 11434" 2>/dev/null
  sleep 1
  ssh -o ConnectTimeout=15 -f -N -L 11434:127.0.0.1:11434 mltgpu
  sleep 2
  if llm_up; then
    ok "connected"
  else
    bad "cannot reach gemma4" "Check the Wi-Fi. Without it, Furhat uses ready-made readings."
  fi
fi

echo "2. LLM reply (the first one can take about 30 s)"
if curl -s -m 60 "$OLLAMA/api/generate" \
  -d '{"model":"gemma4","prompt":"Say hello.","stream":false,"options":{"num_predict":5}}' | grep -q '"response"'; then
  ok "gemma4 answered"
else
  bad "gemma4 did not answer" "Run this script again. Without it, Furhat uses ready-made readings."
fi

echo "3. Card data"
if [ -s data/deck.json ]; then
  ok "saved deck found"
else
  bad "data/deck.json is missing" "npm start will need the internet to download the cards."
fi

echo "4. Furhat Remote API"
if [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$FURHAT")" = "200" ]; then
  ok "connected"
  echo "5. Furhat voice"
  if curl -s -m 25 -X POST -H 'accept: application/json' \
    "$FURHAT/say?text=Testing%20my%20voice.&blocking=true" | grep -q '"success":true'; then
    ok "Furhat should have just said: Testing my voice."
    echo "        -> Did you HEAR it? This script cannot check the sound."
  else
    bad "Furhat did not speak" "Restart the Furhat SDK and the Remote API."
  fi
else
  bad "Remote API is not running" "Open the Furhat SDK, start the virtual Furhat, then start the Remote API."
fi

echo
if [ "$problems" -eq 0 ]; then
  echo "All good. When it is time for the demo, run: npm start"
else
  echo "$problems problem(s) above. If Furhat itself cannot run, use: npm run text"
fi
