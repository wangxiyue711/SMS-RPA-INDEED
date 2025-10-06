#!/usr/bin/env python3
"""Normalize existing rpa_history entries in Firestore.

Usage:
  python scripts/normalize_history.py --userUid=UID [--dry-run] [--limit=100] [--yes]

This script applies the following rules to documents under
`rpa_history/{userUid}/entries`:
 - If `is_sms_target` is explicitly False -> set top-level `sms_sent`=False,
   `level`="failed" (or keep), and `sms_response.message` = "未送信".
 - If `is_sms_target` is True and `sms_response` indicates success (HTTP 200
   or code '200'), ensure `sms_response.code` is '200', `level` is "success",
   and `sms_sent` is True.
 - If `is_sms_target` is True and sending failed, keep provider `code` and
   `message` where possible; if only a code exists, set message to
   `コード {code}: 未定義のコード` and `level` to "failed".

The script supports a safe `--dry-run` mode and batch updates.
Requires `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account JSON.
"""
import argparse
import os
import sys
import json
from typing import Any, Dict

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except Exception as e:
    print("ERROR: firebase_admin is required to run this script. Install with `pip install firebase-admin`", file=sys.stderr)
    raise


def normalize_one(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return a dict of fields to update for this doc (empty => no change)."""
    out = {}
    is_target = doc.get("is_sms_target")
    sr = doc.get("sms_response") or {}
    sent_flag = bool(doc.get("sms_sent"))

    # Helper to ensure sms_response shape
    norm = dict(sr) if isinstance(sr, dict) else {"output": str(sr)}

    # Case 1: Explicitly non-target
    if is_target is False:
        # Ensure sms_sent False and sms_response.message = 未送信
        if doc.get("sms_sent") is not False:
            out["sms_sent"] = False
        # build sms_response
        if not norm.get("message") or norm.get("message") != "未送信":
            norm["message"] = "未送信"
        if not norm.get("level"):
            norm["level"] = "failed"
        out["sms_response"] = norm
        # top-level level
        out["level"] = norm.get("level")
        return out

    # Case 2: Target or unknown -> try to normalize sms_response
    code = None
    try:
        code = (norm.get("code") or norm.get("status") or None)
        if code is not None:
            code = str(code).strip()
    except Exception:
        code = None

    # If HTTP status present and code empty, try to use it
    if not code and norm.get("status"):
        code = str(norm.get("status"))

    # success detection: code == '200' or status == 200
    is_success = False
    if code:
        if str(code) == "200":
            is_success = True
    elif norm.get("status") == 200:
        is_success = True

    if is_success:
        # ensure code/message/level
        if norm.get("code") != "200":
            norm["code"] = "200"
        # prefer existing message, otherwise set a baseline
        if not norm.get("message"):
            norm["message"] = "コード 200: 送信成功"
        norm["level"] = "success"
        out["sms_response"] = norm
        out["level"] = "success"
        out["sms_sent"] = True
        return out

    # If there's a code but no message, set a fallback message and failed level
    if code:
        if not norm.get("message"):
            norm["message"] = f"コード {code}: 未定義のコード"
        if not norm.get("level"):
            norm["level"] = "failed"
        out["sms_response"] = norm
        out["level"] = norm.get("level")
        out["sms_sent"] = True if norm.get("level") == "success" else False
        return out

    # No code and not explicitly non-target: if sms_response is empty, leave as-is
    return {}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--userUid", required=True)
    p.add_argument("--dry-run", dest="dry_run", action="store_true", help="Perform a dry run (default)", default=True)
    p.add_argument("--no-dry-run", dest="dry_run", action="store_false", help="Disable dry run and apply changes")
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--yes", action="store_true", help="Apply updates (skip confirmation)")
    args = p.parse_args()

    sa = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not sa or not os.path.exists(sa):
        print("ERROR: set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path", file=sys.stderr)
        sys.exit(2)

    cred = credentials.Certificate(sa)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)

    db = firestore.client()
    coll = db.collection("rpa_history").document(str(args.userUid)).collection("entries")

    docs = coll.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(args.limit).stream()
    to_update = []
    total = 0
    for d in docs:
        total += 1
        data = d.to_dict() or {}
        changes = normalize_one(data)
        if changes:
            to_update.append((d.id, changes))

    print(f"Found {total} docs scanned, {len(to_update)} docs to update (limit={args.limit})")
    if not to_update:
        return

    if args.dry_run:
        print("--dry-run: the following updates would be applied:")
        for doc_id, ch in to_update:
            print(f"doc: {doc_id} -> {json.dumps(ch, ensure_ascii=False)}")
        print("Dry run complete. Rerun with --dry-run=False and --yes to apply.")
        return

    if not args.yes:
        ok = input(f"About to apply {len(to_update)} updates. Type 'yes' to continue: ")
        if ok.strip().lower() != "yes":
            print("Aborted by user.")
            return

    # apply updates
    applied = 0
    for doc_id, ch in to_update:
        try:
            coll.document(doc_id).update(ch)
            applied += 1
        except Exception as e:
            print(f"Failed to update {doc_id}: {e}")

    print(f"Applied updates to {applied}/{len(to_update)} documents.")


if __name__ == "__main__":
    main()
