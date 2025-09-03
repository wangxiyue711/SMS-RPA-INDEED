// src/lib/python.ts
import { spawn } from "child_process";
import path from "path";

export function runPython(
  scriptRelPath: string,
  opts?: { inputLine?: string; env?: NodeJS.ProcessEnv }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), scriptRelPath);
    const child = spawn("python", [scriptPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        LANG: "en_US.UTF-8",
        ...(opts?.env || {}),
      },
    });

    if (opts?.inputLine) {
      child.stdin.write(opts.inputLine + "\n");
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));

    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
