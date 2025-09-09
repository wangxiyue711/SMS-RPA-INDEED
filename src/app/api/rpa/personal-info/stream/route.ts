import { NextRequest } from "next/server";
import path from "path";
import { spawn } from "child_process";
import { adminDb } from "../../../../../lib/firebaseAdmin";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const userUid = url.searchParams.get("userUid");

  // Read user config from Firestore if userUid provided
  let cfg: any = {};
  if (userUid) {
    try {
      const snap = await adminDb
        .collection("user_configs")
        .doc(String(userUid))
        .get();
      if (snap.exists) cfg = snap.data() || {};
    } catch (e) {
      // ignore
    }
  }

  const scriptPath = path.resolve(process.cwd(), "rpa_gmail_indeed_test.py");

  const stream = new ReadableStream({
    start(controller) {
      // spawn python
      const py = spawn("C:/Python313/python.exe", [scriptPath]);

      // send cfg to stdin
      try {
        py.stdin.write(JSON.stringify({ config: cfg }));
        py.stdin.end();
      } catch (e) {}

      const push = (type: string, chunk: string) => {
        const payload = `event: ${type}\ndata: ${chunk.replace(
          /\n/g,
          "\\n"
        )}\n\n`;
        controller.enqueue(new TextEncoder().encode(payload));
      };

      py.stdout.on("data", (d) => push("stdout", String(d)));
      py.stderr.on("data", (d) => push("stderr", String(d)));

      py.on("close", (code) => {
        push("close", String(code));
        controller.close();
      });

      // if client cancels, kill child
      (req as any).signal.addEventListener("abort", () => {
        try {
          py.kill();
        } catch (e) {}
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
