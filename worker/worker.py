#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lightweight Firestore-backed worker for running RPA jobs.

Usage (Windows):
- Install Python 3.8+
- pip install -r requirements.txt
- Set GOOGLE_APPLICATION_CREDENTIALS (or use --sa-file)
- Run: python worker.py  （常驻轮询）
- 或:  python worker.py --once             （处理一条就退出）
- 或:  python worker.py --max-runtime 60   （最多运行60分钟后退出）

Env:
- RPA_WORKER_POLL_SECONDS (default 5)
- RPA_JOB_COLLECTION (default rpa_jobs)
- RPA_HISTORY_COLLECTION (default rpa_history)
- RPA_SCRIPT_PATH (optional absolute path)
- RPA_SCRIPT_URL  (optional,当本地没脚本时自动下载)
- SERVICE_ACCOUNT_PATH (作为 GOOGLE_APPLICATION_CREDENTIALS 的备选)

Exit/“关不掉”改良点：
- 所有阻塞性的 input() 改为仅 TTY 下才生效
- 捕获 SIGINT/SIGTERM/SIGBREAK，安全退出 while 循环
"""

import os
import sys
import time
# Reduce noisy native logs (gRPC / glog / absl) early
os.environ.setdefault("GRPC_VERBOSITY", "ERROR")
os.environ.setdefault("GRPC_TRACE", "")
os.environ.setdefault("GLOG_minloglevel", "2")
import json
import socket
import tempfile
import subprocess
import re
from datetime import datetime, timedelta, timezone
import getpass
import urllib.request
import shutil
import signal
from typing import Optional
import traceback

# ----------------- Third-party -----------------
try:
    from google.cloud import firestore
except Exception as e:
    def _eprint(*a, **k): print(*a, **k, file=sys.stderr)
    _eprint("依存関係が不足しています: google-cloud-firestore をインストールしてください（pip install -r requirements.txt）")
    # 仅在交互式终端暂停，避免服务模式“关不掉”
    if sys.stdin.isatty():
        try: input("続行するには Enter を押してください...")
        except EOFError: pass
    raise

try:
    from google.oauth2 import service_account as oauth_service_account
except Exception:
    oauth_service_account = None

try:
    import firebase_admin
    from firebase_admin import credentials as fb_credentials
    from firebase_admin import auth as fb_auth
except Exception:
    firebase_admin = None

try:
    from cryptography.fernet import Fernet
except Exception:
    Fernet = None
# ------------------------------------------------

POLL_INTERVAL = int(os.environ.get("RPA_WORKER_POLL_SECONDS", "5"))
JOB_COLLECTION = os.environ.get("RPA_JOB_COLLECTION", "rpa_jobs")
HISTORY_COLLECTION = os.environ.get("RPA_HISTORY_COLLECTION", "rpa_history")
RPA_SCRIPT = os.environ.get("RPA_SCRIPT_PATH", None)  # optional override

STOP = False  # 信号控制
START_TIME = datetime.now(timezone.utc)

def now_iso() -> str:
    # return RFC3339-like UTC 'Z' timestamp with timezone-aware datetime
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def eprint(*a, **k):
    print(*a, **k, file=sys.stderr, flush=True)

def pause_if_tty(msg="続行するには Enter を押してください..."):
    if sys.stdin.isatty():
        try: input(msg)
        except EOFError: pass

def handle_signal(signum, frame):
    global STOP
    STOP = True
    print(f"[{now_iso()}] Got signal {signum}, preparing to stop...", flush=True)

# 注册信号（Windows 也支持 SIGBREAK）
for s in (getattr(signal, "SIGINT", None),
          getattr(signal, "SIGTERM", None),
          getattr(signal, "SIGBREAK", None)):
    if s:
        try:
            signal.signal(s, handle_signal)
        except Exception:
            pass

def parse_args():
    import argparse
    p = argparse.ArgumentParser(description="Firestore RPA Worker")
    p.add_argument("--sa-file", "--service-account", dest="sa_file", help="Path to service account JSON")
    p.add_argument("--once", action="store_true", help="Process at most one queued job then exit")
    p.add_argument("--uid", dest="uid", help="Run RPA immediately for this user UID (single-run)")
    p.add_argument("--max-runtime", type=int, default=0, help="Max runtime in minutes (0 = unlimited)")
    p.add_argument("--log-stdout", action="store_true", help="Print child stdout even if it is JSON")
    p.add_argument("--script", dest="script", help="Override RPA script path")
    return p.parse_args()

def resolve_service_account_path(cli_path: Optional[str]) -> Optional[str]:
    if cli_path and os.path.exists(cli_path):
        return cli_path
    for key in ("GOOGLE_APPLICATION_CREDENTIALS", "SERVICE_ACCOUNT_PATH"):
        v = os.environ.get(key)
        if v and os.path.exists(v):
            return v
    return None

def find_rpa_script(cli_override: Optional[str]) -> str:
    # 只引用 worker 目录下的 rpa_gmail_indeed_test.py
    here = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.join(here, "rpa_gmail_indeed_test.py")
    if os.path.exists(candidate):
        return candidate
    raise FileNotFoundError("worker/rpa_gmail_indeed_test.py not found; 请确保脚本在 worker 目录下")

def firestore_client(sa_path: Optional[str]):
    if oauth_service_account and sa_path:
        try:
            creds = oauth_service_account.Credentials.from_service_account_file(sa_path)
            return firestore.Client(credentials=creds, project=creds.project_id)
        except Exception as e:
            eprint("Failed to init Firestore with SA credentials; fallback to default:", e)
    return firestore.Client()

def claim_job_transactional(db, doc_ref, hostname):
    @firestore.transactional
    def _claim(tx):
        snap = doc_ref.get(transaction=tx)
        data = snap.to_dict() or {}
        if data.get("status") != "queued":
            return False
        tx.update(doc_ref, {
            "status": "running",
            "claimed_by": hostname,
            "started_at": now_iso(),
        })
        return True

    tx = db.transaction()
    try:
        return _claim(tx)
    except Exception:
        return False

def run_rpa_script(rpa_script, cfg_json, log_stdout=False, extra_env: Optional[dict] = None, timeout_seconds: Optional[int] = 60 * 10):
    cmd = [sys.executable, rpa_script]
    tmpf = None
    if cfg_json:
        tmpf = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".json", encoding="utf-8")
        # Ensure cfg_json is JSON-serializable (convert Firestore timestamps etc.)
        try:
            safe_cfg = _sanitize_for_firestore(cfg_json)
        except Exception:
            safe_cfg = cfg_json
        json.dump(safe_cfg, tmpf, ensure_ascii=False)
        tmpf.close()
        cmd += ["--cfg-file", tmpf.name]

    print(f"[{now_iso()}] 実行: {' '.join(cmd)}", flush=True)
    try:
        # Prepare environment for subprocess: merge current env with extra_env
        env = os.environ.copy()
        if extra_env and isinstance(extra_env, dict):
            for k, v in extra_env.items():
                if v is None:
                    env.pop(k, None)
                else:
                    env[str(k)] = str(v)

        stream_mode = timeout_seconds is None
        run_kwargs = {
            'text': True,
            'encoding': 'utf-8',
            'errors': 'replace',
            'env': env,
        }

        if stream_mode:
            # Long-running monitor mode: let child inherit stdio so console shows live output.
            # subprocess.run will block until child exits (which is desired for monitor jobs).
            res = subprocess.run(cmd, **run_kwargs)
            stdout = None
            stderr = None
        else:
            run_kwargs.update({'capture_output': True, 'timeout': int(timeout_seconds)})
            res = subprocess.run(cmd, **run_kwargs)
            stdout = (res.stdout or "").strip()
            stderr = (res.stderr or "").strip()

        print(f"[{now_iso()}] RPA 終了コード: {res.returncode}", flush=True)
        # Only surface child stderr/stdout when explicitly requested by the user
        # (log_stdout) or when DEBUG_JSON is enabled for machine-readable output.
        debug_json = os.environ.get('DEBUG_JSON')
        if stderr and (log_stdout or (debug_json and debug_json != '0')):
            eprint(f"[{now_iso()}] RPA stderr:\n{stderr}")

        if stdout and (log_stdout or (debug_json and debug_json != '0')):
            print(f"[{now_iso()}] RPA stdout:\n{stdout}", flush=True)

    finally:
        if tmpf:
            try: os.unlink(tmpf.name)
            except Exception:
                pass

    # 优先解析 JSON（如果 child 输出被捕获）
    try:
        if stdout is not None:
            return True, json.loads(stdout)
        else:
            return (res.returncode == 0), {"success": (res.returncode == 0), "exit_code": res.returncode}
    except Exception:
        return False, {"success": False, "raw_stdout": stdout, "exit_code": res.returncode}

def write_history_entry(db, user_uid, entry):
    """写入历史记录，确保数据格式与前端表格兼容"""
    coll = db.collection(HISTORY_COLLECTION).document(user_uid).collection("entries")
    
    # 安全的对象判断：确保entry是字典且有results数组（包括空数组）
    if isinstance(entry, dict) and "results" in entry and isinstance(entry.get("results"), list):
        # 这是带有results数组的RPA输出
        results = entry.get("results", [])
        
        # 如果results为空，不写入任何历史记录（避免产生无意义的记录）
        if not results:
            print(f"[{now_iso()}] Skipping history write for empty results")
            return
            
        now = int(time.time() * 1000)
        
        for i, result in enumerate(results):
            # 确保result也是字典类型
            if not isinstance(result, dict):
                continue
                
            # 转换单个结果为前端表格期望的格式
            history_entry = {
                "createdAt": now + i,  # 每个结果略微错开时间戳避免冲突
                "name": result.get("name") or result.get("姓名（ふりがな）") or "",
                "phone": result.get("phone") or result.get("電話番号") or "", 
                "gender": result.get("gender") or result.get("性別") or "",
                "birth": result.get("birth") or result.get("生年月日") or "",
                "age": result.get("age") or result.get("__標準_年齢__") or "",
                "source_url": result.get("source_url") or "",
                "is_sms_target": bool(result.get("should_send_sms", False)),
                "sms_sent": result.get("sms_sent"),  # 可能是None, True, False
                "sms_response": result.get("sms_response"),  # SMS响应详情
                "level": "success" if result else "info",
                "_written_at": now_iso(),
                "_worker_version": "1.0"
            }
            
            # 提取ふりがな信息
            raw_name = result.get("name") or result.get("姓名（ふりがな）") or ""
            if raw_name:
                furigana_match = re.search(r'(?:\(|\（)\s*([^\)\）]+?)\s*(?:\)|\）)\s*$', str(raw_name))
                if furigana_match:
                    history_entry["furigana"] = furigana_match.group(1).strip()
                    history_entry["name"] = re.sub(r'\（.*?\）|\(.*?\)', '', str(raw_name)).strip()
            
            try:
                coll.add(_sanitize_for_firestore(history_entry))
                print(f"[{now_iso()}] Added history entry for {history_entry['name'] or 'unknown'}")
            except Exception as e:
                print(f"[{now_iso()}] Failed to write history entry: {e}")
    else:
        # 原始格式，直接写入（保持向后兼容）
        # 但跳过明显的RPA状态消息
        if isinstance(entry, dict) and entry.get("message") in ["no_unread"]:
            print(f"[{now_iso()}] Skipping status message: {entry.get('message')}")
            return
            
        entry_copy = dict(entry) if isinstance(entry, dict) else {"raw": entry}
        entry_copy["_written_at"] = now_iso()
        try:
            coll.add(_sanitize_for_firestore(entry_copy))
        except Exception as e:
            print(f"[{now_iso()}] Failed to write raw history entry: {e}")

def should_stop_for_runtime(max_minutes: int) -> bool:
    if max_minutes <= 0:
        return False
    deadline = START_TIME + timedelta(minutes=max_minutes)
    return datetime.now(timezone.utc) >= deadline


def _sanitize_for_firestore(obj):
    """Recursively convert Firestore-specific types (e.g., DatetimeWithNanoseconds)
    and other non-JSON-friendly values into JSON-serializable Python types.
    """
    try:
        # builtin simple types
        if obj is None or isinstance(obj, (bool, int, float, str)):
            return obj
        # datetime -> ISO
        if isinstance(obj, datetime):
            return obj.isoformat().replace('+00:00', 'Z') if obj.tzinfo else obj.isoformat() + 'Z'
        # bytes -> base64
        if isinstance(obj, (bytes, bytearray)):
            try:
                import base64

                return base64.b64encode(bytes(obj)).decode('ascii')
            except Exception:
                return str(obj)
        # mapping
        if isinstance(obj, dict):
            return {k: _sanitize_for_firestore(v) for k, v in obj.items()}
        # list/tuple
        if isinstance(obj, (list, tuple)):
            return [_sanitize_for_firestore(v) for v in obj]

        # Firestore timestamp types: google.protobuf.Timestamp, or
        # google.cloud.firestore_v1._helpers.DatetimeWithNanoseconds
        try:
            from google.protobuf.timestamp_pb2 import Timestamp as _Ts

            if isinstance(obj, _Ts):
                # convert to RFC3339
                return datetime.fromtimestamp(obj.seconds, timezone.utc).isoformat().replace('+00:00', 'Z')
        except Exception:
            pass

        try:
            # DatetimeWithNanoseconds is sometimes provided by google.api_core
            from google.api_core.datetime_helpers import DatetimeWithNanoseconds as _DTWN
            if isinstance(obj, _DTWN):
                try:
                    if obj.tzinfo:
                        return obj.isoformat().replace('+00:00', 'Z')
                    else:
                        return obj.isoformat() + 'Z'
                except Exception:
                    return str(obj)
        except Exception:
            pass

        # Duck-typing: some firestore/protobuf timestamp-like objects expose seconds/nanos
        try:
            if hasattr(obj, 'seconds') and hasattr(obj, 'nanos'):
                try:
                    secs = int(getattr(obj, 'seconds'))
                    nanos = int(getattr(obj, 'nanos'))
                    ts = secs + (nanos / 1_000_000_000)
                    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace('+00:00', 'Z')
                except Exception:
                    return str(obj)
        except Exception:
            pass

        # If object provides conversion helpers, try them
        try:
            to_dt = getattr(obj, 'to_datetime', None)
            if callable(to_dt):
                try:
                    dt = to_dt()
                    return _sanitize_for_firestore(dt)
                except Exception:
                    pass
            ToDt = getattr(obj, 'ToDatetime', None)
            if callable(ToDt):
                try:
                    dt = ToDt()
                    return _sanitize_for_firestore(dt)
                except Exception:
                    pass
        except Exception:
            pass

        # Fallback to str
        return str(obj)
    except Exception:
        return str(obj)


def find_user_config(db, user_identifier: str):
    """Attempt to resolve a user_configs document for user_identifier.

    Returns (doc_id, data_dict) if found, otherwise None.
    Strategy:
    1. Try document with id == user_identifier
    2. Query user_configs where common fields match (authUid, uid, email)
    """
    coll = db.collection("user_configs")
    # 1) direct doc id
    try:
        snap = coll.document(str(user_identifier)).get()
        if snap.exists:
            return snap.id, snap.to_dict() or {}
    except Exception:
        pass

    # 2) try common fields
    fields = ["authUid", "uid", "email", "userUid"]
    for f in fields:
        try:
            q = coll.where(field_path=f, op_string="==", value=user_identifier).limit(1)
            docs = list(q.stream())
            if docs:
                d = docs[0]
                return d.id, d.to_dict() or {}
        except Exception:
            # ignore and continue
            continue

    return None

def cleanup_expired_jobs(db):
    """清理过期的已完成任务，减少数据冗余"""
    try:
        # 删除24小时前完成的任务
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
        cutoff_iso = cutoff_time.isoformat().replace('+00:00', 'Z')
        
        # 查询过期的已完成任务
        expired_query = db.collection(JOB_COLLECTION).where(
            field_path="status", op_string="in", value=["done", "failed"]
        ).where(
            field_path="expires_at", op_string="<=", value=cutoff_iso
        ).limit(50)  # 每次最多清理50个
        
        docs = list(expired_query.stream())
        if docs:
            batch = db.batch()
            for doc in docs:
                batch.delete(doc.reference)
            batch.commit()
            print(f"[{now_iso()}] Cleaned up {len(docs)} expired jobs", flush=True)
            
    except Exception as e:
        eprint("Warning: failed to cleanup expired jobs:", e)

def process_one_job(db, hostname, rpa_script) -> bool:
    """返回是否处理到一条任务（True=处理了/更新了状态，False=队列为空）"""
    # use named args to avoid positional-arg deprecation warning from google-cloud-firestore
    q = db.collection(JOB_COLLECTION).where(field_path="status", op_string="==", value="queued").order_by("created_at").limit(1)
    docs = list(q.stream())
    if not docs:
        return False

    doc = docs[0]
    doc_ref = doc.reference
    doc_id = doc.id
    doc_data = doc.to_dict() or {}

    # transactional claim
    if not claim_job_transactional(db, doc_ref, hostname):
        return True  # 有任务但被别人抢了

    print(f"[{now_iso()}] Claimed job: {doc_id} (user: {doc_data.get('userUid')})", flush=True)

    user_uid = doc_data.get("userUid")
    cfg = doc_data.get("cfg")

    # Resolve user config: rpa_jobs.userUid may not equal user_configs document id.
    resolved_user_doc_id = None
    resolved_cfg = None
    # Prefer an explicit userDocId written by the enqueueing server
    if doc_data.get("userDocId"):
        try:
            snap = db.collection("user_configs").document(str(doc_data.get("userDocId"))).get()
            if snap.exists:
                resolved_user_doc_id = snap.id
                resolved_cfg = snap.to_dict() or {}
        except Exception:
            pass

    if not resolved_user_doc_id and user_uid:
        try:
            resolved_doc = find_user_config(db, user_uid)
            if resolved_doc:
                resolved_user_doc_id, resolved_cfg = resolved_doc
        except Exception as e:
            eprint("Error resolving user config:", e)

    # Prefer cfg embedded in job; otherwise use resolved user config
    if not cfg and resolved_cfg:
        cfg = resolved_cfg

    # Prepare env so child script can fetch user config from Firestore when needed
    extra_env = {}
    # If worker started with service account, expose it to child process
    sa_env = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if sa_env:
        extra_env['GOOGLE_APPLICATION_CREDENTIALS'] = sa_env
    if resolved_user_doc_id:
        extra_env['USER_UID'] = resolved_user_doc_id
    elif user_uid:
        extra_env['USER_UID'] = user_uid

    # If job cfg requests monitor mode, run child script without timeout and stream output
    monitor_mode = False
    try:
        if isinstance(cfg, dict) and bool(cfg.get('monitor')):
            monitor_mode = True
    except Exception:
        monitor_mode = False

    if monitor_mode:
        print(f"[{now_iso()}] Starting RPA in monitor mode for job {doc_id}", flush=True)
        ok, result = run_rpa_script(rpa_script, cfg, log_stdout=False, extra_env=extra_env, timeout_seconds=None)
    else:
        ok, result = run_rpa_script(rpa_script, cfg, log_stdout=False, extra_env=extra_env)

    # 检测是否需要人工
    needs_human = False
    targets = None
    if isinstance(result, dict):
        if result.get("requires_human"):
            needs_human = True
            targets = result.get("requires_human")
        # 安全地处理results数组
        results_list = result.get("results")
        if isinstance(results_list, list):
            for r in results_list:
                if isinstance(r, dict) and r.get("target_url"):
                    needs_human = True
                    targets = (targets or []) + [r.get("target_url")]

    update_payload = {
        "finished_at": now_iso(),
        "result_summary": _sanitize_for_firestore(result),
    }

    if needs_human:
        update_payload["status"] = "needs_human"
        if targets: update_payload["targets"] = targets
        doc_ref.update(update_payload)
        print(f"[{now_iso()}] Job {doc_id} requires human intervention.", flush=True)
        return True

    # 检查是否因缺少凭据失败（exitcode 2 是 rpa 脚本的凭据错误码）
    if not ok and isinstance(result, dict) and result.get("exit_code") == 2:
        update_payload["status"] = "needs_setup"
        update_payload["needs_setup_reason"] = "Missing IMAP credentials in user_configs"
        if resolved_user_doc_id:
            update_payload["suggested_user_doc_id"] = resolved_user_doc_id
        elif user_uid:
            update_payload["suggested_user_uid"] = user_uid
        doc_ref.update(update_payload)
        print(f"[{now_iso()}] Job {doc_id} needs user setup (missing email credentials)", flush=True)
        return True

    # 正常完成 - 标记为 done/failed 并设置过期时间
    update_payload["status"] = "done" if ok else "failed"
    update_payload["completed_at"] = now_iso()
    # 设置24小时后过期，便于后续清理
    import datetime
    expire_time = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
    update_payload["expires_at"] = expire_time.isoformat().replace('+00:00', 'Z')
    doc_ref.update(update_payload)

    if user_uid and not monitor_mode:
        # write history under the resolved user doc id if available, otherwise use original
        # Skip history write in monitor mode since RPA script writes directly to Firestore
        history_uid = resolved_user_doc_id or user_uid
        try:
            write_history_entry(db, history_uid, result if isinstance(result, dict) else {"raw": result})
            print(f"[{now_iso()}] Wrote history for user {history_uid}", flush=True)
        except Exception as e:
            eprint("Warning: failed to write history:", e)
    elif user_uid and monitor_mode:
        print(f"[{now_iso()}] Skipping worker history write in monitor mode (RPA script writes directly)", flush=True)

    return True

def main_loop(once=False, max_runtime_minutes=0, sa_path=None, script_override=None):
    if sa_path and not os.path.exists(sa_path):
        eprint("ERROR: service account JSON not found:", sa_path)
        sys.exit(1)

    # Export service account path into environment so subprocesses (and child scripts)
    # that rely on GOOGLE_APPLICATION_CREDENTIALS can access Firestore.
    if sa_path:
        try:
            os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', sa_path)
        except Exception:
            pass

    db = firestore_client(sa_path)
    hostname = socket.gethostname()
    rpa_script = find_rpa_script(script_override)

    print(f"[{now_iso()}] ワーカー起動: {hostname}（{JOB_COLLECTION} を {POLL_INTERVAL}s ごとに確認）", flush=True)

    # 定期清理过期的任务（每处理100个任务或启动时执行一次）
    cleanup_counter = 0

    if once:
        processed = process_one_job(db, hostname, rpa_script)
        if not processed:
            print(f"[{now_iso()}] No queued jobs.", flush=True)
        return

    while not STOP:
        if should_stop_for_runtime(max_runtime_minutes):
            print(f"[{now_iso()}] Reached max runtime, exiting.", flush=True)
            break

        try:
            processed = process_one_job(db, hostname, rpa_script)
            
            # 每处理100个任务清理一次过期任务
            cleanup_counter += 1
            if cleanup_counter >= 100:
                cleanup_expired_jobs(db)
                cleanup_counter = 0
                
        except Exception as e:
            # Print full traceback to help diagnose serialization / type errors
            try:
                traceback.print_exc()
            except Exception:
                pass
            eprint("ワーカーでエラーが発生しました:", e)
            processed = True  # 避免紧密轮询

        # 没任务就睡一会
        if not processed:
            time.sleep(POLL_INTERVAL)


def run_once_for_uid(db, hostname, rpa_script, uid: str):
    """Run RPA once for a specific user UID (helper for manual UID paste flow)."""
    try:
        print(f"[{now_iso()}] Running one-off job for UID: {uid}", flush=True)
        snap = db.collection("user_configs").document(str(uid)).get()
        if not snap.exists:
            eprint("User config not found for UID:", uid)
            return False
        cfg = snap.to_dict() or {}
        extra_env = {}
        sa_env = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
        if sa_env:
            extra_env['GOOGLE_APPLICATION_CREDENTIALS'] = sa_env
        extra_env['USER_UID'] = uid
        ok, result = run_rpa_script(rpa_script, cfg, log_stdout=True, extra_env=extra_env)

        # write history
        try:
            write_history_entry(db, uid, result if isinstance(result, dict) else {"raw": result})
            print(f"[{now_iso()}] Wrote history for user {uid}", flush=True)
        except Exception as e:
            eprint("Warning: failed to write history:", e)

        return ok
    except Exception as e:
        eprint("Error running one-off for uid:", e)
        return False

if __name__ == "__main__":
    args = parse_args()

    # --- register 子命令 ---
    if len(sys.argv) > 1 and sys.argv[1] in ("register", "--register"):
        sa_path = resolve_service_account_path(args.sa_file)
        if not sa_path or not os.path.exists(sa_path):
            eprint("エラー: register 用のサービスアカウントJSONが見つかりません。--sa-file を指定するか、環境変数を設定してください。")
            pause_if_tty()
            sys.exit(1)

        if firebase_admin is None:
            eprint("依存関係が不足しています: firebase-admin をインストールしてください（pip install firebase-admin）")
            pause_if_tty()
            sys.exit(1)

        if not firebase_admin._apps:
            fb_cred = fb_credentials.Certificate(sa_path)
            firebase_admin.initialize_app(fb_cred)

        db = firestore_client(sa_path)
        hostname = socket.gethostname()

        print("--- ワーカー登録モード ---")
        app_email = input("アプリのユーザー用メールアドレス（Firebase Auth）: ").strip()
        if not app_email:
            eprint("メールが入力されませんでした。中止します。")
            sys.exit(1)

        try:
            fb_user = fb_auth.get_user_by_email(app_email)
            uid = fb_user.uid
            print(f"ユーザー UID: {uid}")
        except Exception as e:
            eprint("Firebase ユーザーが見つかりませんでした:", e)
            pause_if_tty()
            sys.exit(1)

        imap_email = input("IMAP / ログイン用メールアドレス: ").strip()
        imap_password = getpass.getpass("IMAP パスワード（非表示）: ")

        extra_note = input("任意メモ（Enterでスキップ）: ").strip()

        data = {
            "imap": {"email": imap_email},
            "registered_at": now_iso(),
            "registered_on": hostname,
        }
        if extra_note:
            data["note"] = extra_note

        secret_b64 = os.environ.get("RPA_SECRET_KEY")
        if secret_b64:
            if Fernet is None:
                eprint("RPA_SECRET_KEY が設定されていますが cryptography が未インストールです")
                sys.exit(1)
            try:
                f = Fernet(secret_b64)
                payload = json.dumps({"email": imap_email, "password": imap_password}).encode("utf-8")
                token = f.encrypt(payload).decode("utf-8")
                data["encrypted_imap"] = token
            except Exception as e:
                eprint("暗号化に失敗しました:", e)
                sys.exit(1)
        else:
            data["imap"]["password"] = imap_password  # 明示的に保存（本番では避ける）

        try:
            db.collection("user_configs").document(uid).set(data, merge=True)
            print("ユーザー設定を保存しました。登録完了。")
        except Exception as e:
            eprint("ユーザー設定の書き込みに失敗しました:", e)
            pause_if_tty()
            sys.exit(1)

        sys.exit(0)

    # --- 常驻/一次性 执行 ---
    try:
        sa_path = resolve_service_account_path(args.sa_file)

        # If a --sa-file was provided, export it to environment so child processes
        # can also access Firestore without extra user steps.
        if sa_path:
            try:
                os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', sa_path)
            except Exception:
                pass

        # Create Firestore client early so we can prompt the user while connected.
        try:
            db = firestore_client(sa_path)
        except Exception as e:
            eprint("Failed to initialize Firestore client:", e)
            pause_if_tty()
            sys.exit(1)

        hostname = socket.gethostname()
        rpa_script = find_rpa_script(args.script)

        # If started with no args in an interactive terminal, prompt user to paste UID
        # so double-clicking the script will allow a manual one-off run.
        if len(sys.argv) == 1 and sys.stdin.isatty():
            try:
                print(f"[{now_iso()}] Firestore に接続しました。UID を入力（Enter で監視開始）: ", end="", flush=True)
                uid_input = input().strip()
            except EOFError:
                uid_input = ""

            if uid_input:
                # Instead of a one-off run, start the RPA script in monitor mode
                print(f"[{now_iso()}] 監視を開始します: UID {uid_input}（停止は Ctrl+C）", flush=True)
                extra_env = {}
                sa_env = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
                if sa_env:
                    extra_env['GOOGLE_APPLICATION_CREDENTIALS'] = sa_env
                extra_env['USER_UID'] = uid_input
                # Run child script in streaming monitor mode (no timeout)
                try:
                    run_rpa_script(rpa_script, None, log_stdout=True, extra_env=extra_env, timeout_seconds=None)
                except KeyboardInterrupt:
                    print("Monitor stopped by user", flush=True)
                except Exception as e:
                    eprint("Error starting monitor for UID:", e)
                sys.exit(0)

        # If --uid provided explicitly, respect it (support '-' for interactive paste)
        if args.uid:
            uid = args.uid
            if uid == "-":
                try:
                    uid = input("Paste user UID to run RPA for: ").strip()
                except EOFError:
                    uid = ""
            if uid:
                run_once_for_uid(db, hostname, rpa_script, uid)
            else:
                eprint("No UID provided; exiting.")
        else:
            main_loop(
                once=args.once,
                max_runtime_minutes=args.max_runtime,
                sa_path=sa_path,
                script_override=args.script,
            )
    except KeyboardInterrupt:
        print("Worker stopped by user", flush=True)
        sys.exit(0)
