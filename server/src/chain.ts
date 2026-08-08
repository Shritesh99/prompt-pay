import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { vaultAbi, auctionAbi, settlementAbi } from "./abis.js";

// Monad's public RPC rate-limits a polling server, so read across a couple of
// endpoints with retries. Extra URLs can be added via RPC_FALLBACKS (csv).
const MONAD_FALLBACKS = [
  "https://rpc.ankr.com/monad_testnet",
  "https://rpc-testnet.monadinfra.com",
];
const rpcUrls = [
  config.rpcUrl,
  ...(process.env.RPC_FALLBACKS?.split(",").map((s) => s.trim()).filter(Boolean) ??
    (config.network === "monad" ? MONAD_FALLBACKS : [])),
].filter((u, i, a) => u && a.indexOf(u) === i);

const transport = fallback(
  rpcUrls.map((url) => http(url, { retryCount: 3, retryDelay: 300 })),
  { rank: false }
);

export const chain = defineChain({
  id: config.chainId,
  name: config.network === "monad" ? "Monad Testnet" : "PromptPay Local",
  nativeCurrency:
    config.network === "monad"
      ? { name: "MON", symbol: "MON", decimals: 18 }
      : { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

export const publicClient = createPublicClient({ chain, transport });

export const oracleAccount = privateKeyToAccount(config.oraclePrivateKey);
export const oracleClient = createWalletClient({
  account: oracleAccount,
  chain,
  transport,
});

export type BoardRow = {
  id: bigint;
  advertiser: Address;
  price: bigint;
  balance: bigint;
  active: boolean;
};

export async function readBoard(): Promise<BoardRow[]> {
  const [ids, advertisers, prices, balances, actives] = await publicClient.readContract({
    address: config.auction,
    abi: auctionAbi,
    functionName: "board",
  });
  return ids.map((id, i) => ({
    id,
    advertiser: advertisers[i],
    price: prices[i],
    balance: balances[i],
    active: actives[i],
  }));
}

export async function readTopBid(): Promise<{ winnerId: bigint; price: bigint }> {
  const [winnerId, price] = await publicClient.readContract({
    address: config.auction,
    abi: auctionAbi,
    functionName: "topBid",
  });
  return { winnerId, price };
}

export async function readCampaign(id: bigint) {
  return publicClient.readContract({
    address: config.vault,
    abi: vaultAbi,
    functionName: "campaignOf",
    args: [id],
  });
}

export async function readClaimable(address: Address): Promise<bigint> {
  return publicClient.readContract({
    address: config.vault,
    abi: vaultAbi,
    functionName: "claimable",
    args: [address],
  });
}

export async function settleBatchOnChain(args: {
  receiptId: Hex;
  campaignId: bigint;
  earner: Address;
  humanId: Hex;
  impressions: bigint;
  clicks: bigint;
}): Promise<Hex> {
  const hash = await oracleClient.writeContract({
    address: config.settlement,
    abi: settlementAbi,
    functionName: "settleBatch",
    args: [
      args.receiptId,
      args.campaignId,
      args.earner,
      args.humanId,
      args.impressions,
      args.clicks,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
}
