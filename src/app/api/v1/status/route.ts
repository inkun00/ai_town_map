import { NextResponse } from "next/server";
import { missingConfig } from "@/server/env";

export function GET() {
  return NextResponse.json({ data: { configured: missingConfig().length === 0 }, meta: { mode: "stage3" } }, { headers: { "Cache-Control": "no-store" } });
}
