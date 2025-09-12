import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "jobId required" }, { status: 400 });
    }

    const doc = await adminDb.collection("rpa_jobs").doc(jobId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const data = doc.data();
    return NextResponse.json({
      status: data?.status || "unknown",
      needs_setup_reason: data?.needs_setup_reason,
      suggested_user_doc_id: data?.suggested_user_doc_id,
      suggested_user_uid: data?.suggested_user_uid,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
