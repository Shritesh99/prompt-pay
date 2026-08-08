"use client";
// Client helpers shared across pages: deployment fetch, signer resolution
// (injected wallet via wagmi OR a dev wallet key), and polling.
import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount } from "wagmi";
import { activeChain } from "./chains";
import type { Deployment } from "./deployment";

export const publicClient = createPublicClient({ chain: activeChain, transport: http() });

// anvil funded key #1 — the local "dev wallet" so demos never need MetaMask.
// On Monad, set NEXT_PUBLIC_DEV_WALLET_KEY to a funded throwaway key.
const DEV_WALLET_KEY = (process.env.NEXT_PUBLIC_DEV_WALLET_KEY ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as `0x${string}`;

export function useDeployment(): Deployment | null {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  useEffect(() => {
    fetch("/api/deployment")
      .then((r) => r.json())
      .then(setDeployment)
      .catch(() => {});
  }, []);
  return deployment;
}

export type Signer = { walletClient: WalletClient; address: Address; kind: "injected" | "dev" };

/** Injected wallet when connected via wagmi; otherwise an explicit dev wallet. */
export function useSigner(): {
  signer: Signer | null;
  useDevWallet: () => void;
} {
  const { address: injectedAddress, isConnected } = useAccount();
  const [devMode, setDevMode] = useState(false);
  const [signer, setSigner] = useState<Signer | null>(null);

  useEffect(() => {
    if (isConnected && injectedAddress && !devMode) {
      const walletClient = createWalletClient({
        account: injectedAddress,
        chain: activeChain,
        transport: custom((window as unknown as { ethereum: unknown }).ethereum as never),
      });
      setSigner({ walletClient, address: injectedAddress, kind: "injected" });
    } else if (devMode) {
      const account = privateKeyToAccount(DEV_WALLET_KEY);
      const walletClient = createWalletClient({
        account,
        chain: activeChain,
        transport: http(),
      });
      setSigner({ walletClient, address: account.address, kind: "dev" });
    } else {
      setSigner(null);
    }
  }, [isConnected, injectedAddress, devMode]);

  const useDevWallet = useCallback(() => setDevMode(true), []);
  return { signer, useDevWallet };
}

export function usePoll<T>(fn: () => Promise<T>, intervalMs: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => fn().then((v) => alive && setValue(v)).catch(() => {});
    run();
    const t = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
  return value;
}

export function fmtUsdc(baseUnits: string | bigint | number): string {
  return (Number(baseUnits) / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}
