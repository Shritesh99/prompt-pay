// Server-side only: resolves the on-chain deployment for the active network.
// On Monad (production/Netlify) the addresses are bundled at build time so no
// filesystem access is needed in the serverless runtime. For local anvil we
// read the file fresh, since dev-stack redeploys and rewrites it each run.
import { NETWORK } from "./chains";
import monadDeployment from "../../contracts/deployments/monad.json";

export type Deployment = {
  chainId: number;
  usdc: `0x${string}`;
  vault: `0x${string}`;
  auction: `0x${string}`;
  settlement: `0x${string}`;
  treasury: `0x${string}`;
  oracle: `0x${string}`;
};

export function loadDeployment(): Deployment {
  if (NETWORK === "monad") return monadDeployment as Deployment;
  // local anvil only — this branch never runs on Netlify
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const file = path.resolve(process.cwd(), "../contracts/deployments", `${NETWORK}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

/**
 * Ad-server base URL, resolved at REQUEST time (not build time) so a tunnel URL
 * can change via the Netlify `SERVER_BASE` env var without a rebuild.
 */
export function serverBase(): string {
  return (
    process.env.SERVER_BASE ??
    process.env.NEXT_PUBLIC_SERVER_BASE ??
    "http://localhost:4021"
  );
}
