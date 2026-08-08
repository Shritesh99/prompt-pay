// PromptPay ad-server as a Supabase Edge Function (Deno + Hono).
//
// Differences from the Node server (server/src): state lives in Postgres, and
// there is no long-running settlement loop — serverless can't hold one. Instead
// we settle "on report": each accepted impression/click triggers a settlement
// pass, serialized across concurrent invocations by a Postgres advisory lock so
// the oracle's nonce never races.
import { Hono } from "npm:hono@4.6.14";
import { cors } from "npm:hono/cors";
import { z } from "npm:zod@3.24.1";
import postgres from "npm:postgres@3.4.5";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  keccak256,
  toHex,
  verifyMessage,
  type Address,
  type Hex,
} from "npm:viem@2.21.55";
import { privateKeyToAccount } from "npm:viem@2.21.55/accounts";
import deployment from "./deployment.json" with { type: "json" };
import { vaultAbi, auctionAbi, settlementAbi } from "./abis.ts";

// ---- config ----
const env = (k: string) => Deno.env.get(k);
const CHAIN_ID = Number(env("CHAIN_ID") ?? deployment.chainId);
const USDC = (env("USDC_ADDRESS") ?? deployment.usdc) as Address;
const VAULT = (env("CAMPAIGN_VAULT") ?? deployment.vault) as Address;
const AUCTION = (env("AD_AUCTION") ?? deployment.auction) as Address;
const SETTLEMENT = (env("PAYOUT_SETTLEMENT") ?? deployment.settlement) as Address;
const VIEW_THRESHOLD_MS = Number(env("VIEW_THRESHOLD_MS") ?? 3000);
const PER_KEY_DAILY_CAP = Number(env("PER_KEY_DAILY_CAP") ?? 2000);
const KILLSWITCH = env("KILLSWITCH") === "1";
const ORACLE_PRIVATE_KEY = env("ORACLE_PRIVATE_KEY") as Hex;
const PUBLIC_URL = env("PUBLIC_URL") ?? "https://promptpay.functions.supabase.co/server";

const RPC_URLS = [
  env("RPC_URL") ?? "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
  "https://rpc-testnet.monadinfra.com",
].filter((u, i, a) => u && a.indexOf(u) === i);

const chain = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
});
const transport = fallback(RPC_URLS.map((u) => http(u, { retryCount: 3, retryDelay: 300 })));
const publicClient = createPublicClient({ chain, transport });
const oracle = privateKeyToAccount(ORACLE_PRIVATE_KEY);
const oracleClient = createWalletClient({ account: oracle, chain, transport });

const sql = postgres(env("SUPABASE_DB_URL")!, { prepare: false });

// ---- helpers ----
const now = () => Date.now();
const creativeHashOf = (text: string, clickUrl: string) => keccak256(toHex(`${text}\n${clickUrl}`));
const domain = new URL(PUBLIC_URL).host;
const reportUri = `${PUBLIC_URL}/report`;
const TURNSTILE_SECRET = env("TURNSTILE_SECRET");

const enrollMessage = (wallet: string, issuedAt: string) =>
  ["PromptPay Enroll v1", `wallet: ${wallet.toLowerCase()}`, `issuedAt: ${issuedAt}`].join("\n");

async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true; // not configured (dev) → skip the human check
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token ?? "" }),
    });
    return !!(await res.json()).success;
  } catch {
    return false;
  }
}

async function isEnrolled(wallet: string): Promise<boolean> {
  const [r] = await sql`select 1 from enrollments where wallet = ${wallet.toLowerCase()}`;
  return !!r;
}
const randomHex = (bytes: number) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return "0x" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
};

function canonicalMessage(a: { agent: string; nonce: string; issuedAt: string; rawBody: string }) {
  return [
    "PromptPay Report v1",
    `domain: ${domain}`,
    `uri: ${reportUri}`,
    `agent: ${a.agent.toLowerCase()}`,
    `nonce: ${a.nonce}`,
    `issuedAt: ${a.issuedAt}`,
    `body: ${keccak256(toHex(a.rawBody))}`,
  ].join("\n");
}

// chain reads
async function readBoard() {
  const [ids, advertisers, prices, balances, actives] = (await publicClient.readContract({
    address: AUCTION,
    abi: auctionAbi,
    functionName: "board",
  })) as [bigint[], Address[], bigint[], bigint[], boolean[]];
  return ids.map((id, i) => ({
    id,
    advertiser: advertisers[i],
    price: prices[i],
    balance: balances[i],
    active: actives[i],
  }));
}
const readTopBid = async () =>
  (await publicClient.readContract({ address: AUCTION, abi: auctionAbi, functionName: "topBid" })) as [bigint, bigint];
const readCampaign = (id: bigint) =>
  publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "campaignOf", args: [id] }) as Promise<
    { advertiser: Address; balance: bigint; pricePerSlot: bigint; creativeHash: Hex; active: boolean }
  >;
const readClaimable = (addr: Address) =>
  publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "claimable", args: [addr] }) as Promise<bigint>;

// Settle every pending batch, serialized across invocations by an advisory lock
// so the oracle nonce never races.
async function settlePending(): Promise<{ settled: number; failed: number }> {
  let settled = 0;
  let failed = 0;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(911911)`;
    const rows = await tx`select * from pending where impressions > 0 or clicks > 0`;
    for (const b of rows) {
      const receiptId = randomHex(32) as Hex;
      try {
        const hash = await oracleClient.writeContract({
          address: SETTLEMENT,
          abi: settlementAbi,
          functionName: "settleBatch",
          args: [receiptId, BigInt(b.campaign_id), b.earner as Address, b.human_id as Hex, BigInt(b.impressions), BigInt(b.clicks)],
        });
        await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
        await tx`delete from pending where campaign_id=${b.campaign_id} and earner=${b.earner} and human_id=${b.human_id}`;
        await tx`insert into receipts (receipt_id, campaign_id, earner, human_id, impressions, clicks, tx_hash, settled_at)
                 values (${receiptId}, ${b.campaign_id}, ${b.earner}, ${b.human_id}, ${b.impressions}, ${b.clicks}, ${hash}, ${now()})`;
        settled++;
      } catch (e) {
        failed++;
        console.error("settle failed (left pending):", (e as Error).message);
      }
    }
  });
  return { settled, failed };
}

// ---- routes ----
const app = new Hono().basePath("/server");
app.use("*", cors());

app.get("/health", (c) =>
  c.json({ service: "promptpay-server", runtime: "supabase-edge", chainId: CHAIN_ID, contracts: { usdc: USDC, vault: VAULT, auction: AUCTION, settlement: SETTLEMENT } })
);

app.get("/killswitch", (c) => c.json({ killed: KILLSWITCH }));

app.get("/ad", async (c) => {
  if (KILLSWITCH) return c.json({ ad: null, reason: "killswitch" });
  const board = await readBoard();
  const eligible: { row: (typeof board)[number]; creative: Record<string, unknown> }[] = [];
  for (const r of board) {
    if (!(r.active && r.price > 0n && r.balance >= r.price)) continue;
    const [cr] = await sql`select * from creatives where campaign_id = ${r.id.toString()}`;
    if (cr) eligible.push({ row: r, creative: cr });
  }
  if (eligible.length === 0) return c.json({ ad: null, reason: "no_eligible_campaigns" });

  const total = eligible.reduce((s, e) => s + e.row.price, 0n);
  let roll = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) % total;
  let picked = eligible[0];
  for (const e of eligible) {
    if (roll < e.row.price) { picked = e; break; }
    roll -= e.row.price;
  }
  const cr = picked.creative;
  return c.json({
    ad: {
      adId: cr.creative_hash,
      campaignId: picked.row.id.toString(),
      adText: cr.text,
      clickUrl: cr.click_url,
      icon: cr.icon,
      pricePerSlot: picked.row.price.toString(),
    },
    viewThresholdMs: VIEW_THRESHOLD_MS,
  });
});

const campaignBody = z.object({
  campaignId: z.string().regex(/^\d+$/),
  advertiser: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  text: z.string().min(1).max(120),
  clickUrl: z.string().url().max(300),
  icon: z.string().url().max(300).optional(),
});

app.post("/campaigns", async (c) => {
  const parsed = campaignBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_body", detail: parsed.error.flatten() }, 400);
  const { campaignId, advertiser, text, clickUrl, icon } = parsed.data;

  const onchain = await readCampaign(BigInt(campaignId));
  if (onchain.advertiser === "0x0000000000000000000000000000000000000000") return c.json({ error: "unknown_campaign" }, 404);
  if (onchain.advertiser.toLowerCase() !== advertiser.toLowerCase()) return c.json({ error: "not_campaign_advertiser" }, 403);
  const hash = creativeHashOf(text, clickUrl);
  if (onchain.creativeHash.toLowerCase() !== hash.toLowerCase()) return c.json({ error: "creative_hash_mismatch", expected: onchain.creativeHash, got: hash }, 409);

  await sql`insert into creatives (campaign_id, advertiser, text, click_url, icon, creative_hash, created_at)
            values (${campaignId}, ${advertiser.toLowerCase()}, ${text}, ${clickUrl}, ${icon ?? null}, ${hash}, ${now()})
            on conflict (campaign_id) do update set text=excluded.text, click_url=excluded.click_url, icon=excluded.icon, creative_hash=excluded.creative_hash`;
  return c.json({ ok: true, campaignId, creativeHash: hash });
});

const reportBody = z.object({
  campaignId: z.string().regex(/^\d+$/),
  type: z.enum(["impression", "click"]),
  surface: z.string().max(64).optional(),
  payout: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

app.post("/report", async (c) => {
  if (KILLSWITCH) return c.json({ error: "killswitch" }, 503);
  const agent = c.req.header("x-pp-agent");
  const nonce = c.req.header("x-pp-nonce");
  const issuedAt = c.req.header("x-pp-issued-at");
  const signature = c.req.header("x-pp-signature");

  if (!agent || !nonce || !issuedAt || !signature) {
    const n = randomHex(16).slice(2);
    const issued = now();
    const ttl = 5 * 60 * 1000;
    await sql`insert into challenges (nonce, issued_at, expires_at) values (${n}, ${issued}, ${issued + ttl})`;
    return c.json(
      {
        error: "signature_required",
        challenge: {
          nonce: n,
          issuedAt: new Date(issued).toISOString(),
          expiresAt: new Date(issued + ttl).toISOString(),
          domain,
          uri: reportUri,
          statement: "Sign to report a PromptPay ad event. This costs nothing.",
        },
      },
      402
    );
  }

  const rawBody = await c.req.text();
  const parsed = reportBody.safeParse(JSON.parse(rawBody || "null"));
  if (!parsed.success) return c.json({ error: "bad_body", detail: parsed.error.flatten() }, 400);

  if (!/^0x[0-9a-fA-F]{40}$/.test(agent)) return c.json({ error: "bad_agent_address" }, 401);
  const consumed = await sql`update challenges set used = true where nonce = ${nonce} and used = false and expires_at > ${now()} returning nonce`;
  if (consumed.length !== 1) return c.json({ error: "bad_or_replayed_nonce" }, 401);

  let valid = false;
  try {
    valid = await verifyMessage({ address: agent as Address, message: canonicalMessage({ agent, nonce, issuedAt, rawBody }), signature: signature as Hex });
  } catch { valid = false; }
  if (!valid) return c.json({ error: "bad_signature" }, 401);

  const { campaignId, type, surface, payout } = parsed.data;
  // Earning identity = the payout wallet (the signer just proves the impression).
  // The cap is keyed on the wallet, so extra signing keys give no benefit.
  const earner = (payout ?? agent).toLowerCase();
  const humanId = keccak256(toHex(earner));

  const [cr] = await sql`select 1 from creatives where campaign_id = ${campaignId}`;
  if (!cr) return c.json({ error: "unknown_campaign" }, 404);

  // A wallet must enroll (human check + signature) before it can earn.
  if (!(await isEnrolled(earner))) {
    return c.json({ ok: true, credited: false, reason: "not_enrolled" });
  }

  const units = type === "click" ? 50 : 1;
  const [{ accepted }] = await sql`select accept_units(${earner}, ${units}, ${PER_KEY_DAILY_CAP}, ${now()}) as accepted`;
  if (accepted === 0) return c.json({ ok: true, credited: false, capped: true });
  const impressions = type === "impression" ? 1 : 0;
  const clicks = type === "click" && accepted === 50 ? 1 : 0;
  if (impressions === 0 && clicks === 0) return c.json({ ok: true, credited: false, capped: true });

  await sql`insert into pending (campaign_id, earner, human_id, impressions, clicks, updated_at)
            values (${campaignId}, ${earner}, ${humanId}, ${impressions}, ${clicks}, ${now()})
            on conflict (campaign_id, earner, human_id) do update
              set impressions = pending.impressions + excluded.impressions,
                  clicks = pending.clicks + excluded.clicks, updated_at = excluded.updated_at`;
  await sql`insert into events_log (campaign_id, surface, type, earner, created_at) values (${campaignId}, ${surface ?? null}, ${type}, ${earner}, ${now()})`;

  // settle on report (serialized by advisory lock). Prefer waitUntil so the
  // background settlement can't be torn down when the response returns.
  const settleP = settlePending().catch((e) => console.error("settle error:", (e as Error).message));
  const er = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(settleP);
  else await settleP;
  return c.json({ ok: true, credited: true, capped: accepted < units, earner, campaignId });
});

app.get("/earnings/:address", async (c) => {
  const address = c.req.param("address");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: "bad_address" }, 400);
  const claimable = await readClaimable(address as Address);
  const rows = await sql`select impressions, clicks from pending where earner = ${address.toLowerCase()}`;
  const pendingUnits = rows.reduce((s, r) => s + r.impressions + r.clicks * 50, 0);
  return c.json({ address, claimable: claimable.toString(), pendingUnits });
});

app.get("/auction", async (c) => {
  const [[winnerId, price], board] = await Promise.all([readTopBid(), readBoard()]);
  const creatives = await sql`select campaign_id, text from creatives`;
  const textOf = (id: string) => creatives.find((r) => r.campaign_id === id)?.text ?? null;
  return c.json({
    winner: winnerId === 0n ? null : { campaignId: winnerId.toString(), price: price.toString() },
    board: board.map((r) => ({
      campaignId: r.id.toString(),
      advertiser: r.advertiser,
      pricePerSlot: r.price.toString(),
      balance: r.balance.toString(),
      active: r.active,
      creative: textOf(r.id.toString()),
    })),
  });
});

app.get("/activity", async (c) => {
  const events = await sql`select * from events_log order by id desc limit 50`;
  const receipts = await sql`select * from receipts order by settled_at desc limit 100`;
  return c.json({ events, receipts });
});

const enrollBody = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  issuedAt: z.string(),
  signature: z.string(),
  turnstileToken: z.string().optional(),
});

app.post("/enroll", async (c) => {
  const parsed = enrollBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_body", detail: parsed.error.flatten() }, 400);
  const { wallet, issuedAt, signature, turnstileToken } = parsed.data;

  const t = Date.parse(issuedAt);
  if (!t || Math.abs(now() - t) > 10 * 60 * 1000) return c.json({ error: "stale_issuedAt" }, 400);
  if (!(await verifyTurnstile(turnstileToken))) return c.json({ error: "human_check_failed" }, 403);

  let ok = false;
  try {
    ok = await verifyMessage({ address: wallet as Address, message: enrollMessage(wallet, issuedAt), signature: signature as Hex });
  } catch { ok = false; }
  if (!ok) return c.json({ error: "bad_signature" }, 401);

  await sql`insert into enrollments (wallet, enrolled_at) values (${wallet.toLowerCase()}, ${now()})
            on conflict (wallet) do update set enrolled_at = excluded.enrolled_at`;
  return c.json({ ok: true, enrolled: true });
});

app.get("/enrolled/:wallet", async (c) => {
  const wallet = c.req.param("wallet");
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return c.json({ error: "bad_address" }, 400);
  return c.json({ wallet: wallet.toLowerCase(), enrolled: await isEnrolled(wallet) });
});

app.post("/settle/flush", async (c) => c.json(await settlePending()));

Deno.serve(app.fetch);
