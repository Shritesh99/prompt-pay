import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { keccak256, toHex, type Address } from "viem";
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
  const { agent: signer, humanId } = verdict.verified;

  const { campaignId, type, surface, payout } = parsed.data;
  if (!store.getCreative(campaignId)) return c.json({ error: "unknown_campaign" }, 404);

  // The signer proves the impression; the payout wallet (if given) is who gets
  // paid. The daily cap stays keyed on humanId (the signing key), so declaring
  // a payout can't be used to exceed a cap.
  const earner = payout ?? signer;

  const units = type === "click" ? 50 : 1;
  const accepted = store.acceptUnits(humanId, units, config.perKeyDailyCap);
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
  const [{ winnerId, price }, board] = await Promise.all([readTopBid(), readBoard()]);
  return c.json({
    winner: winnerId === 0n ? null : { campaignId: winnerId.toString(), price: price.toString() },
    board: board.map((r) => ({
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

app.post("/settle/flush", async (c) => c.json(await flushSettlements()));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `[promptpay-server] ${config.network} (chain ${config.chainId}) on http://localhost:${info.port}`
  );
  startSettleLoop();
});
