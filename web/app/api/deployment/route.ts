import { NextResponse } from "next/server";
import { loadDeployment } from "../../../lib/deployment";

export function GET() {
  return NextResponse.json(loadDeployment());
}
