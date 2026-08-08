import { randomBytes } from "node:crypto";
import { keccak256, toHex, verifyMessage, type Address } from "viem";
import { config } from "./config.js";
import { store } from "./db.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type Challenge = {
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  domain: string;
  uri: string;
  statement: string;
};

const domain = new URL(config.publicUrl).host;
const reportUri = `${config.publicUrl}/report`;

export function issueChallenge(): Challenge {
  const nonce = randomBytes(16).toString("hex");
  const issued = Date.now();
  store.saveChallenge(nonce, issued, issued + CHALLENGE_TTL_MS);
  return {
    nonce,
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(issued + CHALLENGE_TTL_MS).toISOString(),
    domain,
    uri: reportUri,
    statement: "Sign to report a PromptPay ad event. This costs nothing.",
  };
}

/**
 * Canonical EIP-191 message. The raw request body is bound in by hash so a
 * signature can't be replayed with a different payload. Clients must build
 * this string byte-for-byte identically (see cli/src/daemon.mjs).
 */
export function canonicalMessage(args: {
  agent: string;
  nonce: string;
  issuedAt: string;
  rawBody: string;
}): string {
  return [
    "PromptPay Report v1",
    `domain: ${domain}`,
    `uri: ${reportUri}`,
    `agent: ${args.agent.toLowerCase()}`,
    `nonce: ${args.nonce}`,
    `issuedAt: ${args.issuedAt}`,
    `body: ${keccak256(toHex(args.rawBody))}`,
  ].join("\n");
}

export type VerifiedAgent = { agent: Address; humanId: `0x${string}` };

export async function verifyReport(args: {
  agent: string;
  nonce: string;
  issuedAt: string;
  signature: string;
  rawBody: string;
}): Promise<{ ok: true; verified: VerifiedAgent } | { ok: false; error: string }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.agent)) {
    return { ok: false, error: "bad_agent_address" };
  }
  if (!store.consumeChallenge(args.nonce)) {
    return { ok: false, error: "bad_or_replayed_nonce" };
  }
  const message = canonicalMessage(args);
  let valid = false;
  try {
    valid = await verifyMessage({
      address: args.agent as Address,
      message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "bad_signature" };
  return {
    ok: true,
    verified: { agent: args.agent as Address, humanId: resolveHumanId(args.agent as Address) },
  };
}

/**
 * PHASE: sybil — today every agent key is its own "human". When the
 * AgentRegistry lands on Monad, replace this with a registry lookup so all of
 * one verified human's agents share a single identity (and daily cap).
 */
export function resolveHumanId(agent: Address): `0x${string}` {
  return keccak256(toHex(agent.toLowerCase()));
}
