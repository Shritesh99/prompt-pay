"use client";
import { useEffect, useState } from "react";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "../../lib/abis";
import { activeChain, explorerTx } from "../../lib/chains";
import { fmtUsdc, publicClient, useDeployment, usePoll, useServerBase } from "../../lib/hooks";

const STORAGE_KEY = "promptpay.agentKey";

export default function EarnPage() {
  const deployment = useDeployment();
  const [agentKey, setAgentKey] = useState<`0x${string}` | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored)) setAgentKey(stored as `0x${string}`);
  }, []);

  const account = agentKey ? privateKeyToAccount(agentKey) : null;
  const serverBase = useServerBase();

  const earnings = usePoll<{ claimable: string; pendingUnits: number } | null>(
    async () =>
      account
        ? fetch(`${serverBase}/earnings/${account.address}`).then((r) => r.json())
        : null,
    4000,
    [serverBase, account?.address]
  );
  const activity = usePoll<{ events: { type: string; campaign_id: string; earner: string; created_at: number }[] }>(
    () => fetch(`${serverBase}/activity`).then((r) => r.json()),
    4000,
    [serverBase]
  );

  function adoptKey(key: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return;
    localStorage.setItem(STORAGE_KEY, key);
    setAgentKey(key as `0x${string}`);
  }

  async function claim() {
    if (!agentKey || !deployment || !account) return;
    setClaiming(true);
    setClaimMsg(null);
    setClaimTx(null);
    try {
      // The agent wallet needs native gas to sign claimAll(). Top it up, then
      // WAIT until the balance actually lands before claiming — the faucet tx
      // and the claim must not race (that caused "insufficient balance").
      const MIN_GAS = 10n ** 16n; // 0.01 MON — plenty for a claim
      let balance = await publicClient.getBalance({ address: account.address });
      if (balance < MIN_GAS) {
        setClaimMsg("Funding gas…");
        const res = await fetch("/api/faucet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: account.address, gasOnly: true }),
        });
        // poll for the gas to arrive (covers async faucet + rate-limit cases)
        for (let i = 0; i < 15 && balance < MIN_GAS; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          balance = await publicClient.getBalance({ address: account.address });
        }
        if (balance < MIN_GAS) {
          const detail = res.ok ? "faucet sent but gas hasn't arrived yet" : `faucet ${res.status}`;
          throw new Error(`no gas to claim (${detail}) — wait a moment and try again`);
        }
      }
      setClaimMsg("Claiming…");
      const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
      const hash = await wallet.writeContract({
        address: deployment.vault,
        abi: vaultAbi,
        functionName: "claimAll",
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

  const myEvents = (activity?.events ?? []).filter(
    (e) => account && e.earner.toLowerCase() === account.address.toLowerCase()
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Earn</h1>

      {!account ? (
        <div className="space-y-4 rounded-xl border border-zinc-800 p-6">
          <p className="text-sm text-zinc-400">
            Your <span className="text-zinc-200">agent key</span> identifies you as an earner — the
            CLI generates one during <code className="rounded bg-zinc-900 px-1">promptpay setup</code>.
            Paste it to track and claim your earnings here, or create a fresh one.
          </p>
          <div className="flex gap-3">
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="0x… agent private key"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-violet-500"
            />
            <button
              onClick={() => adoptKey(keyInput)}
              className="whitespace-nowrap rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500"
            >
              Use key
            </button>
            <button
              onClick={() => adoptKey(generatePrivateKey())}
              className="whitespace-nowrap rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
            >
              Generate new
            </button>
          </div>
          <p className="text-xs text-zinc-600">Stored only in this browser&apos;s localStorage.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 p-5">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Claimable</p>
              <p className="mt-1 text-3xl font-bold text-emerald-400">
                ${earnings ? fmtUsdc(earnings.claimable) : "…"}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 p-5">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Pending settlement</p>
              <p className="mt-1 text-3xl font-bold">{earnings?.pendingUnits ?? "…"} <span className="text-base font-normal text-zinc-500">units</span></p>
            </div>
            <div className="flex flex-col justify-between rounded-xl border border-zinc-800 p-5">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Agent</p>
              <p className="break-all font-mono text-xs text-zinc-400">{account.address}</p>
              <button
                onClick={claim}
                disabled={claiming || !earnings || earnings.claimable === "0"}
                className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {claiming ? "Claiming…" : "Claim USDC"}
              </button>
            </div>
          </div>
          {claimMsg && (
            <p className="break-all rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
              <span className={claimTx ? "text-emerald-400" : ""}>{claimMsg}</span>
              {claimTx &&
                (explorerTx(claimTx) ? (
                  <>
                    {" "}
                    <a
                      href={explorerTx(claimTx)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-400 underline hover:text-violet-300"
                    >
                      View on MonadScan ↗
                    </a>
                    <span className="ml-2 font-mono text-xs text-zinc-500">
                      {claimTx.slice(0, 10)}…{claimTx.slice(-8)}
                    </span>
                  </>
                ) : (
                  <span className="ml-1 font-mono text-xs">{claimTx}</span>
                ))}
            </p>
          )}

          <div className="rounded-xl border border-zinc-800 p-6">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Set up the Claude Code earner
            </h2>
            <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-300">
              {`node cli/bin/promptpay.mjs setup --key ${agentKey} --server ${serverBase}`}
            </pre>
            <p className="mt-2 text-xs text-zinc-500">
              Then open a new <code>claude</code> session — the ad shows in the status line and the
              thinking verb, and impressions credit to this agent.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 p-6">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Recent activity
            </h2>
            {myEvents.length === 0 ? (
              <p className="text-sm text-zinc-500">No impressions yet.</p>
            ) : (
              <ul className="space-y-1 text-sm text-zinc-400">
                {myEvents.slice(0, 15).map((e, i) => (
                  <li key={i}>
                    <span className={e.type === "click" ? "text-amber-400" : "text-emerald-400"}>
                      {e.type}
                    </span>{" "}
                    · campaign #{e.campaign_id} · {new Date(e.created_at).toLocaleTimeString()}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              setAgentKey(null);
            }}
            className="text-xs text-zinc-600 underline hover:text-zinc-400"
          >
            forget this agent key
          </button>
        </>
      )}
    </div>
  );
}
