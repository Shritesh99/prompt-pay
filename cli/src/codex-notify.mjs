#!/usr/bin/env node
// PromptPay notify hook for OpenAI Codex CLI.
//
// Codex spawns this with a single JSON argument on `agent-turn-complete` (the
// moment the AI finishes a turn — the wait-time we monetize). On each turn we
// pop a native "sponsored" notification with the winning ad and report a
// signed impression to the ad-server. One real turn = one impression, so it's
// inherently bot-resistant.
//
// Wired via ~/.codex/config.toml:  notify = ["node", "<abs>/codex-notify.mjs"]
import { execFile } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, DEFAULT_SERVER } from "./config.mjs";
import { signedReport } from "./report.mjs";

async function main() {
  let evt = null;
  try {
    evt = JSON.parse(process.argv[2] ?? "null");
  } catch {}
  // Only bill on a completed turn. If Codex ever changes the shape, act only
  // when we positively recognize the event (never bill on unknown input).
  const type = evt?.type ?? evt?.["event"];
  if (type !== "agent-turn-complete") return;

  const config = loadConfig();
  if (!config?.agentPrivateKey) return;
  const account = privateKeyToAccount(config.agentPrivateKey);
  const serverBase = config.serverBase ?? DEFAULT_SERVER;

  const [ks, adRes] = await Promise.all([
    fetch(`${serverBase}/killswitch`).then((r) => r.json()).catch(() => ({ killed: false })),
    fetch(`${serverBase}/ad`).then((r) => r.json()).catch(() => ({ ad: null })),
  ]);
  if (ks.killed || !adRes?.ad) return;
  const ad = adRes.ad;

  notify(ad);
  await signedReport({
    serverBase,
    account,
    campaignId: ad.campaignId,
    type: "impression",
    surface: "codex-notify",
    payout: config.payout,
  }).catch(() => {});
}

function hostOf(u) {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function notify(ad) {
  const host = hostOf(ad.clickUrl);
  const title = "Sponsored · PromptPay";
  const message = `${ad.adText}${host ? ` → ${host}` : ""}`;
  const run = (cmd, args) => new Promise((res) => execFile(cmd, args, () => res()));

  if (process.platform === "darwin") {
    // terminal-notifier is clickable (opens the URL); fall back to osascript
    execFile("terminal-notifier", [
      "-title", title,
      "-message", message,
      ...(ad.clickUrl ? ["-open", ad.clickUrl] : []),
    ], (err) => {
      if (err) {
        const q = (s) => '"' + String(s).replace(/["\\]/g, "\\$&") + '"';
        run("osascript", ["-e", `display notification ${q(message)} with title ${q(title)}`]);
      }
    });
  } else if (process.platform === "linux") {
    run("notify-send", [title, message]);
  } else if (process.platform === "win32") {
    const ps = `New-BurntToastNotification -Text ${JSON.stringify(title)}, ${JSON.stringify(message)}`;
    run("powershell", ["-NoProfile", "-Command", ps]);
  }
}

main().finally(() => process.exit(0));
