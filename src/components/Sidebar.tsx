import React from "react";

type SidebarProps = {
  activePanel: "mail" | "api" | "rpa" | "sms";
  switchPanel: (panel: "mail" | "api" | "rpa" | "sms") => void;
};

const Sidebar: React.FC<SidebarProps> = ({ activePanel, switchPanel }) => (
  <nav className="sidebar">
    <ul className="nav-menu">
      <li>
        <button
          type="button"
          className={activePanel === "mail" ? "active" : ""}
          onClick={() => switchPanel("mail")}
        >
          アカウント設定
        </button>
      </li>
      <li>
        <button
          type="button"
          className={activePanel === "api" ? "active" : ""}
          onClick={() => switchPanel("api")}
        >
          SMS設定
        </button>
      </li>
      <li>
        <button
          type="button"
          className={activePanel === "rpa" ? "active" : ""}
          onClick={() => switchPanel("rpa")}
        >
          RPA実行
        </button>
      </li>
      <li>
        <button
          type="button"
          className={activePanel === "sms" ? "active" : ""}
          onClick={() => switchPanel("sms")}
        >
          個別送信テスト用
        </button>
      </li>
    </ul>
    <style jsx>{`
      .sidebar {
        width: 220px;
        background: #f6f7f2;
        border-right: 1px solid #e6e8d9;
        padding: 16px;
      }
      .nav-menu {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .nav-menu li {
        margin-bottom: 8px;
      }
      .nav-menu button {
        display: block;
        width: 100%;
        text-align: left;
        padding: 10px 12px;
        border-radius: 8px;
        color: #43503a;
        background: transparent;
        border: none;
        cursor: pointer;
      }
      .nav-menu button.active,
      .nav-menu button:hover {
        background: #e9eedb;
      }
      @media (max-width: 960px) {
        .sidebar {
          width: auto;
          display: flex;
          overflow-x: auto;
        }
        .nav-menu {
          display: flex;
          gap: 8px;
        }
      }
    `}</style>
  </nav>
);

export default Sidebar;
