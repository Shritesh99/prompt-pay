import { keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// Holds the agent signing key and speaks the PromptPay 402 challenge protocol —
// identical canonical message to cli/src/daemon.mjs and server/src/auth.ts.
export class AgentWallet {
  private account: PrivateKeyAccount;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address(): string {
    return this.account.address;
  }

  async report(serverBase: string, campaignId: string, type: "impression" | "click", surface: string) {
    const body = JSON.stringify({ campaignId, type, surface });
    const post = (headers: Record<string, string>) =>
      fetch(`${serverBase}/report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      });

    const bare = await post({});
    if (bare.status !== 402) return bare.json();
    const { challenge } = (await bare.json()) as { challenge: any };

    const message = [
      "PromptPay Report v1",
      `domain: ${challenge.domain}`,
      `uri: ${challenge.uri}`,
      `agent: ${this.address.toLowerCase()}`,
      `nonce: ${challenge.nonce}`,
      `issuedAt: ${challenge.issuedAt}`,
      `body: ${keccak256(toHex(body))}`,
    ].join("\n");
    const signature = await this.account.signMessage({ message });

    const signed = await post({
      "x-pp-agent": this.address,
      "x-pp-nonce": challenge.nonce,
      "x-pp-issued-at": challenge.issuedAt,
      "x-pp-signature": signature,
    });
    return signed.json();
  }
}
