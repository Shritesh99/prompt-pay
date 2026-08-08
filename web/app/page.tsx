"use client";
import Link from "next/link";
import { fmtUsdc, usePoll, useServerBase } from "../lib/hooks";

type Auction = {
  winner: { campaignId: string; price: string } | null;
  board: { campaignId: string; creative: string | null; pricePerSlot: string; balance: string }[];
};

export default function Landing() {
  const serverBase = useServerBase();
  const auction = usePoll<Auction>(
    () => fetch(`${serverBase}/auction`).then((r) => r.json()),
    5000,
    [serverBase]
  );
  const winner = auction?.winner
    ? auction.board.find((b) => b.campaignId === auction.winner!.campaignId)
    : null;

  return (
    <div className="space-y-10">
      <section className="space-y-4 pt-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Get paid while <span className="text-violet-400">Claude thinks</span>.
        </h1>
        <p className="max-w-2xl text-lg text-zinc-400">
          PromptPay turns AI wait time into income. Advertisers bid in a live on-chain auction on
          Monad to sponsor Claude Code&apos;s thinking spinner — developers who show the ad earn{" "}
          <span className="text-zinc-200">50% of the revenue in USDC</span>, claimable any time.
        </p>
        <div className="flex gap-3 pt-2">
          <Link
            href="/earn"
            className="rounded-lg bg-violet-600 px-5 py-2.5 font-medium hover:bg-violet-500"
          >
            Start earning
          </Link>
          <Link
            href="/advertise/new"
            className="rounded-lg border border-zinc-700 px-5 py-2.5 font-medium hover:bg-zinc-900"
          >
            Launch a campaign
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Live in the spinner right now
        </h2>
        {winner ? (
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-lg text-emerald-400">
              ✦ {winner.creative ?? `campaign #${winner.campaignId}`}{" "}
              <span className="text-zinc-500">· sponsored</span>
            </p>
            <p className="whitespace-nowrap text-sm text-zinc-400">
              {fmtUsdc(winner.pricePerSlot)} USDC / 1000 impressions
            </p>
          </div>
        ) : (
          <p className="text-zinc-500">No campaign live — be the first to bid.</p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["1. Advertisers escrow USDC", "Fund a campaign, commit the creative on-chain, and bid for the spinner slot in an English auction."],
          ["2. Devs show the ad", "A one-command CLI puts the winning ad in Claude Code (status line + thinking verb) or Codex (per-turn notification). Signed impressions, no bots."],
          ["3. Everyone settles on Monad", "An oracle batches events on-chain: 50% to the earner, instantly claimable. Sub-second finality."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-xl border border-zinc-800 p-5">
            <h3 className="mb-2 font-medium">{title}</h3>
            <p className="text-sm text-zinc-400">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
