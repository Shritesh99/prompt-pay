// Installs/removes the PromptPay `notify` hook in ~/.codex/config.toml.
// Codex reads `notify` only from the USER-level config (project-local is
// ignored), and it must be a top-level key (before the first [table]).
// We edit line-by-line so the rest of the user's TOML is left untouched.
import { homedir } from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PATHS, ensureHome } from "./config.mjs";

const CODEX_DIR = path.join(homedir(), ".codex");
const CODEX_CONFIG = path.join(CODEX_DIR, "config.toml");
const BACKUP = path.join(PATHS.home, "codex-config.backup.json");

function readLines() {
  if (!existsSync(CODEX_CONFIG)) return [];
  return readFileSync(CODEX_CONFIG, "utf8").split("\n");
}

// index of the first [table] header, i.e. the end of the top-level region
function firstTableIndex(lines) {
  const i = lines.findIndex((l) => /^\s*\[/.test(l));
  return i === -1 ? lines.length : i;
}

function topLevelNotifyIndex(lines) {
  const end = firstTableIndex(lines);
  for (let i = 0; i < end; i++) if (/^\s*notify\s*=/.test(lines[i])) return i;
  return -1;
}

export function installCodexNotify(scriptPath) {
  mkdirSync(CODEX_DIR, { recursive: true });
  ensureHome();
  const lines = readLines();

  const existingIdx = topLevelNotifyIndex(lines);
  if (!existsSync(BACKUP)) {
    writeFileSync(
      BACKUP,
      JSON.stringify(
        { hadNotify: existingIdx !== -1, line: existingIdx !== -1 ? lines[existingIdx] : null },
        null,
        2
      )
    );
  }
  if (existingIdx !== -1) lines.splice(existingIdx, 1);

  const notifyLine = `notify = ["node", ${JSON.stringify(scriptPath)}]`;
  lines.unshift(notifyLine);
  writeFileSync(CODEX_CONFIG, lines.join("\n"));
}

export function restoreCodexNotify() {
  const lines = readLines();
  const idx = topLevelNotifyIndex(lines);
  if (idx !== -1) lines.splice(idx, 1);

  if (existsSync(BACKUP)) {
    const backup = JSON.parse(readFileSync(BACKUP, "utf8"));
    if (backup.hadNotify && backup.line) lines.unshift(backup.line);
  }
  writeFileSync(CODEX_CONFIG, lines.join("\n"));
}

export { CODEX_CONFIG };
