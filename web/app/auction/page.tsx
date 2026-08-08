"use client";
import { SERVER_BASE } from "../../lib/chains";
import { fmtUsdc, usePoll } from "../../lib/hooks";

type Auction = {
  winner: { campaignId: string; price: string } | null;
  board: {
    campaignId: string;
    advertiser: string;
    pricePerSlot: string;
    balance: string;
    active: boolean;
    creative: string | null;
  }[];
};

export default function AuctionPage() {
  const auction = usePoll<Auction>(
    () => fetch(`${SERVER_BASE}/auction`).then((r) => r.json()),
    4000
  );
  const board = (auction?.board ?? []).slice().sort((a, b) => Number(b.pricePerSlot) - Number(a.pricePerSlot));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Live auction</h1>
      <p className="text-sm text-zinc-400">
        English-ascending, on-chain. The slot rotates across funded campaigns weighted by bid; the
        top bid shows most. Price is USDC per 1000 impressions (a click counts as 50).
      </p>
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-zinc-400">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Creative</th>
              <th className="px-4 py-3">Advertiser</th>
              <th className="px-4 py-3 text-right">Bid / slot</th>
              <th className="px-4 py-3 text-right">Budget left</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {board.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No bids yet.
                </td>
              </tr>
            )}
            {board.map((row) => {
              const isWinner = auction?.winner?.campaignId === row.campaignId;
              return (
                <tr key={row.campaignId} className="border-t border-zinc-800">
                  <td className="px-4 py-3 text-zinc-500">{row.campaignId}</td>
                  <td className="px-4 py-3">{row.creative ?? <span className="text-zinc-600">unregistered</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {row.advertiser.slice(0, 6)}…{row.advertiser.slice(-4)}
                  </td>
                  <td className="px-4 py-3 text-right">{fmtUsdc(row.pricePerSlot)}</td>
                  <td className="px-4 py-3 text-right">{fmtUsdc(row.balance)}</td>
                  <td className="px-4 py-3">
                    {isWinner && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                        winning
                      </span>
                    )}
                    {!row.active && (
                      <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">
                        inactive
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
