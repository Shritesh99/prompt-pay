// Seeds a demo campaign: mints pUSDC, creates + funds + bids a campaign
// on-chain, then registers the creative with the ad-server.
// Usage: node scripts/seed-demo.mjs [network]  (default: anvil; server must be running)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const network = process.argv[2] ?? process.env.PROMPTPAY_NETWORK ?? "anvil";
const serverBase = process.env.SERVER_BASE ?? "http://localhost:4021";
const deployment = JSON.parse(
  readFileSync(path.join(root, "contracts/deployments", `${network}.json`), "utf8")
);
const rpcUrl =
  process.env.RPC_URL ?? (network === "monad" ? "https://testnet-rpc.monad.xyz" : "http://127.0.0.1:8546");
// anvil funded key #0 for local dev; set SEEDER_PRIVATE_KEY on real networks
const key =
  process.env.SEEDER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const abi = (name, file) =>
  JSON.parse(readFileSync(path.join(root, "contracts/out", file, `${name}.json`), "utf8")).abi;
const usdcAbi = abi("MockUSDC", "MockUSDC.sol");
const vaultAbi = abi("CampaignVault", "CampaignVault.sol");
const auctionAbi = abi("AdAuction", "AdAuction.sol");

const chain = defineChain({
  id: deployment.chainId,
  name: network,
  nativeCurrency: { name: "n", symbol: network === "monad" ? "MON" : "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

const TEXT = process.env.AD_TEXT ?? "Ship it on Monad - 10,000 TPS, full EVM";
const CLICK_URL = process.env.AD_URL ?? "https://monad.xyz";
const BUDGET = 100_000_000n; // 100 pUSDC
const PRICE_PER_SLOT = 2_000_000n; // 2 pUSDC per 1000 impressions

async function tx(request) {
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return receipt;
}

const creativeHash = keccak256(toHex(`${TEXT}\n${CLICK_URL}`));
console.log("seeder:", account.address);

await tx({ address: deployment.usdc, abi: usdcAbi, functionName: "mint", args: [account.address, BUDGET] });
await tx({ address: deployment.usdc, abi: usdcAbi, functionName: "approve", args: [deployment.vault, BUDGET] });

const createReceipt = await tx({
  address: deployment.vault,
  abi: vaultAbi,
  functionName: "createCampaign",
  args: [creativeHash],
});
const [created] = parseEventLogs({ abi: vaultAbi, eventName: "CampaignCreated", logs: createReceipt.logs });
const campaignId = created.args.id;
console.log("campaign id:", campaignId.toString());

await tx({ address: deployment.vault, abi: vaultAbi, functionName: "fund", args: [campaignId, BUDGET] });
await tx({ address: deployment.auction, abi: auctionAbi, functionName: "bid", args: [campaignId, PRICE_PER_SLOT] });

const res = await fetch(`${serverBase}/campaigns`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    campaignId: campaignId.toString(),
    advertiser: account.address,
    text: TEXT,
    clickUrl: CLICK_URL,
  }),
});
const body = await res.json();
if (!res.ok) throw new Error(`creative registration failed: ${JSON.stringify(body)}`);
console.log("creative registered:", body.creativeHash);
console.log(`seeded: "${TEXT}" -> ${CLICK_URL} | budget 100 pUSDC @ 2 pUSDC/slot`);
