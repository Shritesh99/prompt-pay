"use client";
import { useEffect, useState } from "react";
import { vaultAbi } from "../../lib/abis";
import { explorerTx } from "../../lib/chains";
import { fmtUsdc, publicClient, useDeployment, usePoll, useServerBase, useSigner } from "../../lib/hooks";
import { Turnstile } from "../../components/Turnstile";

const STORAGE_KEY = "promptpay.wallet";
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

export default function EarnPage() {
  const deployment = useDeployment();
  const serverBase = useServerBase();
  const { signer, useDevWallet } = useSigner();

  const [wallet, setWallet] = useState<string | null>(null);
  const [walletInput, setWalletInput] = useState("");
  const [origin, setOrigin] = useState("https://promptpay-monad-blitz.netlify.app");
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
    const q = new URLSearchParams(window.location.search).get("wallet");
    const stored = q ?? localStorage.getItem(STORAGE_KEY);
    if (stored && isAddress(stored)) setWallet(stored.toLowerCase());
  }, []);

  const earnings = usePoll<{ claimable: string; pendingUnits: number } | null>(
    async () => (wallet ? fetch(`${serverBase}/earnings/${wallet}`).then((r) => r.json()) : null),
    4000,
    [serverBase, wallet]
  );
  const activity = usePoll<{ events: { type: string; campaign_id: string; earner: string; created_at: number }[] }>(
    () => fetch(`${serverBase}/activity`).then((r) => r.json()),
    4000,
    [serverBase]
  );

  function saveWallet(addr: string) {
    if (!isAddress(addr)) return;
    const a = addr.toLowerCase();
    localStorage.setItem(STORAGE_KEY, a);
    setWallet(a);
  }

  const curlCmd = `curl -fsSL ${origin}/install.sh | sh -s -- --wallet ${wallet ?? "0xYourWallet"}`;
  const connectedMatches = signer && wallet && signer.address.toLowerCase() === wallet;

  // enrollment status for the current wallet
  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    const check = () =>
      fetch(`${serverBase}/enrolled/${wallet}`)
        .then((r) => r.json())
        .then((j) => alive && setEnrolled(!!j.enrolled))
        .catch(() => {});
    check();
    const t = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [serverBase, wallet]);

  async function enroll() {
    if (!signer || !connectedMatches || !wallet) return;
    setEnrolling(true);
    setEnrollMsg(null);
    try {
      const issuedAt = new Date().toISOString();
      const message = ["PromptPay Enroll v1", `wallet: ${wallet}`, `issuedAt: ${issuedAt}`].join("\n");
      const signature = await signer.walletClient.signMessage({ account: signer.address, message });
      const res = await fetch(`${serverBase}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, issuedAt, signature, turnstileToken }),
      });
      const out = await res.json();
      if (!res.ok || !out.enrolled) throw new Error(out.error ?? "enroll failed");
      setEnrolled(true);
      setEnrollMsg("Enrolled — this wallet can now earn.");
    } catch (err) {
      setEnrollMsg(`Enroll failed: ${(err as Error).message}`);
    } finally {
      setEnrolling(false);
    }
  }

  async function claim() {
    if (!deployment || !signer || !connectedMatches) return;
    setClaiming(true);
    setClaimMsg(null);
    setClaimTx(null);
    try {
      const MIN_GAS = 10n ** 16n; // 0.01 MON
      let balance = await publicClient.getBalance({ address: signer.address });
      if (balance < MIN_GAS) {
        setClaimMsg("Funding gas…");
        await fetch("/api/faucet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: signer.address, gasOnly: true }),
        }).catch(() => {});
        for (let i = 0; i < 15 && balance < MIN_GAS; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          balance = await publicClient.getBalance({ address: signer.address });
        }
        if (balance < MIN_GAS) throw new Error("no gas to claim yet — wait a moment and retry");
      }
      setClaimMsg("Claiming…");
      const hash = await signer.walletClient.writeContract({
        address: deployment.vault,
        abi: vaultAbi,
        functionName: "claimAll",
        account: signer.address,
        chain: null,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setClaimTx(hash);
      setClaimMsg("Claimed!");
    } catch (err) {
      setClaimMsg(`Claim failed: ${(err as Error).message}`);
    } finally {
      setClaiming(false);
    }
  }

  const myEvents = (activity?.events ?? []).filter((e) => wallet && e.earner.toLowerCase() === wallet);

  // ---- Step 1: ask for the public wallet ----
  if (!wallet) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Earn</h1>
        <div className="space-y-4 rounded-xl border border-zinc-800 p-6">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Step 1 of 2 · Your wallet</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Paste the <span className="text-zinc-200">public address</span> you want to be paid to. This is
              your earner identity — impressions signed by your device are settled to this wallet on Monad.
              Only your public address is used; no private key is ever entered here.
            </p>
          </div>
          <div className="flex gap-3">
            <input
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value.trim())}
              placeholder="0x… your public wallet address"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-violet-500"
            />
            <button
              onClick={() => saveWallet(walletInput)}
              disabled={!isAddress(walletInput)}
              className="whitespace-nowrap rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
          <div className="flex items-center gap-3 border-t border-zinc-800 pt-4 text-sm text-zinc-500">
            {signer ? (
              <button onClick={() => saveWallet(signer.address)} className="rounded-lg border border-zinc-700 px-3 py-1.5 hover:bg-zinc-900">
                Use connected wallet ({signer.address.slice(0, 6)}…{signer.address.slice(-4)})
              </button>
            ) : (
              <>
                <span>or</span>
                <button onClick={useDevWallet} className="rounded-lg border border-zinc-700 px-3 py-1.5 hover:bg-zinc-900">
                  Use a dev wallet
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Step 2: install command + dashboard ----
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Earn</h1>
        <button
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setWallet(null);
            setWalletInput("");
          }}
          className="text-xs text-zinc-500 underline hover:text-zinc-300"
        >
          ← use a different wallet
        </button>
      </div>

      <div className={`rounded-xl border p-6 ${enrolled ? "border-emerald-800/60 bg-emerald-950/20" : "border-amber-800/60 bg-amber-950/20"}`}>
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-zinc-300">
          Enroll to earn {enrolled === true && <span className="text-emerald-400">· ✓ enrolled</span>}
        </h2>
        {enrolled ? (
          <p className="text-xs text-zinc-400">
            This wallet is enrolled — impressions from your agent settle here. The daily cap is per
            wallet, so extra signing keys don&apos;t earn more.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-zinc-400">
              A wallet must enroll before it can earn: pass a human check and sign to prove you
              control it. This is what stops free key/wallet spam from farming impressions.
            </p>
            {connectedMatches ? (
              <>
                <Turnstile onToken={setTurnstileToken} />
                <button
                  onClick={enroll}
                  disabled={enrolling || !turnstileToken}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {enrolling ? "Enrolling…" : "Enroll this wallet"}
                </button>
              </>
            ) : (
              <p className="text-xs text-zinc-500">
                Connect this wallet (top right){signer ? "" : " or use a dev wallet"} to enroll.
                {!signer && (
                  <button onClick={useDevWallet} className="ml-1 underline hover:text-zinc-300">
                    dev wallet
                  </button>
                )}
              </p>
            )}
          </>
        )}
        {enrollMsg && <p className="mt-2 text-xs text-zinc-300">{enrollMsg}</p>}
      </div>

      <div className="rounded-xl border border-violet-800/60 bg-violet-950/20 p-6">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-violet-300">Install &amp; earn</h2>
        <p className="mb-3 text-xs text-zinc-400">
          Run this on your machine. A signing key is generated locally and never leaves your device; earnings
          settle to <span className="font-mono text-zinc-200">{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>. Add{" "}
          <code>--agent both</code> to also enable Codex.
        </p>
        <CopyBox text={curlCmd} />
        <details className="mt-3 text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">…or from a cloned repo</summary>
          <div className="mt-2 space-y-2">
            <CopyBox text={`node cli/bin/promptpay.mjs setup --wallet ${wallet}`} />
            <CopyBox text={`node cli/bin/promptpay.mjs codex-setup --wallet ${wallet}`} />
          </div>
        </details>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Claimable</p>
          <p className="mt-1 text-3xl font-bold text-emerald-400">${earnings ? fmtUsdc(earnings.claimable) : "…"}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Pending settlement</p>
          <p className="mt-1 text-3xl font-bold">
            {earnings?.pendingUnits ?? "…"} <span className="text-base font-normal text-zinc-500">units</span>
          </p>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-zinc-800 p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Wallet</p>
          <p className="break-all font-mono text-xs text-zinc-400">{wallet}</p>
          {connectedMatches ? (
            <button
              onClick={claim}
              disabled={claiming || !earnings || earnings.claimable === "0"}
              className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {claiming ? "Claiming…" : "Claim USDC"}
            </button>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">
              Connect this wallet (top right){signer ? "" : " or use a dev wallet"} to claim.
              {!signer && (
                <button onClick={useDevWallet} className="ml-1 underline hover:text-zinc-300">
                  dev wallet
                </button>
              )}
            </p>
          )}
        </div>
      </div>

      {claimMsg && (
        <p className="break-all rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
          <span className={claimTx ? "text-emerald-400" : ""}>{claimMsg}</span>
          {claimTx && explorerTx(claimTx) && (
            <>
              {" "}
              <a href={explorerTx(claimTx)!} target="_blank" rel="noopener noreferrer" className="text-violet-400 underline hover:text-violet-300">
                View on MonadScan ↗
              </a>
              <span className="ml-2 font-mono text-xs text-zinc-500">
                {claimTx.slice(0, 10)}…{claimTx.slice(-8)}
              </span>
            </>
          )}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 p-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Recent activity</h2>
        {myEvents.length === 0 ? (
          <p className="text-sm text-zinc-500">No impressions yet — start your agent above.</p>
        ) : (
          <ul className="space-y-1 text-sm text-zinc-400">
            {myEvents.slice(0, 15).map((e, i) => (
              <li key={i}>
                <span className={e.type === "click" ? "text-amber-400" : "text-emerald-400"}>{e.type}</span> · campaign #
                {e.campaign_id} · {new Date(e.created_at).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <pre className="flex-1 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-200 ring-1 ring-zinc-800">{text}</pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => {}
          );
        }}
        className="shrink-0 rounded-lg border border-zinc-700 px-3 text-xs hover:bg-zinc-900"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
