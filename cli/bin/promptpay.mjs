#!/usr/bin/env node
// PromptPay CLI — earn USDC while your AI coding agent works.
//   promptpay setup [--key 0x…] [--server URL]   Claude Code: status-line + spinner ad + daemon
//   promptpay start | stop | status | uninstall
//   promptpay codex-setup [--key 0x…] [--server URL]   Codex: sponsored notify hook (earns per turn)
//   promptpay codex-uninstall
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PATHS, ensureHome, loadConfig, saveConfig, DEFAULT_SERVER } from "../src/config.mjs";
import { installSettings, restoreSettings } from "../src/settings.mjs";
import { installCodexNotify, restoreCodexNotify, CODEX_CONFIG } from "../src/codex.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2];
const args = process.argv.slice(3);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

// Optional payout wallet (public address). Earnings settle here instead of to
// the local signing key. Kept in config so both surfaces report it.
function walletFlag() {
  const w = flag("wallet") ?? loadConfig()?.payout;
  if (w === undefined) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(w)) {
    console.error("--wallet must be a 0x-prefixed 20-byte address");
    process.exit(1);
  }
  return w.toLowerCase();
}

function daemonPid() {
  try {
    const pid = Number(readFileSync(PATHS.pid, "utf8"));
    process.kill(pid, 0); // liveness probe only
    return pid;
  } catch {
    return null;
  }
}

function startDaemon() {
  if (daemonPid()) return console.log("daemon already running");
  const log = openSync(PATHS.log, "a");
  const child = spawn(process.execPath, [path.join(here, "../src/daemon.mjs")], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  writeFileSync(PATHS.pid, String(child.pid));
  child.unref();
  console.log(`daemon started (pid ${child.pid}, log at ${PATHS.log})`);
}

function stopDaemon() {
  const pid = daemonPid();
  if (!pid) return console.log("daemon not running");
  process.kill(pid);
  rmSync(PATHS.pid, { force: true });
  console.log(`daemon stopped (pid ${pid})`);
}

// Always start a fresh daemon (kill any existing one first) — setup rewrites
// config, and re-running the installer should replace a stale daemon.
function restartDaemon() {
  const pid = daemonPid();
  if (pid) {
    try {
      process.kill(pid);
    } catch {}
    rmSync(PATHS.pid, { force: true });
    console.log(`stopped previous daemon (pid ${pid})`);
  }
  startDaemon();
}

switch (cmd) {
  case "setup": {
    ensureHome();
    const key = flag("key") ?? loadConfig()?.agentPrivateKey ?? generatePrivateKey();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.error("--key must be a 0x-prefixed 32-byte hex private key");
      process.exit(1);
    }
    const serverBase = flag("server") ?? loadConfig()?.serverBase ?? DEFAULT_SERVER;
    const payout = walletFlag();
    saveConfig({ agentPrivateKey: key, serverBase, payout });
    copyFileSync(path.join(here, "../src/statusline.mjs"), PATHS.statusline);
    installSettings("promptpay · waiting for ads");
    restartDaemon();
    const address = privateKeyToAccount(key).address;
    console.log(`\nagent (signing key): ${address}`);
    console.log(`payout: ${payout ?? address}${payout ? "" : "  (no --wallet given; earnings go to the signing key)"}`);
    console.log(`server: ${serverBase}`);
    console.log("\nOpen a NEW `claude` session — the ad appears in the status line");
    console.log("and as the thinking verb. `promptpay status` shows earnings.");
    break;
  }

  case "start":
    startDaemon();
    break;

  case "stop":
    stopDaemon();
    break;

  case "status": {
    const config = loadConfig();
    if (!config) {
      console.log("not set up — run `promptpay setup`");
      break;
    }
    const address = privateKeyToAccount(config.agentPrivateKey).address;
    const payoutAddr = config.payout ?? address;
    console.log(`agent:  ${address}`);
    console.log(`payout: ${payoutAddr}`);
    console.log(`server: ${config.serverBase}`);
    console.log(`daemon: ${daemonPid() ? `running (pid ${daemonPid()})` : "stopped"}`);
    try {
      const ad = JSON.parse(readFileSync(PATHS.currentAd, "utf8"));
      if (ad.adText) console.log(`ad:     "${ad.adText}" → ${ad.clickUrl}`);
    } catch {}
    try {
      const e = await (await fetch(`${config.serverBase}/earnings/${payoutAddr}`)).json();
      console.log(`earned: $${(Number(e.claimable) / 1e6).toFixed(4)} USDC claimable (+${e.pendingUnits} units pending settlement)`);
    } catch {
      console.log("earned: (server unreachable)");
    }
    break;
  }

  case "uninstall": {
    stopDaemon();
    if (existsSync(PATHS.settingsBackup) || existsSync(PATHS.config)) restoreSettings();
    for (const f of [PATHS.currentAd, PATHS.heartbeat, PATHS.settingsBackup, PATHS.statusline]) {
      rmSync(f, { force: true });
    }
    console.log("uninstalled — Claude Code settings restored. (~/.promptpay/config.json kept: it holds your agent key.)");
    break;
  }

  case "codex-setup": {
    ensureHome();
    const key = flag("key") ?? loadConfig()?.agentPrivateKey ?? generatePrivateKey();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.error("--key must be a 0x-prefixed 32-byte hex private key");
      process.exit(1);
    }
    const serverBase = flag("server") ?? loadConfig()?.serverBase ?? DEFAULT_SERVER;
    const payout = walletFlag();
    saveConfig({ agentPrivateKey: key, serverBase, payout });
    const notifyScript = path.join(here, "../src/codex-notify.mjs");
    installCodexNotify(notifyScript);
    const address = privateKeyToAccount(key).address;
    console.log(`installed Codex notify hook → ${CODEX_CONFIG}`);
    console.log(`agent (signing key): ${address}`);
    console.log(`payout: ${payout ?? address}`);
    console.log(`server: ${serverBase}`);
    console.log("\nRun `codex`, complete a task, and a sponsored notification appears each");
    console.log("turn — earning an impression. Watch it: promptpay status");
    console.log("Undo: promptpay codex-uninstall");
    break;
  }

  case "codex-uninstall":
    restoreCodexNotify();
    console.log(`removed PromptPay notify hook from ${CODEX_CONFIG}`);
    break;

  default:
    console.log(
      "usage: promptpay <setup|start|stop|status|uninstall|codex-setup|codex-uninstall> [--key 0x…] [--server URL]"
    );
    process.exit(cmd ? 1 : 0);
}
