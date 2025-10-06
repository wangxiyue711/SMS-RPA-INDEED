#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Suppress noisy C++/gRPC/glog messages before importing their modules.
# These env vars reduce verbosity from libraries that write to STDERR.
import os
os.environ.setdefault("GRPC_VERBOSITY", "ERROR")
os.environ.setdefault("GRPC_TRACE", "")
os.environ.setdefault("GLOG_minloglevel", "2")

import re, imaplib, email, time, datetime, urllib.parse, sys
import json, signal, traceback
from typing import Optional


def _patch_selenium_quit():
    """Monkeypatch Selenium WebDriver.quit to respect KEEP_BROWSER_OPEN env var.

    Call this early so any subsequent driver.quit() calls become controlled.
    """
    try:
        from selenium.webdriver.remote.webdriver import WebDriver as SeleniumWebDriver
    except Exception:
        return

    if getattr(SeleniumWebDriver, '_quit_monkeypatched', False):
        return

    try:
        try:
            setattr(SeleniumWebDriver, '_quit_monkeypatched', True)
        except Exception:
            pass
    except Exception:
        pass
    try:
        orig_quit = getattr(SeleniumWebDriver, 'quit', None)
        try:
            setattr(SeleniumWebDriver, '_original_quit', orig_quit)
        except Exception:
            try:
                setattr(SeleniumWebDriver, '_original_quit', None)
            except Exception:
                pass
    except Exception:
        pass

    def _safe_quit(self, *args, **kwargs):
        try:
            keep = os.environ.get('KEEP_BROWSER_OPEN')
            if keep and keep != '0':
                try:
                    print(json.dumps({"evt": "quit_skipped_by_env", "ts": int(time.time()*1000)}), file=sys.stderr, flush=True)
                except Exception:
                    pass
                return
        except Exception:
            pass
        orig = getattr(SeleniumWebDriver, '_original_quit', None)
        if orig:
            return orig(self, *args, **kwargs)

    try:
        try:
            setattr(SeleniumWebDriver, 'quit', _safe_quit)
        except Exception:
            pass
    except Exception:
        pass


# Apply the patch immediately so any early quits are controlled
_patch_selenium_quit()


def safe_quit(driver, reason=None):
    """Call driver.quit() unless KEEP_BROWSER_OPEN set; always log to stderr."""
    try:
        keep = os.environ.get('KEEP_BROWSER_OPEN')
        if keep and keep != '0':
            try:
                emit({"evt": "safe_quit_skipped", "reason": reason}, ja="ブラウザの終了をスキップしました")
            except Exception:
                pass
            return
    except Exception:
        pass
    try:
        emit({"evt": "safe_quit_call", "reason": reason}, ja="ブラウザを終了します")
    except Exception:
        pass
    try:
        driver.quit()
    except Exception as e:
        try:
            emit({"evt": "safe_quit_error", "err": str(e)[:2000]}, ja="ブラウザ終了時にエラーが発生しました")
        except Exception:
            pass
from datetime import timezone
from email.header import decode_header
from bs4 import BeautifulSoup, Tag

from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import undetected_chromedriver as uc
from selenium.webdriver.support.ui import WebDriverWait as WW
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, InvalidSessionIdException, WebDriverException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

# 尝试把 stdout 设置为 utf-8（在某些 Windows 环境下需要）
try:
    reconfig = getattr(sys.stdout, "reconfigure", None)
    if callable(reconfig):
        try:
            reconfig(encoding="utf-8")
        except Exception:
            pass
except Exception:
    pass
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')


def emit(event_dict: dict, ja: Optional[str] = None, to_stdout: bool = False):
    """统一输出事件：打印结构化 JSON（保留原始字段）并可附加短日语提示。

    - event_dict: 要输出的字典
    - ja: 可选的日语短消息，会附加为 msg_ja 并单独打印一行便于人工查看。
    - to_stdout: 是否将 JSON 输出到 stdout（默认 stderr）
    """
    try:
        # Short Japanese line for humans (default)
        if ja:
            try:
                print(ja, file=sys.stderr)
            except Exception:
                pass
        else:
            try:
                # fallback short label
                lbl = (event_dict or {}).get('evt') or (event_dict or {}).get('event') or '情報'
                print(str(lbl), file=sys.stderr)
            except Exception:
                pass

        # Detailed JSON only when explicitly requested (DEBUG_JSON=1)
        debug_json = os.environ.get('DEBUG_JSON')
        if debug_json and debug_json != '0':
            try:
                payload = dict(event_dict or {})
                if ja:
                    payload['msg_ja'] = ja
                payload.setdefault('ts', int(time.time() * 1000))
                s = json.dumps(payload, ensure_ascii=False)
                if to_stdout:
                    print(s, flush=True)
                else:
                    print(s, file=sys.stderr, flush=True)
            except Exception:
                pass
    except Exception:
        pass

# ========= 配置 =========
IMAP_HOST = "imap.gmail.com"
# 不在源码中保存敏感凭据，默认留空。
IMAP_USER = ""
IMAP_PASS = ""

# SITE_USER/PASS 可通过环境或远端配置注入
SITE_USER = os.environ.get('SITE_USER', '')
SITE_PASS = os.environ.get('SITE_PASS', '')

SUBJECT_KEYWORD = "【新しい応募者のお知らせ】"
ALLOWED_DOMAINS = {"indeed.com", "jp.indeed.com", "indeedemail.com", "cts.indeed.com"}

# 尝试从 stdin 读取 JSON 配置（由后端传入），格式: {"config": { ... }}
cfg = {}
# 支持通过命令行参数传入配置文件路径: --cfg-file=PATH
try:
    for a in sys.argv[1:]:
        if a.startswith("--cfg-file="):
            cfg_path = a.split("=", 1)[1]
            try:
                with open(cfg_path, 'r', encoding='utf-8') as f:
                    payload = json.load(f)
                    cfg = payload.get('config') or payload
            except Exception:
                cfg = {}
            break
except Exception:
    cfg = {}

# 如果没有 cfg-file，再尝试从 stdin 读取（保持兼容）
try:
    if not cfg and not sys.stdin.isatty():
        raw = sys.stdin.read()
        if raw:
            try:
                payload = json.loads(raw)
                cfg = payload.get('config') or payload
            except Exception:
                cfg = {}
except Exception:
    cfg = cfg or {}


def try_fetch_cfg_from_firestore_if_available(user_uid: Optional[str]):
    """尝试使用 GOOGLE_APPLICATION_CREDENTIALS 拉取 Firestore 中的 user_configs/{user_uid} 文档。
    若环境或依赖不可用则返回 None。
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except Exception:
        return None

    try:
        # Initialize firebase_admin using service account path from env if not already
        if not firebase_admin._apps:
            cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
            if not cred_path or not os.path.exists(cred_path):
                return None
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)

        db = firestore.client()
        doc = db.collection('user_configs').document(str(user_uid)).get()
        if not doc.exists:
            return None
        return doc.to_dict()
    except Exception:
        return None


def _normalize_name_and_furigana(raw_name: str):
    name = raw_name or ""
    furigana = ""
    try:
        m = re.search(r'(?:\(|\（)\s*([^\)\）]+?)\s*(?:\)|\）)\s*$', str(name))
        if m:
            furigana = (m.group(1) or "").strip()
            name = re.sub(r'\（.*?\）|\(.*?\)', '', str(name)).strip()
    except Exception:
        pass
    return name, furigana

def _normalize_phone_for_compare(phone: Optional[str]) -> str:
    try:
        if not phone:
            return ""
        s = str(phone)
        # unify: remove non-digits, map +81 leading to 0
        digits = re.sub(r"[^0-9]", "", s)
        if digits.startswith("81") and len(digits) >= 10:
            digits = "0" + digits[2:]
        return digits
    except Exception:
        return str(phone or "")

def write_history_entry_to_firestore(user_uid: str, entry: dict):
    """Single immediate history write with normalization and idempotency guard."""
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except Exception:
        return False

    try:
        if not firebase_admin._apps:
            cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
            if not cred_path or not os.path.exists(cred_path):
                emit({"event": "history_error", "error": "no_service_account", "uid": str(user_uid)}, ja="サービスアカウントが見つかりません")
                return False
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        db = firestore.client()
        coll = db.collection('rpa_history').document(str(user_uid)).collection('entries')

        # Normalize name/furigana and phone for uniform display and duplicate detection
        try:
            nm, fu = _normalize_name_and_furigana(entry.get("name") or entry.get("姓名（ふりがな）") or "")
            if nm:
                entry["name"] = nm
            if fu and not entry.get("furigana"):
                entry["furigana"] = fu
        except Exception:
            pass
        try:
            if entry.get("phone"):
                entry["phone"] = _normalize_phone_display(entry.get("phone"))
        except Exception:
            pass

        # Idempotency: skip if a very recent entry exists with same normalized name+phone
        try:
            norm_name = str(entry.get("name") or "").strip()
            norm_phone_cmp = _normalize_phone_for_compare(entry.get("phone"))
            # time window: last 2 minutes (120000 ms)
            now_ms = int(time.time() * 1000)
            window_ms = 120000
            since_ms = now_ms - window_ms
            # query limited recent entries to reduce cost
            try:
                from google.cloud import firestore as _gcf
                _DESC = _gcf.Query.DESCENDING
            except Exception:
                _DESC = "DESCENDING"
            recent_q = coll.order_by("createdAt", direction=_DESC).limit(50)
            recent_docs = list(recent_q.stream())
            for d in recent_docs:
                try:
                    data = d.to_dict() or {}
                    cat = int(data.get("createdAt") or 0)
                    if cat and cat < since_ms:
                        # older than window -> stop scanning
                        break
                    dn = str(data.get("name") or "").strip()
                    dp = _normalize_phone_for_compare(data.get("phone"))
                    if dn == norm_name and dp == norm_phone_cmp:
                        # duplicate within time window
                        emit({"event": "history_skip_duplicate", "uid": user_uid, "name": dn}, ja="直近の重複を検出し履歴をスキップしました")
                        return True
                except Exception:
                    continue
        except Exception:
            pass

        coll.add(entry)
        return True
    except Exception as e:
        try:
            emit({"event": "history_error", "uid": str(user_uid), "error": str(e)[:1000]}, ja="履歴保存でエラーが発生しました")
        except Exception:
            pass
        return False


# 应用配置到变量
try:
    if isinstance(cfg, dict):
        IMAP_USER = cfg.get('email_config', {}).get('address') or cfg.get('IMAP_USER') or IMAP_USER
        IMAP_PASS = cfg.get('email_config', {}).get('app_password') or cfg.get('IMAP_PASS') or IMAP_PASS
        SITE_USER = cfg.get('email_config', {}).get('address') or SITE_USER
        SITE_PASS = cfg.get('email_config', {}).get('site_password') or SITE_PASS
        SUBJECT_KEYWORD = cfg.get('SUBJECT_KEYWORD') or SUBJECT_KEYWORD
        domains = cfg.get('ALLOWED_DOMAINS')
        if isinstance(domains, (list, tuple)):
            ALLOWED_DOMAINS = set(domains)
        elif isinstance(domains, str):
            ALLOWED_DOMAINS = set(x.strip() for x in domains.split(','))

    # 当没有从命令行/stdin 获得凭据时，尝试通过环境变量 USER_UID + 服务账号从 Firestore 读取
    if (not cfg or not isinstance(cfg, dict) or not cfg.get('email_config')) and os.environ.get('USER_UID'):
        fetched = try_fetch_cfg_from_firestore_if_available(os.environ.get('USER_UID'))
        if fetched and isinstance(fetched, dict):
            cfg = {**(fetched or {}), **(cfg or {})}
            IMAP_USER = cfg.get('email_config', {}).get('address') or IMAP_USER
            IMAP_PASS = cfg.get('email_config', {}).get('app_password') or IMAP_PASS
            SITE_USER = cfg.get('email_config', {}).get('address') or SITE_USER
            SITE_PASS = cfg.get('email_config', {}).get('site_password') or SITE_PASS

    # 安全策略：如果最终没有 IMAP_USER/IMAP_PASS，则停止并返回错误，避免回退到源码中可能的敏感值
    if not IMAP_USER or not IMAP_PASS:
        print("ERROR: IMAP の認証情報が設定されていません。--cfg-file または stdin の email_config、あるいは USER_UID と GOOGLE_APPLICATION_CREDENTIALS を設定してください。", file=sys.stderr)
        # 如果希望保留进程用于调试，可设置 NO_SYS_EXIT=1 或 KEEP_BROWSER_OPEN=1
        noexit = os.environ.get('NO_SYS_EXIT')
        if noexit and noexit != '0':
            try:
                emit({"evt": "sys_exit_blocked", "reason": "no_imap_credentials"}, ja="IMAP認証情報が不足しています。プロセスを停止しません。")
            except Exception:
                pass
            # do not exit so developer can inspect environment and browser
        else:
            sys.exit(2)
except Exception:
    pass

# ========= 工具 =========
def decode_any(s, charset=None):
    """
    Decode bytes to str trying a list of likely encodings.
    If `charset` is provided (from email part), try it first.
    """
    if not s:
        return ""
    if isinstance(s, str):
        return s
    if isinstance(s, bytes):
        encs = []
        if charset:
            encs.append(charset)
        # common encodings for Japanese emails/pages
        encs += ["utf-8", "cp932", "shift_jis", "euc-jp", "iso-2022-jp", "latin1"]
        for e in encs:
            try:
                return s.decode(e, errors="strict")
            except Exception:
                try:
                    # try with ignore to avoid crashes
                    return s.decode(e, errors="ignore")
                except Exception:
                    continue
        # fallback
        try:
            return s.decode("utf-8", errors="ignore")
        except Exception:
            return s.decode("latin1", errors="ignore")
    return str(s)

def domain_allowed(u: str) -> bool:
    try:
        host = (urllib.parse.urlparse(u).hostname or "").lower()
        return any(host == d or host.endswith("." + d) for d in ALLOWED_DOMAINS)
    except:
        return False

def peel_indeed_redirect(u: str) -> str:
    try:
        parsed = urllib.parse.urlparse(u)
        host = (parsed.hostname or "").lower()
        if host and ("cts.indeed.com" in host):
            qs = urllib.parse.parse_qs(parsed.query)
            for key in ("u", "url"):
                if key in qs and qs[key]:
                    return urllib.parse.unquote(qs[key][0])
    except:
        pass
    return u

def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())

def _calc_age(yyyy_mm_dd: str) -> str:
    if not yyyy_mm_dd:
        return ""
    # 尝试用正则从任意文本中提取 YYYY MM DD
    try:
        m = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", yyyy_mm_dd)
        if not m:
            return ""
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        dt = datetime.datetime(year=y, month=mo, day=d)
        today = datetime.datetime.today()
        age = today.year - dt.year - ((today.month, today.day) < (dt.month, dt.day))
        return str(age)
    except Exception:
        return ""

# ========= 邮件 =========
def get_all_target_unread_messages(subject_keyword: str):
    box = imaplib.IMAP4_SSL(IMAP_HOST)
    box.login(IMAP_USER, IMAP_PASS)
    box.select("INBOX")
    typ, data = box.search(None, 'UNSEEN')
    result = []
    if typ == "OK":
        ids = data[0].split()
        for mid in reversed(ids):
            typ, raw = box.fetch(mid, "(RFC822)")
            if typ == "OK" and raw and isinstance(raw[0], tuple) and len(raw[0]) > 1:
                msg = email.message_from_bytes(raw[0][1])
                subj_raw = msg.get("Subject")
                if subj_raw is None:
                    continue
                subj = decode_any(decode_header(subj_raw)[0][0])
                if subject_keyword in subj:
                    result.append((mid, msg))
    box.logout()
    return result


def mark_message_seen(mid):
    try:
        box = imaplib.IMAP4_SSL(IMAP_HOST)
        box.login(IMAP_USER, IMAP_PASS)
        box.select("INBOX")
        box.store(mid, '+FLAGS', '\\Seen')
        try:
            # log which mid was marked for easier debugging
            try:
                mid_s = mid.decode() if isinstance(mid, bytes) else str(mid)
            except Exception:
                mid_s = str(mid)
            try:
                emit({"event": "marked_seen", "mid": mid_s}, ja="メールを既読にしました")
            except Exception:
                pass
        finally:
            box.logout()
    except Exception:
        pass

def extract_target_link_from_email(msg):
    html = None
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                html = decode_any(part.get_payload(decode=True), charset=part.get_content_charset()); break
    else:
        if msg.get_content_type() == "text/html":
            html = decode_any(msg.get_payload(decode=True), charset=msg.get_content_charset())
    if not html: return None

    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        if "応募内容を確認する" in (a.get_text(strip=True) or ""):
            href = a.get('href')
            try:
                href = str(href)
            except Exception:
                href = None
            if href:
                cand = peel_indeed_redirect(href)
                if domain_allowed(cand):
                    return cand
    for a in soup.find_all("a", href=True):
        href = a.get('href')
        try:
            href = str(href)
        except Exception:
            href = None
        if href:
            cand = peel_indeed_redirect(href)
            if domain_allowed(cand):
                return cand
    return None

# ========= 浏览器 =========
def make_driver():
    opts = Options()
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1400,950")
    user_data_dir = os.path.abspath("chrome_user_data")
    opts.add_argument(f"--user-data-dir={user_data_dir}")
    # Create driver and emit a short, simple Japanese diagnostic line with path/version
    driver = uc.Chrome(options=opts)
    try:
        svc_path = None
        try:
            svc_path = getattr(driver, 'service', None)
            if svc_path is not None:
                svc_path = getattr(svc_path, 'path', None)
        except Exception:
            svc_path = None

        caps = getattr(driver, 'capabilities', {}) or {}
        browser_ver = caps.get('browserVersion') or caps.get('version') or ''
        # try CDP fallback
        try:
            v = driver.execute_cdp_cmd('Browser.getVersion', {})
            if isinstance(v, dict):
                # v['product'] looks like 'Chrome/140.0.7339.208'
                prod = v.get('product') or ''
                if prod:
                    browser_ver = prod
        except Exception:
            pass

        try:
            emit({"evt": "driver_ready", "driver_path": svc_path or "", "browser_version": browser_ver}, ja=f"ブラウザ起動: バージョン {browser_ver.split('/')[-1] if browser_ver else '不明'}")
        except Exception:
            pass
    except Exception:
        pass
    return driver

def ensure_in_latest_tab(driver):
    if len(driver.window_handles) > 1:
        driver.switch_to.window(driver.window_handles[-1])

def try_accept_cookies(driver):
    for xp in [
        "//button[normalize-space()='同意']",
        "//button[contains(.,'同意')]",
        "//button[contains(.,'Accept')]",
    ]:
        try:
            WW(driver, 3).until(EC.element_to_be_clickable((By.XPATH, xp))).click(); break
        except TimeoutException:
            pass


def _save_debug_snapshot(driver, tag='snapshot'):
    """尝试保存截图与页面源码，返回保存的文件名（png, html）并在 stderr 输出简短日语提示。"""
    if not driver:
        try:
            print(json.dumps({"evt": "no_driver_for_snapshot", "tag": tag}, ensure_ascii=False), file=sys.stderr, flush=True)
        except Exception:
            pass
        return None, None
    ts = int(time.time())
    png = f"debug_{tag}_{ts}.png"
    html = f"debug_{tag}_{ts}.html"
    try:
        # screenshot
        try:
            driver.save_screenshot(png)
        except Exception:
            png = None
        # page source
        try:
            src = driver.page_source
            with open(html, 'w', encoding='utf-8') as f:
                f.write(src or '')
        except Exception:
            html = None
    except Exception:
        png = None; html = None
    try:
        info = {"evt": "saved_snapshot", "tag": tag, "png": png or "", "html": html or ""}
        print(json.dumps(info, ensure_ascii=False), file=sys.stderr, flush=True)
        # short human Japanese line
        files = []
        if png: files.append(png)
        if html: files.append(html)
        if files:
            print(f"デバッグ証拠を保存しました: {', '.join(files)}", file=sys.stderr)
        else:
            print("デバッグ証拠の保存に失敗しました。", file=sys.stderr)
    except Exception:
        pass
    return png, html

def reveal_phone_if_hidden(driver):
    for xp in [
        "//button[contains(.,'連絡先を表示')]",
        "//button[contains(.,'電話番号を表示')]",
    ]:
        try:
            btn = WW(driver, 3).until(EC.element_to_be_clickable((By.XPATH, xp)))
            ActionChains(driver).move_to_element(btn).perform()
            btn.click(); time.sleep(0.3); return
        except TimeoutException:
            continue

def maybe_switch_to_candidate_iframe(driver):
    frames = driver.find_elements(By.TAG_NAME, "iframe")
    if not frames: return False
    for f in frames:
        meta = " ".join([(f.get_attribute("id") or ""), (f.get_attribute("name") or "")]).lower()
        if any(k in meta for k in ["candidate","applicant","応募","detail"]):
            driver.switch_to.frame(f); return True
    return False

def site_login_and_open(driver, target_url, user, pwd):
    driver.get(target_url); time.sleep(2); try_accept_cookies(driver)
    page_text = BeautifulSoup(driver.page_source, "html.parser").get_text("\n", strip=True)
    if "応募者情報" in page_text: return
    # 页面未检测到登录后的目标内容，尝试自动使用凭证登录（若提供）
    print("応募者情報が検出されません。自動ログインを試みます（認証情報がある場合）...", file=sys.stderr)
    try:
        if user and pwd:
            # 常见表单选择器：尝试寻找邮箱/用户名和密码字段并提交
            try:
                email_sel = "input[type='email'], input[name*='email'], input[id*='email'], input[name*='user'], input[name*='username']"
                pass_sel = "input[type='password'], input[name*='pass'], input[id*='pass']"
                email_elems = driver.find_elements(By.CSS_SELECTOR, email_sel)
                pass_elems = driver.find_elements(By.CSS_SELECTOR, pass_sel)
                if email_elems and pass_elems:
                    try:
                        email_elems[0].clear(); email_elems[0].send_keys(user)
                        pass_elems[0].clear(); pass_elems[0].send_keys(pwd)
                        # 尝试点击提交按钮或回车
                        btns = driver.find_elements(By.CSS_SELECTOR, "button[type=submit], input[type=submit], button[id*='login'], button[name*='login']")
                        if btns:
                            btns[0].click()
                        else:
                            pass_elems[0].send_keys(Keys.ENTER)
                        # 等待跳转或页面包含目标文字
                        try:
                            WW(driver, 8).until(lambda d: "応募者情報" in BeautifulSoup(d.page_source, 'html.parser').get_text("\n", strip=True))
                            print("自動ログインに成功しました", file=sys.stderr)
                            return
                        except Exception:
                            # 登录后仍未检测到目标，继续但不阻塞
                            print("自動ログインの試行は完了しましたが、応募者情報が見つかりませんでした。手動ログインが必要かもしれません。", file=sys.stderr)
                    except Exception:
                        print("ログインフォームの入力に失敗しました。続行します...", file=sys.stderr)
                else:
                    print("ログインフォームの要素が見つかりませんでした。既にログイン済みか、別のログイン方式が使用されている可能性があります。", file=sys.stderr)
            except Exception:
                print("自動ログイン処理で例外が発生しました。続行します...", file=sys.stderr)
        else:
            print("SITE_USER/SITE_PASS が提供されていません。自動ログインをスキップします。", file=sys.stderr)
    except Exception as e:
        print(f"自動ログインで例外を捕捉しました: {e}", file=sys.stderr)

# ========= 応募者情報抓取 =========
def _get_by_label(container, labels):
    for lab in labels:
        # 根据容器类型使用不同的XPath策略
        if container.tag_name == 'html' or str(type(container)) == "<class 'selenium.webdriver.chrome.webdriver.WebDriver'>":
            xpath_patterns = [f"//*[contains(normalize-space(), '{lab}')]"]
        else:
            xpath_patterns = [f".//*[contains(normalize-space(), '{lab}')]"]
        
        for xp in xpath_patterns:
            try:
                elems = container.find_elements(By.XPATH, xp)
                for lab_el in elems:
                    try:
                        lab_text = _norm_text(lab_el.text)
                        
                        # 如果元素包含标签和值，尝试提取值部分
                        if lab in lab_text:
                            # 处理冒号分隔的情况
                            for sep in ["：", ":", "\n"]:
                                if lab + sep in lab_text:
                                    value = lab_text.split(lab + sep, 1)[-1].strip()
                                    if value and value != lab:
                                        clean_value = value.split('\n')[0].strip()
                                        
                                        # 字段特定清理
                                        if "姓名" in lab or "氏名" in lab or "名前" in lab:
                                            # 姓名：保留完整姓名和读音，包括括号
                                            match = re.match(r'^([^電話性別生年月日]+?)(?=\s*[電話性別生年月日]|$)', clean_value)
                                            if match:
                                                clean_value = match.group(1).strip()
                                        elif "電話" in lab or "TEL" in lab or "tel" in lab:
                                            match = re.search(r'(\+?\d+[\s\-\d]*\d)', clean_value)
                                            if match:
                                                clean_value = match.group(1).strip()
                                        elif "性別" in lab:
                                            clean_value = clean_value.split()[0] if clean_value.split() else clean_value
                                        elif "生年月日" in lab or "誕生日" in lab:
                                            match = re.search(r'(\d{4}/\d{1,2}/\d{1,2})', clean_value)
                                            if match:
                                                clean_value = match.group(1)
                                        
                                        if clean_value:
                                            return clean_value
                    except:
                        continue
            except:
                continue
    return ""

def extract_all_fields(driver):
    info = {}
    
    # 检查是否有iframe
    try: 
        maybe_switch_to_candidate_iframe(driver)
    except: 
        pass
    
    # 查找容器
    container = driver  # 默认使用整个页面
    
    try:
        # 尝试找到包含"応募者情報"的更大容器
        possible_containers = [
            "//*[contains(.,'応募者情報')]/ancestor::*[self::section or self::div or self::main or self::article][1]",
            "//*[contains(.,'応募者情報')]/parent::*",
            "//section[contains(.,'応募者情報')]",
            "//div[contains(.,'応募者情報')]"
        ]
        
        for container_xpath in possible_containers:
            try:
                temp_container = WW(driver, 5).until(
                    EC.visibility_of_element_located((By.XPATH, container_xpath))
                )
                # 测试这个容器是否包含字段
                test_elements = temp_container.find_elements(By.XPATH, ".//*[contains(text(), '姓名') or contains(text(), '電話') or contains(text(), '性別')]")
                if len(test_elements) > 0:
                    container = temp_container
                    break
            except:
                continue
    except:
        pass
    
    reveal_phone_if_hidden(driver)
    
    # 抓取字段
    name   = _get_by_label(container, ["姓名（ふりがな）", "姓名", "氏名", "名前", "お名前", "ふりがな"])
    phone  = _get_by_label(container, ["電話番号", "電話", "連絡先", "TEL", "tel", "携帯電話", "携帯"])
    gender = _get_by_label(container, ["性別", "性别"])
    birth  = _get_by_label(container, ["生年月日", "誕生日", "生まれ", "年齢", "生年"])
    
    info["姓名（ふりがな）"] = name
    info["電話番号"] = phone
    info["性別"] = gender
    info["生年月日"] = birth
    info["__標準_姓名__"] = name
    info["__標準_電話番号__"] = re.sub(r"[^0-9+]", "", phone)
    info["__標準_生年月日__"] = birth
    info["__標準_年齢__"] = _calc_age(birth)
    
    try: driver.switch_to.default_content()
    except: pass
    return info

def pretty_print_info(info, source_url=None):
    # 返回结构化字典，附带来源链接
    return {
        "name": info.get("姓名（ふりがな）", ""),
        "phone": info.get("電話番号", ""),
        "gender": info.get("性別", ""),
        "birth": info.get("生年月日", ""),
        "age": info.get("__標準_年齢__", ""),
        "source_url": source_url or "",
    }


def _normalize_phone_display(phone: Optional[str]) -> str:
    """Convert international like +81 90 4490 4649 to domestic 090-4490-4649 for display."""
    if not phone:
        return ""
    s = str(phone).strip()
    # remove spaces and plus signs for processing
    digits = re.sub(r"[^0-9]", "", s)
    # if starts with 81 and then 9x -> replace with 0
    if digits.startswith("81") and len(digits) >= 11:
        digits = "0" + digits[2:]
    # format: if 11 digits -> 3-4-4 like 090-1234-5678
    if len(digits) == 11:
        return f"{digits[0:3]}-{digits[3:7]}-{digits[7:11]}"
    # fallback group
    if len(digits) >= 10:
        return f"{digits[0:3]}-{digits[3:7]}-{digits[7:]}"
    return phone


def format_candidate_card(result: dict, uid: Optional[str] = None) -> str:
    """Return a multi-line Japanese card for a single candidate result."""
    name = result.get("name") or result.get("姓名（ふりがな）") or ""
    furigana = result.get("furigana") or ""
    phone_raw = result.get("phone") or result.get("電話番号") or ""
    phone = _normalize_phone_display(phone_raw)
    gender = result.get("gender") or result.get("性別") or ""
    birth = result.get("birth") or result.get("生年月日") or ""
    age = result.get("age") or result.get("__標準_年齢__") or ""
    source = result.get("source_url") or ""
    is_target = bool(result.get("should_send_sms", False))
    sms_sent = result.get("sms_sent")

    if not is_target:
        sms_status = "対象外（未送信）"
    else:
        if sms_sent:
            sms_status = "対象（送信済み）"
        else:
            sms_status = "対象（未送信）"

    lines = []
    lines.append(f"候補者：{name}{('（' + furigana + '）') if furigana else ''}")
    if phone:
        lines.append(f"電話　：{phone}")
    if age:
        if birth:
            lines.append(f"年齢　：{age} 歳（{birth}）")
        else:
            lines.append(f"年齢　：{age} 歳")
    if gender:
        lines.append(f"性別　：{gender}")
    lines.append(f"SMS　：{sms_status}")
    if uid:
        lines.append(f"履歴UID：{uid}")
    if source:
        # shorten URL for display
        try:
            parsed = urllib.parse.urlparse(source)
            domain = parsed.hostname or source
            lines.append(f"ソース：{domain} ")
        except Exception:
            lines.append(f"ソース：{source}")

    return "\n".join(lines)

def send_sms_if_configured(phone, name=""):
    """发送SMS（如果配置了SMS API）"""
    try:
        import requests

        # 优先使用前端的sms_config结构，兼容旧的sms_api结构
        sms_config = cfg.get("sms_config") if isinstance(cfg, dict) else {}
        sms_api = cfg.get("sms_api") if isinstance(cfg, dict) else {}

        # 如果 sms_config 缺失且环境有 USER_UID，则自动拉取并合并
        if os.environ.get("USER_UID"):
            try:
                fetched = try_fetch_cfg_from_firestore_if_available(os.environ["USER_UID"])
                if fetched and isinstance(fetched, dict) and fetched.get("sms_config"):
                    # 合并：优先使用 Firestore 中的 sms_config（确保 uid 下的模板可用）
                    fetched_sms = fetched.get("sms_config") or {}
                    if isinstance(fetched_sms, dict):
                        sms_config = {**(sms_config or {}), **fetched_sms}
                        try:
                            cfg["sms_config"] = sms_config
                        except Exception:
                            pass
            except Exception as e:
                print(f"[sms_debug] auto-fetch sms_config failed: {e}", file=sys.stderr)

        # 从sms_config或sms_api中获取配置
        api_url = ""
        api_id = ""
        api_password = ""

        if isinstance(sms_config, dict) and sms_config.get("api_url"):
            api_url = sms_config.get("api_url", "")
            api_id = sms_config.get("api_id", "")
            api_password = sms_config.get("api_password", "")
        elif isinstance(sms_api, dict) and sms_api.get("url"):
            api_url = sms_api.get("url", "")
            api_id = sms_api.get("id", "")
            api_password = sms_api.get("password", "")

        if not all([api_url, api_id, api_password]):
            print(f"[sms_debug] missing api fields: url={api_url!=''}, id={api_id!=''}, pass={api_password!=''}", file=sys.stderr)
            return {"success": False, "error": "SMS API not configured"}



        # 自动转换为日本手机号格式（API要求：仅数字，无+号）
        phone_for_api = re.sub(r"[^0-9]", "", str(phone))

        def is_valid_jp_phone(num):
            """
            严格按API要求校验手机号：
            1. 仅数字。
            2. 11位：020X, 060X, 070X, 080X, 090X（X为1-9）。
            3. 14位：0200, 0600, 0700, 0800, 0900开头。
            4. 8180, 8190开头的值：12位以内。
            5. 0或81以外开头的值：6~20位。
            """
            if not num.isdigit():
                return False
            l = len(num)
            if l == 11 and re.match(r"^(020[1-9]|060[1-9]|070[1-9]|080[1-9]|090[1-9])", num):
                return True
            if l == 14 and re.match(r"^(0200|0600|0700|0800|0900)", num):
                return True
            if re.match(r"^(8180|8190)", num) and l <= 12:
                return True
            # 兜底规则：只要是 6~20 位数字就接受（覆盖各种区号/国际码情况），
            # 以减少因本地/国际前缀判断不一致导致的拒绝（出现560错误）的情况。
            if 6 <= l <= 20:
                return True
            return False

        if not is_valid_jp_phone(phone_for_api):
            return {"success": False, "error": f"電話番号の形式が API の要件に合いません: {phone_for_api}"}

        # 调试日志：在发送前打印清洗后的手机号，便于排查 API 返回的560错误（不要打印凭据）
        try:
            print(f"[sms_debug] will send to: {phone_for_api}, api_url_present={bool(api_url)}", file=sys.stderr)
        except Exception:
            pass

        # 模板选择必须严格遵循用户在 target 页面上的选择（user_configs/{uid}.target_rules.templates）
        # 步骤：尝试从 Firestore 拉取 target_rules.templates（若 USER_UID 可用），
        # 并根据 template1/template2 映射到 sms_text_a/sms_text_b。若未选择任何模板，则中止发送并返回错误。
        chosen_source = None
        message = None
        # 当用户同时勾选 template1 和 template2 时，按先后顺序交替发送：A, B, A, B...
        # 优先策略：如果有 USER_UID 并且能够访问 Firestore，则根据历史记录条目数的奇偶决定使用哪个模板；
        # 如果无法访问 Firestore，则在进程内使用简单的切换器（非持久化）。
        alternate_choice = None
        try:
            templates_choice = None
            if os.environ.get("USER_UID"):
                fetched = try_fetch_cfg_from_firestore_if_available(os.environ["USER_UID"])
                if fetched and isinstance(fetched, dict):
                    tr = fetched.get("target_rules") or {}
                    templates_choice = tr.get("templates") if isinstance(tr, dict) else None

            # 如果在运行时传入的 cfg 里也有 target_rules，我们也尊重它（优先级低于 Firestore）
            if templates_choice is None and isinstance(cfg, dict):
                tr = cfg.get("target_rules") or {}
                templates_choice = tr.get("templates") if isinstance(tr, dict) else None

            # templates_choice 应该形如 { template1: true/false, template2: true/false }
            if isinstance(templates_choice, dict):
                t1 = bool(templates_choice.get("template1"))
                t2 = bool(templates_choice.get("template2"))
                if t1 and t2:
                    # 双模板交替
                    try:
                        uid = os.environ.get("USER_UID")
                        count = None
                        if uid:
                            try:
                                import firebase_admin
                                from firebase_admin import credentials, firestore
                                if not firebase_admin._apps:
                                    cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
                                    if cred_path and os.path.exists(cred_path):
                                        cred = credentials.Certificate(cred_path)
                                        firebase_admin.initialize_app(cred)
                                db = firestore.client()
                                # 尝试统计历史条目数（如大量文档此操作可优化）
                                try:
                                    docs = list(db.collection('rpa_history').document(str(uid)).collection('entries').stream())
                                    count = len(docs)
                                except Exception:
                                    count = None
                            except Exception:
                                count = None

                        if count is not None:
                            # 如果 count 为偶数则使用 template1 (A)，奇数使用 template2 (B)
                            use_t1 = (count % 2 == 0)
                        else:
                            # 回退：使用进程内切换
                            global _SMS_ALTERNATE_TOGGLE
                            try:
                                _SMS_ALTERNATE_TOGGLE = globals().get('_SMS_ALTERNATE_TOGGLE', False)
                                use_t1 = not _SMS_ALTERNATE_TOGGLE
                                globals()['_SMS_ALTERNATE_TOGGLE'] = use_t1
                            except Exception:
                                use_t1 = True

                        if use_t1:
                            if isinstance(sms_config, dict) and sms_config.get("sms_text_a"):
                                message = str(sms_config.get("sms_text_a"))
                                chosen_source = "template1:sms_text_a"
                        else:
                            if isinstance(sms_config, dict) and sms_config.get("sms_text_b"):
                                message = str(sms_config.get("sms_text_b"))
                                chosen_source = "template2:sms_text_b"
                    except Exception:
                        # 发生任何错误则回退到单独选择逻辑
                        pass
                else:
                    if t1:
                        if isinstance(sms_config, dict) and sms_config.get("sms_text_a"):
                            message = str(sms_config.get("sms_text_a"))
                            chosen_source = "template1:sms_text_a"
                    elif t2:
                        if isinstance(sms_config, dict) and sms_config.get("sms_text_b"):
                            message = str(sms_config.get("sms_text_b"))
                            chosen_source = "template2:sms_text_b"
        except Exception:
            message = None

        # 如果没有选择模板或对应模板在 sms_config 中不存在，则中止发送
        if not message:
            try:
                print("[sms_debug] no user-selected template found under target_rules.templates or sms_config missing template", file=sys.stderr)
            except Exception:
                pass
            return {"success": False, "error": "no_user_selected_template"}

        # 支持简单占位符替换 {name}
        try:
            message = message.replace("{name}", name).replace("{NAME}", name)
        except Exception:
            pass

        try:
            print(f"[sms_debug] using_template={chosen_source}", file=sys.stderr)
        except Exception:
            pass

        data = {"mobilenumber": phone_for_api, "smstext": message.replace("&", "＆")}
        # 构建 Basic Auth header
        import base64
        auth_str = f"{api_id}:{api_password}"
        auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("ascii")
        headers = {
            "Authorization": f"Basic {auth_b64}",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "python-fetch/1.0",
            "Connection": "close",
        }
        # 决定重试状态码，从 sms_config 中读取，默认 [560]
        retry_codes_raw = []
        try:
            if isinstance(sms_config, dict):
                retry_codes_raw = sms_config.get("retry_status_codes") or sms_config.get("retry_on_status") or [560]
        except Exception:
            retry_codes_raw = [560]
        retry_codes = []
        if isinstance(retry_codes_raw, (list, tuple)):
            for v in retry_codes_raw:
                try:
                    retry_codes.append(int(v))
                except Exception:
                    continue
        else:
            try:
                retry_codes = [int(retry_codes_raw)]
            except Exception:
                retry_codes = [560]

        def to_local(num: str) -> str:
            # 若以 81 开头，转换为 0 + rest；若以 0 开头则返回原值；否则直接返回
            if num.startswith("81"):
                return "0" + num[2:]
            return num

        def to_81(num: str) -> str:
            if num.startswith("0"):
                return "81" + num[1:]
            if num.startswith("81"):
                return num
            return num

        def post_once(mobile: str):
            body = {"mobilenumber": mobile, "smstext": data.get("smstext")}
            try:
                r = requests.post(api_url, data=body, headers=headers, timeout=30)
                return r.status_code, (r.text if isinstance(r.text, str) else json.dumps(r.text))
            except Exception as e:
                return 0, str(e)

        # 先尝试本地格式，再根据重试码决定是否使用 81 格式重试
        local_num = to_local(phone_for_api)
        alt_81 = to_81(local_num)

        status1, text1 = post_once(local_num)
        try:
            emit({"evt": "sms_attempt", "attempt": "local", "mobile": local_num, "status": status1}, ja=f"SMS送信試行: {local_num} ステータス {status1}")
        except Exception:
            pass

        final_status, final_text = status1, text1
        retry_attempted = False
        if status1 in retry_codes:
            retry_attempted = True
            status2, text2 = post_once(alt_81)
            try:
                emit({"evt": "sms_retry", "attempt": "alt_81", "mobile": alt_81, "status": status2}, ja=f"SMS再試行: {alt_81} ステータス {status2}")
            except Exception:
                pass
            final_status, final_text = status2, text2

        # 映射供应商返回到统一的 code/message/level（参考 src/lib/smsCodes.ts）
        SMS_CONSOLE = {
            "200": ("success", "Success / 送信成功"),
            "401": ("failed", "Authorization Required / 認証エラー"),
            "402": ("failed", "Overlimit / 送信上限超過（Failed to send due to Overlimit）"),
            "405": ("failed", "Method not allowed / メソッドが許可されていない"),
            "414": ("failed", "URL が長過ぎる（GET では 8190 bytes 超）"),
            "500": ("error",  "Internal Server Error / 内部サーバーエラー"),
            "502": ("error",  "Bad gateway / サービス障害"),
            "503": ("error",  "Temporary unavailable / 秒間リクエスト上限(80 req/sec) 到達"),
            "550": ("failed", "Failure / 失敗"),
            "555": ("failed", "IP アドレスがブロックされている（認証エラー連続で発生）"),
            "557": ("failed", "禁止された IP アドレス"),
            "560": ("failed", "携帯番号（mobilenumber）が不正"),
            "562": ("failed", "SMS 送信日時（startdate）が無効"),
            "568": ("failed", "au 向けタイトル（autitle）が不正"),
            "569": ("failed", "SoftBank 向けタイトル（softbanktitle）が不正"),
            "570": ("failed", "SMS テキスト ID（smstextid）が不正"),
            "571": ("failed", "再送信回数（sendingattempts）が不正"),
            "572": ("failed", "再送間隔（resendinginterval）が不正"),
            "573": ("failed", "status の値が不正"),
            "574": ("failed", "SMS ID（smsid）が不正"),
            "575": ("failed", "docomo の値が不正"),
            "576": ("failed", "au の値が不正"),
            "577": ("failed", "SoftBank の値が不正"),
            "578": ("failed", "SIM の値が不正"),
            "579": ("failed", "gateway の値が不正"),
            "580": ("failed", "SMS タイトル（smstitle）が不正"),
            "585": ("failed", "SMS テキスト（smstext）が不正"),
            "587": ("failed", "SMS ID が一意ではない（重複）"),
            "590": ("failed", "Original URL（originalurl）が不正"),
            "591": ("failed", "SMS テキストタイプが無効（smstext type disabled）"),
            "592": ("failed", "送信許可時間外（Time is disabled）"),
            "598": ("failed", "Docomo 向けタイトル（docomotitle）が不正"),
            "599": ("failed", "再送信機能が無効（有料オプション未契約）"),
            "601": ("failed", "送信元番号選択機能が OFF（サポートへ連絡）"),
            "605": ("failed", "type の値が不正（Invalid type）"),
            "606": ("failed", "この API は無効（This API is disabled）"),
            "608": ("failed", "登録日（registrationdate）が無効（最大24ヶ月前まで）"),
            "610": ("failed", "キャリア判定機能（HLR）が無効"),
            "615": ("failed", "JSON 形式が不正"),
            "624": ("failed", "重複 SMSID（30日以内の同一 smsid）"),
            "631": ("failed", "再送信パラメータ変更不可（権限画面で編集可を ON）"),
            "632": ("failed", "楽天向けタイトルが無効"),
            "633": ("failed", "楽天向け SMS 本文が無効"),
            "634": ("failed", "楽天向け SMS 本文が上限超過"),
            "639": ("failed", "短縮URL アクセス機能が無効"),
            "664": ("failed", "テンプレートと本文の必須パラメータに過不足あり"),
            "666": ("failed", "IP ブロック直前（認証エラー累積 9 回目）"),
        }

        def extract_code(text, http_status):
            # 尝试解析 JSON 字段
            try:
                obj = json.loads(text)
                for k in ("code", "status", "result", "result_code", "error_code", "ErrorCode"):
                    if k in obj and obj[k] is not None:
                        return str(obj[k]).upper()
                if isinstance(obj.get("error"), dict) and obj.get("error").get("code"):
                    return str(obj.get("error").get("code")).upper()
            except Exception:
                pass
            # 简单 XML / KV / 数字提取
            try:
                m = re.search(r"<\s*(?:Code|Status|Result)\s*>\s*([^<\s]+)\s*<\\s*(?:Code|Status|Result)\s*>", text, re.I)
                if m:
                    return m.group(1).upper()
            except Exception:
                pass
            try:
                m = re.search(r"\b(?:code|status|result)\s*[:=]\s*[\"']?([A-Za-z0-9_-]{2,})", text, re.I)
                if m:
                    return m.group(1).upper()
            except Exception:
                pass
            try:
                m = re.search(r"\b([1-9][0-9]{2})\b", text)
                if m:
                    return m.group(1)
            except Exception:
                pass
            return str(http_status) if http_status else None

        raw_code = extract_code(final_text or "", final_status)
        # 规范化 code：去空白、去引号，保留字母数字下划线和短横线；大写化
        code = None
        try:
            if raw_code is not None:
                cstr = str(raw_code).strip()
                # 去除外层引号
                if (cstr.startswith('"') and cstr.endswith('"')) or (cstr.startswith("'") and cstr.endswith("'")):
                    cstr = cstr[1:-1]
                # 仅保留常见安全字符
                cstr = re.sub(r"[^A-Za-z0-9_\-]", "", cstr)
                cstr = cstr.upper()
                if cstr:
                    code = cstr
        except Exception:
            code = None

        # 如果没有解析到 code，但 HTTP 状态是 200，则把 code 设为 '200' 以便映射
        try:
            if not code and final_status == 200:
                code = "200"
        except Exception:
            pass

        level = None
        message = None
        if code and code in SMS_CONSOLE:
            level, message = SMS_CONSOLE[code]
            message = f"コード {code}: {message}"
        elif code:
            level = "failed"
            message = f"コード {code}: 未定義のコード"
        else:
            level = "error"
            message = "コードを取得できませんでした"

        result = {
            "success": final_status == 200,
            "provider": "sms-api",
            "status": final_status,
            "code": code,
            "level": level,
            "message": message,
            "output": final_text,
            "retry_attempted": retry_attempted,
        }
        try:
            emit({"event": "sms_result_normalized", "status": final_status, "code": code, "level": level}, ja=(f"SMS結果: {level} コード {code}" if code else "SMS結果: 解析できませんでした"))
        except Exception:
            pass
        # If HTTP status is 200 treat as success-level by default to match terminal indication
        try:
            if result.get("status") == 200 and result.get("level") != "success":
                result["level"] = "success"
                # keep existing message but ensure there is some note
                if not result.get("message"):
                    result["message"] = "HTTP 200: treated as success"
        except Exception:
            pass

        return result
    except Exception as e:
        return {"success": False, "error": str(e)}

def evaluate_sms_target(driver, info):
    """
    基于用户配置的target_rules判断是否应该发送短信。
    需要姓名、性别、年龄全部条件都符合才返回True。
    参考 /src/app/api/rpa/personal-info/route.ts 的逻辑
    """
    try:
        # 获取用户的target_rules配置
        target_rules = cfg.get("target_rules") if isinstance(cfg, dict) else {}
        if not target_rules:
            # 如果没有配置规则，使用默认简单规则
            phone = (info.get("__標準_電話番号__") or 
                    info.get("電話番号") or 
                    info.get("phone") or "")
            pd = re.sub(r"[^0-9]", "", str(phone))
            if not pd or len(pd) < 7:
                return False
            
            age = None
            a = (info.get("__標準_年齢__") or 
                 info.get("age") or 
                 info.get("年齢"))
            try:
                age = int(str(a)) if a else None
            except Exception:
                age = None
            return age is None or age >= 18

        # 1. 检查姓名条件（去除括号内容，仅用主名部分判断类型）
        raw_name = info.get("姓名（ふりがな）") or info.get("name") or ""
        # 去除全角/半角括号及其中内容
        name = re.sub(r"[（(][^）)]*[）)]", "", raw_name).strip()
        name_checks = target_rules.get("nameChecks", {})
        name_configured = any([
            name_checks.get("kanji"),
            name_checks.get("katakana"),
            name_checks.get("hiragana"),
            name_checks.get("alphabet")
        ])
        name_pass = False
        if name_configured:
            # 只要满足任一勾选条件即可
            if name_checks.get("kanji") and re.search(r'[\u4e00-\u9fff]', name):
                name_pass = True
            if name_checks.get("katakana") and re.search(r'[\u30a0-\u30ff]', name):
                name_pass = True
            if name_checks.get("hiragana") and re.search(r'[\u3040-\u309f]', name):
                name_pass = True
            if name_checks.get("alphabet") and re.search(r'[A-Za-z]', name):
                name_pass = True

        # 2. 检查性别和年龄条件
        gender_raw = info.get("性別") or info.get("gender") or ""
        gender = None
        if "男" in gender_raw or "male" in gender_raw.lower():
            gender = "male"
        elif "女" in gender_raw or "female" in gender_raw.lower():
            gender = "female"

        age = None
        a = (info.get("__標準_年齢__") or 
             info.get("age") or 
             info.get("年齢"))
        try:
            age = int(str(a)) if a else None
        except Exception:
            age = None

        gender_pass = True
        age_rules = target_rules.get("age", {})
        if gender and age_rules.get(gender):
            gender_rule = age_rules[gender]
            gender_configured = bool(
                isinstance(gender_rule.get("include"), bool) or
                isinstance(gender_rule.get("skip"), bool) or
                gender_rule.get("min") is not None or
                gender_rule.get("max") is not None
            )
            
            if gender_configured:
                # 检查include/skip标志
                include_flag = None
                if isinstance(gender_rule.get("include"), bool):
                    include_flag = gender_rule["include"]
                elif isinstance(gender_rule.get("skip"), bool):
                    include_flag = not gender_rule["skip"]
                
                if include_flag is False:
                    gender_pass = False
                
                # 检查年龄范围
                min_age = gender_rule.get("min")
                max_age = gender_rule.get("max")
                if min_age is not None or max_age is not None:
                    if age is None:
                        gender_pass = False
                    elif min_age is not None and age < min_age:
                        gender_pass = False
                    elif max_age is not None and age > max_age:
                        gender_pass = False

        # 3. 所有配置的条件都必须通过
        any_rule_configured = name_configured or (gender and age_rules.get(gender))
        if not any_rule_configured:
            return None  # 没有配置规则，返回None让后端决定
        
        # 需要所有配置的组都通过
        if not name_pass:
            return False
        if not gender_pass:
            return False
            
        return True
        
    except Exception as e:
        print(f"evaluate_sms_target error: {e}", file=sys.stderr)
        return False

# ========= 主流程 =========
def main():
    # 支持监控模式：如果 stdin config 指定 monitor=True，则持续运行并按 poll_interval (秒) 检查新邮件
    results_batch = []
    # 读取配置（已在模块顶部处理），允许从 cfg 里取 monitor / poll_interval
    # 默认短轮询：5 秒（按要求，输入 UID 后希望每 5 秒检查一次）
    monitor = False
    poll_interval = 5
    try:
        cfg_global = globals().get('cfg')
        if isinstance(cfg_global, dict):
            # 若 cfg 明确包含 monitor 字段，则以其为准；否则当环境有 USER_UID 时默认启用监控
            if 'monitor' in cfg_global:
                monitor = bool(cfg_global.get('monitor'))
            else:
                monitor = bool(os.environ.get('USER_UID'))

            try:
                poll_interval = int(cfg_global.get('poll_interval') or poll_interval)
            except Exception:
                pass
        else:
            # 未提供 cfg：若运行环境有 USER_UID，则默认进入监控模式
            monitor = bool(os.environ.get('USER_UID'))
    except Exception:
        pass

    stop_requested = False
    import signal

    def _handle_sig(signum, frame):
        nonlocal stop_requested
        stop_requested = True
        print(json.dumps({"event": "shutdown", "timestamp": int(time.time() * 1000)}), file=sys.stderr, flush=True)

    signal.signal(signal.SIGINT, _handle_sig)
    signal.signal(signal.SIGTERM, _handle_sig)

    driver = None
    try:
        while not stop_requested:
            # indicate we are about to poll the mailbox
            try:
                emit({"event": "polling_mailbox", "poll_interval": poll_interval}, ja="メールボックスを確認しています...")
            except Exception:
                pass

            msgs = get_all_target_unread_messages(SUBJECT_KEYWORD)

            # No unread messages -> show a per-second countdown and continue
            if not msgs:
                try:
                    emit({"event": "found_unread_count", "count": 0}, ja="未読メールは見つかりませんでした。")
                except Exception:
                    pass

                # Countdown per second for better console visibility; always continue polling
                for sec in range(poll_interval, 0, -1):
                    if stop_requested:
                        break
                    try:
                        # short human-friendly Japanese line
                        print(f"次の確認まで：{sec} 秒", file=sys.stderr)
                    except Exception:
                        pass
                    time.sleep(1)
                continue

            # There are unread messages
            total = len(msgs)
            try:
                emit({"event": "found_unread_count", "count": total}, ja=f"未読メールが見つかりました: {total} 件")
            except Exception:
                pass

            # ensure browser driver
            if driver is None:
                driver = make_driver()

            results_batch = []
            remaining = total
            for idx, (mid, msg) in enumerate(msgs, start=1):
                if stop_requested:
                    break

                # log processing progress
                try:
                    emit({
                        "event": "processing_start",
                        "index": idx,
                        "total": total,
                        "remaining_before": remaining
                    }, ja=f"処理開始: {idx}/{total}")
                except Exception:
                    pass

                target_url = extract_target_link_from_email(msg)
                if not target_url:
                    # No Indeed target link found — do NOT mark as read, leave for manual inspection
                    try:
                        print(json.dumps({"event": "processing_skip", "reason": "no_target_url_keep_unread", "remaining_before": remaining, "timestamp": int(time.time() * 1000)}), file=sys.stderr, flush=True)
                    except Exception:
                        pass
                    remaining -= 1
                    continue

                processed_ok = False
                ent = None
                try:
                    site_login_and_open(driver, target_url, SITE_USER, SITE_PASS)
                    ensure_in_latest_tab(driver)
                    try_accept_cookies(driver)
                    info = extract_all_fields(driver)
                    ent = pretty_print_info(info, source_url=target_url)
                    try:
                        ent["should_send_sms"] = evaluate_sms_target(driver, info)
                    except Exception:
                        ent["should_send_sms"] = False

                    # send SMS if configured
                    if ent.get("should_send_sms") and ent.get("phone"):
                        try:
                            sms_result = send_sms_if_configured(ent["phone"], ent["name"])
                            ent["sms_sent"] = sms_result.get("success", False)
                            ent["sms_response"] = sms_result
                        except Exception as e:
                            emit({"event": "sms_send_failed", "error": str(e)}, ja="SMS送信に失敗しました")
                            ent["sms_sent"] = False
                            ent["sms_response"] = {"success": False, "error": str(e)}
                    else:
                        ent["sms_sent"] = False
                        ent["sms_response"] = None

                    results_batch.append(ent)
                    processed_ok = True

                except (InvalidSessionIdException, WebDriverException) as e:
                    msg = str(e).lower()
                    if any(k in msg for k in ("invalid session id", "chrome not reachable", "disconnected", "session not created")):
                        try:
                            try:
                                safe_quit(driver, reason='rebuild_after_session_error')
                            except:
                                pass
                            try:
                                _save_debug_snapshot(driver, tag='session_error_before_rebuild')
                            except Exception:
                                pass
                            driver = make_driver()
                            # retry once
                            try:
                                site_login_and_open(driver, target_url, SITE_USER, SITE_PASS)
                                ensure_in_latest_tab(driver); try_accept_cookies(driver)
                                info = extract_all_fields(driver)
                                ent = pretty_print_info(info, source_url=target_url)
                                try:
                                    ent["should_send_sms"] = evaluate_sms_target(driver, info)
                                except Exception:
                                    ent["should_send_sms"] = False

                                if ent.get("should_send_sms") and ent.get("phone"):
                                    try:
                                        sms_result = send_sms_if_configured(ent["phone"], ent["name"])
                                        ent["sms_sent"] = sms_result.get("success", False)
                                        ent["sms_response"] = sms_result
                                    except Exception as e2:
                                        emit({"event": "sms_send_failed", "error": str(e2)}, ja="SMS送信に失敗しました")
                                        ent["sms_sent"] = False
                                        ent["sms_response"] = {"success": False, "error": str(e2)}
                                else:
                                    ent["sms_sent"] = False
                                    ent["sms_response"] = None

                                results_batch.append(ent)
                                processed_ok = True
                            except Exception as e2:
                                emit({"event": "processing_after_rebuild_error", "error": str(e2)}, ja="再構築後の処理でエラーが発生しました")
                                try:
                                    _save_debug_snapshot(driver, tag='session_error_after_rebuild')
                                except Exception:
                                    pass
                        except Exception:
                            emit({"event": "driver_rebuild_failed"}, ja="ブラウザの再作成に失敗しました")
                    else:
                        emit({"event": "processing_error", "error": str(e)}, ja="処理中にエラーが発生しました")

                except Exception as e:
                    emit({"event": "processing_error", "error": str(e)}, ja="処理中にエラーが発生しました")
                    try:
                        _save_debug_snapshot(driver, tag='processing_exception')
                    except Exception:
                        pass

                # Only mark message as read when processing succeeded
                try:
                    if processed_ok and ent:
                        try:
                            mark_message_seen(mid)
                        except Exception:
                            pass

                        # write single history entry for this result if USER_UID available
                        try:
                            uid_env = os.environ.get('USER_UID')
                            if uid_env:
                                now_ms = int(time.time() * 1000)
                                written_iso = datetime.datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                                # Build normalized, frontend-friendly entry (single immediate write only)
                                history_entry = {
                                    "createdAt": now_ms,
                                    "name": ent.get("name") or ent.get("姓名（ふりがな）") or "",
                                    "phone": ent.get("phone") or ent.get("電話番号") or "",
                                    "gender": ent.get("gender") or ent.get("性別") or "",
                                    "birth": ent.get("birth") or ent.get("生年月日") or "",
                                    "age": ent.get("age") or ent.get("__標準_年齢__") or "",
                                    "source_url": ent.get("source_url") or target_url,
                                    "is_sms_target": bool(ent.get("should_send_sms", False)),
                                    "sms_sent": ent.get("sms_sent"),
                                    "sms_response": ent.get("sms_response"),
                                    "level": "success",
                                    "_written_at": written_iso,
                                    "_worker_version": "1.0",
                                }
                                # Normalize name/furigana and phone before write happens inside writer
                                try:
                                    emit({"event": "about_to_write_history", "uid": uid_env, "name": history_entry.get("name")}, ja="履歴を保存します...")
                                    write_history_entry_to_firestore(uid_env, history_entry)
                                except Exception:
                                    emit({"event": "about_to_write_history_failed", "uid": uid_env}, ja="履歴の保存処理でエラーが発生しました。")
                        except Exception:
                            pass
                except Exception:
                    pass

                remaining -= 1
                try:
                    emit({"event": "processing_done", "index": idx, "total": total, "remaining_after": remaining}, ja=f"処理完了: {idx}/{total}")
                except Exception:
                    pass

            # output batch as JSON line
            try:
                out = {"success": True, "timestamp": int(time.time() * 1000), "results": results_batch}
                # Print human-friendly candidate cards to stderr before emitting JSON
                try:
                    for r in (results_batch or []):
                        try:
                            card = format_candidate_card(r, uid=os.environ.get('USER_UID'))
                            print(card, file=sys.stderr)
                            print("-" * 40, file=sys.stderr)
                        except Exception:
                            pass
                except Exception:
                    pass
                # JSON to stdout (kept for log collectors)
                print(json.dumps(out, ensure_ascii=False), flush=True)
            except Exception:
                pass

            # Note: batch-level history write removed to avoid duplicate entries.

            if not monitor:
                return

            # after processing, countdown again before next poll (per-second visibility)
            for sec in range(poll_interval, 0, -1):
                if stop_requested:
                    break
                try:
                    # Use unified emit helper so human operators see a short Japanese line
                    # and detailed JSON is only printed when DEBUG_JSON is enabled.
                    emit({"event": "countdown", "seconds_left": sec}, ja=f"次の確認まで：{sec} 秒")
                except Exception:
                    pass
                time.sleep(1)
    finally:
        try:
            if driver:
                safe_quit(driver, reason='final_cleanup')
        except:
            pass

if __name__ == "__main__":
    if sys.platform.startswith("win"): os.environ['PYTHONIOENCODING'] = 'utf-8'
    try:
        main()
    except Exception:
        # Print full traceback for debugging
        traceback.print_exc(file=sys.stderr)
        try:
            print(json.dumps({"evt": "unhandled_exception", "ts": int(time.time()*1000)}), file=sys.stderr, flush=True)
        except Exception:
            pass
        # If user set KEEP_BROWSER_OPEN or NO_SYS_EXIT, keep process alive for inspection
        if os.environ.get('KEEP_BROWSER_OPEN') or os.environ.get('NO_SYS_EXIT'):
            # 保存当前 driver 的快照（若存在），以便远程诊断
            try:
                # driver may be in outer scope; attempt to access
                drv = None
                try:
                    drv = globals().get('driver')
                except Exception:
                    drv = None
                try:
                    if drv:
                        _save_debug_snapshot(drv, tag='unhandled_exception')
                except Exception:
                    pass
            except Exception:
                pass
            try:
                print(json.dumps({"evt": "enter_debug_hold", "reason": "KEEP_BROWSER_OPEN or NO_SYS_EXIT set" , "ts": int(time.time()*1000)}), file=sys.stderr, flush=True)
            except Exception:
                pass
            try:
                while True:
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        # otherwise exit with non-zero
        sys.exit(1)
