#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, re, imaplib, email, time, datetime, urllib.parse, sys
import json
from email.header import decode_header
from bs4 import BeautifulSoup, Tag

from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import undetected_chromedriver as uc
from selenium.webdriver.support.ui import WebDriverWait as WW
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

# 尝试把 stdout 设置为 utf-8（在某些 Windows 环境下需要）
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')

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


def try_fetch_cfg_from_firestore_if_available(user_uid: str):
    """尝试使用 GOOGLE_APPLICATION_CREDENTIALS 拉取 Firestore 中的 user_configs/{user_uid} 文档。
    若环境或依赖不可用则返回 None。
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except Exception:
        return None

    try:
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
        print("ERROR: no IMAP credentials provided. Provide --cfg-file, stdin JSON with email_config, or set USER_UID + GOOGLE_APPLICATION_CREDENTIALS to fetch from Firestore.", file=sys.stderr)
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
            cand = peel_indeed_redirect(a["href"])
            if domain_allowed(cand): return cand
    for a in soup.find_all("a", href=True):
        cand = peel_indeed_redirect(a["href"])
        if domain_allowed(cand): return cand
    return None

# ========= 浏览器 =========
def make_driver():
    opts = Options()
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1400,950")
    user_data_dir = os.path.abspath("chrome_user_data")
    opts.add_argument(f"--user-data-dir={user_data_dir}")
    return uc.Chrome(options=opts)

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
    print("未检测到応募者情報，尝试自动登录（若提供凭证）...", file=sys.stderr)
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
                            print("自动登录成功", file=sys.stderr)
                            return
                        except Exception:
                            # 登录后仍未检测到目标，继续但不阻塞
                            print("自动登录尝试完毕，但未检测到応募者情報；继续运行（可能需要手动登录）", file=sys.stderr)
                    except Exception:
                        print("尝试填写登录表单失败，继续...", file=sys.stderr)
                else:
                    print("未找到登录表单元素，可能已在登录状态或使用其他登录方式", file=sys.stderr)
            except Exception:
                    print("自动登录流程发生异常，继续...", file=sys.stderr)
        else:
            print("未提供 SITE_USER/SITE_PASS，跳过自动登录", file=sys.stderr)
    except Exception as e:
        print("自动登录捕获异常:", e, file=sys.stderr)

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


def evaluate_sms_target(driver, info):
    """
    基于页面 DOM 与已抓取字段决定是否应该发送短信。
    规则（合理假设）：
      - 必须有电话号码（数字长度 >=7）
      - 若能解析年龄且 <18 则不发送
      - 若页面包含明显的拒否关键词（如 'SMS不可', '連絡不可', '連絡しない'）则不发送
      - 若页面包含明确同意关键词（如 'SMS可', '連絡可', '同意'）则优先允许
      - 否则在满足电话和年龄条件下允许发送
    """
    try:
        phone = (info.get("__標準_電話番号__") or info.get("phone") or "")
        pd = re.sub(r"[^0-9]", "", str(phone))
        if not pd or len(pd) < 7:
            return False

        age = None
        a = info.get("__標準_年齢__") or info.get("age")
        try:
            age = int(str(a)) if a else None
        except Exception:
            age = None
        if age is not None and age < 18:
            return False

        # 检查页面文本中的关键词
        try:
            text = BeautifulSoup(driver.page_source or "", "html.parser").get_text("\n", strip=True)
            low = text.lower()
            # 明确拒否词
            deny_keywords = ["sms不可", "連絡不可", "連絡しない", "連絡希望しない", "電話不可", "sms拒否", "smsを受け取らない"]
            for k in deny_keywords:
                if k in low:
                    return False
            # 明确同意词
            allow_keywords = ["sms可", "連絡可", "同意", "smsを受け取る"]
            for k in allow_keywords:
                if k in low:
                    return True
        except Exception:
            pass

        # 默认：满足电话与年龄则发送
        return True
    except Exception:
        return False

# ========= 主流程 =========
def main():
    # 支持监控模式：如果 stdin config 指定 monitor=True，则持续运行并按 poll_interval (秒) 检查新邮件
    results_batch = []
    # 读取配置（已在模块顶部处理），允许从 cfg 里取 monitor / poll_interval
    monitor = False
    poll_interval = 300
    try:
        if isinstance(globals().get('cfg'), dict):
            monitor = bool(globals()['cfg'].get('monitor'))
            poll_interval = int(globals()['cfg'].get('poll_interval') or poll_interval)
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
            msgs = get_all_target_unread_messages(SUBJECT_KEYWORD)
            if not msgs:
                # 没有新消息：在非监控模式下立即返回；在监控模式下等待并继续
                if not monitor:
                    print(json.dumps({"success": True, "results": [], "message": "no_unread"}, ensure_ascii=False), flush=True)
                    return
                else:
                    print(json.dumps({"event": "idle", "timestamp": int(time.time() * 1000)}), file=sys.stderr, flush=True)
                    time.sleep(poll_interval)
                    continue

            # 确保浏览器驱动已创建
            if driver is None:
                driver = make_driver()

            results_batch = []
            for mid, msg in msgs:
                if stop_requested: break
                target_url = extract_target_link_from_email(msg)
                if not target_url:
                    # 标记已读以避免重复尝试
                    try:
                        mark_message_seen(mid)
                    except Exception:
                        pass
                    continue
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
                    results_batch.append(ent)
                except Exception as e:
                    print("error processing target:", e, file=sys.stderr)
                finally:
                    # 处理完成后标记消息为已读
                    try:
                        mark_message_seen(mid)
                    except Exception:
                        pass

            # 打印 batch 结果为一行 JSON（可被流式消费）
            try:
                out = {"success": True, "timestamp": int(time.time() * 1000), "results": results_batch}
                print(json.dumps(out, ensure_ascii=False), flush=True)
            except Exception:
                pass

            if not monitor:
                return

            # 监控模式：等待再检查
            sleep_left = poll_interval
            while sleep_left > 0 and not stop_requested:
                time.sleep(min(5, sleep_left))
                sleep_left -= 5
    finally:
        try:
            if driver:
                driver.quit()
        except:
            pass

if __name__ == "__main__":
    if sys.platform.startswith("win"): os.environ['PYTHONIOENCODING'] = 'utf-8'
    main()
