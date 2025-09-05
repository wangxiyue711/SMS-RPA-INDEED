// src/app/main/page.tsx
"use client";
import React from "react";
import Link from "next/link";

export default function TopPage() {
  return (
    <>
      <div className="panel-header" style={{ marginBottom: 16 }}>
        <h2 className="panel-title" style={{ color: "#6f8333", margin: 0 }}>🏠 TOP</h2>
        <p className="panel-description" style={{ color: "#666", margin: "6px 0 0" }}>
          サイドバーから各ページへ移動できます。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
        {[
          { href: "/main/account", label: "📧 アカウント設定" },
          { href: "/main/sms",     label: "📱 SMS設定" },
          { href: "/main/send",    label: "📤 個別送信" },
          { href: "/main/rpa",     label: "🛠️ RPA実行" },
        ].map(x => (
          <Link key={x.href} href={x.href} style={{
            display:"block", padding:16, background:"#fff", border:"1px solid #e6e8d9",
            borderRadius:12, textDecoration:"none", color:"#43503a"
          }}>
            <span style={{ fontWeight:700 }}>{x.label}</span>
            <div style={{ fontSize:12, color:"#777", marginTop:6 }}>クリックして移動</div>
          </Link>
        ))}
      </div>
    </>
  );
}
