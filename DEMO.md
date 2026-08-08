# PromptPay — demo runbook

Everything is real except the stablecoin (a faucet MockUSDC stands in for USDC on both anvil and
Monad testnet). The auction, escrow, signed impression reporting, oracle settlement, 50/50 split
and claims are the production code paths on both networks.

## 1. One command, whole stack (local)

```bash
pnpm install && forge build --root contracts
./scripts/dev-stack.sh                 # WEB_PORT=3100 if :3000 is busy; WEB_MODE=start for prod build
```

This boots a dedicated anvil (`:8546`, chain 31338 — never collides with another project's
anvil), deploys the contracts, starts the ad-server (`:4021`) with a fresh DB, seeds a funded
demo campaign ("Ship it on Monad", 100 pUSDC budget, 2 pUSDC/slot bid), and serves the web app.
Ctrl-C tears it all down; every run is fresh state.

Browse (no wallet needed):

- `http://localhost:3000` — landing, shows what's live in the spinner
- `http://localhost:3000/auction` — the live board, campaign #1 winning
- `http://localhost:3000/leaderboard` — fills as impressions settle

## 2. The money shot — earn in real Claude Code

```bash
node cli/bin/promptpay.mjs setup       # agent key + status line + spinner verb + daemon
```

1. Open a **new `claude` session** in any terminal.
2. Two surfaces appear:
   - **Status line** (bottom): `✦ Ship it on Monad - 10,000 TPS, full EVM · sponsored · earned $…`
     — a real OSC-8 hyperlink, and the earnings figure updates live.
   - **Thinking verb**: while Claude works, the spinner word *is* the ad (via the supported
     `spinnerVerbs` setting).
3. The daemon reports a signed impression per 15s rotation — but **only while the status line
   heartbeat is fresh** (close Claude Code and reports stop; that's the anti-phantom-billing gate).
4. Watch earnings climb: `node cli/bin/promptpay.mjs status` → `earned: $0.00xx USDC claimable`.
5. Clean exit any time: `node cli/bin/promptpay.mjs uninstall` restores your previous
   status line and spinner settings exactly.

## 3. The two-sided flow in the browser

- **Advertise** (`/advertise/new`): write an ad → set budget + bid → *"Fund & enter auction"*.
  The stepper runs: faucet (if you're short) → approve → `createCampaign` (creative hash
  committed on-chain) → `fund` → `bid` → publish creative to the ad-server. No MetaMask needed —
  *"Continue with dev wallet"* uses a funded local account. Outbid campaign #1 and within ~5s the
  CLI shows **your** ad.
- **Earn** (`/earn`): paste the CLI's agent key (printed by `setup`, or generate a fresh one) →
  live claimable balance + activity → **Claim USDC** sends `claimAll()` signed by the agent key.

## 4. Headless proof (CI-able)

```bash
pnpm e2e
```

Asserts, against real contracts: 402 challenge → EIP-191-signed impressions + click →
**nonce replay rejected (401)** → oracle settlement → on-chain `claimable == exact 50% share` →
`claimAll()` → USDC in the earner wallet.

## 5. Monad testnet (chain 10143)

```bash
# fund a throwaway key with MON at https://faucet.monad.xyz, then:
PRIVATE_KEY=0x… ./scripts/deploy-monad.sh
node server/scripts/gen-abis.mjs

# run the stack against Monad:
PROMPTPAY_NETWORK=monad ORACLE_PRIVATE_KEY=$PRIVATE_KEY pnpm --filter @promptpay/server dev
SEEDER_PRIVATE_KEY=$PRIVATE_KEY node server/scripts/seed-demo.mjs monad
NEXT_PUBLIC_PP_NETWORK=monad FAUCET_PRIVATE_KEY=$PRIVATE_KEY pnpm --filter @promptpay/web dev
node cli/bin/promptpay.mjs setup     # same CLI, now settling on Monad

# prove it headlessly on the real chain:
PROMPTPAY_NETWORK=monad GAS_FUNDER_PRIVATE_KEY=$PRIVATE_KEY node server/scripts/e2e.mjs monad
```

Every settlement and claim is a real tx — check them on
[testnet.monadscan.com](https://testnet.monadscan.com).
