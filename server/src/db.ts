import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS creatives (
  campaign_id TEXT PRIMARY KEY,
  advertiser TEXT NOT NULL,
  text TEXT NOT NULL,
  click_url TEXT NOT NULL,
  icon TEXT,
  creative_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS usage (
  key TEXT PRIMARY KEY,
  units INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending (
  campaign_id TEXT NOT NULL,
  earner TEXT NOT NULL,
  human_id TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, earner, human_id)
);
CREATE TABLE IF NOT EXISTS receipts (
  receipt_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  earner TEXT NOT NULL,
  human_id TEXT NOT NULL,
  impressions INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  settled_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  surface TEXT,
  type TEXT NOT NULL,
  earner TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

export type Creative = {
  campaign_id: string;
  advertiser: string;
  text: string;
  click_url: string;
  icon: string | null;
  creative_hash: string;
  created_at: number;
};

export type PendingRow = {
  campaign_id: string;
  earner: string;
  human_id: string;
  impressions: number;
  clicks: number;
  updated_at: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const store = {
  upsertCreative(c: Omit<Creative, "created_at">) {
    db.prepare(
      `INSERT INTO creatives (campaign_id, advertiser, text, click_url, icon, creative_hash, created_at)
       VALUES (@campaign_id, @advertiser, @text, @click_url, @icon, @creative_hash, @created_at)
       ON CONFLICT(campaign_id) DO UPDATE SET
         text=@text, click_url=@click_url, icon=@icon, creative_hash=@creative_hash`
    ).run({ ...c, created_at: Date.now() });
  },

  getCreative(campaignId: string): Creative | undefined {
    return db.prepare(`SELECT * FROM creatives WHERE campaign_id = ?`).get(campaignId) as
      | Creative
      | undefined;
  },

  // ---- auth ----

  saveChallenge(nonce: string, issuedAt: number, expiresAt: number) {
    db.prepare(`INSERT INTO challenges (nonce, issued_at, expires_at) VALUES (?, ?, ?)`).run(
      nonce,
      issuedAt,
      expiresAt
    );
  },

  /** Returns true if the nonce existed, was unused and unexpired; marks it used atomically. */
  consumeChallenge(nonce: string): boolean {
    const res = db
      .prepare(`UPDATE challenges SET used = 1 WHERE nonce = ? AND used = 0 AND expires_at > ?`)
      .run(nonce, Date.now());
    return res.changes === 1;
  },

  // ---- caps ----

  /** Rolling-24h per-key cap with partial acceptance. Returns how many units were accepted. */
  acceptUnits(key: string, units: number, cap: number): number {
    const now = Date.now();
    const accept = db.transaction((): number => {
      const row = db.prepare(`SELECT units, window_start FROM usage WHERE key = ?`).get(key) as
        | { units: number; window_start: number }
        | undefined;
      let used = 0;
      let windowStart = now;
      if (row && now - row.window_start < DAY_MS) {
        used = row.units;
        windowStart = row.window_start;
      }
      const room = Math.max(0, cap - used);
      const accepted = Math.min(units, room);
      if (accepted > 0 || !row) {
        db.prepare(
          `INSERT INTO usage (key, units, window_start) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET units = ?, window_start = ?`
        ).run(key, used + accepted, windowStart, used + accepted, windowStart);
      }
      return accepted;
    });
    return accept();
  },

  // ---- pending settlement ----

  addPending(campaignId: string, earner: string, humanId: string, impressions: number, clicks: number) {
    db.prepare(
      `INSERT INTO pending (campaign_id, earner, human_id, impressions, clicks, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, earner, human_id) DO UPDATE SET
         impressions = impressions + excluded.impressions,
         clicks = clicks + excluded.clicks,
         updated_at = excluded.updated_at`
    ).run(campaignId, earner, humanId, impressions, clicks, Date.now());
  },

  takePending(): PendingRow[] {
    return db
      .prepare(`SELECT * FROM pending WHERE impressions > 0 OR clicks > 0`)
      .all() as PendingRow[];
  },

  /** Subtract the settled amounts (new reports may have landed mid-flight). */
  clearPending(row: PendingRow) {
    db.prepare(
      `UPDATE pending SET impressions = impressions - ?, clicks = clicks - ?
       WHERE campaign_id = ? AND earner = ? AND human_id = ?`
    ).run(row.impressions, row.clicks, row.campaign_id, row.earner, row.human_id);
    db.prepare(`DELETE FROM pending WHERE impressions <= 0 AND clicks <= 0`).run();
  },

  recordReceipt(r: {
    receipt_id: string;
    campaign_id: string;
    earner: string;
    human_id: string;
    impressions: number;
    clicks: number;
    tx_hash: string;
  }) {
    db.prepare(
      `INSERT INTO receipts (receipt_id, campaign_id, earner, human_id, impressions, clicks, tx_hash, settled_at)
       VALUES (@receipt_id, @campaign_id, @earner, @human_id, @impressions, @clicks, @tx_hash, @settled_at)`
    ).run({ ...r, settled_at: Date.now() });
  },

  // ---- activity feed ----

  logEvent(campaignId: string, type: string, earner: string, surface?: string) {
    db.prepare(
      `INSERT INTO events_log (campaign_id, surface, type, earner, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(campaignId, surface ?? null, type, earner, Date.now());
  },

  recentEvents(limit = 50) {
    return db.prepare(`SELECT * FROM events_log ORDER BY id DESC LIMIT ?`).all(limit);
  },

  recentReceipts(limit = 100) {
    return db.prepare(`SELECT * FROM receipts ORDER BY settled_at DESC LIMIT ?`).all(limit);
  },
};
