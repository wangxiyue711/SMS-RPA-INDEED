import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";
import axios from "axios";
import url from "url";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userUid = url.searchParams.get("userUid");
    const limit = Number(url.searchParams.get("limit") || "500");
    if (!userUid)
      return NextResponse.json(
        { success: false, error: "missing userUid" },
        { status: 400 }
      );

    const colRef = adminDb
      .collection("rpa_history")
      .doc(String(userUid))
      .collection("entries");

    const snap = await colRef.orderBy("createdAt", "desc").limit(limit).get();
    const items: any[] = [];
    snap.forEach((d: any) => items.push({ id: d.id, ...d.data() }));

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userUid = body.userUid;
    const results = body.results || [];
    if (!userUid)
      return NextResponse.json(
        { success: false, error: "missing userUid" },
        { status: 400 }
      );

    // 读取用户 SMS 配置（一次性读取，循环中使用）
    const userCfgSnap = await adminDb
      .collection("user_configs")
      .doc(String(userUid))
      .get();
    const smsConfig: any =
      userCfgSnap.exists && userCfgSnap.data()
        ? (userCfgSnap.data() || {}).sms_config || {}
        : {};

    // SMS 工具函数（与 /api/sms/send/route.ts 保持一致）
    function onlyDigits(s = "") {
      return (s || "").replace(/\D/g, "");
    }
    function toLocalJP(num: string) {
      const raw = onlyDigits(num);
      if (raw.startsWith("81")) return "0" + raw.slice(2);
      if (raw.startsWith("0")) return raw;
      return num;
    }
    function to81FromLocal(local: string) {
      const raw = onlyDigits(local);
      if (raw.startsWith("0")) return "81" + raw.slice(1);
      if (raw.startsWith("81")) return raw;
      return raw;
    }
    function genReqId() {
      return "REQ" + Date.now();
    }

    const docRef = adminDb
      .collection("rpa_history")
      .doc(String(userUid))
      .collection("entries");
    const batch = adminDb.batch ? adminDb.batch() : null;

    const now = Date.now();
    const saved: any[] = [];
    for (const r of results) {
      const docId = String(now) + "-" + Math.random().toString(36).slice(2, 9);
      // 优先依赖脚本返回的 should_send_sms（如果存在），否则用后端简易规则兜底
      const phoneRaw = (r.phone || r["電話番号"] || "") as string;
      const phoneDigits = (phoneRaw || "").replace(/[^0-9]/g, "");
      const ageVal = (() => {
        const a = r.age || r["__標準_年齢__"] || r["age"] || "";
        const n =
          typeof a === "number"
            ? a
            : parseInt(String(a).replace(/[^0-9]/g, ""), 10);
        return Number.isFinite(n) ? n : null;
      })();
      const backend_is_sms_target =
        phoneDigits.length >= 7 && (ageVal === null || ageVal >= 18);
      const script_declared =
        typeof r.should_send_sms !== "undefined" ? !!r.should_send_sms : null;
      const is_sms_target =
        script_declared === null ? backend_is_sms_target : script_declared;

      const payload: any = {
        createdAt: now,
        name: r.name || r["姓名（ふりがな）"] || "",
        phone: phoneRaw,
        gender: r.gender || r["性別"] || "",
        birth: r.birth || r["生年月日"] || "",
        age:
          r.age ||
          r["__標準_年齢__"] ||
          (ageVal !== null ? String(ageVal) : ""),
        is_sms_target,
        level: r.level || "success",
        raw: r,
      };

      // 若为 SMS 目标并且用户有配置 SMS 提供商，则尝试发送短信
      if (is_sms_target) {
        try {
          const apiUrl = String(smsConfig.api_url || "").trim();
          const apiId = String(smsConfig.api_id || "").trim();
          const apiPass = String(smsConfig.api_password || "").trim();
          if (apiUrl && apiId && apiPass) {
            const useReport =
              smsConfig.use_delivery_report === true ||
              smsConfig.use_delivery_report === "1" ||
              smsConfig.use_delivery_report === 1;

            const localNum = toLocalJP(phoneRaw);

            const smsTextA = (smsConfig.sms_text_a || "").trim();
            const smsTextB = (smsConfig.sms_text_b || "").trim();
            // 构造消息规则：
            // - 仅当模板中显式包含占位符（如 {name}, {{name}}, $name, %NAME%）时把姓名替换进模板
            // - 否则按模板原样拼接（避免无端插入姓名）
            const namePart = payload.name ? String(payload.name).trim() : "";
            function renderWithNameIfNeeded(tpl: string) {
              if (!tpl) return "";
              const placeholderRE =
                /\{\{\s*name\s*\}\}|\{\s*name\s*\}|\$name|%NAME%/i;
              if (placeholderRE.test(tpl)) {
                return tpl.replace(
                  /\{\{\s*name\s*\}\}|\{\s*name\s*\}|\$name|%NAME%/gi,
                  namePart
                );
              }
              return tpl;
            }

            const aRendered = renderWithNameIfNeeded(smsTextA);
            const bRendered = renderWithNameIfNeeded(smsTextB);
            let message = [aRendered, bRendered]
              .filter(Boolean)
              .join(" ")
              .trim();
            // 如果模板均为空但有姓名，则使用一个默认问候
            if (!message && namePart) message = `こんにちは。${namePart}`;

            // 发送函数（与 /api/sms/send 保持一致行为）
            async function postOnce(mobile: string) {
              const bodyForm = new URLSearchParams();
              bodyForm.set("mobilenumber", mobile);
              bodyForm.set("smstext", (message || "").replace(/&/g, "＆"));
              if (useReport) {
                bodyForm.set("status", "1");
                bodyForm.set("smsid", genReqId());
              }

              const fixieUrl = process.env.FIXIE_URL
                ? url.parse(process.env.FIXIE_URL)
                : null;
              const fixieAuth =
                fixieUrl && fixieUrl.auth ? fixieUrl.auth.split(":") : [];
              const proxyConfig = fixieUrl
                ? {
                    protocol: (fixieUrl.protocol || "http:").replace(
                      ":",
                      ""
                    ) as "http" | "https",
                    host: fixieUrl.hostname || "",
                    port: Number(fixieUrl.port) || 80,
                    auth: {
                      username: fixieAuth[0] || "",
                      password: fixieAuth[1] || "",
                    },
                  }
                : undefined;

              const axiosConfig = {
                headers: {
                  Authorization:
                    "Basic " +
                    Buffer.from(`${apiId}:${apiPass}`).toString("base64"),
                  "Content-Type":
                    "application/x-www-form-urlencoded; charset=UTF-8",
                  "User-Agent": "nextjs-fetch/1.0",
                  Connection: "close",
                },
                proxy: proxyConfig,
                timeout: 15000,
              } as any;

              let resp: any, text: string;
              try {
                const r = await axios.post(
                  apiUrl,
                  bodyForm.toString(),
                  axiosConfig
                );
                text =
                  typeof r.data === "string" ? r.data : JSON.stringify(r.data);
                resp = { ok: true, status: r.status };
              } catch (err: any) {
                if (err.response) {
                  resp = { ok: false, status: err.response.status };
                  text =
                    typeof err.response.data === "string"
                      ? err.response.data
                      : JSON.stringify(err.response.data);
                } else {
                  resp = { ok: false, status: 500 };
                  text = err.message || "Unknown error";
                }
              }
              return { resp, text };
            }

            // 先试本地格式
            let sendRes = await postOnce(localNum);
            // 若返回特定号码无效代码（560），再试 81 格式
            if (sendRes.resp && sendRes.resp.status === 560) {
              const alt = to81FromLocal(localNum);
              const retry = await postOnce(alt);
              sendRes = retry;
            }

            payload.sms_sent = !!(sendRes.resp && sendRes.resp.ok);
            payload.sms_response = {
              status: sendRes.resp.status,
              output: String(sendRes.text).slice(0, 4000),
            };
            payload.sms_message = message;
          } else {
            payload.sms_sent = false;
            payload.sms_response = { error: "sms_config_missing" };
          }
        } catch (e: any) {
          payload.sms_sent = false;
          payload.sms_response = { error: String(e?.message || e) };
        }
      }
      try {
        await adminDb
          .collection("rpa_history")
          .doc(String(userUid))
          .collection("entries")
          .doc(docId)
          .set(payload);
        saved.push(payload);
      } catch (e) {
        // ignore per-entry errors
      }
    }

    return NextResponse.json({
      success: true,
      savedCount: saved.length,
      saved,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
