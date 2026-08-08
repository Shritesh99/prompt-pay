import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

// Token-gated 127.0.0.1 bridge: the injected webview block POSTs view events
// here; the extension host validates and forwards them as signed /report calls.
// All routes live behind a random /pp/<token>/ prefix so nothing else on
// localhost can drive billing.
export type ViewEvent = {
  kind: string;
  session: string;
  adId: string;
  campaignId: string;
  visibleMs?: number;
};

export class Loopback {
  readonly token = randomBytes(16).toString("hex");
  private server: Server | null = null;
  private port = 0;
  private seen = new Set<string>(); // per-session impression dedupe

  constructor(private onEvent: (e: ViewEvent) => void) {}

  async start(): Promise<{ port: number; token: string }> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "content-type");
        if (req.method === "OPTIONS") return res.writeHead(204).end();

        const url = req.url ?? "";
        if (!url.startsWith(`/pp/${this.token}/`)) return res.writeHead(403).end();

        if (req.method === "POST" && url.endsWith("/event")) {
          let raw = "";
          req.on("data", (c) => (raw += c));
          req.on("end", () => {
            try {
              const e = JSON.parse(raw) as ViewEvent;
              this.handle(e);
            } catch {}
            res.writeHead(204).end();
          });
          return;
        }
        res.writeHead(404).end();
      });
      this.server.on("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.port = (this.server!.address() as { port: number }).port;
        resolve({ port: this.port, token: this.token });
      });
    });
  }

  private handle(e: ViewEvent) {
    // one impression per (kind, session, adId); clicks are never deduped
    if (e.kind !== "click") {
      const key = `${e.kind}:${e.session}:${e.adId}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    this.onEvent(e);
  }

  base(): string {
    return `http://127.0.0.1:${this.port}/pp/${this.token}`;
  }

  stop() {
    this.server?.close();
    this.server = null;
  }
}
