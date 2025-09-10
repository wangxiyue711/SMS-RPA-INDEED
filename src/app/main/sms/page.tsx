"use client";

import React, { useEffect } from "react";

/**
 * /main/sms —— SMS設定（内容区）
 * - 由 /main/layout.tsx 提供统一 Header + Sidebar + 登录态守卫
 * - 这里只负责渲染表单与读写配置
 */
export default function SmsSettingsPage() {
  useEffect(() => {
    (async () => {
      // —— 若项目已全局初始化过 Firebase，可删除下面这段初始化 —— //
      const { initializeApp } = await import("firebase/app");
      const { getAuth, onAuthStateChanged } = await import("firebase/auth");
      const { getFirestore, doc, getDoc, setDoc, updateDoc } = await import(
        "firebase/firestore"
      );

      // 若已初始化可跳过；这里安全起见再 init 一次不报错，但更推荐全局统一 init
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

      // —— 幂等挂载全局 API —— //
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
          detectProvider(apiUrl: string) {
            const url = (apiUrl || "").toLowerCase();
            if (url.includes("sms-console.jp")) return "sms-console";
            if (url.includes("twilio.com")) return "twilio";
            if (url.includes("vonage.com") || url.includes("nexmo.com"))
              return "vonage";
            if (url.includes("messagebird.com")) return "messagebird";
            if (url.includes("plivo.com")) return "plivo";
            return "custom";
          },
          async updateSmsConfig(
            apiUrl: string,
            apiId: string,
            apiPassword: string,
            smsTextA: string,
            smsTextB: string
          ) {
            if (!(window as any).currentUser)
              throw new Error("ログインが必要です");
            const user = (window as any).currentUser;
            const ref = doc(_db, "user_configs", user.uid);
            const snap = await getDoc(ref);
            const smsConfig = {
              api_url: apiUrl,
              api_id: apiId,
              api_password: apiPassword,
              sms_text_a: smsTextA,
              sms_text_b: smsTextB,
              use_delivery_report: false,
              provider: (window as any).FirebaseAPI.detectProvider(apiUrl),
            };
            if (snap.exists())
              await updateDoc(ref, {
                sms_config: smsConfig,
                updated_at: new Date(),
              });
            else {
              await setDoc(ref, {
                user_id: user.uid,
                email: user.email,
                email_config: {
                  address: "",
                  app_password: "",
                  site_password: "",
                },
                sms_config: smsConfig,
                created_at: new Date(),
                updated_at: new Date(),
              });
            }
            return { success: true };
          },
        };
        (window as any).__FirebaseAPIBound = true;

        // 表单提交句柄（保持原行为）
        (window as any).saveSmsConfig = async function (e: any) {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const get = (name: string) =>
            (
              form.elements.namedItem(name) as
                | HTMLInputElement
                | HTMLTextAreaElement
            )?.value || "";
          const statusEl = document.getElementById("smsStatus")!;
          if (!(window as any).currentUser) {
            statusEl.innerHTML =
              '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
            return;
          }
          statusEl.innerHTML =
            '<span style="color:#1976d2;">💾 設定を保存中...</span>';

          const apiUrl = get("smsApiUrl");
          const apiId = get("smsApiId");
          const apiPassword = get("smsApiPassword");
          const smsTextA =
            (document.getElementById("smsTextA") as HTMLTextAreaElement)
              ?.value || "";
          const smsTextB =
            (document.getElementById("smsTextB") as HTMLTextAreaElement)
              ?.value || "";

          let res: any = { success: false };
          if (
            (window as any).FirebaseAPI &&
            typeof (window as any).FirebaseAPI.updateSmsConfig === "function"
          ) {
            try {
              res = await (window as any).FirebaseAPI.updateSmsConfig(
                apiUrl,
                apiId,
                apiPassword,
                smsTextA,
                smsTextB
              );
            } catch (err) {
              res = { success: false, error: String(err) };
            }
          } else {
            // 回退：直接使用 Firestore 客户端写入
            try {
              const user = (window as any).currentUser;
              const ref = doc(_db, "user_configs", user.uid);
              const snap = await getDoc(ref);
              const smsConfig = {
                api_url: apiUrl,
                api_id: apiId,
                api_password: apiPassword,
                sms_text_a: smsTextA,
                sms_text_b: smsTextB,
                use_delivery_report: false,
                provider: (window as any).FirebaseAPI?.detectProvider
                  ? (window as any).FirebaseAPI.detectProvider(apiUrl)
                  : "custom",
              };
              if (snap && snap.exists()) {
                await updateDoc(ref, {
                  sms_config: smsConfig,
                  updated_at: new Date(),
                });
              } else {
                await setDoc(ref, {
                  user_id: user.uid,
                  email: user.email,
                  email_config: {
                    address: "",
                    app_password: "",
                    site_password: "",
                  },
                  sms_config: smsConfig,
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
            ? '<span style="color:#388e3c;">✅ SMS設定が保存されました（5項目完了）</span>'
            : `<span style="color:#d32f2f;">❌ エラー: ${res.error}</span>`;
        };
      }

      // 仅做“填充表单值”（登录态守卫交给 layout.tsx）
      onAuthStateChanged(_auth, async (user) => {
        if (user) {
          (window as any).currentUser = user;
          try {
            const cfg = await (window as any).FirebaseAPI.getUserConfig();
            (document.getElementById(
              "smsApiUrl"
            ) as HTMLInputElement | null)!.value =
              cfg.sms_config?.api_url || "";
            (document.getElementById(
              "smsApiId"
            ) as HTMLInputElement | null)!.value = cfg.sms_config?.api_id || "";
            (document.getElementById(
              "smsApiPassword"
            ) as HTMLInputElement | null)!.value =
              cfg.sms_config?.api_password || "";
            (document.getElementById(
              "smsTextA"
            ) as HTMLTextAreaElement | null)!.value =
              cfg.sms_config?.sms_text_a || "";
            (document.getElementById(
              "smsTextB"
            ) as HTMLTextAreaElement | null)!.value =
              cfg.sms_config?.sms_text_b || "";
          } catch (e) {
            console.error("設定ロード失敗:", e);
          }
        }
      });
    })();
  }, []);

  // —— 仅主体内容（Header/Sidebar 由 layout.tsx 统一提供）——
  return (
    <>
      <div className="panel-header" style={{ marginBottom: 16 }}>
        <h2 className="panel-title" style={{ color: "#6f8333", margin: 0 }}>
          📱 SMS設定
        </h2>
        <p
          className="panel-description"
          style={{ color: "#666", margin: "6px 0 0" }}
        >
          SMS送信API設定とメッセージテンプレートを設定してください（5項目必須）
          <br />
          <small>対応API: SMS Console、Twilio、その他HTTP API提供商</small>
        </p>
      </div>

      <form
        className="ai-form"
        onSubmit={(e: any) => (window as any).saveSmsConfig(e)}
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
        <label htmlFor="smsApiUrl">🌐 SMS API URL</label>
        <input
          type="url"
          id="smsApiUrl"
          name="smsApiUrl"
          placeholder="https://www.sms-console.jp/api/ ..."
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
          各社のSMS API提供商のエンドポイントURL
        </div>

        <label htmlFor="smsApiId">🔑 SMS API ID / ユーザー名</label>
        <input
          type="text"
          id="smsApiId"
          name="smsApiId"
          placeholder="sm000206_user / ACxxxxxxxx (Twilio)"
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
          アカウントID / Account SID
        </div>

        <label htmlFor="smsApiPassword">🔐 SMS API パスワード / トークン</label>
        <input
          type="password"
          id="smsApiPassword"
          name="smsApiPassword"
          placeholder="API パスワード / Auth Token"
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
          認証用のパスワード/トークン
        </div>

        <label htmlFor="smsTextA">📄 SMSテンプレートA</label>
        <textarea
          id="smsTextA"
          name="smsTextA"
          rows={4}
          required
          style={{
            border: "2px solid #e8eae0",
            borderRadius: 8,
            padding: 10,
            background: "#fafbf7",
            color: "#43503a",
          }}
        />

        <label htmlFor="smsTextB">📝 SMSテンプレートB</label>
        <textarea
          id="smsTextB"
          name="smsTextB"
          rows={4}
          required
          style={{
            border: "2px solid #e8eae0",
            borderRadius: 8,
            padding: 10,
            background: "#fafbf7",
            color: "#43503a",
          }}
        />

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
          💾 SMS設定を保存
        </button>
      </form>

      <div
        id="smsStatus"
        className="ai-hint"
        style={{ marginTop: 16, minHeight: 20, fontSize: 12, color: "#666" }}
      />
    </>
  );
}
