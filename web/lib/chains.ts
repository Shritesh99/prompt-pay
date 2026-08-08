import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
  testnet: true,
});

export const promptpayLocal = defineChain({
  id: 31338,
  name: "PromptPay Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
  testnet: true,
});

export const NETWORK = process.env.NEXT_PUBLIC_PP_NETWORK ?? "anvil";
export const activeChain = NETWORK === "monad" ? monadTestnet : promptpayLocal;
// Hosted ad-server (Supabase Edge Function) — the default when no override is
// set. The web resolves the live value at runtime from /api/deployment.
export const DEFAULT_SERVER_BASE =
  "https://fvwbsbbhzzxdxalyuczw.supabase.co/functions/v1/server";
export const SERVER_BASE = process.env.NEXT_PUBLIC_SERVER_BASE ?? DEFAULT_SERVER_BASE;

export function explorerTx(hash: string): string | null {
  const base = activeChain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}
