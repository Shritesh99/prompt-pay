# PromptPay — an on-chain ad marketplace for AI wait time, on Monad

## Context

Every developer stares at an AI "thinking" spinner dozens of times a day — dead time that no one
monetizes. **PromptPay** turns it into a two-sided on-chain marketplace: advertisers escrow USDC
and bid in an on-chain English auction to sponsor Claude Code's thinking spinner; developers who
show the winning ad earn 50% of the revenue per verified impression/click, claimable any time.
Built for **Monad Blitz London** on **Monad testnet**, in `/Users/rxshri99/Projects/hackathons/promptpay`.

Confirmed decisions:
- **Chain**: Monad testnet — chain ID `10143`, RPC `https://testnet-rpc.monad.xyz` (alt `https://rpc.ankr.com/monad_testnet`, ws `wss://testnet-rpc.monad.xyz`), native token MON (18dp), faucet `https://faucet.monad.xyz`, explorers `https://testnet.monadscan.com` / `https://testnet.monadvision.com`. Fully EVM-compatible; Foundry/wagmi/viem work unmodified. ~400ms blocks. Local dev on anvil first.
- **Sybil resistance deferred**: no World ID in MVP, but design the seams (humanId passthrough, per-key caps) so an AgentRegistry + World ID slots in later with zero money-contract changes.
- **Both earner surfaces**: CLI/statusline first (officially supported Claude Code settings — reliable hero demo), VS Code extension (webview bundle patching) as a stretch phase.
- Full stack: contracts + server + web + cli + extension, pnpm monorepo.

## Monorepo layout

```
promptpay/
├── pnpm-workspace.yaml            # packages: server, web, cli, extension
├── package.json                   # root scripts: dev, e2e, deploy:monad
├── tsconfig.base.json / README.md / DEMO.md
├── contracts/                     # Foundry, solc 0.8.26, OpenZeppelin via forge install
│   ├── src/{CampaignVault,AdAuction,PayoutSettlement}.sol
│   ├── src/lib/AdMath.sol  ·  src/mocks/MockUSDC.sol
│   ├── test/{PromptPay,AdMath}.t.sol
│   ├── script/Deploy.s.sol · script/dev-chain.sh
│   └── deployments/{anvil,monad}.json
├── server/                        # Hono + tsx + better-sqlite3 + viem, port 4021
│   ├── src/{index,config,chain,auth,db,settle,abis}.ts
│   └── scripts/{gen-abis.mjs,seed-demo.mjs,e2e.mjs}
├── web/                           # Next.js App Router + wagmi v2 + viem + Tailwind
│   ├── app/{page,advertise/new,earn,auction,leaderboard}/  ·  app/api/faucet/route.ts
│   ├── lib/{wagmi,chains,deployment,abis,format}.ts
│   └── components/{TxStepper,Nav,WalletButton}.tsx
├── cli/                           # plain Node ESM, only dep = viem
│   ├── bin/promptpay.mjs          # setup|start|stop|status|uninstall
│   └── src/{config,settings,daemon,statusline}.mjs
├── extension/                     # Phase 7 stretch
└── scripts/{dev-stack.sh,deploy-monad.sh,demo.sh}
```

## Contracts (original designs)

Economic model: pricing unit = USDC base units (6dp) per **slot** = 1000 impressions; click = 50 impression-units; 50/50 earner/treasury split.

- **`lib/AdMath.sol`** — pure: `IMPRESSIONS_PER_SLOT=1000`, `CLICK_UNITS=50`, `EARNER_BPS=5000`; `costOf(impr, clicks, pricePerSlot) = (impr + clicks*50) * pricePerSlot / 1000`; `splitOf(amount)` → 50% earner, remainder treasury (no dust).
- **`CampaignVault.sol`** — the only token custodian. `Campaign{advertiser, balance, pricePerSlot, creativeHash, active}`; advertiser: `createCampaign(creativeHash)`, `fund`, `withdraw`, `deactivate`; operator-only (auction + settlement): `setPrice`, `deduct`, `credit`; earner: `claim(amount)`/`claimAll()` against `claimable[address]`. OZ Ownable + ReentrancyGuard + SafeERC20, custom errors, full event set.
- **`AdAuction.sol`** — ranking only, zero custody. `bid(campaignId, pricePerSlot)`: caller must be advertiser, must strictly exceed prior bid, balance must cover ≥1 slot; writes through `vault.setPrice`. `topBid()` O(n) scan (eligible = active && funded); `board()` view for dashboards.
- **`PayoutSettlement.sol`** — oracle-gated. `settleBatch(receiptId, campaignId, earner, humanId, impressions, clicks)`: receipt-replay guard (`usedReceipts` mapping), `charged = min(cost, balance)`, deduct + credit 50/50, emit `BatchSettled`. **`humanId` is a passthrough audit field** (MVP: `keccak256(agentAddress)`) — World ID slots in later with zero contract changes.
- **`mocks/MockUSDC.sol`** — 6dp ERC20 with open `mint` capped per call (~10,000e6).
- **`Deploy.s.sol`** — deploy vault → auction → settlement, wire operators/oracle/treasury, write `deployments/<network>.json` via `vm.writeJson` (needs `fs_permissions` in foundry.toml). Optional `USDC_ADDRESS` env, else deploy MockUSDC.
- **~18 Foundry tests**: escrow lifecycle, operator gating, claim math, bid rules (outbid-self, underfunded revert, non-advertiser revert), topBid skips inactive/drained, settle split math, click weighting, cap-to-balance partial delivery, receipt replay revert, non-oracle revert, full-loop e2e, fuzz on AdMath.

## Server (Hono, :4021)

- **Config**: loads `contracts/deployments/${PROMPTPAY_NETWORK||anvil}.json`; env: `RPC_URL`, `ORACLE_PRIVATE_KEY`, `VIEW_THRESHOLD_MS=3000`, `SETTLE_INTERVAL_MS=15000`, `PER_KEY_DAILY_CAP=2000`, `KILLSWITCH`.
- **SQLite** (better-sqlite3, WAL): `creatives`, `challenges` (nonce replay), `usage` (rolling-24h caps, atomic partial acceptance), `pending` (keyed campaign+earner+humanId), `receipts`, `events_log`.
- **Auth — EIP-191 challenge–response**: `POST /report` without headers → HTTP 402 + `{nonce, issuedAt, expiresAt, domain, uri}`. Client signs a canonical message (`PromptPay Report v1` + domain/uri/agent/nonce/issuedAt + **`keccak256(rawBody)`** so the signature covers the payload) with its agent key; sends `x-pp-agent/nonce/issued-at/signature` headers. Server verifies via viem `verifyMessage`, single-use nonce. `resolveHumanId(agent)` = `keccak256(agent)` for now, with a marked seam for the AgentRegistry lookup.
- **Endpoints**: `GET /health`, `GET /killswitch`, `GET /ad` (reads `board()`, eligible = active+priced+funded+creative registered, **bid-weighted random pick**, returns `{adId=creativeHash, campaignId, adText, clickUrl, pricePerSlot} + viewThresholdMs`), `POST /campaigns` (zod-validated; `creativeHash = keccak256(text + "\n" + clickUrl)` — shared formula with web; enforce on-chain ownership 403 / hash match 409), `POST /report` (units: impression=1, click=50; per-key daily cap with partial acceptance → `capped:true`; upsert into `pending`), `GET /earnings/:address`, `GET /auction`, `GET /activity`, `POST /settle/flush`.
- **Settlement loop**: every 15s (re-entrancy latch), `takePending()` → random 32-byte `receiptId` → `settleBatch` tx signed by oracle → `waitForTransactionReceipt` → **clear pending only after confirmation** (crash-safe; on-chain replay guard makes double-submit harmless).

## Web (Next.js + wagmi/viem)

- `lib/chains.ts`: `defineChain` for Monad testnet (10143) + local anvil (:8546); `lib/wagmi.ts`: `injected()` connector **plus a dev-wallet mock connector** (viem local account — anvil key locally, funded throwaway key on Monad via `NEXT_PUBLIC_DEV_WALLET_KEY`) so demos never depend on MetaMask.
- Pages: `/` landing with live stats; `/advertise/new` — **TxStepper**: faucet-if-broke → `approve` → `createCampaign(creativeHash)` (parse log for id) → `fund` → `bid` → `POST /campaigns`; auto chain-switch, resumable steps; `/earn` — agent keypair in localStorage (same format as CLI key so users can paste it), polls `/earnings` + `/activity` 4s, **Claim** signs `vault.claimAll()` directly with the agent key; `/auction` — live board, winner highlight; `/leaderboard` — aggregate receipts per earner.
- `app/api/faucet/route.ts` — holds `FAUCET_PRIVATE_KEY`; mints MockUSDC + tops up gas (MON on testnet — pre-fund this key from faucet.monad.xyz); in-memory per-address rate limit.

## CLI (build FIRST among earner surfaces — the hero demo)

Home `~/.promptpay/` (`config.json`, `statusline.mjs`, `current-ad.json`, `heartbeat`, `daemon.pid`, `settings-backup.json`).

- **`bin/promptpay.mjs setup`**: generate agent key (viem `generatePrivateKey`) — the key IS the identity in MVP, no registration; back up then merge into `~/.claude/settings.json`:
  - `statusLine: {type:"command", command:"node ~/.promptpay/statusline.mjs"}`
  - `spinnerVerbs: {mode:"replace", verbs:["<ad text>"]}` — ⚠ **verify this setting still exists in current Claude Code** (was supported ≥2.1.143); degrade to statusline-only if removed.
  - Spawn daemon detached with pidfile. `uninstall` restores backed-up settings exactly.
- **`statusline.mjs`** (runs every CC render — tiny, no network, never throws): write heartbeat timestamp; print `✦ <adText> · sponsored` as an **OSC 8 clickable hyperlink** (ESC via charCode, strip control chars).
- **`daemon.mjs`**: 5s tick polling `/ad` + `/killswitch`; 15s ad rotation (rewrites `current-ad.json` + refreshes `spinnerVerbs`); report impression only if heartbeat age <12s AND dwell ≥ viewThresholdMs AND ≥5s since last report; 402→sign→retry flow from the server auth spec.

## Phase 7 (stretch): VS Code extension

Only after everything else demos. Original re-implementation of the known techniques: locate `~/.vscode/extensions/anthropic.claude-code-*/webview/index.js` (newest); compatibility probe (spinner class pattern + CC's nonsense-verb array present, else refuse); append fenced IIFE between `/* PROMPTPAY-START/END */` markers with atomic write + `.backup` + sha256-verified restore; CSP shape-regex patch (`default-src 'none'; ${var}` → add `connect-src http://127.0.0.1:*`); injected runtime finds `[class*="spinnerRow_"]`, detects thinking via animated sparkle glyph (✢✶✻✽) codepoint changes in a grace window, renders `position:fixed` overlay (**never mutate CC's React DOM**, **never use a document-wide MutationObserver** — both crash/break CC); random-token-gated 127.0.0.1 loopback bridge; extension holds agent key and reuses the signed `/report` flow.

## Phase 8 (deferred, design-only): Sybil resistance

Seams already shipped: humanId flows `/report` → `pending` → `settleBatch` → `BatchSettled`; cap function keys on the resolved id. Later: **`AgentRegistry.sol` on Monad** (`register(agent, humanId)` by a registrar key; `humanIdOf(agent)` view); web onboarding runs World ID IDKit → server verifies via Worldcoin cloud API → nullifier hash becomes `humanId` → registrar binds it; server switches `resolveHumanId` to the registry lookup and caps per-human. Zero changes to Vault/Auction/Settlement.

## Build order (always-demoable increments)

| Phase | Deliverable | Checkpoint |
|---|---|---|
| 0 | Scaffold: workspace, forge init + OZ, README | `pnpm -r install` + `forge build` clean |
| 1 | Contracts + 18 tests + Deploy.s.sol + `dev-chain.sh` (anvil :8546 + deploy + write deployments/anvil.json) | `forge test` green; manual `cast` loop |
| 2 | Server read path (`/health /ad /campaigns /auction /earnings /killswitch`) + `gen-abis.mjs` + `seed-demo.mjs` | `curl :4021/ad` returns the seeded ad |
| 3 | `/report` auth + settlement loop + **`e2e.mjs`** (fresh key → 402→sign→N impressions+1 click → flush → assert on-chain claimable = exact 50% → claim → assert USDC balance; also assert nonce-replay 401 + cap behavior) | `pnpm e2e` exit 0 — the regression gate for all later phases |
| 4 | CLI | **Hero demo**: `promptpay setup` → new `claude` session → ad in status line + spinner verb → `promptpay status` shows earnings ticking; closing CC stops reports (heartbeat gate) |
| 5 | Web + `dev-stack.sh` (anvil+deploy+seed+server+web, trap cleanup) | Two-sided browser demo: advertise via UI → ad in CLI ≤5s → claim in `/earn` |
| 6 | **Monad testnet**: `deploy-monad.sh` (`forge script --rpc-url https://testnet-rpc.monad.xyz --broadcast`), fund deployer/oracle/faucet keys with MON, run stack with `PROMPTPAY_NETWORK=monad` | Real demo with MonadScan tx links; re-run e2e against Monad (small N) |
| 7 | VS Code extension (stretch) | Ad overlay during CC thinking; patch/restore round-trip test |
| 8 | Sybil design doc in README (post-hackathon) | — |

Cut-line if time runs out: Phase 5 can ship with only `/advertise/new` + `/earn`.

## Verification

- `forge test` (phase 1) — 18 unit/fuzz tests.
- `server/scripts/e2e.mjs` (phase 3) — headless full money loop on anvil; re-run after every later phase and once against Monad testnet.
- `DEMO.md` runbook — manual two-sided demo (local + Monad variants): seed campaign → CLI earner in real Claude Code → advertiser flow in browser → claim → explorer links.

## Reference material

- Monad docs: https://docs.monad.xyz (testnet: `developer-essentials/testnet.md`; Foundry deploy guide under `guides/deploy-smart-contract/foundry.md`).
