#!/usr/bin/env bash
# Boots a dedicated anvil (port 8546 / chain 31338 — deliberately off the
# defaults so it never collides with another project's anvil) and deploys the
# PromptPay suite, writing deployments/anvil.json.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC_PORT="${RPC_PORT:-8546}"
CHAIN_ID="${CHAIN_ID:-31338}"
# anvil's default funded key #0 — local dev only
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

pkill -f "anvil --port ${RPC_PORT}" 2>/dev/null || true
sleep 0.3

anvil --port "${RPC_PORT}" --chain-id "${CHAIN_ID}" --silent &
ANVIL_PID=$!
trap 'kill ${ANVIL_PID} 2>/dev/null || true' EXIT
sleep 1

mkdir -p deployments
PRIVATE_KEY="${DEPLOYER_KEY}" NETWORK=anvil forge script script/Deploy.s.sol:Deploy \
  --rpc-url "http://127.0.0.1:${RPC_PORT}" --broadcast -q

echo "anvil running on :${RPC_PORT} (chain ${CHAIN_ID}), deployment at deployments/anvil.json"
echo "Ctrl-C to stop."
trap - EXIT
wait ${ANVIL_PID}
