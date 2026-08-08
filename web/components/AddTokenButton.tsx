"use client";
import { useState } from "react";
import { toHex } from "viem";
import { activeChain } from "../lib/chains";
import { useDeployment } from "../lib/hooks";

// One-click "add pUSDC to MetaMask": make sure the wallet is on the right
// network (add it if missing), then wallet_watchAsset the token. Avoids the
// manual-import failures when MetaMask can't auto-read symbol/decimals.
export function AddTokenButton() {
  const deployment = useDeployment();
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    setMsg(null);
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown }) => Promise<unknown> } }).ethereum;
    if (!eth) {
      setMsg("No injected wallet found — install MetaMask.");
      return;
    }
    if (!deployment) {
      setMsg("Loading token address…");
      return;
    }
    const chainIdHex = toHex(activeChain.id);
    try {
      // ensure the correct network (add it if MetaMask doesn't know it yet)
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
      } catch (e) {
        if ((e as { code?: number }).code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chainIdHex,
                chainName: activeChain.name,
                nativeCurrency: activeChain.nativeCurrency,
                rpcUrls: activeChain.rpcUrls.default.http,
                blockExplorerUrls: activeChain.blockExplorers ? [activeChain.blockExplorers.default.url] : [],
              },
            ],
          });
        } else {
          throw e;
        }
      }

      const added = await eth.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: deployment.usdc, symbol: "pUSDC", decimals: 6 } },
      });
      setMsg(added ? "pUSDC added to MetaMask ✓" : "Import dismissed.");
    } catch (e) {
      setMsg(`Couldn't add token: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      <button onClick={add} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900">
        Add pUSDC to MetaMask
      </button>
      {msg && <p className="mt-1 text-xs text-zinc-500">{msg}</p>}
    </div>
  );
}
