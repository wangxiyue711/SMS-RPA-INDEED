"use client";
import React, { useEffect, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";

export default function PersonalInfoPopup() {
  const [status, setStatus] = useState("起動中…");
  const [count, setCount] = useState(0);

  useEffect(() => {
    async function run() {
      try {
        if (getApps().length === 0) {
          initializeApp({
            apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
            authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
          });
        }
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) {
          setStatus("ログインが必要です");
          return;
        }

        const idToken = await user.getIdToken();

        setStatus("ジョブを登録中…");
        const resp = await fetch("/api/rpa/enqueue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ userUid: user.uid }),
        });
        const data = await resp.json();
        if (!data?.success) {
          setStatus("ジョブ登録に失敗しました");
          return;
        }

        const jobId = data.jobId;
        setStatus("ワーカーの応答を待っています…");
        const db = getFirestore();
        const jobRef = doc(db, "rpa_jobs", jobId);
        const unsub = onSnapshot(jobRef, (snap) => {
          if (!snap.exists()) return;
          const d: any = snap.data();
          if (d.status === "needs_human" && Array.isArray(d.targets)) {
            setStatus("処理が人手を要求しています。リンクを開きます…");
            d.targets.forEach((t: string) => {
              try {
                window.open(t, "_blank");
              } catch {}
            });
            setCount(d.targets.length || 0);
          } else if (d.status === "done") {
            setStatus("完了");
            unsub();
            setTimeout(() => window.close(), 1500);
          }
        });
      } catch (e) {
        setStatus("エラーが発生しました");
      }
    }
    run();
  }, []);

  return (
    <div style={{ padding: 18, width: 380 }}>
      <h3>個人情報 取得ポップアップ</h3>
      <p>{status}</p>
      {count > 0 && <p>開いたリンク数: {count}</p>}
      <div style={{ marginTop: 12 }}>
        <button onClick={() => window.close()}>閉じる</button>
      </div>
    </div>
  );
}
