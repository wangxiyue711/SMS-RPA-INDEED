// src/app/api/rpa/logs/[userUid]/route.ts
import { NextResponse } from "next/server";
import { rpaProcesses } from "@/lib/rpaState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ userUid: string }> }
) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 50);

  const { userUid } = await context.params;
  const info = rpaProcesses.get(userUid);
  if (!info) {
    return NextResponse.json({
      success: true,
      logs: [],
      message: "No RPA process found",
    });
  }
  const logs = info.logs.slice(-limit);
  return NextResponse.json({
    success: true,
    logs,
    totalLogs: info.logs.length,
  });
}
