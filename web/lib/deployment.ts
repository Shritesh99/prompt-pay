// Server-side only: reads the forge deployment for the active network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NETWORK } from "./chains";

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
  const file = path.resolve(process.cwd(), "../contracts/deployments", `${NETWORK}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}
