// src/app/api/rpa/status/[userUid]/route.ts
import { NextResponse } from "next/server";
import { rpaProcesses } from "@/lib/rpaState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ userUid: string }> }
) {
  const { userUid } = await context.params;
  const info = rpaProcesses.get(userUid);
  if (!info) {
    return NextResponse.json({
      success: true,
      status: "not_running",
      message: "No RPA process found",
    });
  }
  return NextResponse.json({
    success: true,
    status: info.status || "running",
    processId: userUid,
    mode: info.mode,
    startTime: info.startTime,
    endTime: info.endTime,
    exitCode: info.exitCode,
    error: info.error,
    logCount: info.logs.length,
  });
}
