# PromptPay — VS Code extension

Shows the winning PromptPay ad **inside the Claude Code panel's thinking spinner** (not just the
terminal) and reports signed impressions that settle on Monad. This is the in-editor counterpart
to the `promptpay` CLI.

## How it works

Claude Code's panel is a VS Code webview with no supported "spinner ad" API, so the extension:

1. **Locates** the newest installed `anthropic.claude-code-*` webview bundle ([locate.ts](src/locate.ts)).
2. **Patches** it ([patch.ts](src/patch.ts)) — appends a fenced IIFE between
   `/* PROMPTPAY-START/END */` markers (atomic write, sha256-verified `.backup`), and relaxes the
   extension host's CSP template so the webview can reach a loopback server. Patching is gated on
   compatibility anchors (the `spinnerRow_` class + Claude Code's nonsense verb array) and is
   fully reversible via **PromptPay: Restore Claude Code**.
3. The injected block ([block.ts](src/block.ts)) detects "thinking" by the animated sparkle glyph
   changing, overlays the ad with `position:fixed` (**never** mutating CC's React DOM, **never** a
   document-wide MutationObserver), and posts view events to a token-gated `127.0.0.1` bridge
   ([loopback.ts](src/loopback.ts)).
4. The extension host signs those events with the agent key ([wallet.ts](src/wallet.ts)) using the
   same 402-challenge protocol as the CLI and server.

## Use

```bash
pnpm build          # dist/extension.js
pnpm test           # patch/restore round-trip against your installed Claude Code
```

Then in VS Code: **PromptPay: Connect agent** (paste the key from `promptpay setup` or `/earn`) →
**PromptPay: Enable ads in spinner** → reload the window. Revert any time with
**PromptPay: Restore Claude Code**.

> Stretch/experimental: bundle patching is inherently fragile across Claude Code releases. The CLI
> (`cli/`) is the reliable earner surface and uses only supported settings.
