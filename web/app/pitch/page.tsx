"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

function Node({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-5 py-3 text-center text-sm ${
        accent ? "border-violet-600/70 bg-violet-950/30 text-violet-100" : "border-zinc-700 bg-zinc-900/60 text-zinc-200"
      }`}
    >
      {children}
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-1 text-zinc-500">
      <span className="text-[11px]">{label}</span>
      <span className="leading-none">↓</span>
    </div>
  );
}

const SLIDES = [
  // 1 — Hero / problem
  <div key="1" className="space-y-6 text-center">
    <p className="text-sm font-medium uppercase tracking-[0.3em] text-violet-400">Monad Blitz London</p>
    <h1 className="text-5xl font-black tracking-tight sm:text-6xl">
      Get paid while your <span className="text-violet-400">AI thinks</span>.
    </h1>
    <p className="mx-auto max-w-2xl text-lg text-zinc-400">
      Every dev stares at an AI &ldquo;thinking&rdquo; spinner dozens of times a day — dead time nobody
      monetizes. <span className="text-zinc-200">PromptPay</span> turns it into a two-sided, on-chain ad
      marketplace: advertisers bid, developers earn <span className="text-zinc-200">USDC per verified
      impression</span>.
    </p>
    <p className="pt-2 font-mono text-sm text-zinc-500">promptpay-monad-blitz.netlify.app</p>
  </div>,

  // 2 — How it works
  <div key="2" className="space-y-8">
    <h2 className="text-center text-4xl font-bold">How it works</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      {[
        ["1 · Advertisers bid", "Escrow USDC and bid in an on-chain English auction on Monad. The creative is committed on-chain."],
        ["2 · Ad shows in the agent", "The winning ad appears in Claude Code (status line + thinking verb) or Codex (per-turn notification)."],
        ["3 · Signed impression → settle", "Each impression is EIP-191 signed and settled on-chain in seconds (50 / 50 split), no batching wait."],
        ["4 · Devs claim USDC", "Earnings accrue to your wallet, claimable any time. Sub-second Monad finality."],
      ].map(([t, b]) => (
        <div key={t} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="mb-1 font-semibold text-violet-300">{t}</h3>
          <p className="text-sm text-zinc-400">{b}</p>
        </div>
      ))}
    </div>
    <p className="text-center text-sm text-zinc-500">
      Fraud-resistant by design: <span className="text-zinc-300">signed impressions</span> ·{" "}
      <span className="text-zinc-300">per-wallet cap</span> ·{" "}
      <span className="text-zinc-300">human-checked enrollment</span> · World ID next.
    </p>
  </div>,

  // 3 — Architecture / the money loop
  <div key="diagram" className="space-y-4">
    <h2 className="text-center text-4xl font-bold">The money loop</h2>
    <div className="mx-auto max-w-xl">
      <Node>Advertiser</Node>
      <Arrow label="escrow USDC + bid in the on-chain auction" />
      <Node accent>Monad — CampaignVault · AdAuction · PayoutSettlement</Node>
      <Arrow label="ad-server reads the winning bid" />
      <Node>Ad-server — Supabase Edge Function + Postgres</Node>
      <Arrow label="serves the winning ad" />
      <Node>Claude Code · Codex — ad in the thinking spinner</Node>
      <Arrow label="signed impression (EIP-191) · verify · per-wallet cap · enrolled?" />
      <Node accent>Oracle settles on Monad — 50% dev / 50% treasury</Node>
      <Arrow label="claim any time" />
      <Node>Developer wallet — USDC</Node>
    </div>
  </div>,

  // 4 — Live + CTA
  <div key="live" className="space-y-8">
    <h2 className="text-center text-4xl font-bold">
      Live on <span className="text-violet-400">Monad testnet</span>
    </h2>
    <div className="grid gap-4 sm:grid-cols-3">
      {[
        ["Contracts", "CampaignVault · AdAuction · PayoutSettlement on Monad (chain 10143)"],
        ["Ad-server", "Supabase Edge Function + Postgres — hosted, settles on report"],
        ["Earners", "Claude Code + Codex, installed with one curl line"],
      ].map(([t, b]) => (
        <div key={t} className="rounded-xl border border-zinc-800 p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">{t}</p>
          <p className="mt-1 text-sm text-zinc-300">{b}</p>
        </div>
      ))}
    </div>
    <pre className="mx-auto max-w-2xl overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-200 ring-1 ring-zinc-800">
      curl -fsSL promptpay-monad-blitz.netlify.app/install.sh | sh -s -- --wallet 0xYou
    </pre>
    <div className="flex justify-center gap-3">
      <Link href="/advertise/new" className="rounded-lg bg-violet-600 px-5 py-2.5 font-medium hover:bg-violet-500">
        Advertise
      </Link>
      <Link href="/earn" className="rounded-lg border border-zinc-700 px-5 py-2.5 font-medium hover:bg-zinc-900">
        Earn
      </Link>
      <Link href="/auction" className="rounded-lg border border-zinc-700 px-5 py-2.5 font-medium hover:bg-zinc-900">
        Live auction
      </Link>
    </div>
  </div>,
];

export default function PitchPage() {
  const [i, setI] = useState(0);
  const go = useCallback((d: number) => setI((p) => Math.min(SLIDES.length - 1, Math.max(0, p + d))), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="select-none">
      <div className="relative flex min-h-[72vh] items-center justify-center">
        {/* click zones */}
        <button aria-label="Previous" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize" />
        <button aria-label="Next" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-1/3 cursor-e-resize" />
        <div className="w-full px-2">{SLIDES[i]}</div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <button onClick={() => go(-1)} disabled={i === 0} className="rounded-md border border-zinc-700 px-3 py-1 text-sm disabled:opacity-30">
          ←
        </button>
        <div className="flex gap-2">
          {SLIDES.map((_, n) => (
            <button
              key={n}
              onClick={() => setI(n)}
              className={`h-2 w-2 rounded-full ${n === i ? "bg-violet-400" : "bg-zinc-700 hover:bg-zinc-600"}`}
              aria-label={`Slide ${n + 1}`}
            />
          ))}
        </div>
        <button onClick={() => go(1)} disabled={i === SLIDES.length - 1} className="rounded-md border border-zinc-700 px-3 py-1 text-sm disabled:opacity-30">
          →
        </button>
        <span className="ml-2 font-mono text-xs text-zinc-500">
          {i + 1} / {SLIDES.length}
        </span>
      </div>
      <p className="mt-3 text-center text-xs text-zinc-600">Use ← / → (or click the sides) to navigate.</p>
    </div>
  );
}
