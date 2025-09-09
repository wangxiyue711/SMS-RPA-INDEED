// src/app/main/history/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { getApps, initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
// firebase/firestore client imports removed: history page now uses server API (/api/rpa/history)

/** 统一的数据项 */
type UnifiedItem = {
  id: string;
  timeEpoch: number;
  timeText: string; // 展示用
  kind: "sms" | "rpa"; // 個別送信 / RPA
  level: "success" | "failed" | "error" | "info";
  title: string; // 列表主文案
  detail?: string; // 次要说明
};

type RpaLog = {
  timestamp: number | string;
  type: "stdout" | "stderr";
  message: string;
};
type ServerSms = {
  createdAt?: any; // Firestore Timestamp | epoch | ISO
  created_at?: any;
  time?: any;
  phone?: string;
  messageExcerpt?: string;
  code?: string;
  level?: "success" | "failed" | "error";
  detail?: string;
  provider?: string;
};

export default function UnifiedHistoryPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [items, setItems] = useState<UnifiedItem[]>([]);
  const [rpaDocs, setRpaDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 筛选：すべて / 個別送信 / RPA
  const [filter, setFilter] = useState<"all" | "sms" | "rpa">("all");
  const [q, setQ] = useState("");
  const [rpaLimit, setRpaLimit] = useState(500); // RPA日志获取条数

  const brand = "#6f8333";

  // ---------- 工具：时间解析/格式化 ----------
  function toEpoch(v: any): number {
    if (typeof v === "number") return v;
    if (v && typeof v === "object") {
      // Firestore Timestamp
      if (typeof v.seconds === "number")
        return (
          v.seconds * 1000 +
          (v.nanoseconds ? Math.floor(v.nanoseconds / 1e6) : 0)
        );
      // Date
      if (v instanceof Date) return v.getTime();
    }
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
    return Date.now();
  }
  function fmtJa(ts: number) {
    return new Date(ts).toLocaleString("ja-JP");
  }

  // ---------- 拉取数据并合并 ----------
  const refresh = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setErr(null);
    try {
      const unified: UnifiedItem[] = [];

      // 1) 個別送信（ローカル）
      try {
        const local = JSON.parse(localStorage.getItem("smsHistory") || "[]");
        if (Array.isArray(local)) {
          for (const it of local) {
            const ts = toEpoch(it.timestamp ?? it.time ?? Date.now());
            const title = `📱 ${it.phone || "-"} — ${String(
              it.message || ""
            ).trim()}`;
            const level =
              it.status === "success"
                ? "success"
                : it.status === "failed"
                ? "failed"
                : it.status === "error"
                ? "error"
                : "info";
            unified.push({
              id: `sms-local-${ts}-${it.phone || ""}-${Math.random()
                .toString(36)
                .slice(2, 7)}`,
              timeEpoch: ts,
              timeText: fmtJa(ts),
              kind: "sms",
              level,
              title,
              detail: it.statusInfo || undefined,
            });
          }
        }
      } catch {}

      // 2) 個別送信（サーバー・存在すれば）
      try {
        const resp = await fetch(`/api/history/sms?limit=1000`);
        if (resp.ok) {
          const data = await resp.json();
          const rows: ServerSms[] = Array.isArray(data?.items)
            ? data.items
            : [];
          for (const r of rows) {
            const ts = toEpoch(r.createdAt ?? r.created_at ?? r.time);
            const phone = r.phone ? String(r.phone) : "-";
            const title = `📱 ${phone} — ${r.messageExcerpt ?? ""}`;
            unified.push({
              id: `sms-server-${ts}-${phone}-${Math.random()
                .toString(36)
                .slice(2, 7)}`,
              timeEpoch: ts,
              timeText: fmtJa(ts),
              kind: "sms",
              level: r.level || "info",
              title,
              detail: r.detail || (r.code ? `コード ${r.code}` : undefined),
            });
          }
        }
      } catch {
        // 接口不存在就跳过
      }

      // 3) RPA（サーバー）
      try {
        // 从服务端拉取 rpa_history 条目，避免客户端 Firestore 权限问题
        const resp = await fetch(
          `/api/rpa/history?userUid=${uid}&limit=${rpaLimit}`
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data?.success) {
            const docs: any[] = Array.isArray(data.items) ? data.items : [];
            setRpaDocs(docs);
            for (const d of docs) {
              const ts = toEpoch(d.createdAt ?? Date.now());
              const title = `🧰 ${d.name || "-"} — ${d.phone || "-"}`;
              unified.push({
                id: `rpa-${ts}-${Math.random().toString(36).slice(2, 7)}`,
                timeEpoch: ts,
                timeText: fmtJa(ts),
                kind: "rpa",
                level: d.level || "info",
                title,
                detail: `${d.name || ""} ${d.phone || ""}`.trim() || undefined,
              });
            }
          } else {
            throw new Error(data?.error || "rpa history fetch failed");
          }
        } else {
          throw new Error("rpa history http error");
        }
      } catch (e: any) {
        // 回退到旧的 logs 接口
        try {
          const resp = await fetch(`/api/rpa/logs/${uid}?limit=${rpaLimit}`);
          const data = await resp.json();
          if (data?.success) {
            const logs: RpaLog[] = data.logs || [];
            for (const l of logs) {
              const ts = toEpoch(l.timestamp);
              unified.push({
                id: `rpa-${ts}-${Math.random().toString(36).slice(2, 7)}`,
                timeEpoch: ts,
                timeText: fmtJa(ts),
                kind: "rpa",
                level: l.type === "stderr" ? "error" : "info",
                title: l.type === "stderr" ? `🧰 RPA [ERROR]` : `🧰 RPA`,
                detail: l.message,
              });
            }
          }
        } catch {
          setErr(e?.message || String(e));
        }
      }

      // 4) 按时间倒序
      unified.sort((a, b) => b.timeEpoch - a.timeEpoch);
      setItems(unified);
    } finally {
      setLoading(false);
    }
  }, [uid, rpaLimit]);

  // ---------- 初始化：Firebase + 用户 ----------
  useEffect(() => {
    if (getApps().length === 0) {
      initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId:
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      });
    }
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        (window as any).currentUser = user;
        setUid(user.uid);
      }
    });
    return () => unsub();
  }, []);

  // uid/rpaLimit 变化重新拉
  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---------- 过滤与搜索 ----------
  const view = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((it) => {
      const matchKind = filter === "all" ? true : it.kind === filter;
      const matchQ =
        !qq ||
        it.title.toLowerCase().includes(qq) ||
        (it.detail || "").toLowerCase().includes(qq) ||
        it.timeText.toLowerCase().includes(qq);
      return matchKind && matchQ;
    });
  }, [items, filter, q]);

  // ---------- 导出 ----------
  function exportCSV() {
    const rows = [
      ["time(ja)", "kind", "level", "title", "detail"],
      ...view.map((x) => [
        x.timeText,
        x.kind,
        x.level,
        x.title,
        (x.detail || "").replace(/\r?\n/g, " "),
      ]),
    ];
    const csv = rows
      .map((r) =>
        r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="panel-header" style={{ marginBottom: 16 }}>
        <h2 className="panel-title" style={{ color: brand, margin: 0 }}>
          📜 実行履歴
        </h2>
        <p
          className="panel-description"
          style={{ color: "#666", margin: "6px 0 0" }}
        >
          個別送信と RPA の履歴をまとめて表示（新しい順）。
        </p>
      </div>

      {/* 工具条 */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "2px solid #e8eae0",
            background: "#fff",
          }}
          title="種類でフィルター"
        >
          <option value="all">すべて</option>
          <option value="sms">個別送信</option>
          <option value="rpa">RPA</option>
        </select>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="キーワード検索（電話番号 / 本文 / メッセージ / 時刻）"
          style={{
            flex: "1 1 260px",
            padding: 10,
            borderRadius: 8,
            border: "2px solid #e8eae0",
            background: "#fafbf7",
            color: "#43503a",
          }}
        />

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <select
            value={rpaLimit}
            onChange={(e) => setRpaLimit(Number(e.target.value))}
            onBlur={refresh}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "2px solid #e8eae0",
              background: "#fff",
            }}
            title="RPA 取得件数"
          >
            {[200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                RPA {n}件
              </option>
            ))}
          </select>
          <button
            onClick={refresh}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e6e8d9",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            🔄 取得
          </button>
          <button
            onClick={exportCSV}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e6e8d9",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e6e8d9",
          borderRadius: 12,
          padding: 12,
        }}
      >
        {err && (
          <div style={{ color: "#d32f2f", marginBottom: 8 }}>❌ {err}</div>
        )}
        {loading ? (
          <p style={{ color: "#666" }}>読み込み中...</p>
        ) : view.length === 0 ? (
          <p style={{ color: "#777", textAlign: "center", margin: "12px 0" }}>
            履歴がありません
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {filter === "rpa" ? (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr style={{ background: "#f6f7f2" }}>
                    {[
                      "時刻",
                      "姓名（ふりがな）",
                      "電話番号",
                      "性別",
                      "生年月日",
                      "年齢",
                      "SMS対象",
                      "SMS送信",
                      "詳細",
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: 10,
                          borderBottom: "1px solid #e6e8d9",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rpaDocs.map((d) => {
                    const ts = toEpoch(d.createdAt ?? Date.now());
                    return (
                      <tr
                        key={d.id}
                        style={{ borderBottom: "1px solid #f0f0f0" }}
                      >
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          {fmtJa(ts)}
                        </td>
                        <td style={{ padding: 10 }}>{d.name || "-"}</td>
                        <td style={{ padding: 10 }}>{d.phone || "-"}</td>
                        <td style={{ padding: 10 }}>{d.gender || "-"}</td>
                        <td style={{ padding: 10 }}>{d.birth || "-"}</td>
                        <td style={{ padding: 10 }}>{d.age || "-"}</td>
                        <td style={{ padding: 10 }}>
                          {d.is_sms_target ? "Yes" : "No"}
                        </td>
                        <td style={{ padding: 10 }}>
                          {typeof d.sms_sent !== "undefined"
                            ? d.sms_sent
                              ? "送信済"
                              : "送信失敗"
                            : "-"}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            color: "#555",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          <div>
                            {d.raw ? JSON.stringify(d.raw).slice(0, 200) : "-"}
                          </div>
                          {d.sms_response ? (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 12,
                                color: "#444",
                              }}
                            >
                              <strong>SMS:</strong>{" "}
                              {d.sms_sent ? "成功" : "失敗"} -{" "}
                              {String(
                                d.sms_response.output ||
                                  d.sms_response.error ||
                                  ""
                              ).slice(0, 200)}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr style={{ background: "#f6f7f2" }}>
                    {["時刻", "種類", "状態", "概要", "詳細"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: 10,
                          borderBottom: "1px solid #e6e8d9",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.map((x) => {
                    const color =
                      x.level === "success"
                        ? "#388e3c"
                        : x.level === "failed"
                        ? "#d32f2f"
                        : x.level === "error"
                        ? "#ff9800"
                        : "#666";
                    const kindText = x.kind === "sms" ? "個別送信" : "RPA";
                    return (
                      <tr
                        key={x.id}
                        style={{ borderBottom: "1px solid #f0f0f0" }}
                      >
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          {x.timeText}
                        </td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          {kindText}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            whiteSpace: "nowrap",
                            color,
                            fontWeight: 700,
                          }}
                        >
                          {x.level.toUpperCase()}
                        </td>
                        <td style={{ padding: 10, minWidth: 240 }}>
                          {x.title}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            color: "#555",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {x.detail || "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 响应式微调 */}
      <style jsx>{`
        @media (max-width: 960px) {
          table {
            font-size: 13px;
          }
          td,
          th {
            padding: 8px !important;
          }
        }
      `}</style>
    </>
  );
}
