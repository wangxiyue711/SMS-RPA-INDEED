import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userUid = body.userUid;
    const results = Array.isArray(body.results) ? body.results : [];
    if (!userUid) {
      return NextResponse.json({ success: false, error: "missing userUid" }, { status: 400 });
    }

    const now = Date.now();
    const saved: any[] = [];
    for (const r of results) {
      const docId = String(now) + "-" + Math.random().toString(36).slice(2, 9);
      const payload = {
        createdAt: now,
        name: r.name || r["姓名（ふりがな）"] || "",
        phone: r.phone || r["電話番号"] || "",
        gender: r.gender || r["性別"] || "",
        birth: r.birth || r["生年月日"] || "",
        age: r.age || r["__標準_年齢__"] || "",
        is_sms_target: typeof r.should_send_sms !== "undefined" ? !!r.should_send_sms : null,
        level: r.level || "success",
        raw: r,
        decision_debug: r.decision_debug || null,
      };
      try {
        await adminDb
          .collection("rpa_history")
          .doc(String(userUid))
          .collection("entries")
          .doc(docId)
          .set(payload);
        saved.push(payload);
      } catch (e) {
        // ignore per-entry write failures
      }
    }

    return NextResponse.json({ success: true, savedCount: saved.length, saved });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
