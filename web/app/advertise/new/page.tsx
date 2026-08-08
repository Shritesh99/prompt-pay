"use client";
import { useState } from "react";
import { keccak256, parseEventLogs, toHex } from "viem";
import { usdcAbi, vaultAbi, auctionAbi } from "../../../lib/abis";
import { activeChain } from "../../../lib/chains";
import { fmtUsdc, publicClient, useDeployment, useServerBase, useSigner } from "../../../lib/hooks";

type StepState = "idle" | "running" | "done" | "error";
const STEPS = [
  "Faucet: test USDC + gas",
  "Approve USDC",
  "Create campaign (commit creative on-chain)",
  "Fund budget",
  "Place bid",
  "Publish creative to ad-server",
] as const;

export default function NewCampaign() {
  const deployment = useDeployment();
  const { signer, useDevWallet } = useSigner();
  const serverBase = useServerBase();

  const [text, setText] = useState("");
  const [clickUrl, setClickUrl] = useState("https://");
  const [budget, setBudget] = useState("25");
  const [price, setPrice] = useState("2");
  const [steps, setSteps] = useState<StepState[]>(STEPS.map(() => "idle"));
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const budgetUnits = BigInt(Math.round(Number(budget || "0") * 1e6));
  const priceUnits = BigInt(Math.round(Number(price || "0") * 1e6));
  const perImpression = Number(price || "0") / 1000;

  function setStep(i: number, s: StepState) {
    setSteps((prev) => prev.map((v, j) => (j === i ? s : j > i && s === "running" ? "idle" : v)));
  }

  async function launch() {
    if (!deployment || !signer) return;
    setBusy(true);
    setError(null);
    setDoneId(null);
    setSteps(STEPS.map(() => "idle"));
    const { walletClient, address } = signer;
    const creativeHash = keccak256(toHex(`${text}\n${clickUrl}`));

    const write = async (req: Parameters<typeof walletClient.writeContract>[0]) => {
      const hash = await walletClient.writeContract(req);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
      return receipt;
    };

    let step = 0;
    try {
      // 0: faucet when short on USDC (also tops up gas)
      setStep(step, "running");
      const balance = (await publicClient.readContract({
        address: deployment.usdc,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      if (balance < budgetUnits) {
        const res = await fetch("/api/faucet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address }),
        });
        if (!res.ok) throw new Error(`faucet failed: ${JSON.stringify(await res.json())}`);
      }
      setStep(step++, "done");

      // 1: approve
      setStep(step, "running");
      await write({
        address: deployment.usdc,
        abi: usdcAbi,
        functionName: "approve",
        args: [deployment.vault, budgetUnits],
        account: walletClient.account!,
        chain: activeChain,
      });
      setStep(step++, "done");

      // 2: create
      setStep(step, "running");
      const createReceipt = await write({
        address: deployment.vault,
        abi: vaultAbi,
        functionName: "createCampaign",
        args: [creativeHash],
        account: walletClient.account!,
        chain: activeChain,
      });
      const [created] = parseEventLogs({
        abi: vaultAbi,
        eventName: "CampaignCreated",
        logs: createReceipt.logs,
      });
      const campaignId = (created.args as { id: bigint }).id;
      setStep(step++, "done");

      // 3: fund
      setStep(step, "running");
      await write({
        address: deployment.vault,
        abi: vaultAbi,
        functionName: "fund",
        args: [campaignId, budgetUnits],
        account: walletClient.account!,
        chain: activeChain,
      });
      setStep(step++, "done");

      // 4: bid
      setStep(step, "running");
      await write({
        address: deployment.auction,
        abi: auctionAbi,
        functionName: "bid",
        args: [campaignId, priceUnits],
        account: walletClient.account!,
        chain: activeChain,
      });
      setStep(step++, "done");

      // 5: publish creative
      setStep(step, "running");
      const pub = await fetch(`${serverBase}/campaigns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignId: campaignId.toString(),
          advertiser: address,
          text,
          clickUrl,
        }),
      });
      if (!pub.ok) throw new Error(`ad-server rejected creative: ${JSON.stringify(await pub.json())}`);
      setStep(step, "done");
      setDoneId(campaignId.toString());
    } catch (err) {
      setStep(step, "error");
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const valid = text.length > 0 && text.length <= 120 && /^https?:\/\/.+/.test(clickUrl) && budgetUnits > 0n && priceUnits > 0n && budgetUnits >= priceUnits;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Launch a campaign</h1>

      <div className="space-y-4 rounded-xl border border-zinc-800 p-6">
        <label className="block">
          <span className="text-sm text-zinc-400">Ad text (max 120 chars — shown in the spinner)</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={120}
            placeholder="Ship it on Monad - 10,000 TPS, full EVM"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 outline-none focus:border-violet-500"
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Click URL</span>
          <input
            value={clickUrl}
            onChange={(e) => setClickUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 outline-none focus:border-violet-500"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-zinc-400">Budget (USDC)</span>
            <input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              type="number"
              min="0"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 outline-none focus:border-violet-500"
            />
          </label>
          <label className="block">
            <span className="text-sm text-zinc-400">Bid (USDC per 1000 impressions)</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              min="0"
              step="0.1"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 outline-none focus:border-violet-500"
            />
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          ≈ ${perImpression.toFixed(4)} per impression · ${(perImpression * 50).toFixed(3)} per click (50×) ·
          budget covers ~{price && Number(price) > 0 ? Math.floor((Number(budget) / Number(price)) * 1000).toLocaleString() : 0} impressions
        </p>

        {!signer ? (
          <div className="flex items-center gap-3 border-t border-zinc-800 pt-4">
            <p className="text-sm text-zinc-400">Connect a wallet (top right) or</p>
            <button
              onClick={useDevWallet}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
            >
              Continue with dev wallet
            </button>
          </div>
        ) : (
          <div className="border-t border-zinc-800 pt-4">
            <p className="mb-3 text-xs text-zinc-500">
              paying as <span className="font-mono">{signer.address}</span> ({signer.kind} wallet)
            </p>
            <button
              onClick={launch}
              disabled={!valid || busy || !deployment}
              className="rounded-lg bg-violet-600 px-5 py-2.5 font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Launching…" : `Fund ${fmtUsdc(budgetUnits)} USDC & enter auction`}
            </button>
          </div>
        )}
      </div>

      <ol className="space-y-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span
              className={
                steps[i] === "done"
                  ? "text-emerald-400"
                  : steps[i] === "running"
                    ? "animate-pulse text-violet-400"
                    : steps[i] === "error"
                      ? "text-red-400"
                      : "text-zinc-600"
              }
            >
              {steps[i] === "done" ? "✓" : steps[i] === "error" ? "✗" : "●"}
            </span>
            <span className={steps[i] === "idle" ? "text-zinc-500" : ""}>{label}</span>
          </li>
        ))}
      </ol>

      {error && <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
      {doneId && (
        <p className="rounded-lg border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          Campaign #{doneId} is live — watch it on the <a href="/auction" className="underline">auction board</a>.
          Raise your bid any time by launching again.
        </p>
      )}
    </div>
  );
}
