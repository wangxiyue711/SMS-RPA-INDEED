// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { rpaProcesses } from "@/lib/rpaState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "RPA Server via Next API is running",
    timestamp: new Date().toISOString(),
    activeProcesses: rpaProcesses.size,
  });
}
