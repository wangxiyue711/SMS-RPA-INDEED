// src/app/main/layout.tsx
"use client";

import React, { useMemo, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";

import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string>("読み込み中...");

  const activeKey = useMemo(() => {
    const parts = (pathname || "/main").split("/").filter(Boolean);
    return parts[1] ?? "top";
  }, [pathname]);

  useEffect(() => {
    if (getApps().length === 0) {
      initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      });
    }
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) router.replace(`/login?next=${encodeURIComponent(pathname || "/main")}`);
      else {
        (window as any).currentUser = user;
        setEmail(user.email ?? "");
      }
    });
    return () => unsub();
  }, [router, pathname]);

  const handleLogout = async () => {
    try { await signOut(getAuth()); } finally { router.replace("/login"); }
  };

  return (
    <div
      className="app-shell"
      style={{
        width: "100%",
        maxWidth: "none",
        minWidth: 0,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#f8faef",
      }}
    >
      <header
        className="header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          background: "#fff",
          borderBottom: "1px solid #eee",
        }}
      >
        <div className="brand">
          <span className="brand-title" style={{ fontWeight: 700, color: "#6f8333" }}>🤖 XXX XXXX</span>
        </div>
        <div className="user-info" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span id="userEmail" aria-live="polite">{email}</span>
          {/* <button onClick={handleLogout} ...>ログアウト</button> */}
        </div>
      </header>

      <div
        className="main-wrapper"
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          width: "100%",
        }}
      >
        <Sidebar activeKey={activeKey} />
        <main
          className="main-content"
          style={{
            flex: 1,
            padding: 24,
            minWidth: 0,
          }}
        >
          <React.Suspense fallback={<div style={{ color: "#666", fontSize: 14 }}>読み込み中...</div>}>
            {children}
          </React.Suspense>
        </main>
      </div>

      {/* ★ 响应式：小于 960px 时，上下布局 */}
      <style jsx>{`
        @media (max-width: 960px) {
          .main-wrapper {
            flex-direction: column;   /* Sidebar 在上，内容在下 */
          }
          .main-content {
            padding: 12px;            /* 小屏缩小内边距，避免横向滚动 */
          }
        }
      `}</style>
    </div>
  );
}
