import { homedir } from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const HOME = path.join(homedir(), ".promptpay");
export const PATHS = {
  home: HOME,
  config: path.join(HOME, "config.json"),
  statusline: path.join(HOME, "statusline.mjs"),
  currentAd: path.join(HOME, "current-ad.json"),
  heartbeat: path.join(HOME, "heartbeat"),
  pid: path.join(HOME, "daemon.pid"),
  log: path.join(HOME, "daemon.log"),
  settingsBackup: path.join(HOME, "settings-backup.json"),
};

export function ensureHome() {
  mkdirSync(HOME, { recursive: true });
}

export function loadConfig() {
  if (!existsSync(PATHS.config)) return null;
  try {
    return JSON.parse(readFileSync(PATHS.config, "utf8"));
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  ensureHome();
  writeFileSync(PATHS.config, JSON.stringify(cfg, null, 2));
}
