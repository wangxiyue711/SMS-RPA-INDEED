// src/app/api/sms/send/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { runPython } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userUid, phone, message } = await req.json();
    if (!userUid || !phone || !message) {
      return NextResponse.json(
        { success: false, error: "User UID, phone number, and message are required" },
        { status: 400 }
      );
    }

    const hasEnv =
      !!process.env.SMS_API_URL && !!process.env.SMS_API_ID && !!process.env.SMS_API_PASSWORD;

    const relScript = hasEnv ? "rpa/send_temp_sms.py" : "rpa/send_personal_sms.py";
    const fullScript = path.join(process.cwd(), relScript);
    if (!fs.existsSync(fullScript)) {
      return NextResponse.json(
        { success: false, error: `SMS script not found: ${relScript}` },
        { status: 500 }
      );
    }

    const input = hasEnv
      ? JSON.stringify({
          userUid,
          phone,
          message,
          smsConfig: {
            api_url: process.env.SMS_API_URL,
            api_id: process.env.SMS_API_ID,
            api_password: process.env.SMS_API_PASSWORD,
          },
        })
      : JSON.stringify({ userUid, phone, message });

    const { code, stdout, stderr } = await runPython(relScript, { inputLine: input });

    const okMarker =
      code === 0 || /SCRIPT_EXIT_SUCCESS|SUCCESS:/i.test(stdout);

    if (okMarker) {
      return NextResponse.json({ success: true, message: "SMS sent successfully", output: stdout.trim() });
    } else {
      const details = (stderr || stdout || "").trim();
      return NextResponse.json(
        { success: false, error: "SMS sending failed", details },
        { status: 500 }
      );
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
