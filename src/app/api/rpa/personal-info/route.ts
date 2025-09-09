import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { adminDb } from "../../../../lib/firebaseAdmin";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userUid = body.userUid || body.config?.user_id;
  // 从 Firestore 读取用户配置（server-side），优先使用 userUid
  let cfg: any = body.config || {};
  if (userUid) {
    try {
      const snap = await adminDb
        .collection("user_configs")
        .doc(String(userUid))
        .get();
      if (snap.exists) cfg = { ...(snap.data() || {}), ...(cfg || {}) };
    } catch (e) {
      // ignore and continue with provided cfg
    }
  }

  return new Promise((resolve) => {
    const scriptPath = path.resolve(process.cwd(), "rpa_gmail_indeed_test.py");
    const pythonCmd = process.env.RPA_PYTHON_CMD || "python";

    // 将 cfg 写到临时文件，并以 --cfg-file=path 传入
    const cfgFile = path.join(
      os.tmpdir(),
      `rpa_cfg_${Date.now()}_${Math.floor(Math.random() * 10000)}.json`
    );
    try {
      fs.writeFileSync(cfgFile, JSON.stringify({ config: cfg }), {
        encoding: "utf8",
      });
    } catch (e) {
      // ignore
    }

    // 如果 cfg 指定 monitor=true，则以 detached 后台进程启动并立即返回
    if (cfg && cfg.monitor) {
      try {
        const child = spawn(pythonCmd, [scriptPath, `--cfg-file=${cfgFile}`], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
        return resolve(
          NextResponse.json({ success: true, message: "monitor_started" })
        );
      } catch (e) {
        return resolve(
          NextResponse.json(
            { success: false, error: String(e) },
            { status: 500 }
          )
        );
      }
    }

    const py = spawn(pythonCmd, [scriptPath, `--cfg-file=${cfgFile}`]);

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
        // foreground run 完成后尝试删除临时 cfg 文件
        if (fs.existsSync(cfgFile)) fs.unlinkSync(cfgFile);
      } catch (e) {}
      if (code === 0) {
        // 尝试解析 python 输出为 JSON
        try {
          const parsed = JSON.parse(output);
          resolve(NextResponse.json({ success: true, data: parsed }));
        } catch (e) {
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

    // 延长超时以支持网页抓取（例如 selenium 可能需要更久）
    const timeout = 300000; // 5 分钟
    const t = setTimeout(() => {
      try {
        py.kill();
      } catch (e) {}
      try {
        if (fs.existsSync(cfgFile)) fs.unlinkSync(cfgFile);
      } catch (e) {}
      resolve(
        NextResponse.json(
          { success: false, error: "脚本执行超时" },
          { status: 500 }
        )
      );
    }, timeout);

    py.on("exit", () => clearTimeout(t));
  });
}
