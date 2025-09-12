import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";
import { resolveSmsResult } from "../../../../lib/smsCodes";
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
    // 读取用户的 target_rules（如果有），用来决定是否应发送短信
    const userData =
      userCfgSnap.exists && userCfgSnap.data() ? userCfgSnap.data() || {} : {};
    const targetRules: any = userData.target_rules || {};

    function nameMatchesChecks(name: string, checks: any) {
      if (!name || !checks) return null;
      // 去掉括号内的振り仮名/読み仮名等（支持全角和半角括号）
      const sRaw = String(name || "").trim();
      const s = sRaw.replace(/\（.*?\）|\(.*?\)/g, "").trim();
      if (!s) return null;
      const hasKanji = /[\u4e00-\u9fff]/.test(s);
      const hasKatakana = /[\u30A0-\u30FF]/.test(s);
      const hasHiragana = /[\u3040-\u309F]/.test(s);
      // 对英文字母的判断：如果姓或名任一包含英文字母，则视为 alphabet
      const parts = s.split(/\s+/).filter(Boolean);
      const family = parts[0] || "";
      const given = parts[1] || "";
      const hasAlpha = /[A-Za-z]/.test(family) || /[A-Za-z]/.test(given);
      // If any check is true, treat as OR: match if any selected type is present. If none selected, return null (no opinion)
      const anySelected = !!(
        checks.kanji ||
        checks.katakana ||
        checks.hiragana ||
        checks.alphabet
      );
      if (!anySelected) return null;
      if (checks.kanji && hasKanji) return true;
      if (checks.katakana && hasKatakana) return true;
      if (checks.hiragana && hasHiragana) return true;
      if (checks.alphabet && hasAlpha) return true;
      return false;
    }

    function normalizeGender(g: any) {
      if (!g) return null;
      const s = String(g).toLowerCase();
      if (s.includes("男") || s.includes("male")) return "male";
      if (s.includes("女") || s.includes("female")) return "female";
      return null;
    }

    function evaluateByRules(r: any) {
      if (!targetRules) return null;
      const tr = targetRules;
      const nameChecks = tr?.nameChecks || {};
      const ageRules = tr?.age || {};

      // Determine if name rules configured
      const nameConfigured = !!(
        nameChecks &&
        (nameChecks.kanji ||
          nameChecks.katakana ||
          nameChecks.hiragana ||
          nameChecks.alphabet)
      );
      const name = r.name || r["姓名（ふりがな）"] || "";
      const nm = nameMatchesChecks(name, nameChecks);
      const namePass = nameConfigured ? nm === true : true; // if not configured -> pass

      // Gender/age rules
      const gender = normalizeGender(r.gender || r["性別"] || "");
      const ageVal = (() => {
        const a = r.age || r["__標準_年齢__"] || r["age"] || "";
        const n =
          typeof a === "number"
            ? a
            : parseInt(String(a).replace(/[^0-9]/g, ""), 10);
        return Number.isFinite(n) ? n : null;
      })();

      let genderConfigured = false;
      let genderPass = true;
      if (gender && ageRules && ageRules[gender]) {
        const gRuleRaw = ageRules[gender] || {};
        genderConfigured = !!(
          typeof gRuleRaw.include === "boolean" ||
          typeof gRuleRaw.skip === "boolean" ||
          gRuleRaw.min != null ||
          gRuleRaw.max != null
        );

        // determine include flag: prefer explicit include, otherwise if skip exists invert it
        let includeFlag: boolean | null = null;
        if (typeof gRuleRaw.include === "boolean")
          includeFlag = !!gRuleRaw.include;
        else if (typeof gRuleRaw.skip === "boolean")
          includeFlag = !gRuleRaw.skip;

        if (includeFlag === false) genderPass = false;

        const min = gRuleRaw?.min != null ? Number(gRuleRaw.min) : null;
        const max = gRuleRaw?.max != null ? Number(gRuleRaw.max) : null;
        if (min != null || max != null) {
          if (ageVal === null) genderPass = false;
          if (min != null && ageVal != null && ageVal < min) genderPass = false;
          if (max != null && ageVal != null && ageVal > max) genderPass = false;
        }
      }

      const anyRuleConfigured = nameConfigured || genderConfigured;
      if (!anyRuleConfigured) return null;

      // require all configured groups to pass
      if (!namePass) return false;
      if (!genderPass) return false;
      return true;
    }
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

      // Evaluate user-defined rules (null = no opinion, true = allow, false = disallow)
      const ruleDecision = evaluateByRules(r);

      let is_sms_target: boolean;
      if (script_declared !== null) {
        // If script explicitly declared, respect it unless user rules explicitly disallow
        if (ruleDecision === false) {
          is_sms_target = false;
        } else if (ruleDecision === true) {
          is_sms_target = true && script_declared;
        } else {
          is_sms_target = script_declared;
        }
      } else {
        // No script opinion: prefer user rules if present, otherwise fallback to backend simple rule
        if (ruleDecision !== null) {
          is_sms_target = ruleDecision;
        } else {
          is_sms_target = backend_is_sms_target;
        }
      }

      // prepare name variants: raw (may include ふりがな in parentheses), clean (parentheses removed), and furigana extracted
      const rawName = r.name || r["姓名（ふりがな）"] || "";
      const furiganaMatch = String(rawName).match(
        /(?:\(|\（)\s*([^\)\）]+?)\s*(?:\)|\）)\s*$/
      );
      const furigana = furiganaMatch ? furiganaMatch[1].trim() : null;
      const cleanName = String(rawName)
        .replace(/\（.*?\）|\(.*?\)/g, "")
        .trim();

      const payload: any = {
        createdAt: now,
        // `name` keeps the cleaned display name (parentheses removed) for UI display
        name: cleanName || rawName || "",
        // preserve originals for audit and optional display
        name_raw: rawName || "",
        furigana: furigana,
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
        decision_debug: {
          script_declared,
          backend_is_sms_target,
          ruleDecision: ruleDecision === undefined ? null : ruleDecision,
          final_is_sms_target: is_sms_target,
          appliedTargetRules: targetRules,
          observed: {
            age: ageVal,
            gender: normalizeGender(r.gender || r["性別"] || ""),
            name: r.name || r["姓名（ふりがな）"] || "",
          },
        },
      };

      // 若为 SMS 目标并且用户有配置 SMS 提供商，则尝试发送短信
      if (is_sms_target) {
        try {
          const apiUrl = String(smsConfig.api_url || "").trim();
          const apiId = String(smsConfig.api_id || "").trim();
          const apiPass = String(smsConfig.api_password || "").trim();

          // SMS will be attempted when the user has provided api_url/api_id/api_password
          if (apiUrl && apiId && apiPass) {
            const useReport =
              smsConfig.use_delivery_report === true ||
              smsConfig.use_delivery_report === "1" ||
              smsConfig.use_delivery_report === 1;

            const localNum = toLocalJP(phoneRaw);

            const smsTextA = (smsConfig.sms_text_a || "").trim();
            const smsTextB = (smsConfig.sms_text_b || "").trim();
            let message =
              smsTextA ||
              smsTextB ||
              "こんにちは。ご応募ありがとうございます。";
            message = String(message).trim();

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

            // attempt local format
            // 支持通过 smsConfig.retry_status_codes 或 smsConfig.retry_on_status 配置要重试的状态码（默认 [560]）
            const retryCodesRaw: any = smsConfig.retry_status_codes ||
              smsConfig.retry_on_status || [560];
            let retryCodes: number[] = [];
            if (Array.isArray(retryCodesRaw)) {
              retryCodes = retryCodesRaw
                .map((v: any) => Number(v))
                .filter((n: number) => !Number.isNaN(n));
            } else {
              const n = Number(retryCodesRaw);
              if (!Number.isNaN(n)) retryCodes = [n];
            }

            let retryAttempted = false;
            let sendRes = await postOnce(localNum);
            if (sendRes.resp && retryCodes.includes(sendRes.resp.status)) {
              const alt = to81FromLocal(localNum);
              const retry = await postOnce(alt);
              sendRes = retry;
              retryAttempted = true;
            }

            payload.sms_sent = !!(sendRes.resp && sendRes.resp.ok);
            // Parse provider/code/level/message using shared codebook and attach
            const provider = String(smsConfig.provider || "sms-console");
            const httpStatus =
              sendRes && sendRes.resp ? Number(sendRes.resp.status) : undefined;
            const bodyOrText = sendRes
              ? sendRes.text ?? (sendRes.resp && sendRes.resp.data) ?? sendRes
              : undefined;
            const resolved = resolveSmsResult(provider, bodyOrText, httpStatus);

            payload.sms_response = {
              provider,
              status: sendRes.resp.status,
              output: String(sendRes.text).slice(0, 4000),
              retry_attempted: retryAttempted,
              // human-friendly interpretation from codebook
              code: resolved.code ?? null,
              level: resolved.level,
              message: resolved.message,
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
