"use client";

import React, { useEffect } from "react";

/**
 * /main/account —— アカウント設定（内容区）
 * - Header 与 Sidebar 由 /main/layout.tsx 提供，这里只渲染表单与读写配置
 * - 登录态守卫也放在 layout.tsx，本页仅做表单回填/保存
 */
export default function AccountSettingsPage() {
  useEffect(() => {
    (async () => {
      // 若你的项目已有全局初始化，可删掉这段；这里保留为“幂等可用”的版本
      const { initializeApp } = await import("firebase/app");
      const { getAuth, onAuthStateChanged } = await import("firebase/auth");
      const { getFirestore, doc, getDoc, setDoc, updateDoc } = await import(
        "firebase/firestore"
      );

      const firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId:
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      };

      const app = initializeApp(firebaseConfig);
      const _auth = getAuth(app);
      const _db = getFirestore(app);
      (window as any).auth = _auth;
      (window as any).db = _db;

      // —— 幂等挂载 FirebaseAPI —— //
      if (!(window as any).__FirebaseAPIBound) {
        (window as any).FirebaseAPI = {
          async getUserConfig() {
            if (!(window as any).currentUser)
              throw new Error("ログインが必要です");
            const user = (window as any).currentUser;
            const ref = doc(_db, "user_configs", user.uid);
            const snap = await getDoc(ref);
            if (snap.exists()) return snap.data();
            const defaultConfig = {
              user_id: user.uid,
              email: user.email,
              email_config: {
                address: "",
                app_password: "",
                site_password: "",
              },
              sms_config: {
                provider: "",
                api_url: "",
                api_id: "",
                api_password: "",
                sms_text_a: "",
                sms_text_b: "",
              },
              created_at: new Date(),
              updated_at: new Date(),
            };
            await setDoc(ref, defaultConfig);
            return defaultConfig;
          },
          async updateEmailConfig(
            emailAddress: string,
            appPassword: string,
            sitePassword: string
          ) {
            if (!(window as any).currentUser)
              throw new Error("ログインが必要です");
            const user = (window as any).currentUser;
            const ref = doc(_db, "user_configs", user.uid);
            const snap = await getDoc(ref);
            const payload = {
              email_config: {
                address: emailAddress,
                app_password: appPassword,
                site_password: sitePassword,
              },
              updated_at: new Date(),
            };
            if (snap.exists()) await updateDoc(ref, payload);
            else {
              await setDoc(ref, {
                user_id: user.uid,
                email: user.email,
                email_config: payload.email_config,
                sms_config: {
                  provider: "",
                  api_url: "",
                  api_id: "",
                  api_password: "",
                  sms_text_a: "",
                  sms_text_b: "",
                },
                created_at: new Date(),
                updated_at: new Date(),
              });
            }
            return { success: true };
          },
        };
        (window as any).__FirebaseAPIBound = true;

        // 表单提交句柄（保持你原有的 DOM id 与行为）
        (window as any).saveAccountConfig = async function (e: any) {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const get = (n: string) =>
            (form.elements.namedItem(n) as HTMLInputElement)?.value || "";
          const statusEl = document.getElementById("accountStatus")!;
          if (!(window as any).currentUser) {
            statusEl.innerHTML =
              '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
            return;
          }
          statusEl.innerHTML =
            '<span style="color:#1976d2;">💾 設定を保存中...</span>';

          const emailAddress = get("emailAddress");
          const appPassword = get("appPassword");
          const sitePassword = get("sitePassword");

          let res: any = { success: false };

          // 优先使用已经挂载的全局 API
          if (
            (window as any).FirebaseAPI &&
            typeof (window as any).FirebaseAPI.updateEmailConfig === "function"
          ) {
            try {
              res = await (window as any).FirebaseAPI.updateEmailConfig(
                emailAddress,
                appPassword,
                sitePassword
              );
            } catch (err) {
              res = { success: false, error: String(err) };
            }
          } else {
            // 回退：直接使用 firestore 客户端接口写入
            try {
              const user = (window as any).currentUser;
              const ref = doc(_db, "user_configs", user.uid);
              const snap = await getDoc(ref);
              const payload = {
                email_config: {
                  address: emailAddress,
                  app_password: appPassword,
                  site_password: sitePassword,
                },
                updated_at: new Date(),
              };
              if (snap && snap.exists()) {
                await updateDoc(ref, payload);
              } else {
                await setDoc(ref, {
                  user_id: user.uid,
                  email: user.email,
                  email_config: payload.email_config,
                  sms_config: {
                    provider: "",
                    api_url: "",
                    api_id: "",
                    api_password: "",
                    sms_text_a: "",
                    sms_text_b: "",
                  },
                  created_at: new Date(),
                  updated_at: new Date(),
                });
              }
              res = { success: true };
            } catch (err) {
              res = { success: false, error: String(err) };
            }
          }

          statusEl.innerHTML = res.success
            ? '<span style="color:#388e3c;">✅ アカウント設定が保存されました</span>'
            : `<span style="color:#d32f2f;">❌ エラー: ${res.error}</span>`;
        };
      }

      // 只做表单回填（重定向由 layout.tsx 处理）
      onAuthStateChanged(_auth, async (user) => {
        if (user) {
          (window as any).currentUser = user;
          try {
            let cfg: any = null;
            // 优先使用全局 API（若已挂载），否则直接从 Firestore 读取作为回退
            if (
              (window as any).FirebaseAPI &&
              typeof (window as any).FirebaseAPI.getUserConfig === "function"
            ) {
              cfg = await (window as any).FirebaseAPI.getUserConfig();
            } else {
              try {
                const ref = doc(_db, "user_configs", user.uid);
                const snap = await getDoc(ref);
                if (snap && snap.exists()) cfg = snap.data();
                else
                  cfg = {
                    email_config: {
                      address: "",
                      app_password: "",
                      site_password: "",
                    },
                  };
              } catch (innerErr) {
                console.warn(
                  "FirebaseAPI 未挂载，且直接读取 Firestore 失败：",
                  innerErr
                );
              }
            }

            if (cfg) {
              (document.getElementById(
                "emailAddress"
              ) as HTMLInputElement | null)!.value =
                cfg.email_config?.address || "";
              (document.getElementById(
                "emailAppPassword"
              ) as HTMLInputElement | null)!.value =
                cfg.email_config?.app_password || "";
              (document.getElementById(
                "sitePassword"
              ) as HTMLInputElement | null)!.value =
                cfg.email_config?.site_password || "";
            }
          } catch (e) {
            console.error("設定ロード失敗:", e);
          }
        }
      });
    })();
  }, []);

  // —— 仅主体内容（Header/Sidebar 由 /main/layout.tsx 提供）——
  return (
    <>
      <div className="panel-header" style={{ marginBottom: 16 }}>
        <h2 className="panel-title" style={{ color: "#6f8333", margin: 0 }}>
          📧 アカウント設定
        </h2>
        <p
          className="panel-description"
          style={{ color: "#666", margin: "6px 0 0" }}
        >
          RPA自動化に必要なアカウント情報を設定してください（3項目のみ）
        </p>
      </div>

      <form
        className="ai-form"
        onSubmit={(e: any) => (window as any).saveAccountConfig(e)}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "#fff",
          padding: 16,
          border: "1px solid #e6e8d9",
          borderRadius: 12,
        }}
      >
        <label htmlFor="emailAddress">📬 メールアドレス</label>
        <input
          type="email"
          id="emailAddress"
          name="emailAddress"
          placeholder="example@gmail.com"
          required
          autoComplete="off"
          style={{
            border: "2px solid #e8eae0",
            borderRadius: 8,
            padding: 10,
            background: "#fafbf7",
            color: "#43503a",
          }}
        />
        <div className="ai-hint" style={{ fontSize: 12, color: "#666" }}>
          RPAが監視するGmailアドレス（Indeed求人メール受信用）
        </div>

        <label htmlFor="emailAppPassword">🔑 Gmailアプリパスワード</label>
        <input
          type="password"
          id="emailAppPassword"
          name="appPassword"
          placeholder="16文字のアプリパスワード"
          required
          style={{
            border: "2px solid #e8eae0",
            borderRadius: 8,
            padding: 10,
            background: "#fafbf7",
            color: "#43503a",
          }}
        />
        <div className="ai-hint" style={{ fontSize: 12, color: "#666" }}>
          Google設定→セキュリティ→2段階認証→アプリパスワードで生成
        </div>

        <label htmlFor="sitePassword">🌐 Indeedログインパスワード</label>
        <input
          type="password"
          id="sitePassword"
          name="sitePassword"
          placeholder="Indeedアカウントのパスワード"
          required
          style={{
            border: "2px solid #e8eae0",
            borderRadius: 8,
            padding: 10,
            background: "#fafbf7",
            color: "#43503a",
          }}
        />
        <div className="ai-hint" style={{ fontSize: 12, color: "#666" }}>
          Indeed求人サイトにログインするためのパスワード
        </div>

        <button
          type="submit"
          style={{
            padding: "10px 12px",
            background: "linear-gradient(135deg,#6f8333 0%,#8fa446 100%)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          💾 アカウント設定を保存
        </button>
      </form>

      <div
        id="accountStatus"
        className="ai-hint"
        style={{ marginTop: 16, minHeight: 20, fontSize: 12, color: "#666" }}
      />
    </>
  );
}
