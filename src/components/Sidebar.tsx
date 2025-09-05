"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";

/** 菜单项类型（支持 children） */
export type SidebarItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;            // 提供 href → Link 跳转；否则用 onSelect
  hidden?: boolean;
  children?: SidebarItem[]; // 有 children 即为父级，可折叠
};

export type SidebarProps = {
  items?: SidebarItem[];
  activeKey?: string;               // 当前激活的“子级”或“父级”key
  onSelect?: (key: string) => void; // 单页模式可用
  width?: number;                   // 桌面侧栏宽度（默认 220）
  className?: string;
};

/** 默认菜单（按你的新结构） */
export const DEFAULT_ITEMS: SidebarItem[] = [
  { key: "top", label: "TOP", href: "/main" },
  {
    key: "rpa-group",
    label: "RPA",
    children: [
      { key: "account", label: "アカウント設定 ", href: "/main/account" },
      { key: "sms",     label: "SMS設定 ",       href: "/main/sms" },
      { key: "target",  label: "対象設定  ❌",      href: "/main/target" },
      { key: "rpa",     label: "RPA実行 ❌",       href: "/main/rpa" },
    ],
  },
  { key: "send",    label: "個別送信 ",   href: "/main/send" },
  { key: "history", label: "実行履歴  ",   href: "/main/history" },
  // { key: "admin",   label: "Admin ",     href: "/main/admin" },
];

export default function Sidebar({
  items = DEFAULT_ITEMS,
  activeKey,
  onSelect,
  width = 220,
  className,
}: SidebarProps) {
  /** 哪些父级处于展开状态（默认：包含当前 activeKey 的父级展开） */
  const initiallyOpen = useMemo(() => {
    const map: Record<string, boolean> = {};
    const visit = (nodes: SidebarItem[], parentKey?: string) => {
      nodes.forEach((n) => {
        if (n.children?.length) {
          // 如果 activeKey 命中这个父级的任一子项 → 默认展开
          if (n.children.some((c) => c.key === activeKey)) map[n.key] = true;
          visit(n.children, n.key);
        }
      });
    };
    visit(items);
    return map;
  }, [items, activeKey]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initiallyOpen);
  const toggleGroup = (k: string) => setOpenGroups((s) => ({ ...s, [k]: !s[k] }));

  /** 判断当前父级是否“激活”（当任一子项激活时） */
  const isParentActive = (group: SidebarItem) =>
    !!group.children?.some((c) => c.key === activeKey);

  return (
    <nav
      className={"sidebar" + (className ? ` ${className}` : "")}
      style={{
        width,
        background: "#f6f7f2",
        borderRight: "1px solid #e6e8d9",
        padding: 16,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        zIndex: 10,
      }}
      aria-label="Sidebar"
    >
      <ul className="nav-menu" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.filter(i => !i.hidden).map((item) => {
          const hasChildren = !!item.children?.length;

          // —— 父级（可折叠）——
          if (hasChildren) {
            const opened = !!openGroups[item.key];
            const active = isParentActive(item);
            return (
              <li key={item.key} className="nav-item" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  aria-expanded={opened}
                  aria-haspopup="true"
                  onClick={() => toggleGroup(item.key)}
                  className={active ? "active" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    color: "#43503a",
                    background: active ? "#e9eedb" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    {item.icon} <span>{item.label}</span>
                  </span>
                  <span
                    aria-hidden
                    style={{
                      transition: "transform .2s",
                      transform: opened ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                  >
                    ▶
                  </span>
                </button>

                {opened && (
                  <ul
                    className="submenu"
                    style={{
                      listStyle: "none",
                      margin: "6px 0 0 0",
                      padding: "6px 0 0 10px",
                      borderLeft: "2px solid #e6e8d9",
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    {item.children!.map((child) => {
                      const isActiveChild = activeKey === child.key;
                      const btnStyle: React.CSSProperties = {
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 8,
                        color: "#43503a",
                        background: isActiveChild ? "#e9eedb" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      };

                      return (
                        <li key={child.key} className="submenu-item">
                          {child.href ? (
                            <Link
                              href={child.href}
                              style={{ textDecoration: "none" }}
                              onClick={() => onSelect?.(child.key)}
                            >
                              <div
                                role="button"
                                aria-current={isActiveChild ? "page" : undefined}
                                style={btnStyle}
                                onMouseOver={(e) => (e.currentTarget.style.background = "#e9eedb")}
                                onMouseOut={(e) => (e.currentTarget.style.background = isActiveChild ? "#e9eedb" : "transparent")}
                              >
                                {child.icon} <span>{child.label}</span>
                              </div>
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onSelect?.(child.key)}
                              style={btnStyle}
                              aria-current={isActiveChild ? "page" : undefined}
                              onMouseOver={(e) => (e.currentTarget.style.background = "#e9eedb")}
                              onMouseOut={(e) => (e.currentTarget.style.background = isActiveChild ? "#e9eedb" : "transparent")}
                            >
                              {child.icon} <span>{child.label}</span>
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          }

          // —— 普通单项 —— 
          const isActive = activeKey === item.key;
          const commonBtnStyle: React.CSSProperties = {
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            borderRadius: 8,
            color: "#43503a",
            background: isActive ? "#e9eedb" : "transparent",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
          };

          return (
            <li key={item.key} className="nav-item" style={{ marginBottom: 8 }}>
              {item.href ? (
                <Link
                  href={item.href}
                  style={{ textDecoration: "none" }}
                  onClick={() => onSelect?.(item.key)}
                >
                  <div
                    role="button"
                    aria-current={isActive ? "page" : undefined}
                    style={commonBtnStyle}
                    onMouseOver={(e) => (e.currentTarget.style.background = "#e9eedb")}
                    onMouseOut={(e) => (e.currentTarget.style.background = isActive ? "#e9eedb" : "transparent")}
                  >
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      {item.icon} <span>{item.label}</span>
                    </span>
                  </div>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect?.(item.key)}
                  style={commonBtnStyle}
                  aria-current={isActive ? "page" : undefined}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#e9eedb")}
                  onMouseOut={(e) => (e.currentTarget.style.background = isActive ? "#e9eedb" : "transparent")}
                >
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    {item.icon} <span>{item.label}</span>
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* 响应式：小屏转为吸顶 + 横向滚动，子菜单同样横向滚动 */}
      <style jsx>{`
        @media (max-width: 960px) {
          nav.sidebar {
            width: 100% !important;
            padding: 8px 8px;
            border-right: none;
            border-bottom: 1px solid #e6e8d9;
            background: #f6f7f2;
          }
          nav.sidebar .nav-menu {
            display: flex;
            gap: 8px;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            padding-bottom: 6px;
          }
          nav.sidebar .nav-item {
            flex: 0 0 auto;
            margin-bottom: 0;
          }
          nav.sidebar .submenu {
            border-left: none;
            padding: 8px 0 0 0;
            margin: 4px 0 0 0;
            display: flex;           /* 子菜单一行横向滚动 */
            gap: 8px;
            overflow-x: auto;
          }
          nav.sidebar .submenu-item {
            flex: 0 0 auto;
          }
        }
      `}</style>
    </nav>
  );
}
