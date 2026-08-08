// Headless proof of the full money loop against a running stack:
//   fresh earner key -> 402 challenge -> signed impressions + click ->
//   nonce-replay rejected -> settle on-chain -> claimable == exact 50% ->
//   claim -> USDC lands in the earner wallet.
// Usage: node scripts/e2e.mjs [network]   (stack must be up and seeded)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const network = process.argv[2] ?? process.env.PROMPTPAY_NETWORK ?? "anvil";
const serverBase = process.env.SERVER_BASE ?? "http://localhost:4021";
const deployment = JSON.parse(
  readFileSync(path.join(root, "contracts/deployments", `${network}.json`), "utf8")
);
const rpcUrl =
  process.env.RPC_URL ?? (network === "monad" ? "https://testnet-rpc.monad.xyz" : "http://127.0.0.1:8546");
const gasKey =
  process.env.GAS_FUNDER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0

const IMPRESSIONS = Number(process.env.E2E_IMPRESSIONS ?? 5);
const CLICKS = 1;

const chain = defineChain({
  id: deployment.chainId,
  name: network,
  nativeCurrency: { name: "n", symbol: "n", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const abi = (name, file) =>
  JSON.parse(readFileSync(path.join(root, "contracts/out", file, `${name}.json`), "utf8")).abi;
const vaultAbi = abi("CampaignVault", "CampaignVault.sol");
const usdcAbi = abi("MockUSDC", "MockUSDC.sol");

const earnerKey = generatePrivateKey();
const earner = privateKeyToAccount(earnerKey);
console.log("earner:", earner.address);

// --- fetch the live ad ---
const adRes = await (await fetch(`${serverBase}/ad`)).json();
assert.ok(adRes.ad, "no ad being served — seed a campaign first");
const { campaignId, pricePerSlot } = adRes.ad;
console.log(`ad: campaign ${campaignId} @ ${pricePerSlot}/slot`);

// --- signed reporting (402 challenge -> EIP-191 -> retry) ---
async function report(type) {
  const body = JSON.stringify({ campaignId, type, surface: "e2e" });
  const bare = await fetch(`${serverBase}/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(bare.status, 402, "expected 402 challenge without signature");
  const { challenge } = await bare.json();

  const message = [
    "PromptPay Report v1",
    `domain: ${challenge.domain}`,
    `uri: ${challenge.uri}`,
    `agent: ${earner.address.toLowerCase()}`,
    `nonce: ${challenge.nonce}`,
    `issuedAt: ${challenge.issuedAt}`,
    `body: ${keccak256(toHex(body))}`,
  ].join("\n");
  const signature = await earner.signMessage({ message });
  const headers = {
    "content-type": "application/json",
    "x-pp-agent": earner.address,
    "x-pp-nonce": challenge.nonce,
    "x-pp-issued-at": challenge.issuedAt,
    "x-pp-signature": signature,
  };
  const signed = await fetch(`${serverBase}/report`, { method: "POST", headers, body });
  const out = await signed.json();
  assert.equal(signed.status, 200, `report failed: ${JSON.stringify(out)}`);
  assert.equal(out.credited, true, `not credited: ${JSON.stringify(out)}`);
  return { headers, body };
}

let last;
for (let i = 0; i < IMPRESSIONS; i++) last = await report("impression");
await report("click");
console.log(`reported ${IMPRESSIONS} impressions + ${CLICKS} click`);

// --- replayed nonce must be rejected ---
const replay = await fetch(`${serverBase}/report`, {
  method: "POST",
  headers: last.headers,
  body: last.body,
});
assert.equal(replay.status, 401, "nonce replay should be rejected");
console.log("nonce replay rejected ✓");

// --- settle ---
// Two settlement models: the Node server batches on /settle/flush; the Supabase
// edge function settles on report. Trigger a flush (harmless either way) and
// then poll on-chain claimable until it reaches the expected split.
const units = BigInt(IMPRESSIONS) + BigInt(CLICKS) * 50n;
const cost = (units * BigInt(pricePerSlot)) / 1000n;
const expectedEarnerShare = (cost * 5000n) / 10000n;

let claimable = 0n;
for (let i = 0; i < 15; i++) {
  await fetch(`${serverBase}/settle/flush`, { method: "POST" }).catch(() => {});
  claimable = await pub.readContract({
    address: deployment.vault,
    abi: vaultAbi,
    functionName: "claimable",
    args: [earner.address],
  });
  if (claimable >= expectedEarnerShare) break;
  await new Promise((r) => setTimeout(r, 2000));
}
assert.equal(claimable, expectedEarnerShare, `claimable ${claimable} != expected ${expectedEarnerShare}`);
console.log(`on-chain claimable == exact 50% share (${claimable} base units) ✓`);

// --- claim: fund gas, claimAll, assert USDC lands ---
// The funder often shares an account with the server's settlement oracle, so a
// same-nonce oracle tx can replace our transfer (viem's receipt wait follows
// replacements silently). Verify arrival and retry until the gas lands.
const funder = createWalletClient({ account: privateKeyToAccount(gasKey), chain, transport: http(rpcUrl) });
const GAS_DRIP = 5n * 10n ** 16n; // 0.05 native
for (let i = 0; i < 6; i++) {
  const bal = await pub.getBalance({ address: earner.address });
  if (bal >= GAS_DRIP / 2n) break;
  if (i === 5) throw new Error("could not fund earner gas after retries");
  try {
    const gasTx = await funder.sendTransaction({ to: earner.address, value: GAS_DRIP });
    await pub.waitForTransactionReceipt({ hash: gasTx });
  } catch (err) {
    console.log(`  gas funding attempt ${i + 1} failed: ${err.shortMessage ?? err.message}`);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
const earnerWallet = createWalletClient({ account: earner, chain, transport: http(rpcUrl) });
const claimTx = await earnerWallet.writeContract({
  address: deployment.vault,
  abi: vaultAbi,
  functionName: "claimAll",
});
await pub.waitForTransactionReceipt({ hash: claimTx });
const usdcBalance = await pub.readContract({
  address: deployment.usdc,
  abi: usdcAbi,
  functionName: "balanceOf",
  args: [earner.address],
});
assert.equal(usdcBalance, expectedEarnerShare);
console.log(`claimed ${usdcBalance} pUSDC base units to wallet ✓`);
console.log("E2E PASS: report -> settle -> claim, exact 50/50 split");
