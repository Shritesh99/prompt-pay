"use client";
import { useEffect, useRef } from "react";

// Cloudflare Turnstile widget. Defaults to Cloudflare's always-pass TEST sitekey
// so the flow works out of the box; set NEXT_PUBLIC_TURNSTILE_SITEKEY (and the
// server's TURNSTILE_SECRET) to real keys for a genuine human check.
const SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY ?? "1x00000000000000000000AA";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback"?: () => void }) => string;
    };
  }
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    const id = "cf-turnstile-script";
    const render = () => {
      if (!window.turnstile || !ref.current || rendered.current) return;
      rendered.current = true;
      window.turnstile.render(ref.current, {
        sitekey: SITEKEY,
        callback: (t) => onToken(t),
        "expired-callback": () => onToken(null),
      });
    };
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    const t = setInterval(render, 400);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="my-2" />;
}
