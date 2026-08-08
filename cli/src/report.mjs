// Shared signed-impression reporter used by both earner surfaces (the Claude
// Code status-line daemon and the Codex notify hook). Runs the server's
// 402 challenge -> EIP-191 signature -> retry flow.
import { keccak256, toHex } from "viem";

export async function signedReport({ serverBase, account, campaignId, type, surface, timeoutMs = 8000 }) {
  const body = JSON.stringify({ campaignId, type, surface });
  const signal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const post = (headers) =>
    fetch(`${serverBase}/report`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal,
    });

  const bare = await post({});
  if (bare.status !== 402) return bare.json();
  const { challenge } = await bare.json();

  const message = [
    "PromptPay Report v1",
    `domain: ${challenge.domain}`,
    `uri: ${challenge.uri}`,
    `agent: ${account.address.toLowerCase()}`,
    `nonce: ${challenge.nonce}`,
    `issuedAt: ${challenge.issuedAt}`,
    `body: ${keccak256(toHex(body))}`,
  ].join("\n");
  const signature = await account.signMessage({ message });

  const signed = await post({
    "x-pp-agent": account.address,
    "x-pp-nonce": challenge.nonce,
    "x-pp-issued-at": challenge.issuedAt,
    "x-pp-signature": signature,
  });
  return signed.json();
}
