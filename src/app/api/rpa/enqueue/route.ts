import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebaseAdmin";

// POST /api/rpa/enqueue
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const authHeader = req.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.split("Bearer ")[1]
      : null;
    if (!idToken)
      return NextResponse.json(
        { success: false, error: "no token" },
        { status: 401 }
      );

    // verify token
    let decoded: any;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch (e) {
      return NextResponse.json(
        { success: false, error: "invalid token" },
        { status: 401 }
      );
    }

    if (decoded.uid !== body.userUid) {
      return NextResponse.json(
        { success: false, error: "uid mismatch" },
        { status: 403 }
      );
    }

    const jobRef = adminDb.collection("rpa_jobs").doc();
    const job = {
      userUid: body.userUid,
      cfg: body.cfg || null,
      status: "queued",
      created_at: new Date().toISOString(),
    };
    await jobRef.set(job);
    return NextResponse.json({ success: true, jobId: jobRef.id });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message || String(e) },
      { status: 500 }
    );
  }
}
