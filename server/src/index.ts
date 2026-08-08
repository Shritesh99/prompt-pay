import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { keccak256, toHex, verifyMessage, type Address } from "viem";
import { z } from "zod";
import { config } from "./config.js";
import { store } from "./db.js";
import { readBoard, readCampaign, readClaimable, readTopBid } from "./chain.js";
import { issueChallenge, verifyReport } from "./auth.js";
import { flushSettlements, startSettleLoop } from "./settle.js";

export function creativeHashOf(text: string, clickUrl: string): `0x${string}` {
  return keccak256(toHex(`${text}\n${clickUrl}`));
}

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    service: "promptpay-server",
    network: config.network,
    chainId: config.chainId,
    contracts: {
      usdc: config.usdc,
      vault: config.vault,
      auction: config.auction,
      settlement: config.settlement,
    },
  })
);

app.get("/killswitch", (c) => c.json({ killed: config.killswitch }));

// ---- ad serving ----

app.get("/ad", async (c) => {
  if (config.killswitch) return c.json({ ad: null, reason: "killswitch" });
  const board = await readBoard();
  const eligible = board
    .filter((r) => r.active && r.price > 0n && r.balance >= r.price)
    .map((r) => ({ row: r, creative: store.getCreative(r.id.toString()) }))
    .filter((e) => e.creative !== undefined);
  if (eligible.length === 0) return c.json({ ad: null, reason: "no_eligible_campaigns" });

  // Bid-weighted random pick: the top bidder shows most, but every funded
  // advertiser rotates in with probability proportional to their bid.
  const total = eligible.reduce((sum, e) => sum + e.row.price, 0n);
  let roll = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) % total;
  let picked = eligible[0];
  for (const e of eligible) {
    if (roll < e.row.price) {
      picked = e;
      break;
    }
    roll -= e.row.price;
  }

  const creative = picked.creative!;
  return c.json({
    ad: {
      adId: creative.creative_hash,
      campaignId: picked.row.id.toString(),
      adText: creative.text,
      clickUrl: creative.click_url,
      icon: creative.icon,
      pricePerSlot: picked.row.price.toString(),
    },
    viewThresholdMs: config.viewThresholdMs,
  });
});

// ---- advertiser creative registration ----

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
  if (onchain.advertiser === "0x0000000000000000000000000000000000000000") {
    return c.json({ error: "unknown_campaign" }, 404);
  }
  if (onchain.advertiser.toLowerCase() !== advertiser.toLowerCase()) {
    return c.json({ error: "not_campaign_advertiser" }, 403);
  }
  const hash = creativeHashOf(text, clickUrl);
  if (onchain.creativeHash.toLowerCase() !== hash.toLowerCase()) {
    return c.json({ error: "creative_hash_mismatch", expected: onchain.creativeHash, got: hash }, 409);
  }

  store.upsertCreative({
    campaign_id: campaignId,
    advertiser: advertiser.toLowerCase(),
    text,
    click_url: clickUrl,
    icon: icon ?? null,
    creative_hash: hash,
  });
  return c.json({ ok: true, campaignId, creativeHash: hash });
});

// ---- earning ----

const reportBody = z.object({
  campaignId: z.string().regex(/^\d+$/),
  type: z.enum(["impression", "click"]),
  surface: z.string().max(64).optional(),
  // Optional payout address: the signer authenticates the report, but earnings
  // are credited here (the earner's real wallet). Bound into the signature via
  // the body hash, so it can't be tampered with.
  payout: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

app.post("/report", async (c) => {
  if (config.killswitch) return c.json({ error: "killswitch" }, 503);

  const agent = c.req.header("x-pp-agent");
  const nonce = c.req.header("x-pp-nonce");
  const issuedAt = c.req.header("x-pp-issued-at");
  const signature = c.req.header("x-pp-signature");

  if (!agent || !nonce || !issuedAt || !signature) {
    return c.json({ error: "signature_required", challenge: issueChallenge() }, 402);
  }

  const rawBody = await c.req.text();
  const parsed = reportBody.safeParse(JSON.parse(rawBody || "null"));
  if (!parsed.success) return c.json({ error: "bad_body", detail: parsed.error.flatten() }, 400);

  const verdict = await verifyReport({ agent, nonce, issuedAt, signature, rawBody });
  if (!verdict.ok) return c.json({ error: verdict.error }, 401);
  const { agent: signer } = verdict.verified;

  const { campaignId, type, surface, payout } = parsed.data;
  if (!store.getCreative(campaignId)) return c.json({ error: "unknown_campaign" }, 404);

  // Earning identity = the payout wallet (the signer just proves the impression).
  // Cap is keyed on the wallet, so extra signing keys give no benefit.
  const earner = (payout ?? signer).toLowerCase() as Address;
  const humanId = keccak256(toHex(earner));

  // A wallet must enroll (human check + signature) before it can earn.
  if (!store.isEnrolled(earner)) {
    return c.json({ ok: true, credited: false, reason: "not_enrolled" });
  }

  const units = type === "click" ? 50 : 1;
  const accepted = store.acceptUnits(earner, units, config.perKeyDailyCap);
  if (accepted === 0) {
    return c.json({ ok: true, credited: false, capped: true });
  }
  // partial acceptance near the cap: only bill what fit
  const impressions = type === "impression" ? 1 : 0;
  const clicks = type === "click" && accepted === 50 ? 1 : 0;
  if (impressions === 0 && clicks === 0) {
    return c.json({ ok: true, credited: false, capped: true });
  }

  store.addPending(campaignId, earner.toLowerCase(), humanId, impressions, clicks);
  store.logEvent(campaignId, type, earner.toLowerCase(), surface);
  return c.json({ ok: true, credited: true, capped: accepted < units, earner, campaignId });
});

app.get("/earnings/:address", async (c) => {
  const address = c.req.param("address");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: "bad_address" }, 400);
  const claimable = await readClaimable(address as Address);
  const pendingRows = store
    .takePending()
    .filter((r) => r.earner === address.toLowerCase());
  const pendingUnits = pendingRows.reduce((s, r) => s + r.impressions + r.clicks * 50, 0);
  return c.json({ address, claimable: claimable.toString(), pendingUnits });
});

// ---- dashboards ----

app.get("/auction", async (c) => {
  const board = await readBoard();
  // Only campaigns with a registered creative (i.e. that can actually serve),
  // hiding leftover on-chain test campaigns.
  const registered = board.filter((r) => store.getCreative(r.id.toString()));
  let winner: { campaignId: string; price: string } | null = null;
  for (const r of registered) {
    if (r.active && r.price > 0n && r.balance >= r.price && (!winner || r.price > BigInt(winner.price))) {
      winner = { campaignId: r.id.toString(), price: r.price.toString() };
    }
  }
  return c.json({
    winner,
    board: registered.map((r) => ({
      campaignId: r.id.toString(),
      advertiser: r.advertiser,
      pricePerSlot: r.price.toString(),
      balance: r.balance.toString(),
      active: r.active,
      creative: store.getCreative(r.id.toString())?.text ?? null,
    })),
  });
});

app.get("/activity", (c) =>
  c.json({ events: store.recentEvents(), receipts: store.recentReceipts() })
);

const enrollMessage = (wallet: string, issuedAt: string) =>
  ["PromptPay Enroll v1", `wallet: ${wallet.toLowerCase()}`, `issuedAt: ${issuedAt}`].join("\n");

async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // not configured (local dev) → skip the human check
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token ?? "" }),
    });
    return !!((await res.json()) as { success: boolean }).success;
  } catch {
    return false;
  }
}

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
  if (!t || Math.abs(Date.now() - t) > 10 * 60 * 1000) return c.json({ error: "stale_issuedAt" }, 400);
  if (!(await verifyTurnstile(turnstileToken))) return c.json({ error: "human_check_failed" }, 403);

  let ok = false;
  try {
    ok = await verifyMessage({ address: wallet as Address, message: enrollMessage(wallet, issuedAt), signature: signature as `0x${string}` });
  } catch {
    ok = false;
  }
  if (!ok) return c.json({ error: "bad_signature" }, 401);

  store.enroll(wallet);
  return c.json({ ok: true, enrolled: true });
});

app.get("/enrolled/:wallet", (c) => {
  const wallet = c.req.param("wallet");
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return c.json({ error: "bad_address" }, 400);
  return c.json({ wallet: wallet.toLowerCase(), enrolled: store.isEnrolled(wallet) });
});

app.post("/settle/flush", async (c) => c.json(await flushSettlements()));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `[promptpay-server] ${config.network} (chain ${config.chainId}) on http://localhost:${info.port}`
  );
  startSettleLoop();
});
