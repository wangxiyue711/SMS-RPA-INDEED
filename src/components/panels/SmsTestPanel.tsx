// src/components/panels/SmsTestPanel.tsx
"use client";

declare global {
  interface Window {
    sendIndividualSms: (e: any) => Promise<void>;
    toggleTemplate: () => void;
    loadTemplate: (type: "A" | "B") => Promise<void>;
    checkServerConnection: () => Promise<void>;
  }
}

export function SmsTestPanel() {
  return (
    <>
      <div className="panel-header">
        <h2 className="panel-title">📱 SMS送信</h2>
        <p className="panel-description">個別にSMSを送信できます。</p>
      </div>

      <div
        id="connectionStatus"
        style={{
          marginBottom: 16,
          padding: 8,
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        <span id="statusText">🔍 サーバー接続状態をチェック中...</span>
      </div>

      <form
        className="ai-form"
        onSubmit={(e: any) => window.sendIndividualSms(e)}
      >
        <label htmlFor="recipientPhone">📞 送信先電話番号</label>
        <input
          type="tel"
          id="recipientPhone"
          name="recipientPhone"
          placeholder="+8190..."
          required
          pattern="^(\+81|0)?[0-9]{10,11}$"
        />

        <label htmlFor="smsContent">💬 送信メッセージ</label>
        <textarea
          id="smsContent"
          name="smsContent"
          rows={6}
          maxLength={670}
          required
        />

        <div style={{ margin: "16px 0" }}>
          <label>
            <input
              type="checkbox"
              id="useTemplate"
              onChange={() => window.toggleTemplate()}
            />
            既存のテンプレートを使用
          </label>
        </div>

        <div
          id="templateSelector"
          style={{ display: "none", marginBottom: 16 }}
        >
          <button
            type="button"
            onClick={() => window.loadTemplate("A")}
            className="btnA"
          >
            📄 テンプレートA
          </button>
          <button
            type="button"
            onClick={() => window.loadTemplate("B")}
            className="btnB"
          >
            📝 テンプレートB
          </button>
        </div>

        <button type="submit" className="btnSend">
          📤 SMS送信
        </button>
      </form>

      <div
        id="smsResult"
        className="ai-hint"
        style={{ marginTop: 16, minHeight: 20 }}
      />
    </>
  );
}
