export const RPA_BASE_URL =
  process.env.RPA_BASE_URL?.replace(/\/+$/,"") || "";

export function assertRpaBaseUrl() {
  // 新逻辑：不再要求 .env.local 设置 RPA_BASE_URL
  return; // 什么也不做
}


export async function proxyJSON(path: string, init?: RequestInit): Promise<Response> {
  assertRpaBaseUrl();
  const url = `${RPA_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: init?.method || "GET",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    body: init?.body,
    cache: "no-store",
  });
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}