#!/usr/bin/env bash
# Deploys the PromptPay ad-server to Supabase (Edge Function + Postgres).
#
# Prereqs (one-time):
#   supabase login            # or export SUPABASE_ACCESS_TOKEN
#   export SUPABASE_PROJECT_REF=xxxxxxxxxxxx   # from your project's dashboard URL
#   MONAD_MNEMONIC set in .env (derives the oracle key)
#
# Then:  ./scripts/deploy-supabase.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source scripts/env-key.sh
: "${PRIVATE_KEY:?no key — set MONAD_MNEMONIC in .env}"
: "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF (your project ref)}"

# keep the function's bundled contract addresses + ABIs in sync with the deploy
cp contracts/deployments/monad.json supabase/functions/server/deployment.json
node server/scripts/gen-abis.mjs >/dev/null

echo "[supabase] linking project $SUPABASE_PROJECT_REF"
supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "[supabase] pushing database migrations"
supabase db push

echo "[supabase] setting function secrets"
supabase secrets set \
  ORACLE_PRIVATE_KEY="$PRIVATE_KEY" \
  RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}" \
  VIEW_THRESHOLD_MS="${VIEW_THRESHOLD_MS:-800}" \
  PER_KEY_DAILY_CAP="${PER_KEY_DAILY_CAP:-2000}" \
  PUBLIC_URL="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/server" >/dev/null

echo "[supabase] deploying function 'server'"
supabase functions deploy server --no-verify-jwt

BASE="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/server"
echo
echo "ad-server live at: $BASE"
echo "sanity: curl -s $BASE/health"
echo
echo "point the web app at it (no rebuild needed — read at runtime):"
echo "  cd /tmp && netlify env:set SERVER_BASE \"$BASE\" --site 603abff3-bee0-43ef-a02e-fc7e2cef8e23"
echo "then seed a campaign:"
echo "  SERVER_BASE=$BASE SEEDER_PRIVATE_KEY=\$PRIVATE_KEY PRICE_PER_SLOT=1000000000 BUDGET=5000000000 node server/scripts/seed-demo.mjs monad"
