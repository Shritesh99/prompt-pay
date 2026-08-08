#!/usr/bin/env bash
# Reset PromptPay to a clean state for a demo:
#   1. wipe the hosted Supabase Postgres (creatives, events, receipts, …)
#   2. pre-enroll the demo wallet so earning works out of the box
#   3. seed a couple of fresh $0.50/impression campaigns
#   4. reset the local CLI (stop daemon + restore Claude Code settings)
#
# Needs .env: MONAD_MNEMONIC + SUPABASE_ACCESS_TOKEN (or SUPERBASE_ACCESS_TOKEN).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source scripts/env-key.sh
set -a; source .env; set +a
export TOKEN="${SUPABASE_ACCESS_TOKEN:-${SUPERBASE_ACCESS_TOKEN:-}}"
: "${PRIVATE_KEY:?set MONAD_MNEMONIC in .env}"
: "${TOKEN:?set SUPABASE_ACCESS_TOKEN in .env}"

REF="fvwbsbbhzzxdxalyuczw"
BASE="https://${REF}.supabase.co/functions/v1/server"
DEMO_WALLET="${DEMO_WALLET:-0x4f2ea930cfb0b50fb1c9dbbe5c89f36163b93c52}"

echo "[reset] wiping Supabase tables + pre-enrolling ${DEMO_WALLET}"
node --input-type=module -e '
const ref="'"$REF"'", token=process.env.TOKEN, wallet="'"$DEMO_WALLET"'".toLowerCase();
const q=async(query)=>{const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({query})});if(!r.ok)throw new Error(await r.text());return r.json();};
await q("truncate creatives, events_log, receipts, pending, usage, challenges, enrollments restart identity");
await q(`insert into enrollments (wallet, enrolled_at) values ('"'"'${wallet}'"'"', ${Date.now()})`);
console.log("  tables cleared, demo wallet enrolled");
'

# No ads are seeded — create campaigns live via /advertise/new during the demo.
# (To seed some anyway: SEED_ADS=1 ./scripts/demo-reset.sh)
if [[ "${SEED_ADS:-0}" == "1" ]]; then
  echo "[reset] seeding fresh campaigns (\$0.50 / impression)"
  SERVER_BASE="$BASE" SEEDER_PRIVATE_KEY="$PRIVATE_KEY" PRICE_PER_SLOT=1000000000 BUDGET=5000000000 \
    AD_TEXT="Ship it on Monad - 10,000 TPS, full EVM" AD_URL="https://monad.xyz" \
    node server/scripts/seed-demo.mjs monad 2>&1 | grep -E "campaign id|creative registered" || true
fi

echo "[reset] resetting local CLI (stop daemon + restore Claude Code settings)"
node cli/bin/promptpay.mjs uninstall >/dev/null 2>&1 || true
rm -rf "$HOME/.promptpay"

echo
echo "Clean demo state ready (no ads — create one live)."
echo "  1. Advertise:  https://promptpay-monad-blitz.netlify.app/advertise/new"
echo "  2. Watch:      https://promptpay-monad-blitz.netlify.app/auction"
echo "  3. Earn:       curl -fsSL https://promptpay-monad-blitz.netlify.app/install.sh | sh -s -- --wallet ${DEMO_WALLET}"
echo "  4. Open a NEW claude session; claim on /earn."
echo "  (${DEMO_WALLET} is pre-enrolled, so earning works as soon as a campaign is live.)"
