// src/lib/python.ts
import { spawn } from "child_process";
import path from "path";

export function runPython(
  relScriptPath: string,
  opts?: { inputLine?: string }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), relScriptPath);

    // Windows 通常是 "python"，macOS/Linux 常用 "python3"
    // 这里简单做个回退：先试 python3，不行再用 python
    const cmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(cmd, [scriptPath], {
      env: process.env,
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => resolve({ code, stdout, stderr }));

    if (opts?.inputLine) {
      // 我们的约定：写入一行 JSON，python 脚本用 sys.stdin.readline() 读取
      proc.stdin.write(opts.inputLine + "\n");
    }
    proc.stdin.end();
  });
}
