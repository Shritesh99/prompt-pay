# PromptPay

> Get paid while Claude thinks. ⚡ Built on Monad for **Monad Blitz London**.

Every developer stares at an AI "thinking" spinner dozens of times a day. PromptPay turns that
dead time into a **two-sided on-chain ad marketplace**: advertisers escrow USDC and bid in a live
English auction on **Monad** to sponsor Claude Code's spinner; developers who show the winning ad
earn **50% of the revenue in USDC** per signed impression — claimable any time, no minimum payout.

## How it works

```
Claude Code                     PromptPay CLI daemon             Ad-server (Hono :4021)
 status line + thinking verb ──── heartbeat-gated, ──────────────▶ 402 challenge → EIP-191
 show the winning ad              signed impressions               verify · nonce replay guard
                                                                   per-key daily cap
                                                                        │  batches (15s)
        web (Next.js :3000)                                             ▼
 Advertise · Auction · Earn · Leaderboard ───────────▶ MONAD: CampaignVault · AdAuction · PayoutSettlement
   fund + bid + claim (wagmi / dev wallet)                     escrow    ranking    oracle 50/50 split
```

- **`contracts/`** — Foundry suite: `CampaignVault` (sole USDC custodian: budgets, claimables),
  `AdAuction` (English-ascending standing bids, writes the live price through to the vault),
  `PayoutSettlement` (oracle-batched `settleBatch` with on-chain receipt-replay protection,
  50/50 earner/treasury split via `AdMath`), `MockUSDC` faucet token. **23 tests.**
- **`server/`** — Hono ad-server: serves the auction's bid-weighted winning ad, gates
  `POST /report` behind an original 402 challenge → EIP-191 signature flow (body hash bound into
  the signed message, single-use nonces), applies per-key rolling daily caps, and settles pending
  batches on-chain every 15s as the oracle. SQLite state.
- **`cli/`** — the earner. `promptpay setup` provisions an agent key and installs two ad surfaces
  via **supported Claude Code settings** (no patching): the `statusLine` (clickable OSC-8 ad +
  live earnings) and `spinnerVerbs` (the thinking verb *is* the ad). A daemon reports impressions
  only while the statusline heartbeat proves the ad is on screen. `uninstall` restores everything.
- **`web/`** — Next.js dashboard: launch campaigns (faucet → approve → create → fund → bid →
  publish, with a resumable tx stepper), watch the live auction, track and **claim earnings**,
  leaderboard. Works with an injected wallet or a zero-setup dev wallet.

## Run it

```bash
pnpm install && forge build --root contracts
./scripts/dev-stack.sh        # anvil + contracts + ad-server + seeded campaign + web
```

Then earn in a real Claude Code session:

```bash
node cli/bin/promptpay.mjs setup     # installs the surfaces + starts the daemon
# open a new `claude` session → the ad is the status line AND the thinking verb
node cli/bin/promptpay.mjs status    # watch claimable USDC climb
```

Prove the whole money loop headlessly (report → settle → claim, exact split asserted on-chain):

```bash
pnpm e2e
```

## Monad testnet

```bash
PRIVATE_KEY=0x… ./scripts/deploy-monad.sh    # fund the key at https://faucet.monad.xyz
```

Same stack, real chain: run the server with `PROMPTPAY_NETWORK=monad` and the web with
`NEXT_PUBLIC_PP_NETWORK=monad`. Chain 10143 · RPC `https://testnet-rpc.monad.xyz` ·
explorer [testnet.monadscan.com](https://testnet.monadscan.com). Monad's ~400ms blocks make
oracle settlement and claims feel instant — micropayments per impression only work when
settlement costs less than the impression.

## Why it's fraud-resistant (and the road to fully Sybil-proof)

Today: every impression is **signed** by the earning agent's key against a single-use server
nonce (body hash bound in — no replay, no tampering), heartbeat gating means ads only bill while
actually rendered, and every agent key has a rolling daily earning cap. The `humanId` field
already flows through `/report` → `PayoutSettlement.settleBatch` → `BatchSettled` events, so the
next step needs **zero changes to the money contracts**: an `AgentRegistry` on Monad binding
agent keys to World ID nullifiers (verified via cloud proof), making the cap per-human instead of
per-key — one human, one earner, no bot farms.

## Docs

- [DEMO.md](./DEMO.md) — full demo runbook (local + Monad testnet)
- Contracts: `forge test --root contracts` · Server e2e: `pnpm e2e`
