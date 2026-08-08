// PromptPay status line for Claude Code. Runs on EVERY render, so it must be
// tiny, do no network I/O, and never throw. Its side effect is the heartbeat:
// a fresh heartbeat file is the daemon's proof that the ad is on screen.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = path.join(homedir(), ".promptpay");
const ESC = String.fromCharCode(27); // no literal ESC bytes in source

try {
  writeFileSync(path.join(HOME, "heartbeat"), String(Date.now()));
} catch {}

let ad = null;
try {
  ad = JSON.parse(readFileSync(path.join(HOME, "current-ad.json"), "utf8"));
} catch {}

const clean = (s) => [...String(s)].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").slice(0, 90);

// Show the destination as visible text (e.g. "monad.xyz") alongside the ad, and
// still make the whole line an OSC-8 hyperlink to the full URL.
const hostOf = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return null;
  }
};

let line = "✦ promptpay · waiting for ads";
if (ad && ad.adText && Date.now() - (ad.fetchedAt ?? 0) < 90_000) {
  const url = /^https?:\/\//.test(ad.clickUrl ?? "") ? ad.clickUrl : null;
  const host = url ? hostOf(url) : null;
  const label = `✦ ${clean(ad.adText)}${host ? ` → ${host}` : ""} · sponsored`;
  // OSC 8 hyperlink — clickable in most modern terminals
  line = url ? `${ESC}]8;;${url}${ESC}\\${label}${ESC}]8;;${ESC}\\` : label;
  if (ad.earnedUsd) line += ` · earned $${ad.earnedUsd}`;
}

process.stdout.write(line);
