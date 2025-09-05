// src/components/panels/SmsConfigPanel.tsx
"use client";

declare global {
  interface Window {
    saveSmsConfig: (e: any) => Promise<void>;
  }
}

export function SmsConfigPanel() {
  return (
    <>
      <div className="panel-header">
        <h2 className="panel-title">📱 SMS設定</h2>
        <p className="panel-description">
          SMS送信API設定とメッセージテンプレートを設定してください（5項目必須）
          <br />
          <small>対応API: SMS Console、Twilio、その他HTTP API提供商</small>
        </p>
      </div>
      <form className="ai-form" onSubmit={(e: any) => window.saveSmsConfig(e)}>
        <label htmlFor="smsApiUrl">🌐 SMS API URL</label>
        <input
          type="url"
          id="smsApiUrl"
          name="smsApiUrl"
          placeholder="https://www.sms-console.jp/api/ ..."
          required
          autoComplete="off"
        />
        <div className="ai-hint">各社のSMS API提供商のエンドポイントURL</div>

        <label htmlFor="smsApiId">🔑 SMS API ID / ユーザー名</label>
        <input
          type="text"
          id="smsApiId"
          name="smsApiId"
          placeholder="sm000206_user / ACxxxxxxxx (Twilio)"
          required
          autoComplete="off"
        />
        <div className="ai-hint">アカウントID / Account SID</div>

        <label htmlFor="smsApiPassword">🔐 SMS API パスワード / トークン</label>
        <input
          type="password"
          id="smsApiPassword"
          name="smsApiPassword"
          placeholder="API パスワード / Auth Token"
          required
        />
        <div className="ai-hint">認証用のパスワード/トークン</div>

        <label htmlFor="smsTextA">📄 SMSテンプレートA</label>
        <textarea id="smsTextA" name="smsTextA" rows={4} required />

        <label htmlFor="smsTextB">📝 SMSテンプレートB</label>
        <textarea id="smsTextB" name="smsTextB" rows={4} required />

        <button type="submit">💾 SMS設定を保存</button>
      </form>
      <div
        id="smsStatus"
        className="ai-hint"
        style={{ marginTop: 16, minHeight: 20 }}
      />
    </>
  );
}
