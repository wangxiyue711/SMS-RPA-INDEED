import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import axios from "axios";
import url from "url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 工具：号码格式兜底（贴近你旧脚本逻辑）
function onlyDigits(s = "") {
  return (s || "").replace(/\D/g, "");
}
function toLocalJP(num: string) {
  const raw = onlyDigits(num);
  if (raw.startsWith("81")) return "0" + raw.slice(2); // 81xxxxxxxxxx -> 0xxxxxxxxx
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

const code_map: Record<number, string> = {
  200: "成功",
  401: "认证错误（Authorization Required）",
  402: "发送上限错误（Overlimit）",
  405: "方法不允许/发送上限错误（Method not allowed）",
  414: "URL过长",
  500: "内部服务器错误",
  502: "网关错误",
  503: "暂时不可用/限流",
  550: "失败",
  555: "IP被封禁",
  557: "禁止的IP地址",
  560: "手机号无效",
  562: "发送日期无效",
  568: "au短信标题无效",
  569: "Softbank短信标题无效",
  570: "短信文本ID无效",
  571: "发送尝试次数无效",
  572: "重发间隔无效",
  573: "状态无效",
  574: "短信ID无效",
  575: "Docomo无效",
  576: "au无效",
  577: "SoftBank无效",
  578: "SIM无效",
  579: "网关无效",
  580: "短信标题无效",
  585: "短信内容无效",
  587: "短信ID不唯一",
  590: "原始URL无效",
  591: "短信文本类型无效",
  592: "时间无效/超出发送权限",
  598: "Docomo短信标题无效",
  599: "重发功能无效",
  601: "短信标题功能无效",
  605: "类型无效",
  606: "API被禁用",
  608: "注册日期无效",
  610: "HLR功能无效",
  612: "原始URL2无效",
  613: "原始URL3无效",
  614: "原始URL4无效",
  615: "JSON格式错误",
  617: "Memo功能无效",
  624: "重复的SMSID",
  631: "重发参数不可更改",
  632: "乐天标题无效",
  633: "乐天短信内容无效",
  634: "乐天短信内容过长",
  635: "乐天提醒短信内容过长",
  636: "乐天设置无效",
  639: "短链功能无效",
  640: "短链码无效",
  641: "短链码2无效",
  642: "短链码3无效",
  643: "短链码4无效",
  644: "Memo模板功能无效",
  645: "Memo模板ID无效",
  646: "Memo模板ID2无效",
  647: "Memo模板ID3无效",
  648: "Memo模板ID4无效",
  649: "Memo模板ID5无效",
  650: "主短信内容短链分割错误",
  651: "docomo短信内容短链分割错误",
  652: "au短信内容短链分割错误",
  653: "Softbank短信内容短链分割错误",
  654: "乐天短信内容短链分割错误",
  655: "主短信内容docomo分割错误",
  656: "主短信内容au分割错误",
  657: "主短信内容Softbank分割错误",
  659: "提醒短信短链分割错误",
  660: "提醒短信docomo分割错误",
  661: "提醒短信au分割错误",
  662: "提醒短信Softbank分割错误",
  664: "模板与短信参数冲突",
  665: "RCS图片无效",
  666: "即将IP封禁（9次认证错误）",
  667: "RCS视频无效",
  668: "RCS音频无效",
  669: "Memo值无效",
  670: "Memo2值无效",
  671: "Memo3值无效",
  672: "Memo4无效",
  673: "Memo5无效",
};

export async function POST(req: NextRequest) {
  try {
    const { userUid, phone, message } = await req.json();
    if (!userUid || !phone || !message) {
      return NextResponse.json(
        { success: false, error: "userUid, phone, message are required" },
        { status: 400 }
      );
    }

    // 1) 读 Firestore: user_configs/{uid}.sms_config
    const snap = await adminDb.collection("user_configs").doc(userUid).get();
    if (!snap.exists) {
      return NextResponse.json(
        { success: false, error: "User config not found" },
        { status: 404 }
      );
    }
    const smsConfig: any = (snap.data() || {}).sms_config || {};

    const apiUrl = String(smsConfig.api_url || "").trim();
    const apiId = String(smsConfig.api_id || "").trim();
    const apiPass = String(smsConfig.api_password || "").trim();
    if (!apiUrl || !apiId || !apiPass) {
      return NextResponse.json(
        {
          success: false,
          error: "SMS config not set (api_url/api_id/api_password)",
        },
        { status: 400 }
      );
    }

    const useReport =
      smsConfig.use_delivery_report === true ||
      smsConfig.use_delivery_report === "1" ||
      smsConfig.use_delivery_report === 1;

    // 2) 号码：先用本地 0 开头，不行再试 81 开头
    const local = toLocalJP(phone);

    // 3) 发请求（Basic Auth + x-www-form-urlencoded；字段名：mobilenumber / smstext）
    async function postOnce(mobile: string) {
      const body = new URLSearchParams();
      body.set("mobilenumber", mobile);
      body.set("smstext", (message || "").replace(/&/g, "＆")); // 与旧脚本一致
      if (useReport) {
        body.set("status", "1");
        body.set("smsid", genReqId());
      }

      // Fixie 代理配置
      const fixieUrl = process.env.FIXIE_URL
        ? url.parse(process.env.FIXIE_URL)
        : null;
      const fixieAuth =
        fixieUrl && fixieUrl.auth ? fixieUrl.auth.split(":") : [];

      const proxyConfig = fixieUrl
        ? {
            protocol: (fixieUrl.protocol || "http:").replace(":", "") as
              | "http"
              | "https",
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
            "Basic " + Buffer.from(`${apiId}:${apiPass}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "nextjs-fetch/1.0",
          Connection: "close",
        },
        proxy: proxyConfig,
        timeout: 15000,
      };

      let resp, text;
      try {
        resp = await axios.post(apiUrl, body.toString(), axiosConfig);
        text =
          typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
        // axios 的 resp.status 是数字
        resp = { ok: true, status: resp.status };
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

    // 先发本地格式
    let { resp, text } = await postOnce(local);

    // 若 560（号码无效）再试 81 格式
    if (resp.status === 560) {
      const alt = to81FromLocal(local);
      const retry = await postOnce(alt);
      resp = retry.resp;
      text = retry.text;
    }

    // 构造要记录到 Firestore 的 payload（无论发送成功与否都记录）
    const now = Date.now();
    const id = String(now) + "-" + Math.random().toString(36).slice(2, 8);
    const payload: any = {
      createdAt: now,
      phone,
      messageExcerpt: String(message || "").substring(0, 4000),
      provider: smsConfig.provider || null,
      rawRequest: { phone, message },
      sms_sent: !!resp.ok,
      sms_response: {
        status: resp.status,
        output: String(text).slice(0, 4000),
      },
      sms_message: String(message || ""),
      level: resp.ok ? "success" : "failed",
    };

    try {
      const colRef = adminDb
        .collection("sms_history")
        .doc(String(userUid))
        .collection("entries");
      await colRef.doc(id).set(payload);
    } catch (e) {
      // 忽略写入错误（不会阻塞响应）
    }

    if (!resp.ok) {
      const errorMessage = code_map[resp.status] || `HTTP ${resp.status}`;
      return NextResponse.json(
        {
          success: false,
          error: `${errorMessage} (${resp.status})`,
          details: String(text).slice(0, 2000),
          recorded: payload,
        },
        { status: 502 }
      );
    }

    // 成功时也检查状态码，提供更详细的信息
    const statusMessage = code_map[resp.status] || "OK";
    return NextResponse.json({
      success: true,
      status: resp.status,
      statusMessage,
      output: String(text).slice(0, 4000),
      recorded: payload,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
