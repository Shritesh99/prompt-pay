// Claude Code integration via SUPPORTED settings only (no bundle patching):
//   statusLine   — persistent clickable ad at the bottom of every session
//   spinnerVerbs — the "thinking" verb IS the ad while Claude works
// Prior values of exactly those two keys are backed up once and restored on
// uninstall; nothing else in settings.json is touched.
import { homedir } from "node:os";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PATHS, ensureHome } from "./config.mjs";

const SETTINGS = path.join(homedir(), ".claude", "settings.json");
const ABSENT = "__promptpay_absent__";
const MANAGED_KEYS = ["statusLine", "spinnerVerbs"];

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function backupOnce(settings) {
  if (existsSync(PATHS.settingsBackup)) return;
  const backup = {};
  for (const key of MANAGED_KEYS) {
    backup[key] = key in settings ? settings[key] : ABSENT;
  }
  ensureHome();
  writeFileSync(PATHS.settingsBackup, JSON.stringify(backup, null, 2));
}

export function installSettings(adText) {
  const settings = readJson(SETTINGS, {});
  backupOnce(settings);
  settings.statusLine = {
    type: "command",
    command: `node ${PATHS.statusline}`,
    padding: 0,
  };
  settings.spinnerVerbs = { mode: "replace", verbs: [sanitizeVerb(adText)] };
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}

export function updateSpinnerVerb(adText) {
  const settings = readJson(SETTINGS, {});
  const verb = sanitizeVerb(adText);
  const current = settings.spinnerVerbs?.verbs?.[0];
  if (current === verb) return false;
  settings.spinnerVerbs = { mode: "replace", verbs: [verb] };
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  return true;
}

export function restoreSettings() {
  const backup = readJson(PATHS.settingsBackup, null);
  const settings = readJson(SETTINGS, {});
  if (!backup) {
    for (const key of MANAGED_KEYS) delete settings[key];
  } else {
    for (const key of MANAGED_KEYS) {
      if (backup[key] === ABSENT) delete settings[key];
      else settings[key] = backup[key];
    }
  }
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}

function sanitizeVerb(text) {
  // Claude Code appends "…" itself; keep the verb clean and single-line.
  return [...String(text)].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").slice(0, 80).trim();
}
