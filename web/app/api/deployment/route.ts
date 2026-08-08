import { NextResponse } from "next/server";
import { loadDeployment, serverBase } from "../../../lib/deployment";

// Runtime config for the client: contract addresses + the ad-server base URL.
// serverBase is read per-request so changing the Netlify SERVER_BASE env var
// (e.g. a new tunnel URL) takes effect without a redeploy.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ...loadDeployment(), serverBase: serverBase() });
}
