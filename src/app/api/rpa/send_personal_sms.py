# rpa/send_personal_sms.py
import sys, json, os
from twilio.rest import Client

def main():
    # 从 stdin 读一行 JSON：{ userUid, phone, message }
    line = sys.stdin.readline()
    data = json.loads(line) if line else {}
    phone = data.get("phone")
    message = data.get("message")

    # 从环境变量读取 Twilio 配置
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN")
    from_num    = os.getenv("TWILIO_FROM")

    if not (account_sid and auth_token and from_num):
        print("ERROR: missing TWILIO envs (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)", file=sys.stderr)
        sys.exit(2)

    try:
        client = Client(account_sid, auth_token)
        resp = client.messages.create(from_=from_num, to=phone, body=message)
        print(f"SUCCESS: sid={resp.sid} status={getattr(resp, 'status', 'queued')}")
        # VERY IMPORTANT: 这个标记让你的 route.ts 认为成功
        print("SCRIPT_EXIT_SUCCESS")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
