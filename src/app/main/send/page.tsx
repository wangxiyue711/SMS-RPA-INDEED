// src/app/main/send/page.tsx
"use client";

import React, { useEffect } from "react";
import { resolveSmsResult } from "@/lib/smsCodes";

/**
 * /main/send —— 個別送信（单条短信发送）
 * - Header / Sidebar / 登录守卫由 /main/layout.tsx 提供
 * - 本页只负责：发送表单 + 结果提示
 * - 履歴展示已迁到 /main/history；本页仍会把简要记录写入 localStorage，供“実行履歴”聚合页使用
 */
export default function IndividualSendPage() {
  useEffect(() => {
    const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

    // ===== 仅保留一个发送函数（使用码表统一判定）=====
    (window as any).sendIndividualSms = async function (e: any) {
      e.preventDefault();
      const phone = (
        document.getElementById("recipientPhone") as HTMLInputElement
      ).value.trim();
      const message = (
        document.getElementById("smsContent") as HTMLTextAreaElement
      ).value.trim();
      const resultDiv = $("smsResult")!;

      if (!(window as any).currentUser) {
        resultDiv.innerHTML =
          '<span style="color:#d32f2f;">❌ ユーザーがログインしていません</span>';
        return;
      }

      try {
        resultDiv.innerHTML =
          '<span style="color:#1976d2;">📤 SMS送信中...</span>';

        const resp = await fetch(`/api/sms/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userUid: (window as any).currentUser.uid,
            phone,
            message,
          }),
        });

        // 解析站内 API 返回
        const data = await resp.json().catch(() => ({}));

        // 推断供应商
        let provider = "sms-console";
        try {
          const cfg = await (window as any).FirebaseAPI.getUserConfig?.();
          provider =
            cfg?.sms_config?.provider ||
            (window as any).FirebaseAPI?.detectProvider?.(
              cfg?.sms_config?.api_url || ""
            ) ||
            "sms-console";
        } catch {}

        // 统一判定（优先响应体中的 code / status；没有就用 HTTP status）
        const resolved = resolveSmsResult(
          provider,
          data?.code ??
            data?.status ??
            data?.result ??
            data?.output ??
            data?.details ??
            data,
          resp.status
        );

        // UI 提示
        const color =
          resolved.level === "success"
            ? "#388e3c"
            : resolved.level === "failed"
            ? "#d32f2f"
            : "#ff9800";
        resultDiv.innerHTML = `<span style="color:${color};">${
          resolved.level === "success"
            ? "✅"
            : resolved.level === "failed"
            ? "❌"
            : "💥"
        } ${resolved.message}</span>`;

        // 轻量写入 localStorage（供 /main/history 聚合页读取）
        try {
          const entry = {
            timestamp: new Date().toLocaleString("ja-JP"),
            phone,
            message:
              message.substring(0, 50) + (message.length > 50 ? "..." : ""),
            status:
              resolved.level === "success"
                ? "success"
                : resolved.level === "failed"
                ? "failed"
                : "error",
            statusInfo: resolved.message,
          };
          let arr;
          try {
            arr = JSON.parse(localStorage.getItem("smsHistory") || "[]");
          } catch {
            arr = [];
          }
          if (!Array.isArray(arr)) {
            arr = [];
          }
          arr.unshift(entry);
          if (arr.length > 100) arr.length = 100;
          localStorage.setItem("smsHistory", JSON.stringify(arr));
        } catch {
          /* 忽略本地写入错误 */
        }

        // 成功后清空表单
        if (resolved.level === "success") {
          (
            document.getElementById("recipientPhone") as HTMLInputElement
          ).value = "";
          (document.getElementById("smsContent") as HTMLTextAreaElement).value =
            "";
          const ck = document.getElementById("useTemplate") as HTMLInputElement;
          if (ck) {
            ck.checked = false;
            (window as any).toggleTemplate?.();
          }
        }
      } catch (e: any) {
        const msg = `接続エラー: ${e.message}`;
        $(
          "smsResult"
        )!.innerHTML = `<span style="color:#d32f2f;">❌ ${msg}</span>`;
        // 也写一条本地记录，方便在 history 页看到错误
        try {
          let arr;
          try {
            arr = JSON.parse(localStorage.getItem("smsHistory") || "[]");
          } catch {
            arr = [];
          }
          if (!Array.isArray(arr)) {
            arr = [];
          }
          const entry = {
            timestamp: new Date().toLocaleString("ja-JP"),
            phone: (
              document.getElementById("recipientPhone") as HTMLInputElement
            ).value.trim(),
            message: (
              document.getElementById("smsContent") as HTMLTextAreaElement
            ).value
              .trim()
              .substring(0, 50),
            status: "error",
            statusInfo: msg,
          };
          arr.unshift(entry);
          if (arr.length > 100) arr.length = 100;
          localStorage.setItem("smsHistory", JSON.stringify(arr));
        } catch {}
      }
    };

    // ===== 模板快捷填充（保留）=====
    (window as any).toggleTemplate = function () {
      const c = $("useTemplate") as HTMLInputElement | null;
      const s = $("templateSelector");
      if (s) s.style.display = c?.checked ? "block" : "none";
    };
    (window as any).loadTemplate = async function (type: "A" | "B") {
      try {
        const FirebaseAPI = (window as any).FirebaseAPI;
        if (!FirebaseAPI?.getUserConfig) {
          alert("設定が未初期化のようです。ページを再読み込みしてください。");
          return;
        }
        const cfg = await FirebaseAPI.getUserConfig();
        const ta = $("smsContent") as HTMLTextAreaElement | null;
        if (!ta) return;
        if (type === "A" && cfg.sms_config?.sms_text_a)
          ta.value = cfg.sms_config.sms_text_a;
        else if (type === "B" && cfg.sms_config?.sms_text_b)
          ta.value = cfg.sms_config.sms_text_b;
        else
          alert(
            `テンプレート${type}が設定されていません。SMS設定で先に設定してください。`
          );
      } catch (e: any) {
        alert("テンプレートの読み込みに失敗しました: " + e.message);
      }
    };

    // ===== 健康检查（保留）=====
    (window as any).checkServerConnection = async function () {
      const statusDiv = $("connectionStatus")!;
      const statusText = $("statusText")!;
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
        statusText.innerHTML =
          "❌ RPAサーバー未接続 - <strong>RPAサイトを起動してください.bat</strong>";
      }
    };

    // 首次渲染：健康检查 + 轮询
    (window as any).checkServerConnection?.();
    const poll = setInterval(
      () => (window as any).checkServerConnection?.(),
      30000
    );
    return () => clearInterval(poll);
  }, []);

  // —— 仅主体内容（Header/Sidebar 由 /main/layout.tsx 提供）——
  return (
    <>
      <div className="panel-header" style={{ marginBottom: 16 }}>
        <h2 className="panel-title" style={{ color: "#6f8333", margin: 0 }}>
          📤 個別送信
        </h2>
        <p
          className="panel-description"
          style={{ color: "#666", margin: "6px 0 0" }}
        >
          個別にSMSを送信できます。
        </p>
      </div>

      <div
        id="connectionStatus"
        style={{
          marginBottom: 16,
          padding: 8,
          borderRadius: 8,
          fontSize: 12,
          background: "#fff",
          border: "1px solid #e6e8d9",
        }}
      >
        <span id="statusText">🔍 サーバー接続状態をチェック中...</span>
      </div>

      <form
        className="ai-form"
        onSubmit={(e: any) => (window as any).sendIndividualSms(e)}
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
        <label htmlFor="recipientPhone">📞 送信先電話番号</label>
        <input
          type="tel"
          id="recipientPhone"
          name="recipientPhone"
          placeholder="+8190..."
          required
          pattern="^(\+81|0)?[0-9]{10,11}$"
          style={{
            border: "2px solid #e8eae0",
            borderRadius: 8,
            padding: 10,
            background: "#fafbf7",
            color: "#43503a",
          }}
        />

        <label htmlFor="smsContent">💬 送信メッセージ</label>
        <textarea
          id="smsContent"
          name="smsContent"
          rows={6}
          maxLength={670}
          required
          style={{
            border: "2px solid #e8eae0",
            borderRadius: 8,
            padding: 10,
            background: "#fafbf7",
            color: "#43503a",
          }}
        />

        <div style={{ margin: "8px 0 4px" }}>
          <label>
            <input
              type="checkbox"
              id="useTemplate"
              onChange={() => (window as any).toggleTemplate()}
            />{" "}
            既存のテンプレートを使用
          </label>
        </div>

        <div id="templateSelector" style={{ display: "none", marginBottom: 6 }}>
          <button
            type="button"
            onClick={() => (window as any).loadTemplate("A")}
            className="btnA"
            style={{
              marginRight: 8,
              padding: "6px 12px",
              background: "#6f8333",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            📄 テンプレートA
          </button>
          <button
            type="button"
            onClick={() => (window as any).loadTemplate("B")}
            className="btnB"
            style={{
              padding: "6px 12px",
              background: "#8fa446",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            📝 テンプレートB
          </button>
        </div>

        <button
          type="submit"
          className="btnSend"
          style={{
            padding: "10px 12px",
            background: "linear-gradient(135deg,#6f8333 0%, #8fa446 100%)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          送信する
        </button>
      </form>

      <div
        id="smsResult"
        className="ai-hint"
        style={{ marginTop: 16, minHeight: 20, fontSize: 12, color: "#666" }}
      />
    </>
  );
}
