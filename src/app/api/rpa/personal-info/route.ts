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
  try {
    // 关键：使用 Web 标准 Request，而不是 NextRequest
    // 先解析 body 并尽量在服务端合并用户配置（便于 enqueue）
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
        const snap = await adminDb
          .collection("user_configs")
          .doc(String(userUid))
          .get();
        if (snap.exists) cfg = { ...(snap.data() || {}), ...(cfg || {}) };
      } catch (_) {
        // 忽略，继续使用传入 cfg
      }
    }

    // If deployed on Vercel, spawn/child_process is not supported. Enqueue a job
    // document into Firestore so a separate Python worker can pick it up.
    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    if (isVercel) {
      try {
        // Check if user already has a pending job (queued, running, needs_setup)
        let existingJob = null;
        if (userUid) {
          try {
            const existingQuery = await adminDb
              .collection("rpa_jobs")
              .where("userUid", "==", String(userUid))
              .where("status", "in", ["queued", "running", "needs_setup"])
              .limit(1)
              .get();

            if (!existingQuery.empty) {
              existingJob = existingQuery.docs[0];
              // Update the existing job's timestamp to show it's been re-requested
              await existingJob.ref.update({
                requested_at: new Date().toISOString(),
                request_count: (existingJob.data().request_count || 0) + 1,
              });

              return NextResponse.json({
                success: true,
                queued: true,
                jobId: existingJob.id,
                reused: true,
                status: existingJob.data().status,
              });
            }
          } catch (e) {
            // ignore query errors, proceed to create new job
          }
        }

        // Try to resolve the actual user_configs document id so worker can read
        // full user config directly (this avoids mismatches between auth uid and doc id).
        let resolvedDocId: string | null = null;
        try {
          if (userUid) {
            const byId = await adminDb
              .collection("user_configs")
              .doc(String(userUid))
              .get();
            if (byId.exists) {
              resolvedDocId = byId.id;
            } else {
              const fields = ["authUid", "uid", "email", "userUid"];
              for (const f of fields) {
                try {
                  const q = await adminDb
                    .collection("user_configs")
                    .where(f, "==", String(userUid))
                    .limit(1)
                    .get();
                  if (!q.empty) {
                    resolvedDocId = q.docs[0].id;
                    // merge server-side cfg if none provided
                    if (!cfg)
                      cfg = { ...(q.docs[0].data() || {}), ...(cfg || {}) };
                    break;
                  }
                } catch (e) {
                  // ignore single-field query failures
                }
              }
            }
          }
        } catch (e) {
          // ignore resolution errors; worker will attempt its own resolution
        }

        // Force monitor mode for "personal info" action: run continuously.
        try {
          if (!cfg || typeof cfg !== "object") cfg = {};
          cfg.monitor = true;
          // poll interval in seconds
          cfg.poll_interval = 5;
        } catch (e) {
          // ignore
        }

        const job = {
          status: "queued",
          userUid: userUid || null,
          userDocId: resolvedDocId,
          cfg: cfg || {},
          created_at: new Date().toISOString(),
          requested_at: new Date().toISOString(),
          request_count: 1,
        };
        const docRef = await adminDb.collection("rpa_jobs").add(job);
        return NextResponse.json({
          success: true,
          queued: true,
          jobId: docRef.id,
          reused: false,
        });
      } catch (e: any) {
        return NextResponse.json(
          { success: false, error: String(e) },
          { status: 500 }
        );
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
      fs.writeFileSync(cfgFile, JSON.stringify({ config: cfg }), {
        encoding: "utf8",
      });
    } catch (_) {
      // ignore write failures; spawn may still run with passed config
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
        return NextResponse.json(
          { success: false, error: String(e) },
          { status: 500 }
        );
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
        resolve(
          NextResponse.json(
            { success: false, error: "脚本执行超时" },
            { status: 500 }
          )
        );
      }, timeoutMs);

      py.on("exit", () => clearTimeout(timer));
    });

    return promise; // 明确返回 Promise<Response>
  } catch (e: any) {
    // 捕获所有未处理异常并返回 JSON，以便前端能解析
    return NextResponse.json(
      { success: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
