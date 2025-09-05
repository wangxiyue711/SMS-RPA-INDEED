// src/components/panels/RpaPanel.tsx
"use client";

declare global {
  interface Window {
    executeRpa?: () => Promise<void>;
  }
}

export function RpaPanel() {
  return (
    <>
      <div className="panel-header">
        <h2 className="panel-title">RPA実行</h2>
      </div>

      <div className="config-status">
        <h3
          style={{
            marginBottom: 16,
            color: "#8c9569",
            fontSize: "1.1rem",
          }}
        >
          現在の設定状況
        </h3>
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
        onClick={() => window.executeRpa?.()}
        style={{
          marginTop: 20,
          padding: "12px 30px",
          fontSize: "1.1rem",
        }}
      >
        🚀 RPA実行
      </button>
      <div
        id="rpaResult"
        className="result-display"
        style={{ marginTop: 20, display: "none" }}
      />
      <div className="ai-hint" style={{ marginTop: 24 }}>
        RPA実行前に、アカウント設定とSMS
        API設定が完了していることを確認してください。
      </div>
    </>
  );
}
