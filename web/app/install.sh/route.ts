import { serverBase } from "../../lib/deployment";

// Serves the one-line installer:
//   curl -fsSL https://<site>/install.sh | sh -s -- --wallet 0x...
// The ad-server base is injected at request time so the earner reports to the
// currently-live server (e.g. a tunnel URL) without editing anything.
export const dynamic = "force-dynamic";

const REPO_TARBALL = "https://github.com/Shritesh99/prompt-pay/archive/refs/heads/main.tar.gz";

export function GET() {
  const script = `#!/bin/sh
# PromptPay earner installer — get paid while your AI coding agent works.
set -e

SERVER="${serverBase()}"
WALLET=""
AGENT="claude"   # claude | codex | both

while [ $# -gt 0 ]; do
  case "$1" in
    --wallet) WALLET="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --agent)  AGENT="$2";  shift 2 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "PromptPay needs Node.js (>=18). Install it from https://nodejs.org and re-run." >&2
  exit 1
fi

APP="$HOME/.promptpay/app"
echo "→ downloading PromptPay…"
mkdir -p "$APP"
curl -fsSL "${REPO_TARBALL}" | tar xz -C "$APP" --strip-components=1

echo "→ installing dependencies…"
( cd "$APP/cli" && npm install --silent --no-audit --no-fund )

WALLET_ARG=""
if [ -n "$WALLET" ]; then WALLET_ARG="--wallet $WALLET"; fi

case "$AGENT" in
  codex) CMDS="codex-setup" ;;
  both)  CMDS="setup codex-setup" ;;
  *)     CMDS="setup" ;;
esac

for c in $CMDS; do
  echo "→ configuring: promptpay $c"
  node "$APP/cli/bin/promptpay.mjs" $c $WALLET_ARG --server "$SERVER"
done

echo ""
echo "✓ PromptPay installed. Earnings settle to: \${WALLET:-your local signing key}"
echo "  Watch: node $APP/cli/bin/promptpay.mjs status"
`;

  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
