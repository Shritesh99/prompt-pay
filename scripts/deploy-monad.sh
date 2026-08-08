#!/usr/bin/env bash
# Deploys the PromptPay suite to Monad testnet (chain 10143).
# Key source (either works):
#   - MONAD_MNEMONIC in .env (account #0 is derived), or
#   - PRIVATE_KEY env var.
# The account must hold MON — top up at https://faucet.monad.xyz
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source scripts/env-key.sh
: "${PRIVATE_KEY:?no key — set MONAD_MNEMONIC in .env or export PRIVATE_KEY}"

RPC="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
echo "deployer: ${ADDRESS} (needs MON on chain 10143)"
echo "balance:  $(cast balance "$ADDRESS" --rpc-url "$RPC" --ether) MON"

cd contracts && mkdir -p deployments
NETWORK=monad PRIVATE_KEY="$PRIVATE_KEY" forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" --broadcast --slow

node ../server/scripts/gen-abis.mjs

echo
echo "deployment written to contracts/deployments/monad.json"
echo "explorer: https://testnet.monadscan.com/address/${ADDRESS}"
