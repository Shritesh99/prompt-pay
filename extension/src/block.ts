// The IIFE injected into Claude Code's webview bundle. It overlays the winning
// ad on the "thinking" spinner and reports view events back to the extension
// over a token-gated 127.0.0.1 loopback. Placeholders (__PROMPTPAY_*__) are
// substituted by renderBlock() at patch time.
//
// Design rules learned from the surface being React-owned and CSP-locked:
//   - NEVER mutate CC's DOM (React reconciliation tears it down) — overlay only.
//   - NEVER attach a document-wide MutationObserver (fires hundreds/sec during
//     token streaming and crashes the webview). Poll on a short interval.
//   - Detect "thinking" by the animated sparkle glyph *changing*, not by the
//     spinner element merely existing (it lingers frozen after a turn).

export function renderBlock(params: {
  base: string; // loopback base, e.g. http://127.0.0.1:PORT/pp/TOKEN
  adId: string;
  campaignId: string;
  adText: string;
  clickUrl: string;
  viewThresholdMs: number;
}): string {
  const cfg = JSON.stringify(params);
  return `
/* PROMPTPAY-START */
(function () {
  "use strict";
  if (window.__promptpayActive) { try { window.__promptpayTeardown && window.__promptpayTeardown(); } catch (e) {} }
  window.__promptpayActive = true;

  var CFG = ${cfg};
  var SPARKLES = ["\\u2722", "\\u2736", "\\u273B", "\\u273D"]; // ✢ ✶ ✻ ✽
  var GRACE_MS = 1200;
  var session = "s" + Date.now() + Math.floor(Math.random() * 1e6);
  var impressionSent = false, thresholdSent = false, viewMs = 0, shownAt = 0, lastGlyph = "", lastGlyphAt = 0;

  function send(kind, extra) {
    try {
      var body = JSON.stringify(Object.assign({ kind: kind, session: session, adId: CFG.adId, campaignId: CFG.campaignId }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(CFG.base + "/event", new Blob([body], { type: "application/json" }));
      else fetch(CFG.base + "/event", { method: "POST", body: body, keepalive: true });
    } catch (e) {}
  }

  function findSpinnerRow() {
    var rows = document.querySelectorAll('[class*="spinnerRow_"]');
    for (var i = rows.length - 1; i >= 0; i--) {
      if ((rows[i].textContent || "").trim()) return rows[i];
    }
    return null;
  }

  function firstGlyph(el) {
    var t = (el.textContent || "").trim();
    return t ? t[0] : "";
  }

  function ensureOverlay() {
    var o = document.getElementById("promptpay-overlay");
    if (o) return o;
    o = document.createElement("a");
    o.id = "promptpay-overlay";
    o.href = CFG.clickUrl;
    o.target = "_blank";
    o.rel = "noopener";
    o.style.cssText = "position:fixed;z-index:2147483646;display:none;align-items:center;" +
      "font:13px ui-monospace,Menlo,monospace;color:#a78bfa;text-decoration:none;" +
      "padding:2px 6px;border-radius:6px;white-space:nowrap;pointer-events:auto;";
    o.addEventListener("click", function () { send("click"); }); // real href navigates; just log
    document.body.appendChild(o);
    return o;
  }

  function surfaceBg(el) {
    var n = el;
    for (var i = 0; i < 6 && n; i++) {
      var bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      n = n.parentElement;
    }
    return "#1e1e1e";
  }

  function showOverlay(row) {
    var o = ensureOverlay();
    var r = row.getBoundingClientRect();
    o.textContent = "\\u2726 " + CFG.adText + " \\u00B7 sponsored";
    o.style.background = surfaceBg(row);
    o.style.left = r.left + "px";
    o.style.top = r.top + "px";
    o.style.height = r.height + "px";
    o.style.display = "flex";
  }

  function hideOverlay() {
    var o = document.getElementById("promptpay-overlay");
    if (o) o.style.display = "none";
  }

  function thinking() {
    var row = findSpinnerRow();
    if (!row) return { active: false, row: null };
    var g = firstGlyph(row);
    var now = Date.now();
    var isSparkle = SPARKLES.indexOf(g) >= 0;
    if (isSparkle && g !== lastGlyph) { lastGlyph = g; lastGlyphAt = now; }
    // active only while the glyph has animated within the grace window
    return { active: isSparkle && now - lastGlyphAt < GRACE_MS, row: row };
  }

  var iv = setInterval(function () {
    var t = thinking();
    if (t.active && t.row) {
      showOverlay(t.row);
      if (!shownAt) shownAt = Date.now();
      if (!impressionSent) { impressionSent = true; send("impression_rendered"); }
      viewMs = Date.now() - shownAt;
      if (!thresholdSent && viewMs >= CFG.viewThresholdMs) { thresholdSent = true; send("view_threshold_met", { visibleMs: viewMs }); }
    } else {
      hideOverlay();
      shownAt = 0; // ending the view resets dwell; next think is a new impression window
    }
  }, 120);

  window.__promptpayTeardown = function () {
    clearInterval(iv);
    hideOverlay();
    window.__promptpayActive = false;
  };
})();
/* PROMPTPAY-END */
`;
}
