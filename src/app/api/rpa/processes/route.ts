// src/app/api/rpa/processes/route.ts
import { NextResponse } from "next/server";
import { rpaProcesses } from "@/lib/rpaState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const processes = Array.from(rpaProcesses.entries()).map(([userUid, i]) => ({
    userUid,
    status: i.status || "running",
    mode: i.mode,
    startTime: i.startTime,
    endTime: i.endTime,
    logCount: i.logs.length,
  }));
  return NextResponse.json({ success: true, processes, totalCount: processes.length });
}
