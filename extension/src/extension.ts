import * as vscode from "vscode";
import type { Hex } from "viem";
import { applyPatch, isCompatible, isPatched, restore } from "./patch.js";
import { renderBlock } from "./block.js";
import { Loopback, type ViewEvent } from "./loopback.js";
import { AgentWallet } from "./wallet.js";

const SECRET_KEY = "promptpay.agentPrivateKey";
let loopback: Loopback | null = null;
let wallet: AgentWallet | null = null;
let statusBar: vscode.StatusBarItem;
let adPollTimer: NodeJS.Timeout | null = null;
let currentAd: { adId: string; campaignId: string; adText: string; clickUrl: string; viewThresholdMs: number } | null = null;

function serverBase(): string {
  return vscode.workspace.getConfiguration("promptpay").get<string>("serverBase") ?? "http://localhost:4021";
}

async function onViewEvent(e: ViewEvent) {
  if (!wallet) return;
  const type = e.kind === "click" ? "click" : "impression";
  if (e.kind !== "click" && e.kind !== "view_threshold_met") return; // only billable events
  try {
    const out = await wallet.report(serverBase(), e.campaignId, type, "vscode-webview");
    if (out?.credited) refreshEarnings();
  } catch (err) {
    console.error("[promptpay] report failed", err);
  }
}

async function refreshEarnings() {
  if (!wallet) return;
  try {
    const res = await fetch(`${serverBase()}/earnings/${wallet.address}`);
    const { claimable } = (await res.json()) as { claimable: string };
    statusBar.text = `$(sparkle) PromptPay $${(Number(claimable) / 1e6).toFixed(4)}`;
    statusBar.tooltip = `Earning as ${wallet.address}`;
  } catch {
    statusBar.text = "$(sparkle) PromptPay";
  }
}

async function pollAd() {
  try {
    const res = await fetch(`${serverBase()}/ad`);
    const { ad, viewThresholdMs } = (await res.json()) as any;
    if (!ad) return;
    if (currentAd?.adId === ad.adId) return; // unchanged
    currentAd = { ...ad, viewThresholdMs: viewThresholdMs ?? 3000 };
    await rePatchWithCurrentAd();
  } catch {}
}

async function rePatchWithCurrentAd() {
  if (!loopback || !currentAd) return;
  const block = renderBlock({
    base: loopback.base(),
    adId: currentAd.adId,
    campaignId: currentAd.campaignId,
    adText: currentAd.adText,
    clickUrl: currentAd.clickUrl,
    viewThresholdMs: currentAd.viewThresholdMs,
  });
  const result = applyPatch(block);
  if (!result.ok) {
    vscode.window.showWarningMessage(`PromptPay: could not patch Claude Code — ${result.error}`);
  }
}

async function enable(context: vscode.ExtensionContext) {
  const key = await context.secrets.get(SECRET_KEY);
  if (!key) {
    vscode.window.showWarningMessage("PromptPay: connect an agent first (PromptPay: Connect agent).");
    return;
  }
  wallet = new AgentWallet(key as Hex);

  const compat = isCompatible();
  if (!compat.ok) {
    vscode.window.showErrorMessage(`PromptPay: incompatible Claude Code — ${compat.reason}`);
    return;
  }

  loopback = new Loopback(onViewEvent);
  await loopback.start();
  await pollAd();
  if (adPollTimer) clearInterval(adPollTimer);
  adPollTimer = setInterval(pollAd, 15_000);
  refreshEarnings();
  setInterval(refreshEarnings, 15_000);

  vscode.window.showInformationMessage(
    "PromptPay enabled. Reload the window (Developer: Reload Window) to load the ad into the Claude Code panel."
  );
}

export function activate(context: vscode.ExtensionContext) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(sparkle) PromptPay";
  statusBar.command = "promptpay.status";
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("promptpay.connect", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Paste your PromptPay agent private key (0x + 64 hex)",
        password: true,
        validateInput: (v) => (/^0x[0-9a-fA-F]{64}$/.test(v) ? null : "must be 0x + 64 hex chars"),
      });
      if (!key) return;
      await context.secrets.store(SECRET_KEY, key);
      vscode.window.showInformationMessage("PromptPay: agent connected. Run PromptPay: Enable ads in spinner.");
    }),

    vscode.commands.registerCommand("promptpay.enable", () => enable(context)),

    vscode.commands.registerCommand("promptpay.restore", () => {
      if (adPollTimer) clearInterval(adPollTimer);
      loopback?.stop();
      const result = restore();
      vscode.window.showInformationMessage(
        result.ok ? "PromptPay: Claude Code restored. Reload the window." : `PromptPay restore failed: ${result.error}`
      );
    }),

    vscode.commands.registerCommand("promptpay.status", async () => {
      if (!wallet) return vscode.window.showInformationMessage("PromptPay: not connected.");
      await refreshEarnings();
      const patched = isPatched() ? "patched" : "not patched";
      vscode.window.showInformationMessage(`PromptPay — agent ${wallet.address} · Claude Code ${patched}`);
    })
  );
}

export function deactivate() {
  if (adPollTimer) clearInterval(adPollTimer);
  loopback?.stop();
  // leave the patch in place across reloads; user reverts explicitly via the command
}
