// src/app/main/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";

// ------- 小工具：时间/格式 -------
function toISO(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function parseEpoch(v: any): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    if (typeof v.seconds === "number") return v.seconds * 1000 + (v.nanoseconds ? Math.floor(v.nanoseconds / 1e6) : 0);
    if (v instanceof Date) return v.getTime();
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}

// ------- 类型 -------
type SmsRow = {
  createdAt?: any;  // Firestore Timestamp | epoch | ISO
  created_at?: any;
  time?: any;
  phone?: string;
  messageExcerpt?: string;
  code?: string;
  level?: "success" | "failed" | "error";
  detail?: string;
  provider?: string;
};
type DataPoint = { date: string; total: number; success: number; failed: number };

// ------- 组件 -------
export default function TopDashboard() {
  // 默认日期：最近 60 天
  const today = useMemo(() => new Date(), []);
  const sixtyAgo = useMemo(() => {
    const t = new Date(); t.setDate(t.getDate() - 60); return t;
  }, []);

  const [from, setFrom] = useState<string>(toISO(sixtyAgo));
  const [to, setTo] = useState<string>(toISO(today));
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DataPoint[]>([]);
  const [sumTotal, setSumTotal] = useState(0);
  const [sumSuccess, setSumSuccess] = useState(0);
  const [sumFailed, setSumFailed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const brand = "#6f8333";

  // 拉数据 + 聚合
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 生成日期桶
      const start = new Date(from);
      const end = new Date(to);
      if (start > end) {
        setError("日付の範囲が正しくありません（開始 ＞ 終了）");
        setItems([]); setSumTotal(0); setSumSuccess(0); setSumFailed(0);
        setLoading(false);
        return;
      }
      const buckets = new Map<string, DataPoint>();
      const day = new Date(start);
      while (day <= end) {
        const key = toISO(day);
        buckets.set(key, { date: key, total: 0, success: 0, failed: 0 });
        day.setDate(day.getDate() + 1);
      }

      // 1) 优先使用服务器履历
      let usedServer = false;
      try {
        const resp = await fetch(`/api/history/sms?from=${from}&to=${to}&limit=5000`);
        if (resp.ok) {
          const js = await resp.json();
          const list: SmsRow[] = Array.isArray(js?.items) ? js.items : [];
          for (const r of list) {
            const ts = parseEpoch(r.createdAt ?? r.created_at ?? r.time);
            const k = toISO(new Date(ts));
            const dp = buckets.get(k);
            if (!dp) continue;
            dp.total += 1;
            if (r.level === "success") dp.success += 1;
            else if (r.level === "failed" || r.level === "error") dp.failed += 1;
          }
          usedServer = true;
        }
      } catch {
        // ignore
      }

      // 2) 如果没有服务器数据，就读取本地 localStorage
      if (!usedServer) {
        try {
          const arr = JSON.parse(localStorage.getItem("smsHistory") || "[]");
          if (Array.isArray(arr)) {
            for (const it of arr) {
              const ts = parseEpoch(it.timestamp ?? it.time);
              const d = new Date(ts);
              const k = toISO(d);
              if (k < from || k > to) continue;
              const dp = buckets.get(k);
              if (!dp) continue;
              dp.total += 1;
              const s = String(it.status || "").toLowerCase();
              if (s === "success") dp.success += 1;
              else if (s === "failed" || s === "error") dp.failed += 1;
            }
          }
        } catch {
          // ignore
        }
      }

      // 汇总
      const rows = Array.from(buckets.values());
      const totals = rows.reduce(
        (acc, r) => {
          acc.total += r.total; acc.success += r.success; acc.failed += r.failed;
          return acc;
        },
        { total: 0, success: 0, failed: 0 }
      );

      setItems(rows);
      setSumTotal(totals.total);
      setSumSuccess(totals.success);
      setSumFailed(totals.failed);
    } catch (e: any) {
      setError(e?.message || "読み込みに失敗しました");
      setItems([]);
      setSumTotal(0); setSumSuccess(0); setSumFailed(0);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { refresh(); }, []); // 首次载入
  const successRate = useMemo(() => (sumTotal ? (sumSuccess / sumTotal) * 100 : 0), [sumSuccess, sumTotal]);
  const failedRate = useMemo(() => (sumTotal ? (sumFailed / sumTotal) * 100 : 0), [sumFailed, sumTotal]);

  // 简易 SVG 折线图（总量）
  const Chart = () => {
    const data = items;
    const W = 760, H = 160, pad = 20;
    const max = Math.max(1, ...data.map(d => d.total));
    const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, data.length - 1);
    const y = (v: number) => H - pad - (v * (H - pad * 2)) / max;
    const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.total)}`).join(" ");
    const area = `M ${x(0)} ${y(0)} ${path.slice(1)} L ${x(data.length - 1)} ${H - pad} L ${x(0)} ${H - pad} Z`;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="送信回数の推移">
        {/* grid lines */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={pad} x2={W - pad} y1={pad + r * (H - pad * 2)} y2={pad + r * (H - pad * 2)} stroke="#eef1e6" />
        ))}
        {/* area */}
        <path d={area} fill="url(#g1)" opacity="0.6" />
        {/* line */}
        <path d={path} fill="none" stroke={brand} strokeWidth={2.5} />
        {/* dots */}
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.total)} r={3} fill={brand} />
        ))}
        <defs>
          <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={brand} stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    );
  };

  return (
    <div>
      {/* 日期筛选 */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          style={{ padding: "10px 12px", border: "2px solid #e8eae0", borderRadius: 8, background: "#fff" }}
        />
        <span style={{ color: "#8aa06b" }}>—</span>
        <input
          type="date" value={to} onChange={(e) => setTo(e.target.value)}
          style={{ padding: "10px 12px", border: "2px solid #e8eae0", borderRadius: 8, background: "#fff" }}
        />
        <button
          onClick={refresh}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #e6e8d9", background: "#fff", cursor: "pointer" }}
        >
          🔄 取得
        </button>
      </div>

      {/* 指标卡 + 图表 */}
      <div style={{ border: "1px solid #e6e8d9", background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,.03)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
          <StatCard title="⚙ 実行数" value={sumTotal} sub="" />
          <StatCard title="💡 送信成功数" value={sumSuccess} sub={`${successRate.toFixed(2)}%`} />
          <StatCard title="❌ 送信失敗数" value={sumFailed} sub={`${failedRate.toFixed(2)}%`} />
        </div>

        <div style={{ marginTop: 10 }}>
          {loading ? (
            <div style={{ color: "#666", padding: "24px 0" }}>読み込み中...</div>
          ) : (
            <Chart />
          )}
        </div>

        {/* X 轴刻度（每隔若干天显示一下） */}
        {!loading && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: -6, padding: "0 8px", color: "#8aa06b", fontSize: 12 }}>
            {items.map((d, i) => (i % Math.ceil(items.length / 8 || 1) === 0 ? <span key={d.date}>{d.date.slice(5)}</span> : <span key={i} />))}
          </div>
        )}
      </div>

      {/* 错误信息 */}
      {error && <div style={{ color: "#d32f2f", marginTop: 10 }}>❌ {error}</div>}

      {/* 响应式微调 */}
      <style jsx>{`
        @media (max-width: 960px) {
          .grid-3 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// --- 指标卡 ---
function StatCard({ title, value, sub }: { title: string; value: number; sub?: string }) {
  return (
    <div style={{
      border: "1px solid #eef1e6",
      borderRadius: 12,
      padding: 12,
      background: "linear-gradient(180deg,#fbfcf7 0%, #ffffff 60%)"
    }}>
      <div style={{ color: "#8aa06b", fontSize: 12, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 36, fontWeight: 800, color: "#6f8333", lineHeight: 1.1 }}>{value.toLocaleString()}</div>
      {sub ? <div style={{ fontSize: 12, color: "#8aa06b", marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}
