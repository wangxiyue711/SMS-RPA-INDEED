// src/app/api/rpa/stop/route.ts
import { NextResponse } from "next/server";
import { rpaProcesses } from "@/lib/rpaState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userUid } = await req.json();
    if (!userUid) {
      return NextResponse.json({ success: false, error: "User UID is required" }, { status: 400 });
    }

    const info = rpaProcesses.get(userUid);
    if (!info) {
      return NextResponse.json({ success: false, error: "No RPA process found for this user" }, { status: 404 });
    }

    info.process.kill("SIGTERM");
    info.status = "stopped";
    info.endTime = new Date().toISOString();

    return NextResponse.json({ success: true, message: "RPA process stopped successfully" });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
