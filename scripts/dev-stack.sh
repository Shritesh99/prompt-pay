#!/usr/bin/env bash
# One command, whole stack, fresh state:
#   anvil (:8546) -> deploy contracts -> gen ABIs -> ad-server (:4021)
#   -> seeded demo campaign -> web (:3000). Ctrl-C tears everything down.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

RPC_PORT=8546
CHAIN_ID=31338
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
WEB_MODE="${WEB_MODE:-dev}" # dev | start (production build)
WEB_PORT="${WEB_PORT:-3000}"

cleanup() {
  echo; echo "[stack] shutting down…"
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "${ANVIL_PID:-}" ]] && kill "$ANVIL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# clear any lingering processes from a previous run
pkill -f "anvil --port ${RPC_PORT}" 2>/dev/null || true
lsof -ti :4021 | xargs kill 2>/dev/null || true
sleep 0.5

echo "[stack] anvil :${RPC_PORT} (chain ${CHAIN_ID})"
anvil --port $RPC_PORT --chain-id $CHAIN_ID --silent &
ANVIL_PID=$!
sleep 1

echo "[stack] deploying contracts"
(cd contracts && mkdir -p deployments && \
  PRIVATE_KEY=$DEPLOYER_KEY NETWORK=anvil forge script script/Deploy.s.sol:Deploy \
    --rpc-url "http://127.0.0.1:${RPC_PORT}" --broadcast -q)
node server/scripts/gen-abis.mjs

echo "[stack] ad-server :4021 (fresh db)"
rm -f server/data/anvil.db*
(cd server && pnpm dev) &
SERVER_PID=$!
for i in $(seq 1 30); do curl -sf localhost:4021/health >/dev/null && break; sleep 0.5; done

echo "[stack] seeding demo campaign"
node server/scripts/seed-demo.mjs

echo "[stack] web :${WEB_PORT} (${WEB_MODE})"
(cd web && pnpm next "$([ "$WEB_MODE" = start ] && echo start || echo dev)" -p "$WEB_PORT") &
WEB_PID=$!

echo
echo "  http://localhost:${WEB_PORT}            landing"
echo "  http://localhost:${WEB_PORT}/auction    live auction"
echo "  http://localhost:${WEB_PORT}/earn       earner dashboard"
echo "  node cli/bin/promptpay.mjs setup earn in Claude Code"
echo
wait $WEB_PID
