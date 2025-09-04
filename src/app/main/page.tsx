// src/app/main/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export default function MainAppPage() {
  const router = useRouter();

  // 左侧面板状态：mail | api | rpa | sms
  const [activePanel, setActivePanel] = useState<"mail" | "api" | "rpa" | "sms">("mail");
  const switchPanel = useCallback((panel: typeof activePanel) => setActivePanel(panel), []);

  useEffect(() => {
    (async () => {
      // ========== Firebase 动态初始化（前端 SDK） ==========
      const { initializeApp } = await import("firebase/app");
      const { getAuth, onAuthStateChanged, signOut } = await import("firebase/auth");
      const { getFirestore, doc, getDoc, setDoc, updateDoc } = await import("firebase/firestore");

      const firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      };

      const app = initializeApp(firebaseConfig);
      const _auth = getAuth(app);
      const _db = getFirestore(app);

      (window as any).auth = _auth;
      (window as any).db = _db;

      // ====== 幂等挂载 window.FirebaseAPI（避免严格模式多次 effect 覆盖） ======
      if (!(window as any).__FirebaseAPIBound) {
        (window as any).FirebaseAPI = {
          async logoutUser() {
            try {
              await signOut(_auth);
              return { success: true };
            } catch (error: any) {
              return { success: false, error: error.message };
            }
          },

          // 读取/创建用户配置
          async getUserConfig() {
            if (!(window as any).currentUser) throw new Error("ログインが必要です");
            try {
              const user = (window as any).currentUser;
              const ref = doc(_db, "user_configs", user.uid);
              const snap = await getDoc(ref);
              if (snap.exists()) return snap.data();
              const defaultConfig = {
                user_id: user.uid,
                email: user.email,
                email_config: { address: "", app_password: "", site_password: "" },
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
            } catch (e: any) {
              throw new Error("設定の取得に失敗しました: " + e.message);
            }
          },

          async updateEmailConfig(emailAddress: string, appPassword: string, sitePassword: string) {
            if (!(window as any).currentUser) throw new Error("ログインが必要です");
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
            } catch (e: any) {
              return { success: false, error: e.message };
            }
          },

          detectProvider(apiUrl: string) {
            const url = (apiUrl || "").toLowerCase();
            if (url.includes("sms-console.jp")) return "sms-console";
            if (url.includes("twilio.com")) return "twilio";
            if (url.includes("vonage.com") || url.includes("nexmo.com")) return "vonage";
            if (url.includes("messagebird.com")) return "messagebird";
            if (url.includes("plivo.com")) return "plivo";
            return "custom";
          },

          async updateSmsConfig(apiUrl: string, apiId: string, apiPassword: string, smsTextA: string, smsTextB: string) {
            if (!(window as any).currentUser) throw new Error("ログインが必要です");
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
                provider: (window as any).FirebaseAPI.detectProvider(apiUrl),
              };
              if (snap.exists()) await updateDoc(ref, { sms_config: smsConfig, updated_at: new Date() });
              else {
                await setDoc(ref, {
                  user_id: user.uid,
                  email: user.email,
                  email_config: { address: "", app_password: "", site_password: "" },
                  sms_config: smsConfig,
                  created_at: new Date(),
                  updated_at: new Date(),
                });
              }
              return { success: true };
            } catch (e: any) {
              return { success: false, error: e.message };
            }
          },

          async getRpaConfig() {
            try {
              const config = await (window as any).FirebaseAPI.getUserConfig();
              return {
                success: true,
                config: {
                  email: config.email_config?.address,
                  emailPassword: config.email_config?.app_password,
                  sitePassword: config.email_config?.site_password,
                  smsProvider: config.sms_config?.provider,
                  smsApiUrl: config.sms_config?.api_url,
                  smsApiId: config.sms_config?.api_id,
                  smsApiPassword: config.sms_config?.api_password,
                  smsTextA: config.sms_config?.sms_text_a,
                  smsTextB: config.sms_config?.sms_text_b,
                },
              };
            } catch (e: any) {
              return { success: false, error: e.message };
            }
          },
        };
        (window as any).__FirebaseAPIBound = true;

        // ====== 这两个是你表单用到的保存函数（必须挂到 window） ======
        (window as any).saveAccountConfig = async function (e: any) {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement)?.value || "";
          const statusEl = document.getElementById("accountStatus")!;
          if (!(window as any).currentUser) {
            statusEl.innerHTML = '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
            return;
          }
          statusEl.innerHTML = '<span style="color:#1976d2;">💾 設定を保存中...</span>';
          const res = await (window as any).FirebaseAPI.updateEmailConfig(
            get("emailAddress"),
            get("appPassword"),
            get("sitePassword")
          );
          statusEl.innerHTML = res.success
            ? '<span style="color:#388e3c;">✅ アカウント設定が保存されました</span>'
            : `<span style="color:#d32f2f;">❌ エラー: ${res.error}</span>`;
        };

        (window as any).saveSmsConfig = async function (e: any) {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const get = (name: string) =>
            (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement)?.value || "";
          const statusEl = document.getElementById("smsStatus")!;
          if (!(window as any).currentUser) {
            statusEl.innerHTML = '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
            return;
          }
          statusEl.innerHTML = '<span style="color:#1976d2;">💾 設定を保存中...</span>';
          const res = await (window as any).FirebaseAPI.updateSmsConfig(
            get("smsApiUrl"),
            get("smsApiId"),
            get("smsApiPassword"),
            (document.getElementById("smsTextA") as HTMLTextAreaElement)?.value || "",
            (document.getElementById("smsTextB") as HTMLTextAreaElement)?.value || ""
          );
          statusEl.innerHTML = res.success
            ? '<span style="color:#388e3c;">✅ SMS設定が保存されました（5項目完了）</span>'
            : `<span style="color:#d32f2f;">❌ エラー: ${res.error}</span>`;
        };
      }

      // 小工具：等待 FirebaseAPI 就绪（最多 3 秒）
      async function waitForFirebaseAPI(timeoutMs = 3000) {
        const start = Date.now();
        while (true) {
          const api = (window as any).FirebaseAPI;
          if (api && typeof api.getUserConfig === "function") return api;
          if (Date.now() - start > timeoutMs) throw new Error("FirebaseAPI not ready");
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // ========== 认证状态 ==========
      onAuthStateChanged(_auth, async (user) => {
        if (!user) {
          router.replace("/login");
        } else {
          (window as any).currentUser = user;
          const el = document.getElementById("userEmail");
          if (el) el.textContent = user.email || "";
          try {
            await waitForFirebaseAPI();
            await loadUserConfigToForms();
          } catch {}
        }
      });

      // ========== 把 Firestore 配置加载到表单 ==========
      async function loadUserConfigToForms() {
        try {
          const FirebaseAPI = await waitForFirebaseAPI();
          const config = await FirebaseAPI.getUserConfig();
          // 邮箱
          (document.getElementById("emailAddress") as HTMLInputElement | null)!.value =
            config.email_config?.address || "";
          (document.getElementById("emailAppPassword") as HTMLInputElement | null)!.value =
            config.email_config?.app_password || "";
          (document.getElementById("sitePassword") as HTMLInputElement | null)!.value =
            config.email_config?.site_password || "";
          // SMS
          (document.getElementById("smsApiUrl") as HTMLInputElement | null)!.value =
            config.sms_config?.api_url || "";
          (document.getElementById("smsApiId") as HTMLInputElement | null)!.value =
            config.sms_config?.api_id || "";
          (document.getElementById("smsApiPassword") as HTMLInputElement | null)!.value =
            config.sms_config?.api_password || "";
          (document.getElementById("smsTextA") as HTMLTextAreaElement | null)!.value =
            config.sms_config?.sms_text_a || "";
          (document.getElementById("smsTextB") as HTMLTextAreaElement | null)!.value =
            config.sms_config?.sms_text_b || "";
        } catch (e) {
          console.error("設定ロード失敗:", e);
        }
      }

      // ======== 健康检查（/api/health） ========
      (window as any).checkServerConnection = async function () {
        const statusDiv = document.getElementById("connectionStatus")!;
        const statusText = document.getElementById("statusText")!;
        try {
          const resp = await fetch(`/api/health`, { method: "GET" });
          if (resp.ok) {
            statusDiv.style.backgroundColor = "#e8f5e8";
            statusDiv.style.color = "#2e7d2e";
            statusText.textContent = "✅ RPAサーバー接続成功";
          } else throw new Error("Server response not OK");
        } catch {
          statusDiv.style.backgroundColor = "#ffe6e6";
          statusDiv.style.color = "#d32f2f";
          statusText.innerHTML = "❌ RPAサーバー未接続 - <strong>RPAサイトを起動してください.bat</strong>";
        }
      };

      // ======== 个别短信发送（站内 API） ========
      (window as any).sendIndividualSms = async function (e: any) {
        e.preventDefault();
        const phone = (document.getElementById("recipientPhone") as HTMLInputElement).value.trim();
        const message = (document.getElementById("smsContent") as HTMLTextAreaElement).value.trim();
        const resultDiv = document.getElementById("smsResult")!;
        if (!(window as any).currentUser) {
          resultDiv.innerHTML = '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
          return;
        }
        try {
          resultDiv.innerHTML = '<span style="color:#1976d2;">📤 SMS送信中...</span>';
          const resp = await fetch(`/api/sms/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userUid: (window as any).currentUser.uid, phone, message }),
          });
          const data = await resp.json();
          if (data.success) {
            resultDiv.innerHTML = '<span style="color:#388e3c;">✅ SMS送信成功！</span>';
            const statusInfo = data.output ? (data.output.match(/STATUS:\s*(\w+)/)?.[1] || "OK") : "OK";
            (window as any).addToSmsHistory(phone, message, "success", `ステータス: ${statusInfo}`);
            (document.getElementById("recipientPhone") as HTMLInputElement).value = "";
            (document.getElementById("smsContent") as HTMLTextAreaElement).value = "";
            (document.getElementById("useTemplate") as HTMLInputElement).checked = false;
            (window as any).toggleTemplate();
          } else {
            const statusInfo = data.details ? (data.details.match(/STATUS:\s*(\w+)/)?.[1] || "Unknown") : "Unknown";
            resultDiv.innerHTML = `<span style="color:#d32f2f;">❌ SMS送信失敗: ${data.error}</span>`;
            (window as any).addToSmsHistory(phone, message, "failed", `ステータス: ${statusInfo} - ${data.error}`);
          }
        } catch (e: any) {
          resultDiv.innerHTML = `<span style="color:#d32f2f;">❌ エラー: ${e.message}</span>`;
          (window as any).addToSmsHistory(phone, message, "error", `接続エラー: ${e.message}`);
        }
      };

      // ======= 模板选择/历史 =======
      (window as any).toggleTemplate = function () {
        const c = document.getElementById("useTemplate") as HTMLInputElement;
        const s = document.getElementById("templateSelector") as HTMLElement;
        if (s) s.style.display = c?.checked ? "block" : "none";
      };

      (window as any).loadTemplate = async function (type: "A" | "B") {
        try {
          const FirebaseAPI = (window as any).FirebaseAPI;
          const cfg = await FirebaseAPI.getUserConfig();
          const ta = document.getElementById("smsContent") as HTMLTextAreaElement;
          if (type === "A" && cfg.sms_config?.sms_text_a) ta.value = cfg.sms_config.sms_text_a;
          else if (type === "B" && cfg.sms_config?.sms_text_b) ta.value = cfg.sms_config.sms_text_b;
          else alert(`テンプレート${type}が設定されていません。SMS設定で先に設定してください。`);
        } catch (e: any) {
          alert("テンプレートの読み込みに失敗しました: " + e.message);
        }
      };

      (window as any).smsHistory = JSON.parse(localStorage.getItem("smsHistory") || "[]");
      (window as any).addToSmsHistory = function (
        phone: string,
        message: string,
        status: "success" | "failed" | "error",
        statusInfo?: string
      ) {
        const item = {
          timestamp: new Date().toLocaleString("ja-JP"),
          phone,
          message: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
          status,
          statusInfo: statusInfo || null,
        };
        (window as any).smsHistory.unshift(item);
        if ((window as any).smsHistory.length > 100) (window as any).smsHistory = (window as any).smsHistory.slice(0, 100);
        localStorage.setItem("smsHistory", JSON.stringify((window as any).smsHistory));
        (window as any).updateSmsHistoryDisplay();
      };

      (window as any).updateSmsHistoryDisplay = function () {
        const historyDiv = document.getElementById("smsHistory");
        if (!historyDiv) return;
        const arr = (window as any).smsHistory as any[];
        if (!arr.length) {
          historyDiv.innerHTML =
            '<p style="color:#666;text-align:center;margin:20px 0;font-style:italic;">送信履歴はここに表示されます</p>';
          return;
        }
        historyDiv.innerHTML = arr
          .map((item) => {
            const map: any = {
              success: { icon: "✅", color: "#388e3c", bg: "#e8f5e8" },
              failed: { icon: "❌", color: "#d32f2f", bg: "#ffeaea" },
              error: { icon: "💥", color: "#ff9800", bg: "#fff3e0" },
            };
            const m = map[item.status] || { icon: "❓", color: "#666", bg: "#f5f5f5" };
            return `
            <div style="border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:12px;background:linear-gradient(135deg,#fff 0%,${m.bg} 100%);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                <div style="flex:1;">
                  <div style="font-weight:bold;font-size:1.05em;color:#333;margin-bottom:4px;">📱 ${item.phone}</div>
                  <div style="color:#666;font-size:.95em;line-height:1.4;margin-bottom:6px;">${item.message}</div>
                </div>
                <div style="display:flex;align-items:center;background:#fff;padding:4px 8px;border-radius:12px;border:1px solid ${m.color};color:${m.color};font-weight:600;font-size:.85em;">
                  ${m.icon} ${String(item.status).toUpperCase()}
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid #f0f0f0;font-size:.8em;color:#888;">
                <span>🕒 ${item.timestamp}</span>
                ${item.statusInfo ? `<span style="color:${item.status === "success" ? "#388e3c" : "#d32f2f"};font-weight:500;">${item.statusInfo}</span>` : ""}
              </div>
            </div>`;
          })
          .join("");
      };

      (window as any).clearSmsHistory = function () {
        if (confirm("送信履歴をすべて削除しますか？")) {
          (window as any).smsHistory = [];
          localStorage.removeItem("smsHistory");
          (window as any).updateSmsHistoryDisplay();
        }
      };

      // ======== RPA（保留：只有你切到 RPA 面板才触发） ========
      (window as any).rpaStatus = { isRunning: false, processId: null, startTime: null as any, logs: [] as any[] };
      (window as any).getStatusText = function (s: string) {
        const m: any = { running: "🟢 実行中", completed: "✅ 完了", error: "❌ エラー", stopped: "🛑 停止", not_running: "⚫ 停止中" };
        return m[s] || s;
      };
      (window as any).startStatusPolling = function () {
        if ((window as any)._statusPollingInterval) return;
        (window as any)._statusPollingInterval = setInterval(() => {
          if ((window as any).rpaStatus.isRunning) (window as any).refreshRpaStatus?.();
          else (window as any).stopStatusPolling?.();
        }, 5000);
      };
      (window as any).stopStatusPolling = function () {
        if ((window as any)._statusPollingInterval) {
          clearInterval((window as any)._statusPollingInterval);
          (window as any)._statusPollingInterval = null;
        }
      };
      (window as any).refreshRpaStatus = async function () {
        if (!(window as any).currentUser) return;
        const resp = await fetch(`/api/rpa/status/${(window as any).currentUser.uid}`);
        const data = await resp.json();
        if (data.success) {
          const info = document.getElementById("rpaStatusInfo");
          if (info) {
            info.innerHTML = `
              <div>状態: ${(window as any).getStatusText(data.status)}</div>
              <div>開始時間: ${data.startTime ? new Date(data.startTime).toLocaleString() : "-"}</div>
              ${data.endTime ? `<div>終了時間: ${new Date(data.endTime).toLocaleString()}</div>` : ""}
              <div>ログ件数: ${data.logCount || 0}件</div>
              ${data.error ? `<div style="color:red;">エラー: ${data.error}</div>` : ""}
            `;
          }
          if (["completed", "error"].includes(data.status)) {
            (window as any).rpaStatus.isRunning = false;
            (window as any).stopStatusPolling();
          }
        }
      };
      (window as any).showRpaLogs = async function () {
        if (!(window as any).currentUser) return;
        const resp = await fetch(`/api/rpa/logs/${(window as any).currentUser.uid}?limit=100`);
        const data = await resp.json();
        if (data.success) {
          const w = window.open("", "rpaLogs", "width=900,height=700,scrollbars=yes");
          if (!w) return;
          w.document.write(`
            <html><head><title>RPA ログ</title></head>
            <body style="font-family:monospace;padding:16px;background:#f5f5f5;">
              <h2>🔍 RPA 実行ログ</h2>
              <div style="margin:8px 0;">総ログ数: ${data.totalLogs}</div>
              <hr>
              ${data.logs
                .map(
                  (log: any) => `
                <div style="margin:4px 0;padding:8px;background:${log.type === "stderr" ? "#ffe6e6" : "#fff"};border-left:3px solid ${
                    log.type === "stderr" ? "#dc3545" : "#28a745"
                  };">
                  <div style="font-size:.8em;color:#666;">${new Date(log.timestamp).toLocaleString()} [${log.type.toUpperCase()}]</div>
                  <pre style="margin:4px 0;white-space:pre-wrap;">${log.message}</pre>
                </div>`
                )
                .join("")}
            </body></html>
          `);
        }
      };

      // ======== 退出登录 ========
      (window as any).handleLogout = async function () {
        if (confirm("ログアウトしますか？")) {
          await (window as any).FirebaseAPI.logoutUser();
          router.replace("/login");
        }
      };

      // 小调试
      (window as any).checkUserStatus = function () {
        console.log("=== ユーザー状態チェック ===");
        console.log("window.currentUser:", (window as any).currentUser);
        console.log("auth.currentUser:", (window as any).auth?.currentUser);
      };
      setTimeout(() => (window as any).checkUserStatus(), 2000);
    })();
  }, [router]);

  // 进入 RPA 面板时做一次初始化
  useEffect(() => {
    if (activePanel === "rpa") {
      (window as any).initializeRpaStatus?.();
      (window as any).loadRpaConfig?.();
    }
  }, [activePanel]);

  // 首次渲染后：初始化短信历史 / 健康检查，并开启轮询
  useEffect(() => {
    (window as any).updateSmsHistoryDisplay?.();
    (window as any).checkServerConnection?.();
    const t = setInterval(() => (window as any).checkServerConnection?.(), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="brand">
          <span className="brand-title">🤖 XXX XXXX</span>
        </div>
        <div className="user-info">
          <span id="userEmail">読み込み中...</span>
          <button id="logoutBtn" onClick={() => (window as any).handleLogout()}>ログアウト</button>
        </div>
      </header>

      <div className="main-wrapper">
        {/* Sidebar */}
        <nav className="sidebar">
          <ul className="nav-menu">
            <li><button type="button" className={activePanel === "mail" ? "active" : ""} onClick={() => switchPanel("mail")}>アカウント設定</button></li>
            <li><button type="button" className={activePanel === "api" ? "active" : ""} onClick={() => switchPanel("api")}>SMS設定</button></li>
            <li><button type="button" className={activePanel === "rpa" ? "active" : ""} onClick={() => switchPanel("rpa")}>RPA実行</button></li>
            <li><button type="button" className={activePanel === "sms" ? "active" : ""} onClick={() => switchPanel("sms")}>個別送信テスト用</button></li>
          </ul>
        </nav>

        {/* Content */}
        <section className="main-content">
          {/* 账号设置 */}
          <div className={`content-panel ${activePanel === "mail" ? "active" : ""}`} id="panelMail">
            <div className="panel-header">
              <h2 className="panel-title">📧 アカウント設定</h2>
              <p className="panel-description">RPA自動化に必要なアカウント情報を設定してください（3項目のみ）</p>
            </div>
            <form className="ai-form" onSubmit={(e: any) => (window as any).saveAccountConfig(e)}>
              <label htmlFor="emailAddress">📬 メールアドレス</label>
              <input type="email" id="emailAddress" name="emailAddress" placeholder="example@gmail.com" required autoComplete="off" />
              <div className="ai-hint">RPAが監視するGmailアドレス（Indeed求人メール受信用）</div>

              <label htmlFor="emailAppPassword">🔑 Gmailアプリパスワード</label>
              <input type="password" id="emailAppPassword" name="appPassword" placeholder="16文字のアプリパスワード" required />
              <div className="ai-hint">Google設定→セキュリティ→2段階認証→アプリパスワードで生成</div>

              <label htmlFor="sitePassword">🌐 Indeedログインパスワード</label>
              <input type="password" id="sitePassword" name="sitePassword" placeholder="Indeedアカウントのパスワード" required />
              <div className="ai-hint">Indeed求人サイトにログインするためのパスワード</div>

              <button type="submit">💾 アカウント設定を保存</button>
            </form>
            <div id="accountStatus" className="ai-hint" style={{ marginTop: 16, minHeight: 20 }} />
          </div>

          {/* SMS 设置 */}
          <div className={`content-panel ${activePanel === "api" ? "active" : ""}`} id="panelApi">
            <div className="panel-header">
              <h2 className="panel-title">📱 SMS設定</h2>
              <p className="panel-description">
                SMS送信API設定とメッセージテンプレートを設定してください（5項目必須）<br />
                <small>対応API: SMS Console、Twilio、その他HTTP API提供商</small>
              </p>
            </div>
            <form className="ai-form" onSubmit={(e: any) => (window as any).saveSmsConfig(e)}>
              <label htmlFor="smsApiUrl">🌐 SMS API URL</label>
              <input type="url" id="smsApiUrl" name="smsApiUrl" placeholder="https://www.sms-console.jp/api/ ..." required autoComplete="off" />
              <div className="ai-hint">各社のSMS API提供商のエンドポイントURL</div>

              <label htmlFor="smsApiId">🔑 SMS API ID / ユーザー名</label>
              <input type="text" id="smsApiId" name="smsApiId" placeholder="sm000206_user / ACxxxxxxxx (Twilio)" required autoComplete="off" />
              <div className="ai-hint">アカウントID / Account SID</div>

              <label htmlFor="smsApiPassword">🔐 SMS API パスワード / トークン</label>
              <input type="password" id="smsApiPassword" name="smsApiPassword" placeholder="API パスワード / Auth Token" required />
              <div className="ai-hint">認証用のパスワード/トークン</div>

              <label htmlFor="smsTextA">📄 SMSテンプレートA</label>
              <textarea id="smsTextA" name="smsTextA" rows={4} required />

              <label htmlFor="smsTextB">📝 SMSテンプレートB</label>
              <textarea id="smsTextB" name="smsTextB" rows={4} required />

              <button type="submit">💾 SMS設定を保存</button>
            </form>
            <div id="smsStatus" className="ai-hint" style={{ marginTop: 16, minHeight: 20 }} />
          </div>

          {/* SMS 发送 */}
          <div className={`content-panel ${activePanel === "sms" ? "active" : ""}`} id="panelSms">
            <div className="panel-header">
              <h2 className="panel-title">📱 SMS送信</h2>
              <p className="panel-description">個別にSMSを送信できます。</p>
            </div>

            <div id="connectionStatus" style={{ marginBottom: 16, padding: 8, borderRadius: 4, fontSize: 12 }}>
              <span id="statusText">🔍 サーバー接続状態をチェック中...</span>
            </div>

            <form className="ai-form" onSubmit={(e: any) => (window as any).sendIndividualSms(e)}>
              <label htmlFor="recipientPhone">📞 送信先電話番号</label>
              <input type="tel" id="recipientPhone" name="recipientPhone" placeholder="+8190..." required pattern="^(\+81|0)?[0-9]{10,11}$" />

              <label htmlFor="smsContent">💬 送信メッセージ</label>
              <textarea id="smsContent" name="smsContent" rows={6} maxLength={670} required />

              <div style={{ margin: "16px 0" }}>
                <label>
                  <input type="checkbox" id="useTemplate" onChange={() => (window as any).toggleTemplate()} />
                  既存のテンプレートを使用
                </label>
              </div>

              <div id="templateSelector" style={{ display: "none", marginBottom: 16 }}>
                <button type="button" onClick={() => (window as any).loadTemplate("A")} className="btnA">📄 テンプレートA</button>
                <button type="button" onClick={() => (window as any).loadTemplate("B")} className="btnB">📝 テンプレートB</button>
              </div>

              <button type="submit" className="btnSend">📤 SMS送信</button>
            </form>

            <div id="smsResult" className="ai-hint" style={{ marginTop: 16, minHeight: 20 }} />
            <div style={{ marginTop: 32 }}>
              <h3 style={{ color: "#6f8333", marginBottom: 16 }}>📋 送信履歴</h3>
              <div id="smsHistory" className="historyBox">
                <p className="historyEmpty">送信履歴はここに表示されます</p>
              </div>
              <button type="button" onClick={() => (window as any).clearSmsHistory()} className="btnClear">履歴をクリア</button>
            </div>
          </div>

          {/* RPA 执行（保留） */}
          <div className={`content-panel ${activePanel === "rpa" ? "active" : ""}`} id="panelRpa">
            <div className="panel-header"><h2 className="panel-title">RPA実行</h2></div>

            <div className="config-status">
              <h3 style={{ marginBottom: 16, color: "#8c9569", fontSize: "1.1rem" }}>現在の設定状況</h3>
              <div id="configDisplay" className="config-display">
                {[
                  { id: "emailStatus", label: "📧 メール" },
                  { id: "smsApiStatus", label: "📱 SMS API" },
                  { id: "apiIdStatus", label: "🔑 API ID" },
                  { id: "apiPasswordStatus", label: "🔐 API パスワード" },
                  { id: "templateAStatus", label: "📄 テンプレートA" },
                  { id: "templateBStatus", label: "📝 テンプレートB" },
                ].map((x) => (
                  <div className="config-item" key={x.id}>
                    <span className="icon">{x.label.split(" ")[0]}</span>
                    <span>
                      {x.label.split(" ")[1]}: <span id={x.id}>読み込み中...</span>
                    </span>
                    <span className="status-icon"></span>
                  </div>
                ))}
              </div>
            </div>

            <button
              className="btn btn-primary"
              onClick={() => (window as any).executeRpa?.()}
              style={{ marginTop: 20, padding: "12px 30px", fontSize: "1.1rem" }}
            >
              🚀 RPA実行
            </button>
            <div id="rpaResult" className="result-display" style={{ marginTop: 20, display: "none" }} />
            <div className="ai-hint" style={{ marginTop: 24 }}>RPA実行前に、アカウント設定とSMS API設定が完了していることを確認してください。</div>
          </div>
        </section>
      </div>

      {/* 内联样式 */}
      <style jsx>{`
        *{box-sizing:border-box}
        body{background:#f8faef}
        .container{min-height:100vh;display:flex;flex-direction:column}
        .header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#fff;border-bottom:1px solid #eee}
        .brand-title{font-weight:700;color:#6f8333}
        .user-info button{margin-left:12px;padding:6px 10px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer}
        .main-wrapper{display:flex;min-height:calc(100vh - 56px)}
        .sidebar{width:220px;background:#f6f7f2;border-right:1px solid #e6e8d9;padding:16px}
        .nav-menu{list-style:none;padding:0;margin:0}
        .nav-menu li{margin-bottom:8px}
        .nav-menu button{display:block;width:100%;text-align:left;padding:10px 12px;border-radius:8px;color:#43503a;background:transparent;border:none;cursor:pointer}
        .nav-menu button.active,.nav-menu button:hover{background:#e9eedb}
        .main-content{flex:1;padding:24px}
        .panel-header{margin-bottom:16px}
        .panel-title{color:#6f8333;margin:0}
        .panel-description{color:#666;margin:6px 0 0}
        .ai-form{display:flex;flex-direction:column;gap:10px;background:#fff;padding:16px;border:1px solid #e6e8d9;border-radius:12px}
        .ai-form input,.ai-form textarea{border:2px solid #e8eae0;border-radius:8px;padding:10px;background:#fafbf7;color:#43503a}
        .ai-form button{padding:10px 12px;background:linear-gradient(135deg,#6f8333 0%,#8fa446 100%);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer}
        .ai-hint{font-size:12px;color:#666;margin-top:4px}
        .content-panel{display:none}
        .content-panel.active{display:block}
        .config-display{background:#fff;border:1px solid #e6e8d9;border-radius:12px;padding:12px}
        .config-item{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #eee}
        .config-item:last-child{border-bottom:none}
        .status-icon{min-width:24px;text-align:right}
        .historyBox{max-height:400px;overflow-y:auto;border:1px solid #e8eae0;border-radius:12px;padding:16px;background:#fafafa;box-shadow:inset 0 1px 3px rgba(0,0,0,.1)}
        .historyEmpty{color:#666;text-align:center;margin:20px 0;font-style:italic}
        .btnA{margin-right:8px;padding:6px 12px;background:#6f8333;color:#fff;border:none;border-radius:4px;cursor:pointer}
        .btnB{padding:6px 12px;background:#8fa446;color:#fff;border:none;border-radius:4px;cursor:pointer}
        .btnSend{background:linear-gradient(135deg,#6f8333 0%,#8fa446 100%);color:#fff;font-weight:bold}
        .btnClear{margin-top:8px;margin-right:8px;padding:4px 8px;background:#dc3545;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px}
        .result-display{background:#fff;border:1px solid #e6e8d9;border-radius:12px;padding:12px}
        .result-display.success{border-color:#a5d6a7;background:#e8f5e9}
        .result-display.error{border-color:#ef9a9a;background:#ffebee}
        @media (max-width:960px){
          .main-wrapper{flex-direction:column}
          .sidebar{width:auto;display:flex;overflow-x:auto}
          .nav-menu{display:flex;gap:8px}
        }
      `}</style>
    </div>
  );
}
