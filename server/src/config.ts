import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const network = process.env.PROMPTPAY_NETWORK ?? "anvil";
const deploymentFile =
  process.env.DEPLOYMENT_FILE ??
  path.resolve(here, "../../contracts/deployments", `${network}.json`);

const deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as {
  chainId: number;
  usdc: `0x${string}`;
  vault: `0x${string}`;
  auction: `0x${string}`;
  settlement: `0x${string}`;
  treasury: `0x${string}`;
  oracle: `0x${string}`;
};

const defaultRpc =
  network === "monad" ? "https://testnet-rpc.monad.xyz" : "http://127.0.0.1:8546";

// anvil funded key #0 — local dev fallback only; real deployments must set ORACLE_PRIVATE_KEY
const DEV_ORACLE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const port = Number(process.env.PORT ?? 4021);

export const config = {
  network,
  port,
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
  rpcUrl: process.env.RPC_URL ?? defaultRpc,
  chainId: Number(process.env.CHAIN_ID ?? deployment.chainId),
  usdc: (process.env.USDC_ADDRESS ?? deployment.usdc) as `0x${string}`,
  vault: (process.env.CAMPAIGN_VAULT ?? deployment.vault) as `0x${string}`,
  auction: (process.env.AD_AUCTION ?? deployment.auction) as `0x${string}`,
  settlement: (process.env.PAYOUT_SETTLEMENT ?? deployment.settlement) as `0x${string}`,
  treasury: (process.env.TREASURY ?? deployment.treasury) as `0x${string}`,
  oraclePrivateKey: (process.env.ORACLE_PRIVATE_KEY ??
    (network === "anvil" ? DEV_ORACLE_KEY : "")) as `0x${string}`,
  viewThresholdMs: Number(process.env.VIEW_THRESHOLD_MS ?? 3000),
  settleIntervalMs: Number(process.env.SETTLE_INTERVAL_MS ?? 15_000),
  perKeyDailyCap: Number(process.env.PER_KEY_DAILY_CAP ?? 2000),
  killswitch: process.env.KILLSWITCH === "1",
  dbPath: process.env.DB_PATH ?? path.resolve(here, "../data", `${network}.db`),
};

if (!config.oraclePrivateKey) {
  throw new Error(`ORACLE_PRIVATE_KEY is required for network "${network}"`);
}
