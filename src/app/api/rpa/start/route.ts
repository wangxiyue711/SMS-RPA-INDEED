// src/app/api/rpa/start/route.ts
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { rpaProcesses } from "@/lib/rpaState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userUid, mode = "1", interval = 5 } = await req.json();

    if (!userUid) {
      return NextResponse.json({ success: false, error: "User UID is required" }, { status: 400 });
    }
    if (rpaProcesses.has(userUid)) {
      return NextResponse.json({ success: false, error: "RPA process already running for this user" }, { status: 400 });
    }

    const scriptPath = path.join(process.cwd(), "rpa", "send_sms_firebase.py");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ success: false, error: "RPA script not found" }, { status: 500 });
    }

    const py = spawn("python", [scriptPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    // 按你原来的交互：UID -> mode -> interval(可选)
    py.stdin.write(`${userUid}\n`);
    py.stdin.write(`${mode}\n`);
    if (String(mode) === "2") py.stdin.write(`${interval}\n`);

    const info = {
      process: py,
      startTime: new Date().toISOString(),
      mode: String(mode),
      logs: [],
    };
    rpaProcesses.set(userUid, info);

    py.stdout.on("data", (buf) => {
      const msg = buf.toString();
      console.log(`[RPA-${userUid}] STDOUT:`, msg.trim());
      const i = rpaProcesses.get(userUid);
      if (i) {
        i.logs.push({ type: "stdout", message: msg, timestamp: new Date().toISOString() });
        if (i.logs.length > 100) i.logs.splice(0, i.logs.length - 100);
      }
    });

    py.stderr.on("data", (buf) => {
      const msg = buf.toString();
      console.error(`[RPA-${userUid}] STDERR:`, msg.trim());
      const i = rpaProcesses.get(userUid);
      if (i) i.logs.push({ type: "stderr", message: msg, timestamp: new Date().toISOString() });
    });

    py.on("close", (code) => {
      console.log(`[RPA-${userUid}] exit code: ${code}`);
      const i = rpaProcesses.get(userUid);
      if (i) {
        i.exitCode = code;
        i.endTime = new Date().toISOString();
        i.status = "completed";
        // 可保留 30 分钟用于查日志，也可以直接删除
        setTimeout(() => rpaProcesses.delete(userUid), 30 * 60 * 1000);
      }
    });

    py.on("error", (e) => {
      console.error(`[RPA-${userUid}] spawn error:`, e);
      const i = rpaProcesses.get(userUid);
      if (i) {
        i.error = e.message;
        i.status = "error";
      }
    });

    return NextResponse.json({
      success: true,
      message: "RPA process started successfully",
      processId: userUid,
      mode: String(mode),
      startTime: info.startTime,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
