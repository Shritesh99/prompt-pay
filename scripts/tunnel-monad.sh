#!/usr/bin/env bash
# Runs the PromptPay ad-server against Monad testnet, exposes it with a
# cloudflared quick tunnel, and points the live Netlify site at that URL
# (SERVER_BASE is read at request time, so no redeploy is needed).
#
# Use this to drive the deployed frontend (promptpay-monad-blitz.netlify.app)
# from your laptop for a live demo. Ctrl-C stops the server and the tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source scripts/env-key.sh
: "${PRIVATE_KEY:?no key — set MONAD_MNEMONIC in .env}"

SITE_ID="${NETLIFY_SITE_ID:-603abff3-bee0-43ef-a02e-fc7e2cef8e23}"
SERVER_PORT="${PORT:-4021}"

cleanup() {
  echo; echo "[tunnel] stopping…"
  [[ -n "${TUNNEL_PID:-}" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[tunnel] starting ad-server on :$SERVER_PORT (Monad testnet)"
lsof -ti :$SERVER_PORT | xargs kill 2>/dev/null || true
( cd server && PROMPTPAY_NETWORK=monad ORACLE_PRIVATE_KEY="$PRIVATE_KEY" PORT=$SERVER_PORT pnpm dev ) &
SERVER_PID=$!
for i in $(seq 1 30); do curl -sf "localhost:$SERVER_PORT/health" >/dev/null && break; sleep 0.5; done

echo "[tunnel] opening cloudflared quick tunnel"
TUNNEL_LOG="$(mktemp)"
cloudflared tunnel --url "http://localhost:$SERVER_PORT" --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# wait for the public URL to appear in cloudflared's output
URL=""
for i in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 0.5
done
if [[ -z "$URL" ]]; then echo "[tunnel] failed to get a tunnel URL"; cat "$TUNNEL_LOG"; exit 1; fi
echo "[tunnel] public ad-server: $URL"

echo "[tunnel] pointing Netlify site at it (SERVER_BASE, no redeploy needed)"
( cd /tmp && netlify env:set SERVER_BASE "$URL" --site "$SITE_ID" >/dev/null )

# seed a demo campaign if none is live yet
if [[ "$(curl -s "localhost:$SERVER_PORT/ad" | grep -c '"ad":null' || true)" != "0" ]]; then
  echo "[tunnel] seeding a demo campaign"
  SEEDER_PRIVATE_KEY="$PRIVATE_KEY" node server/scripts/seed-demo.mjs monad || true
fi

echo
echo "  Live site:  https://promptpay-monad-blitz.netlify.app"
echo "  Ad-server:  $URL  (via this laptop)"
echo "  CLI earner: node cli/bin/promptpay.mjs setup --server $URL"
echo
echo "Ctrl-C to stop the server + tunnel (the site will fall back to its placeholder)."
wait $SERVER_PID
