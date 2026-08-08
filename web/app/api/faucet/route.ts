// Demo faucet: mints test USDC to the requester and tops up native gas.
// Holds FAUCET_PRIVATE_KEY server-side (anvil key #0 locally; on Monad, a
// throwaway key pre-funded from https://faucet.monad.xyz).
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain, NETWORK } from "../../../lib/chains";
import { loadDeployment } from "../../../lib/deployment";

const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const key = (process.env.FAUCET_PRIVATE_KEY ??
  (NETWORK === "anvil" ? ANVIL_KEY_0 : "")) as `0x${string}`;

const USDC_DRIP = 100_000_000n; // 100 pUSDC
const GAS_DRIP = parseEther(NETWORK === "monad" ? "0.05" : "0.5");
const usdcAbi = parseAbi(["function mint(address to, uint256 amount)"]);

export async function POST(req: Request) {
  if (!key) return NextResponse.json({ error: "faucet_not_configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { address?: string; gasOnly?: boolean } | null;
  const address = body?.address;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "bad_address" }, { status: 400 });
  }

  const deployment = loadDeployment();
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const pub = createPublicClient({ chain: activeChain, transport: http() });

  const gasTx = await wallet.sendTransaction({ to: address as `0x${string}`, value: GAS_DRIP });
  await pub.waitForTransactionReceipt({ hash: gasTx });

  let usdcTx: string | null = null;
  if (!body?.gasOnly) {
    usdcTx = await wallet.writeContract({
      address: deployment.usdc,
      abi: usdcAbi,
      functionName: "mint",
      args: [address as `0x${string}`, USDC_DRIP],
    });
    await pub.waitForTransactionReceipt({ hash: usdcTx as `0x${string}` });
  }

  return NextResponse.json({ ok: true, gasTx, usdcTx });
}
