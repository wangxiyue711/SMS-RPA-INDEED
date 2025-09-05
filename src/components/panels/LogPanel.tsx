// src/components/panels/LogPanel.tsx
"use client";

import { SmsHistoryTable } from "../SmsHistoryTable";

export function LogPanel() {
  return (
    <>
      <div className="panel-header">
        <h2 className="panel-title">📑 ログ</h2>
        <p className="panel-description">送信履歴（SMS送信ログ）</p>
      </div>
      <SmsHistoryTable />
    </>
  );
}
