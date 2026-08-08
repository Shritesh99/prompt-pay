#!/usr/bin/env bash
# Reset PromptPay to a clean state for a fresh demo run.
#
# By default this clears LOCAL / off-chain state only:
#   - stops the CLI earner daemon and restores your ~/.claude/settings.json
#   - removes ~/.promptpay (agent key, cached ad, heartbeat, backups)
#   - stops the ad-server (:4021), any cloudflared tunnel, and local anvil (:8546)
#   - wipes the ad-server SQLite databases (nonces, pending, receipts, events)
#
# Flags:
#   --redeploy        also redeploy FRESH Monad contracts (new addresses) + reseed
#   --netlify-reset   reset the live site's SERVER_BASE back to the localhost placeholder
#   --keep-agent      keep ~/.promptpay/config.json (your agent key) — only clear the rest
#
# On-chain note: without --redeploy, the existing Monad contracts and any
# on-chain claimable balances are left untouched (you cannot wipe a public
# chain). --redeploy gives a truly fresh deployment.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

REDEPLOY=0
NETLIFY_RESET=0
KEEP_AGENT=0
for arg in "$@"; do
  case "$arg" in
    --redeploy) REDEPLOY=1 ;;
    --netlify-reset) NETLIFY_RESET=1 ;;
    --keep-agent) KEEP_AGENT=1 ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

echo "[clean] stopping CLI earner + restoring Claude Code settings"
node cli/bin/promptpay.mjs uninstall 2>/dev/null || true

echo "[clean] stopping ad-server (:4021), tunnel, anvil (:8546)"
lsof -ti :4021 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :8546 2>/dev/null | xargs kill 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
pkill -f "anvil --port 8546" 2>/dev/null || true
pkill -f "cli/src/daemon.mjs" 2>/dev/null || true

echo "[clean] wiping ad-server databases"
rm -f "$ROOT"/server/data/*.db "$ROOT"/server/data/*.db-shm "$ROOT"/server/data/*.db-wal

if [[ "$KEEP_AGENT" -eq 1 ]]; then
  echo "[clean] keeping ~/.promptpay/config.json (agent key); clearing the rest"
  rm -f "$HOME"/.promptpay/{current-ad.json,heartbeat,daemon.pid,daemon.log,statusline.mjs,settings-backup.json} 2>/dev/null || true
else
  echo "[clean] removing ~/.promptpay (agent key + all CLI state)"
  rm -rf "$HOME/.promptpay"
fi

if [[ "$NETLIFY_RESET" -eq 1 ]]; then
  echo "[clean] resetting Netlify SERVER_BASE to placeholder (run from /tmp to dodge the monorepo CLI bug)"
  ( cd /tmp && netlify env:set SERVER_BASE "http://localhost:4021" \
      --site 603abff3-bee0-43ef-a02e-fc7e2cef8e23 >/dev/null 2>&1 ) \
    && echo "[clean]   done" || echo "[clean]   skipped (netlify CLI not available / not linked)"
fi

if [[ "$REDEPLOY" -eq 1 ]]; then
  echo "[clean] redeploying FRESH Monad contracts (new addresses)"
  ./scripts/deploy-monad.sh
  echo "[clean] fresh deployment at contracts/deployments/monad.json — commit it and redeploy the web:"
  echo "        netlify deploy --build --prod --filter @promptpay/web"
fi

echo
echo "[clean] done — clean state."
echo "  next: start the server + tunnel and point the site at it:"
echo "        ./scripts/tunnel-monad.sh"
echo "  then: node cli/bin/promptpay.mjs setup   (generates a fresh agent key)"
