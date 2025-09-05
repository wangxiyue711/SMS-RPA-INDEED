// src/components/SmsHistoryTable.tsx
"use client";

import React from "react";

export function SmsHistoryTable() {
  // 清空履历功能
  const clearHistory = () => {
    localStorage.removeItem("smsHistory");
    setHistory([]);
  };

  // CSV导出功能
  const exportCSV = () => {
    if (!history.length) return;
    const header = ["日時", "電話番号", "内容", "状態", "詳細"];
    const rows = history.map((h) => [
      h.timestamp,
      h.phone,
      h.message,
      h.status,
      h.statusInfo || "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sms_history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [history, setHistory] = React.useState<any[]>([]);

  React.useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem("smsHistory") || "[]"));
    } catch {
      setHistory([]);
    }
  }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 16 }}>送信履歴</span>
        <div>
          <button
            onClick={exportCSV}
            className="btnA"
            style={{ marginRight: 8 }}
          >
            CSV出力
          </button>
          <button onClick={clearHistory} className="btnClear">
            履歴をクリア
          </button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
          }}
        >
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "#f6f7f2",
              zIndex: 1,
            }}
          >
            <tr>
              <th
                style={{
                  padding: "12px 8px",
                  borderBottom: "1px solid #e0e0e0",
                  borderTopLeftRadius: 16,
                }}
              >
                日時
              </th>
              <th
                style={{
                  padding: "12px 8px",
                  borderBottom: "1px solid #e0e0e0",
                }}
              >
                電話番号
              </th>
              <th
                style={{
                  padding: "12px 8px",
                  borderBottom: "1px solid #e0e0e0",
                }}
              >
                内容
              </th>
              <th
                style={{
                  padding: "12px 8px",
                  borderBottom: "1px solid #e0e0e0",
                }}
              >
                状態
              </th>
              <th
                style={{
                  padding: "12px 8px",
                  borderBottom: "1px solid #e0e0e0",
                  borderTopRightRadius: 16,
                }}
              >
                詳細
              </th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    color: "#888",
                    textAlign: "center",
                    padding: 40,
                    fontSize: 16,
                  }}
                >
                  送信履歴はありません
                </td>
              </tr>
            ) : (
              history
                .slice()
                .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
                .map((item, idx) => {
                  const statusMap: any = {
                    success: { text: "成功", color: "#388e3c", bg: "#e8f5e8" },
                    failed: { text: "失敗", color: "#d32f2f", bg: "#ffeaea" },
                    error: { text: "異常", color: "#ff9800", bg: "#fff3e0" },
                  };
                  const m = statusMap[item.status] || {
                    text: item.status,
                    color: "#666",
                    bg: "#f5f5f5",
                  };
                  return (
                    <tr
                      key={idx}
                      style={{
                        background: idx % 2 ? "#f7fafd" : "#fff",
                        transition: "background 0.2s",
                        cursor: "pointer",
                      }}
                      onMouseOver={(e) =>
                        (e.currentTarget.style.background = "#eaf2fb")
                      }
                      onMouseOut={(e) =>
                        (e.currentTarget.style.background =
                          idx % 2 ? "#f7fafd" : "#fff")
                      }
                    >
                      <td style={{ padding: "12px 8px", fontSize: 14 }}>
                        {item.timestamp}
                      </td>
                      <td style={{ padding: "12px 8px", fontSize: 14 }}>
                        {item.phone}
                      </td>
                      <td
                        style={{
                          padding: "12px 8px",
                          maxWidth: 220,
                          fontSize: 14,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          cursor: "pointer",
                        }}
                        title={item.message}
                      >
                        {item.message}
                      </td>
                      <td style={{ padding: "12px 8px" }}>
                        <span
                          style={{
                            background: m.bg,
                            color: m.color,
                            borderRadius: 16,
                            padding: "4px 16px",
                            fontWeight: 700,
                            fontSize: 14,
                            boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                            letterSpacing: 1,
                            display: "inline-block",
                          }}
                        >
                          {m.text}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", fontSize: 14 }}>
                        {item.statusInfo || "-"}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
