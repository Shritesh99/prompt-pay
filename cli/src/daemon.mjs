// PromptPay earning daemon. Polls the ad-server, rotates the ad surfaces
// (status line file + Claude Code spinnerVerbs), and reports impressions —
// but ONLY while the statusline heartbeat proves an ad is actually on screen.
import { readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { PATHS, loadConfig } from "./config.mjs";
import { updateSpinnerVerb } from "./settings.mjs";
import { signedReport } from "./report.mjs";

// Cadence knobs — env-overridable so a demo can bill fast. Defaults are the
// "honest" production values (one impression per 15s rotation).
const num = (name, def) => Number(process.env[name] ?? def);
const TICK_MS = num("PP_TICK_MS", 5_000);
const ROTATION_MS = num("PP_ROTATION_MS", 15_000); // hold each ad so billing is honest
const HEARTBEAT_FRESH_MS = num("PP_HEARTBEAT_FRESH_MS", 12_000); // statusline rendered recently = visible
const MIN_REPORT_GAP_MS = num("PP_MIN_REPORT_GAP_MS", 5_000);
const EARNINGS_POLL_MS = num("PP_EARNINGS_POLL_MS", 15_000);

const config = loadConfig();
if (!config?.agentPrivateKey) {
  console.error("no config — run `promptpay setup` first");
  process.exit(1);
}
const account = privateKeyToAccount(config.agentPrivateKey);
const serverBase = config.serverBase ?? "http://localhost:4021";
console.log(`[daemon] agent ${account.address} → ${serverBase}`);

// "<adText> → <host>" so the destination shows in the thinking verb too
function withHost(adText, clickUrl) {
  try {
    return `${adText} → ${new URL(clickUrl).host.replace(/^www\./, "")}`;
  } catch {
    return adText;
  }
}

let currentAd = null; // {adId, campaignId, adText, clickUrl, viewThresholdMs}
let adShownAt = 0;
let lastReportAt = 0;
let lastEarningsAt = 0;
let earnedUsd = null;
let impressionReportedForRotation = false;

function heartbeatFresh() {
  try {
    const t = Number(readFileSync(PATHS.heartbeat, "utf8"));
    return Date.now() - t < HEARTBEAT_FRESH_MS;
  } catch {
    return false;
  }
}

function writeAdFile() {
  const payload = currentAd
    ? { ...currentAd, fetchedAt: adShownAt, earnedUsd }
    : { fetchedAt: 0 };
  try {
    writeFileSync(PATHS.currentAd, JSON.stringify(payload));
  } catch {}
}

async function tick() {
  // killswitch: blank every surface
  try {
    const ks = await (await fetch(`${serverBase}/killswitch`)).json();
    if (ks.killed) {
      currentAd = null;
      writeAdFile();
      return;
    }
  } catch {
    return; // server unreachable — keep last state, report nothing
  }

  // rotate the ad at most every ROTATION_MS
  if (!currentAd || Date.now() - adShownAt >= ROTATION_MS) {
    try {
      const res = await (await fetch(`${serverBase}/ad`)).json();
      if (res.ad) {
        const changed = currentAd?.adId !== res.ad.adId;
        if (changed || !currentAd) {
          currentAd = { ...res.ad, viewThresholdMs: res.viewThresholdMs ?? 3000 };
          adShownAt = Date.now();
          impressionReportedForRotation = false;
          // include the destination host in the thinking-verb ad too
          updateSpinnerVerb(withHost(currentAd.adText, currentAd.clickUrl));
          writeAdFile();
          console.log(`[daemon] ad: "${currentAd.adText}"`);
        } else {
          adShownAt = Date.now(); // same ad, new rotation window — bill again
          impressionReportedForRotation = false;
        }
      } else {
        currentAd = null;
        writeAdFile();
      }
    } catch {}
  }

  // refresh earnings for the status line
  if (Date.now() - lastEarningsAt > EARNINGS_POLL_MS) {
    lastEarningsAt = Date.now();
    try {
      const e = await (await fetch(`${serverBase}/earnings/${account.address}`)).json();
      earnedUsd = (Number(e.claimable) / 1e6).toFixed(4);
      writeAdFile();
    } catch {}
  }

  // impression gating: ad held past view threshold + statusline actually rendering
  if (
    currentAd &&
    !impressionReportedForRotation &&
    Date.now() - adShownAt >= (currentAd.viewThresholdMs ?? 3000) &&
    Date.now() - lastReportAt >= MIN_REPORT_GAP_MS &&
    heartbeatFresh()
  ) {
    impressionReportedForRotation = true;
    lastReportAt = Date.now();
    try {
      const out = await signedReport({
        serverBase,
        account,
        campaignId: currentAd.campaignId,
        type: "impression",
        surface: "claude-cli-statusline",
      });
      if (out.credited) console.log(`[daemon] impression credited (campaign ${currentAd.campaignId})`);
      else console.log(`[daemon] impression not credited:`, JSON.stringify(out));
    } catch (err) {
      console.error(`[daemon] report failed:`, err.message);
    }
  }
}

setInterval(() => tick().catch(() => {}), TICK_MS);
tick().catch(() => {});
