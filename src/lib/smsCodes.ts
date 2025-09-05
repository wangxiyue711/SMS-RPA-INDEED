// src/lib/smsCodes.ts
export type ResultLevel = "success" | "failed" | "error";
export type CodeDef = { level: ResultLevel; text: string };

/** SMS-CONSOLE のコード表（あなたの資料の内容を反映） */
const SMS_CONSOLE: Record<string, CodeDef> = {
  // --- 成功 ---
  "200": { level: "success", text: "Success / 送信成功" },

  // --- 認証・レート制御・HTTP系 ---
  "401": { level: "failed", text: "Authorization Required / 認証エラー" },
  "402": { level: "failed", text: "Overlimit / 送信上限超過（Failed to send due to Overlimit）" },
  "405": { level: "failed", text: "Method not allowed / メソッドが許可されていない" },
  "414": { level: "failed", text: "URL が長過ぎる（GET では 8190 bytes 超）" },
  "500": { level: "error",  text: "Internal Server Error / 内部サーバーエラー" },
  "502": { level: "error",  text: "Bad gateway / サービス障害" },
  "503": { level: "error",  text: "Temporary unavailable / 秒間リクエスト上限(80 req/sec) 到達" },

  // --- 一般失敗 ---
  "550": { level: "failed", text: "Failure / 失敗" },
  "555": { level: "failed", text: "IP アドレスがブロックされている（認証エラー連続で発生）" },
  "557": { level: "failed", text: "禁止された IP アドレス" },
  "560": { level: "failed", text: "携帯番号（mobilenumber）が不正" },
  "562": { level: "failed", text: "SMS 送信日時（startdate）が無効" },
  "568": { level: "failed", text: "au 向けタイトル（autitle）が不正" },
  "569": { level: "failed", text: "SoftBank 向けタイトル（softbanktitle）が不正" },
  "570": { level: "failed", text: "SMS テキスト ID（smstextid）が不正" },
  "571": { level: "failed", text: "再送信回数（sendingattempts）が不正" },
  "572": { level: "failed", text: "再送間隔（resendinginterval）が不正" },
  "573": { level: "failed", text: "status の値が不正" },
  "574": { level: "failed", text: "SMS ID（smsid）が不正" },
  "575": { level: "failed", text: "docomo の値が不正" },
  "576": { level: "failed", text: "au の値が不正" },
  "577": { level: "failed", text: "SoftBank の値が不正" },
  "578": { level: "failed", text: "SIM の値が不正" },
  "579": { level: "failed", text: "gateway の値が不正" },
  "580": { level: "failed", text: "SMS タイトル（smstitle）が不正" },
  "585": { level: "failed", text: "SMS テキスト（smstext）が不正" },
  "587": { level: "failed", text: "SMS ID が一意ではない（重複）" },
  "590": { level: "failed", text: "Original URL（originalurl）が不正" },
  "591": { level: "failed", text: "SMS テキストタイプが無効（smstext type disabled）" },
  "592": { level: "failed", text: "送信許可時間外（Time is disabled）" },
  "598": { level: "failed", text: "Docomo 向けタイトル（docomotitle）が不正" },
  "599": { level: "failed", text: "再送信機能が無効（有料オプション未契約）" },
  "601": { level: "failed", text: "送信元番号選択機能が OFF（サポートへ連絡）" },
  "605": { level: "failed", text: "type の値が不正（Invalid type）" },
  "606": { level: "failed", text: "この API は無効（This API is disabled）" },
  "608": { level: "failed", text: "登録日（registrationdate）が無効（最大24ヶ月前まで）" },
  "610": { level: "failed", text: "キャリア判定機能（HLR）が無効" },
  "612": { level: "failed", text: "Original URL 2 が不正" },
  "613": { level: "failed", text: "Original URL 3 が不正" },
  "614": { level: "failed", text: "Original URL 4 が不正" },
  "615": { level: "failed", text: "JSON 形式が不正" },
  "617": { level: "failed", text: "メモ API 機能が無効（要連絡）" },
  "624": { level: "failed", text: "重複 SMSID（30日以内の同一 smsid）" },
  "631": { level: "failed", text: "再送信パラメータ変更不可（権限画面で編集可を ON）" },
  "632": { level: "failed", text: "楽天向けタイトルが無効" },
  "633": { level: "failed", text: "楽天向け SMS 本文が無効" },
  "634": { level: "failed", text: "楽天向け SMS 本文が上限超過" },
  "635": { level: "failed", text: "楽天向けリマインド SMS 本文が上限超過" },
  "636": { level: "failed", text: "楽天の設定が無効" },
  "639": { level: "failed", text: "短縮URL アクセス機能が無効" },
  "640": { level: "failed", text: "originalurlcode が不正" },
  "641": { level: "failed", text: "originalurlcode2 が不正" },
  "642": { level: "failed", text: "originalurlcode3 が不正" },
  "643": { level: "failed", text: "originalurlcode4 が不正" },
  "644": { level: "failed", text: "メモ欄テンプレート機能が無効" },
  "645": { level: "failed", text: "memoid が不正" },
  "646": { level: "failed", text: "memoid2 が不正" },
  "647": { level: "failed", text: "memoid3 が不正" },
  "648": { level: "failed", text: "memoid4 が不正" },
  "649": { level: "failed", text: "memoid5 が不正" },

  // --- URL 分割位置に関する警告/失敗（分割受信アラート有効時） ---
  "650": { level: "failed", text: "本文の短縮URLが分割区切り位置にある（main）" },
  "651": { level: "failed", text: "docomo 向け本文で短縮URLが分割区切り位置にある" },
  "652": { level: "failed", text: "sdp 向け本文で短縮URLが分割区切り位置にある" },
  "653": { level: "failed", text: "softbank 向け本文で短縮URLが分割区切り位置にある" },
  "654": { level: "failed", text: "rakuten 向け本文で短縮URLが分割区切り位置にある" },
  "655": { level: "failed", text: "docomo 向け SMS 分割区切り位置に短縮URL（main 文）" },
  "656": { level: "failed", text: "au 向け SMS 分割区切り位置に短縮URL（main 文）" },
  "657": { level: "failed", text: "SoftBank 向け SMS 分割区切り位置に短縮URL（main 文）" },
  "659": { level: "failed", text: "リマインダー本文に短縮URL（分割区切り位置）" },
  "660": { level: "failed", text: "docomo リマインダー本文に短縮URL（分割区切り位置）" },
  "661": { level: "failed", text: "au リマインダー本文に短縮URL（分割区切り位置）" },
  "662": { level: "failed", text: "SoftBank リマインダー本文に短縮URL（分割区切り位置）" },

  "664": { level: "failed", text: "テンプレートと本文の必須パラメータに過不足あり" },

  // --- RCS / Memo 入力制限 ---
  "665": { level: "failed", text: "rcs_image の値が不正（RCS）" },
  "666": { level: "failed", text: "IP ブロック直前（認証エラー累積 9 回目）" },
  "667": { level: "failed", text: "rcs_video の値が不正（RCS）" },
  "668": { level: "failed", text: "rcs_audio の値が不正（RCS）" },
  "669": { level: "failed", text: "memo の値が不正（半角数字のみ）" },
  "670": { level: "failed", text: "memo2 の値が不正" },
  "671": { level: "failed", text: "memo3 の値が不正" },
  "672": { level: "failed", text: "memo4 の値が不正" },
  "673": { level: "failed", text: "memo5 の値が不正" },
};

/** 供应商码表注册（现在只用到 sms-console，可扩展） */
const PROVIDER_CODEBOOK: Record<string, Record<string, CodeDef>> = {
  "sms-console": SMS_CONSOLE,
  "default": {
    "OK": { level: "success", text: "成功" },
    "SUCCESS": { level: "success", text: "成功" },
    "NG": { level: "failed", text: "失敗" },
  },
};

/** 从任意 payload（JSON/XML/テキスト）尽力抽出コード */
export function extractCode(payload: any): string | null {
  try {
    if (payload && typeof payload === "object") {
      const cands = [
        payload.code, payload.status, payload.result, payload.result_code,
        payload.ErrorCode, payload.error_code, payload.error?.code,
      ];
      const hit = String(cands.find(v => v !== undefined) ?? "").trim();
      return hit ? hit.toUpperCase() : null;
    }
    const txt = String(payload ?? "");
    if (!txt) return null;

    try { return extractCode(JSON.parse(txt)); } catch {}

    const mXml = txt.match(/<\s*(?:Code|Status|Result)\s*>\s*([^<\s]+)\s*<\/\s*(?:Code|Status|Result)\s*>/i);
    if (mXml) return mXml[1].toUpperCase();

    const mKv = txt.match(/\b(?:code|status|result)\s*[:=]\s*["']?([A-Za-z0-9_-]{2,})/i);
    if (mKv) return mKv[1].toUpperCase();

    const mSimple = txt.match(/\b(OK|SUCCESS|NG|ERROR|[1-9][0-9]{2}|E\d{3,})\b/i);
    if (mSimple) return mSimple[1].toUpperCase();
  } catch {}
  return null;
}

/** 统一判定：provider + code +（可选）HTTP ステータス */
export function resolveSmsResult(
  provider: string,
  bodyOrText: any,
  httpStatus?: number
): { level: ResultLevel; code?: string; message: string } {
  const book = PROVIDER_CODEBOOK[provider] || PROVIDER_CODEBOOK["default"];
  const code = extractCode(bodyOrText) ?? (httpStatus ? String(httpStatus) : null);

  if (code && book[code]) {
    const def = book[code];
    return { level: def.level, code, message: `コード ${code}: ${def.text}` };
  }
  if (code) {
    // 未収録コードは failed 扱い（後で追加しやすいように文言に残す）
    return { level: "failed", code, message: `コード ${code}: 未定義のコード` };
  }
  return { level: "error", message: "コードを取得できませんでした" };
}
