import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { locateTarget, type Target } from "./locate.js";

const START = "/* PROMPTPAY-START */";
const END = "/* PROMPTPAY-END */";
// The webview bundle contains this hashed CSS-module class and CC's nonsense
// verb array — presence gates patching so we never corrupt an unexpected file.
const SPINNER_ANCHOR = "spinnerRow_";
const VERB_ANCHOR = /Discombobulating|Flibbertigibbeting|Clauding/;
// CSP template: match the SHAPE (a template var after default-src 'none';) so
// minifier variable renames between CC versions don't break us.
const CSP_ANCHOR = /default-src 'none'; (\$\{[a-zA-Z_]\w*\})/;
const CONNECT_SRC = "connect-src http://127.0.0.1:* http://localhost:*; ";

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function atomicWrite(file: string, content: string) {
  const tmp = `${file}.promptpay-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

function stripBlock(src: string): string {
  const s = src.indexOf(START);
  const e = src.indexOf(END);
  if (s >= 0 && e > s) return src.slice(0, s) + src.slice(e + END.length);
  return src;
}

export type PatchResult = { ok: true; version: string } | { ok: false; error: string };

export function isCompatible(): { ok: boolean; target: Target | null; reason?: string } {
  const target = locateTarget();
  if (!target) return { ok: false, target: null, reason: "Claude Code webview bundle not found" };
  const src = readFileSync(target.webview, "utf8");
  if (!src.includes(SPINNER_ANCHOR)) return { ok: false, target, reason: "spinner class anchor missing" };
  if (!VERB_ANCHOR.test(src)) return { ok: false, target, reason: "verb array anchor missing" };
  return { ok: true, target };
}

export function applyPatch(block: string): PatchResult {
  const compat = isCompatible();
  if (!compat.ok || !compat.target) return { ok: false, error: compat.reason ?? "incompatible" };
  const target = compat.target;

  // ---- webview: back up pristine, then append the fenced block ----
  const raw = readFileSync(target.webview, "utf8");
  const backup = `${target.webview}.promptpay-backup`;
  const pristine = stripBlock(raw); // never enshrine an already-patched file as "pristine"
  if (!existsSync(backup)) {
    writeFileSync(backup, pristine);
    writeFileSync(`${backup}.sha256`, sha(pristine));
  }
  atomicWrite(target.webview, pristine + "\n" + block + "\n");

  // ---- extension host: relax CSP so the webview can reach the loopback ----
  if (existsSync(target.host)) {
    const host = readFileSync(target.host, "utf8");
    if (!host.includes(CONNECT_SRC) && CSP_ANCHOR.test(host)) {
      const hostBackup = `${target.host}.promptpay-backup`;
      if (!existsSync(hostBackup)) writeFileSync(hostBackup, host);
      const patched = host.replace(CSP_ANCHOR, `default-src 'none'; ${CONNECT_SRC}$1`);
      atomicWrite(target.host, patched);
    }
  }

  return { ok: true, version: target.version };
}

export function restore(): PatchResult {
  const target = locateTarget();
  if (!target) return { ok: false, error: "target not found" };

  const backup = `${target.webview}.promptpay-backup`;
  if (existsSync(backup)) {
    const pristine = readFileSync(backup, "utf8");
    const expected = existsSync(`${backup}.sha256`) ? readFileSync(`${backup}.sha256`, "utf8") : null;
    if (expected && sha(pristine) !== expected) {
      return { ok: false, error: "backup integrity check failed — not restoring" };
    }
    atomicWrite(target.webview, pristine);
  } else {
    // no backup: just strip our block in place
    const raw = readFileSync(target.webview, "utf8");
    atomicWrite(target.webview, stripBlock(raw));
  }

  // CSP patch is intentionally left in place on restore: Claude Code captures
  // the CSP template into memory at host load, so reverting it now has no
  // effect until the next reload and only risks corrupting the host file.
  return { ok: true, version: target.version };
}

export function isPatched(): boolean {
  const target = locateTarget();
  if (!target) return false;
  return readFileSync(target.webview, "utf8").includes(START);
}
