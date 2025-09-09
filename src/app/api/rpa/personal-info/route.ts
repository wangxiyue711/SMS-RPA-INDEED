// /src/app/api/rpa/personal-info/route.ts
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { adminDb } from "../../../../lib/firebaseAdmin";

// 关键：声明 Node 运行时，避免 Edge 环境不允许 child_process/fs
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// export const maxDuration = 900; // 可选，长任务

export async function POST(req: Request): Promise<Response> {
  // 关键：使用 Web 标准 Request，而不是 NextRequest
  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }

  const userUid = body.userUid || body.config?.user_id;

  // 从 Firestore 读取用户配置（server-side），优先使用 userUid
  let cfg: any = body.config || {};
  if (userUid) {
    try {
      const snap = await adminDb.collection("user_configs").doc(String(userUid)).get();
      if (snap.exists) cfg = { ...(snap.data() || {}), ...(cfg || {}) };
    } catch (_) {
      // 忽略，继续使用传入 cfg
    }
  }

  const scriptPath = path.resolve(process.cwd(), "rpa_gmail_indeed_test.py");
  const pythonCmd = process.env.RPA_PYTHON_CMD || "python";

  // 将 cfg 写到临时文件，并以 --cfg-file=path 传入
  const cfgFile = path.join(
    os.tmpdir(),
    `rpa_cfg_${Date.now()}_${Math.floor(Math.random() * 10000)}.json`
  );
  try {
    fs.writeFileSync(cfgFile, JSON.stringify({ config: cfg }), { encoding: "utf8" });
  } catch (_) {
    // ignore
  }

  // monitor 模式：后台 detached，立即返回 Response
  if (cfg && cfg.monitor) {
    try {
      const child = spawn(pythonCmd, [scriptPath, `--cfg-file=${cfgFile}`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return NextResponse.json({ success: true, message: "monitor_started" });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
  }

  // 前台执行，收集输出
  const py = spawn(pythonCmd, [scriptPath, `--cfg-file=${cfgFile}`]);

  const promise: Promise<Response> = new Promise((resolve) => {
    let output = "";
    let error = "";

    py.stdout.on("data", (data) => {
      output += data.toString();
    });

    py.stderr.on("data", (data) => {
      error += data.toString();
    });

    py.on("close", (code) => {
      try {
        if (fs.existsSync(cfgFile)) fs.unlinkSync(cfgFile);
      } catch (_) {}

      if (code === 0) {
        // 尝试将 Python 标准输出解析为 JSON
        try {
          const parsed = JSON.parse(output);
          resolve(NextResponse.json({ success: true, data: parsed }));
        } catch (_) {
          resolve(NextResponse.json({ success: true, data: output }));
        }
      } else {
        resolve(
          NextResponse.json(
            { success: false, error: error || "Python脚本执行失败" },
            { status: 500 }
          )
        );
      }
    });

    // 超时保护（例如 selenium 场景）
    const timeoutMs = 300000; // 5 分钟
    const timer = setTimeout(() => {
      try {
        py.kill();
      } catch (_) {}
      try {
        if (fs.existsSync(cfgFile)) fs.unlinkSync(cfgFile);
      } catch (_) {}
      resolve(NextResponse.json({ success: false, error: "脚本执行超时" }, { status: 500 }));
    }, timeoutMs);

    py.on("exit", () => clearTimeout(timer));
  });

  return promise; // 明确返回 Promise<Response>
}
