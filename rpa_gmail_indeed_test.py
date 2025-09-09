#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, re, imaplib, email, time, datetime, urllib.parse, sys
from email.header import decode_header
from bs4 import BeautifulSoup, Tag

from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import undetected_chromedriver as uc
from selenium.webdriver.support.ui import WebDriverWait as WW
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.action_chains import ActionChains

# ========= 配置 =========
IMAP_HOST = "imap.gmail.com"
IMAP_USER = "wangxiyue0711@gmail.com"
IMAP_PASS = "dvmwjjztjeqnwslf"

SITE_USER = "info@rec-lab.biz"
SITE_PASS = "reclab0601"

SUBJECT_KEYWORD = "【新しい応募者のお知らせ】"
ALLOWED_DOMAINS = {"indeed.com", "jp.indeed.com", "indeedemail.com", "cts.indeed.com"}

# ========= 工具 =========
def decode_any(s):
    if not s: return ""
    if isinstance(s, bytes):
        try: return s.decode("utf-8")
        except: return s.decode("latin1", errors="ignore")
    return s

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

def extract_target_link_from_email(msg):
    html = None
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                html = decode_any(part.get_payload(decode=True)); break
    else:
        if msg.get_content_type() == "text/html":
            html = decode_any(msg.get_payload(decode=True))
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
    print("如需首次登录，请在浏览器手动完成登录，然后回车继续...")
    input(">>> 按回车继续 ...")

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

def pretty_print_info(info):
    name = info.get("姓名（ふりがな）", "")
    phone = info.get("電話番号", "")
    gender = info.get("性別", "")
    birth = info.get("生年月日", "")
    age = info.get("__標準_年齢__", "")
    
    print(f"姓名（ふりがな）：{name} | 電話番号：{phone} | 性別：{gender} | 生年月日：{birth} | 年齢：{age}")
    print("=" * 100)

# ========= 主流程 =========
def main():
    msgs = get_all_target_unread_messages(SUBJECT_KEYWORD)
    if not msgs:
        print("没有匹配标题的未读邮件。"); return
    driver = make_driver()
    try:
        for mid, msg in msgs:
            target_url = extract_target_link_from_email(msg)
            if not target_url:
                print("未找到链接"); continue
            site_login_and_open(driver, target_url, SITE_USER, SITE_PASS)
            ensure_in_latest_tab(driver); try_accept_cookies(driver)
            info = extract_all_fields(driver)
            pretty_print_info(info)
        input(">>> 按回车退出（不会自动关闭）...")
    finally:
        driver.quit()

if __name__ == "__main__":
    if sys.platform.startswith("win"): os.environ['PYTHONIOENCODING'] = 'utf-8'
    main()
