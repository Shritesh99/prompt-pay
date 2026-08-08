"use client";
import { SERVER_BASE } from "../../lib/chains";
import { usePoll } from "../../lib/hooks";

type Receipt = { earner: string; impressions: number; clicks: number; tx_hash: string };

export default function LeaderboardPage() {
  const activity = usePoll<{ receipts: Receipt[] }>(
    () => fetch(`${SERVER_BASE}/activity`).then((r) => r.json()),
    5000
  );

  const byEarner = new Map<string, { impressions: number; clicks: number; units: number }>();
  for (const r of activity?.receipts ?? []) {
    const cur = byEarner.get(r.earner) ?? { impressions: 0, clicks: 0, units: 0 };
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.units += r.impressions + r.clicks * 50;
    byEarner.set(r.earner, cur);
  }
  const rows = [...byEarner.entries()].sort((a, b) => b[1].units - a[1].units);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Leaderboard</h1>
      <p className="text-sm text-zinc-400">Settled impression-equivalents per earner (click = 50).</p>
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-zinc-400">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Earner</th>
              <th className="px-4 py-3 text-right">Impressions</th>
              <th className="px-4 py-3 text-right">Clicks</th>
              <th className="px-4 py-3 text-right">Units</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  Nothing settled yet.
                </td>
              </tr>
            )}
            {rows.map(([earner, s], i) => (
              <tr key={earner} className="border-t border-zinc-800">
                <td className="px-4 py-3 text-zinc-500">{i + 1}</td>
                <td className="px-4 py-3 font-mono text-xs">{earner.slice(0, 8)}…{earner.slice(-6)}</td>
                <td className="px-4 py-3 text-right">{s.impressions.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{s.clicks.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-medium">{s.units.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
