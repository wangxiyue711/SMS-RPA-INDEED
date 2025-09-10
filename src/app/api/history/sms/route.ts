import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userUid = url.searchParams.get("userUid");
    const limit = Number(url.searchParams.get("limit") || "500");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!userUid)
      return NextResponse.json({ success: false, error: "missing userUid" }, { status: 400 });

    const colRef = adminDb.collection("sms_history").doc(String(userUid)).collection("entries");
    let q: any = colRef.orderBy("createdAt", "desc").limit(limit);

    // 可选的时间过滤（支持 ISO 或 epoch）
    if (from || to) {
      try {
        const fromTs = from ? Date.parse(String(from)) : null;
        const toTs = to ? Date.parse(String(to)) : null;
        if (fromTs) q = q.where("createdAt", ">=", fromTs);
        if (toTs) q = q.where("createdAt", "<=", toTs);
      } catch {}
    }

    const snap = await q.get();
    const items: any[] = [];
    snap.forEach((d: any) => items.push({ id: d.id, ...d.data() }));
    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userUid = body.userUid;
    const rows = Array.isArray(body.rows) ? body.rows : body.row ? [body.row] : [];
    if (!userUid) return NextResponse.json({ success: false, error: "missing userUid" }, { status: 400 });
    if (!rows.length) return NextResponse.json({ success: false, error: "no rows provided" }, { status: 400 });

    const colRef = adminDb.collection("sms_history").doc(String(userUid)).collection("entries");
    const saved: any[] = [];
    for (const r of rows) {
      const id = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
      const payload = {
        createdAt: r.createdAt ?? Date.now(),
        phone: r.phone ?? r.to ?? r.mobile ?? "",
        messageExcerpt: (r.message || r.messageExcerpt || "").slice(0, 4000),
        code: r.code || r.status || null,
        level: r.level || "info",
        detail: r.detail || r.error || null,
        provider: r.provider || null,
        raw: r,
      };
      try {
        await colRef.doc(id).set(payload);
        saved.push({ id, ...payload });
      } catch (e) {
        // ignore per-row
      }
    }
    return NextResponse.json({ success: true, savedCount: saved.length, items: saved });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
