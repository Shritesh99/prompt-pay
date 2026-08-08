// Round-trip test: patch a COPY of the real Claude Code bundle, verify our
// block + CSP land, then restore and assert byte-identical to the original.
// Usage: node test/patch.test.mjs   (bundles src via esbuild into a temp file)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const CC = process.env.PROMPTPAY_TEST_CC ??
  `${process.env.HOME}/.vscode/extensions/anthropic.claude-code-2.1.226-darwin-arm64`;
const FIX = "/tmp/pp-cc-fixture/anthropic.claude-code-test";
const sha = (s) => createHash("sha256").update(s).digest("hex");

// fresh fixture copy
rmSync("/tmp/pp-cc-fixture", { recursive: true, force: true });
mkdirSync(path.join(FIX, "webview"), { recursive: true });
cpSync(path.join(CC, "webview/index.js"), path.join(FIX, "webview/index.js"));
cpSync(path.join(CC, "extension.js"), path.join(FIX, "extension.js"));

const origWebview = readFileSync(path.join(FIX, "webview/index.js"), "utf8");
const origHost = readFileSync(path.join(FIX, "extension.js"), "utf8");
const origSha = sha(origWebview);

// bundle patch.ts + block.ts to an importable ESM module
const outfile = "/tmp/pp-patch-bundle.mjs";
await build({
  entryPoints: ["src/patch.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
});
await build({
  entryPoints: ["src/block.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/pp-block-bundle.mjs",
  logLevel: "silent",
});

process.env.PROMPTPAY_CC_TARGET = path.join(FIX, "webview/index.js");
const { applyPatch, restore, isPatched, isCompatible } = await import(outfile);
const { renderBlock } = await import("/tmp/pp-block-bundle.mjs");

assert.equal(isCompatible().ok, true, "fixture should be compatible");

const block = renderBlock({
  base: "http://127.0.0.1:9999/pp/deadbeef",
  adId: "0xabc",
  campaignId: "1",
  adText: "Test ad",
  clickUrl: "https://monad.xyz",
  viewThresholdMs: 3000,
});

const res = applyPatch(block);
assert.equal(res.ok, true, `patch should succeed: ${res.error ?? ""}`);
assert.equal(isPatched(), true, "bundle should report patched");

const patchedWebview = readFileSync(path.join(FIX, "webview/index.js"), "utf8");
assert.ok(patchedWebview.includes("/* PROMPTPAY-START */"), "block marker present");
assert.ok(patchedWebview.includes("Test ad"), "ad text injected");

const patchedHost = readFileSync(path.join(FIX, "extension.js"), "utf8");
assert.ok(patchedHost.includes("connect-src http://127.0.0.1:*"), "CSP connect-src injected");

// idempotent re-patch (strips prior block, no duplication)
applyPatch(renderBlock({ base: "http://127.0.0.1:9999/pp/deadbeef", adId: "0xdef", campaignId: "2", adText: "Second ad", clickUrl: "https://monad.xyz", viewThresholdMs: 3000 }));
const rePatched = readFileSync(path.join(FIX, "webview/index.js"), "utf8");
assert.equal(rePatched.split("/* PROMPTPAY-START */").length - 1, 1, "exactly one injected block after re-patch");
assert.ok(rePatched.includes("Second ad") && !rePatched.includes("Test ad"), "ad rotated in place");

const rst = restore();
assert.equal(rst.ok, true, `restore should succeed: ${rst.error ?? ""}`);
const restored = readFileSync(path.join(FIX, "webview/index.js"), "utf8");
assert.equal(sha(restored), origSha, "webview restored byte-identical to original");
assert.equal(isPatched(), false, "no longer patched after restore");

console.log(`PASS: patch/restore round-trip against Claude Code ${path.basename(CC)}`);
console.log(`  webview sha stable: ${origSha.slice(0, 16)}…`);
rmSync("/tmp/pp-cc-fixture", { recursive: true, force: true });
