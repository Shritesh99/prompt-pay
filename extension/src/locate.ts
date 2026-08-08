import { homedir } from "node:os";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";

// Finds the newest installed Claude Code extension and its webview bundle +
// extension host file (for the CSP patch). Honors PROMPTPAY_CC_TARGET override.
const EXT_ROOTS = [
  ".vscode/extensions",
  ".vscode-insiders/extensions",
  ".vscode-server/extensions",
  ".cursor/extensions",
  ".cursor-server/extensions",
];

export type Target = { dir: string; webview: string; host: string; version: string };

function versionOf(name: string): number[] {
  const m = name.match(/claude-code-(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function locateTarget(): Target | null {
  const override = process.env.PROMPTPAY_CC_TARGET;
  if (override && existsSync(override)) {
    const dir = path.dirname(path.dirname(override));
    return { dir, webview: override, host: path.join(dir, "extension.js"), version: "override" };
  }

  const home = homedir();
  let best: Target | null = null;
  let bestV = [0, 0, 0];
  for (const root of EXT_ROOTS) {
    const base = path.join(home, root);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (!name.startsWith("anthropic.claude-code-")) continue;
      const dir = path.join(base, name);
      const webview = path.join(dir, "webview", "index.js");
      const host = path.join(dir, "extension.js");
      if (!existsSync(webview)) continue;
      const v = versionOf(name);
      if (cmp(v, bestV) >= 0) {
        bestV = v;
        best = { dir, webview, host, version: v.join(".") };
      }
    }
  }
  return best;
}
