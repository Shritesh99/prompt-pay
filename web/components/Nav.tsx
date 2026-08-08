"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { NETWORK } from "../lib/chains";

const links = [
  { href: "/", label: "PromptPay" },
  { href: "/auction", label: "Auction" },
  { href: "/advertise/new", label: "Advertise" },
  { href: "/earn", label: "Earn" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Nav() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <nav className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-5 px-6 py-3 text-sm">
        {links.map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              i === 0
                ? "font-bold text-violet-400"
                : pathname === l.href
                  ? "text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-100"
            }
          >
            {l.label}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
            {NETWORK === "monad" ? "Monad Testnet" : "local anvil"}
          </span>
          {isConnected ? (
            <button
              onClick={() => disconnect()}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700"
              title="Disconnect"
            >
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </button>
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium hover:bg-violet-500"
            >
              Connect Wallet
            </button>
          )}
        </span>
      </div>
    </nav>
  );
}
