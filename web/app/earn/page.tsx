"use client";
import { useEffect, useState } from "react";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount } from "wagmi";
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

  const { address: connectedWallet } = useAccount();
  const [origin, setOrigin] = useState("https://promptpay-monad-blitz.netlify.app");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  const curlWallet = connectedWallet ?? account?.address ?? "0xYourWallet";
  const curlCmd = `curl -fsSL ${origin}/install.sh | sh -s -- --wallet ${curlWallet}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Earn</h1>

      <div className="rounded-xl border border-violet-800/60 bg-violet-950/20 p-6">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-violet-300">
          Quick install — one line
        </h2>
        <p className="mb-3 text-xs text-zinc-400">
          Sets up the earner for Claude Code and pays out to your wallet. Pass{" "}
          <code>--agent both</code> to also enable Codex. A signing key is generated locally and
          never leaves your machine — only your <span className="text-zinc-200">public wallet</span>{" "}
          is in the command.
        </p>
        <CopyBox text={curlCmd} />
        {!connectedWallet && (
          <p className="mt-2 text-xs text-zinc-500">
            Connect your wallet (top right) to drop your address into the command automatically.
          </p>
        )}
      </div>

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
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-300/90">
            <span className="font-medium">This is a disposable earner key</span> — it only signs
            impression reports and holds your testnet earnings. It is <span className="font-medium">not</span>{" "}
            your main wallet. Never paste a real wallet&apos;s seed phrase or private key here. (A production
            version keeps this signing key on your device and pays out to a separate wallet.)
          </div>
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
            <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Earn in your AI coding agent
            </h2>
            <p className="mb-4 text-xs text-zinc-500">
              Both surfaces credit impressions to this agent key. Run the setup command from the
              PromptPay repo, then use your agent as usual. The key here is a disposable signing key
              (not your wallet) — <code>promptpay setup</code> with no <code>--key</code> just
              generates one locally instead.
            </p>

            <div className="mb-3">
              <p className="mb-1 text-sm font-medium text-zinc-200">Claude Code</p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-300">
                {`node cli/bin/promptpay.mjs setup --key ${agentKey} --server ${serverBase}`}
              </pre>
              <p className="mt-2 text-xs text-zinc-500">
                Open a new <code>claude</code> session — the ad shows in the status line and the
                thinking verb, earning while the session is open.
              </p>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-zinc-200">Codex CLI</p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-300">
                {`node cli/bin/promptpay.mjs codex-setup --key ${agentKey} --server ${serverBase}`}
              </pre>
              <p className="mt-2 text-xs text-zinc-500">
                Run <code>codex</code> — each completed turn pops a sponsored notification and earns
                an impression. Undo anytime with <code>codex-uninstall</code>.
              </p>
            </div>
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

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <pre className="flex-1 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-200 ring-1 ring-zinc-800">
        {text}
      </pre>
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
