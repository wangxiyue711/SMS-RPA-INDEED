// src/components/panels/AccountPanel.tsx
"use client";

declare global {
  interface Window {
    saveAccountConfig: (e: any) => Promise<void>;
  }
}

export function AccountPanel() {
  return (
    <>
      <div className="panel-header">
        <h2 className="panel-title">📧 アカウント設定</h2>
        <p className="panel-description">
          RPA自動化に必要なアカウント情報を設定してください（3項目のみ）
        </p>
      </div>
      <form
        className="ai-form"
        onSubmit={(e: any) => window.saveAccountConfig(e)}
      >
        <label htmlFor="emailAddress">📬 メールアドレス</label>
        <input
          type="email"
          id="emailAddress"
          name="emailAddress"
          placeholder="example@gmail.com"
          required
          autoComplete="off"
        />
        <div className="ai-hint">
          RPAが監視するGmailアドレス（Indeed求人メール受信用）
        </div>

        <label htmlFor="emailAppPassword">🔑 Gmailアプリパスワード</label>
        <input
          type="password"
          id="emailAppPassword"
          name="appPassword"
          placeholder="16文字のアプリパスワード"
          required
        />
        <div className="ai-hint">
          Google設定→セキュリティ→2段階認証→アプリパスワードで生成
        </div>

        <label htmlFor="sitePassword">🌐 Indeedログインパスワード</label>
        <input
          type="password"
          id="sitePassword"
          name="sitePassword"
          placeholder="Indeedアカウントのパスワード"
          required
        />
        <div className="ai-hint">
          Indeed求人サイトにログインするためのパスワード
        </div>

        <button type="submit">💾 アカウント設定を保存</button>
      </form>
      <div
        id="accountStatus"
        className="ai-hint"
        style={{ marginTop: 16, minHeight: 20 }}
      />
    </>
  );
}
