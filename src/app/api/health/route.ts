// src/app/api/health/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "OK",
    timestamp: new Date().toISOString(),
  });
}
