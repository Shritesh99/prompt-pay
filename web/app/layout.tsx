import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: "PromptPay — get paid while Claude thinks",
  description:
    "An on-chain ad marketplace for AI wait time. Advertisers bid in a live auction on Monad; developers earn 50% of ad revenue in USDC.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
