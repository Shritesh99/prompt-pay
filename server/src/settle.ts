import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import { config } from "./config.js";
import { store, type PendingRow } from "./db.js";
import { settleBatchOnChain } from "./chain.js";

let running = false;

/**
 * Pushes every pending (campaign, earner, humanId) batch on-chain. Pending
 * rows are decremented only after the tx confirms, so a crash mid-flush never
 * loses credit — the on-chain receipt-replay guard makes a rare double submit
 * of the same receiptId harmless (it reverts).
 */
export async function flushSettlements(): Promise<{ settled: number; failed: number }> {
  if (running) return { settled: 0, failed: 0 };
  running = true;
  let settled = 0;
  let failed = 0;
  try {
    const batches: PendingRow[] = store.takePending();
    for (const batch of batches) {
      const receiptId = ("0x" + randomBytes(32).toString("hex")) as Hex;
      try {
        const txHash = await settleBatchOnChain({
          receiptId,
          campaignId: BigInt(batch.campaign_id),
          earner: batch.earner as Address,
          humanId: batch.human_id as Hex,
          impressions: BigInt(batch.impressions),
          clicks: BigInt(batch.clicks),
        });
        store.clearPending(batch);
        store.recordReceipt({
          receipt_id: receiptId,
          campaign_id: batch.campaign_id,
          earner: batch.earner,
          human_id: batch.human_id,
          impressions: batch.impressions,
          clicks: batch.clicks,
          tx_hash: txHash,
        });
        settled++;
        console.log(
          `[settle] campaign ${batch.campaign_id} earner ${batch.earner} ` +
            `${batch.impressions} impr + ${batch.clicks} clicks → ${txHash}`
        );
      } catch (err) {
        failed++;
        console.error(`[settle] batch failed (left pending):`, (err as Error).message);
      }
    }
  } finally {
    running = false;
  }
  return { settled, failed };
}

export function startSettleLoop() {
  setInterval(() => {
    flushSettlements().catch((err) => console.error("[settle] loop error:", err));
  }, config.settleIntervalMs);
  console.log(`[settle] loop every ${config.settleIntervalMs}ms as oracle`);
}
