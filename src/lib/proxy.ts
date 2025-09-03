export const RPA_BASE_URL =
  process.env.RPA_BASE_URL?.replace(/\/+$/,"") || "";

export function assertRpaBaseUrl() {
  if (!RPA_BASE_URL) {
    throw new Error("RPA_BASE_URL is not set. Put it in .env.local (e.g. http://localhost:8888)");
  }
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