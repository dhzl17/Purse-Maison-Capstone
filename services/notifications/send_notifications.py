"""
Purse Maison email sender.

Sends the consignor emails waiting in the notifications outbox.

  python send_notifications.py            send waiting emails
  python send_notifications.py --dry-run  show what would be sent; changes nothing
"""

import os
import smtplib
import sys
from datetime import date, datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

import requests
from dotenv import load_dotenv

load_dotenv()  # reads .env on your computer; GitHub passes these values in directly
API = os.environ["SUPABASE_URL"].rstrip("/").removesuffix("/rest/v1") + "/rest/v1"
KEY = os.environ["SUPABASE_SECRET_KEY"]

STORE = "Purse Maison"
MAX_ATTEMPTS = 5   # after this many failed tries, an email is marked 'failed'
BATCH = 50         # most emails sent in one run


# ---------- Talking to Supabase ----------

def api(method, path, params=None, body=None):
    headers = {"apikey": KEY, "Content-Type": "application/json"}
    response = requests.request(method, f"{API}/{path}", headers=headers,
                                params=params, json=body, timeout=60)
    if not response.ok:
        raise RuntimeError(f"{method} {path} failed ({response.status_code}): {response.text}")
    return response.json() if response.text else None


def load_portal_url():
    rows = api("GET", "app_settings", {"select": "value", "key": "eq.portal_url"})
    return (rows[0]["value"].strip() if rows else "")


def load_pending():
    return api("GET", "notifications", {
        "select": "id,notification_type,details,attempts,"
                  "consignors(full_name,email),consignment_items(item_code,brand,model,color)",
        "status": "eq.pending",
        "order": "created_at",
        "limit": str(BATCH)})


def mark(notification_id, changes):
    api("PATCH", "notifications", {"id": f"eq.{notification_id}"}, changes)


# ---------- Writing the emails ----------

def peso(value):
    return "₱{:,.2f}".format(float(value))


def nice_date(value):
    d = date.fromisoformat(str(value)[:10])
    return f"{d:%B} {d.day}, {d.year}"


def compose(n, portal_url):
    item = n.get("consignment_items") or {}
    consignor = n.get("consignors") or {}
    d = n.get("details") or {}

    name = " ".join(p for p in (item.get("brand"), item.get("model"), item.get("color")) if p) or "item"
    ref = f"{name} ({item['item_code']})" if item.get("item_code") else name
    first_name = (consignor.get("full_name") or "").split(" ")[0] or "there"
    kind = n["notification_type"]

    if kind == "item_received":
        subject = f"We've received your {name}"
        lines = [f"Your {ref} has arrived at our store. Next it goes through authentication, "
                 "photography and listing, and we'll update you along the way."]
    elif kind == "authentication_failed":
        subject = f"An update on your {name}"
        lines = [f"Unfortunately, your {ref} did not pass our authentication process, "
                 "so we can't list it for sale.",
                 "Our team will contact you about the next steps."]
    elif kind == "item_published":
        subject = f"Your {name} is now listed for sale"
        lines = [f"Your {ref} is now live and available to buyers."]
        if d.get("contract_end_date"):
            lines.append(f"Your consignment period runs until {nice_date(d['contract_end_date'])}.")
    elif kind == "item_sold":
        subject = f"Your {name} has sold"
        lines = [f"Good news: your {ref} has sold, and the buyer's payment has been verified."]
        if d.get("payout") is not None:
            due = f" by {nice_date(d['payout_due_by'])}" if d.get("payout_due_by") else ""
            lines.append(f"Your payout of {peso(d['payout'])} will be released{due}.")
    elif kind == "payout_released":
        subject = f"Your payout for {name} has been released"
        amount = f" of {peso(d['payout'])}" if d.get("payout") is not None else ""
        lines = [f"Your payout{amount} for your {ref} has been released."]
    elif kind == "contract_ending":
        subject = f"Your consignment period for {name} ends soon"
        when = f" on {nice_date(d['contract_end_date'])}" if d.get("contract_end_date") else " soon"
        lines = [f"The consignment period for your {ref} ends{when}.",
                 "If you'd like to extend it, please contact us before then."]
    elif kind == "item_withdrawn":
        subject = f"Your {name} has been released to you"
        lines = [f"Your {ref} has been withdrawn from consignment and released to you."]
        if d.get("pull_out_fee") and float(d["pull_out_fee"]) > 0:
            lines.append(f"A pull-out fee of {peso(d['pull_out_fee'])} was paid.")
    else:
        raise ValueError(f"Unknown notification type: {kind}")

    if portal_url:
        lines.append(f"You can check all your items anytime at {portal_url}")

    body = f"Hi {first_name},\n\n" + "\n\n".join(lines) + f"\n\nThank you,\n{STORE}\n"
    return subject, body


# ---------- Sending ----------

def connect():
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASSWORD"]

    smtp = smtplib.SMTP_SSL(host, port, timeout=30) if port == 465 else smtplib.SMTP(host, port, timeout=30)
    if port != 465:
        smtp.starttls()
    smtp.login(user, password)
    return smtp, user


def main():
    dry_run = "--dry-run" in sys.argv

    if not dry_run:
        queued = api("POST", "rpc/queue_contract_reminders", body={})
        if queued:
            print(f"Queued {queued} contract reminder(s)")

    pending = load_pending()
    if not pending:
        print("No emails waiting.")
        return

    portal_url = load_portal_url()

    if dry_run:
        for n in pending:
            email = (n.get("consignors") or {}).get("email") or "(no email on file: would be skipped)"
            subject, body = compose(n, portal_url)
            print(f"\nTo: {email}\nSubject: {subject}\n\n{body}" + "-" * 50)
        print(f"Dry run: {len(pending)} email(s) would be processed. Nothing was changed.")
        return

    try:
        smtp, sender = connect()
    except smtplib.SMTPAuthenticationError:
        print("Email login failed. Check SMTP_USER and SMTP_PASSWORD (use a Gmail app password).")
        sys.exit(1)

    sent = skipped = failed = 0
    with smtp:
        for n in pending:
            email = ((n.get("consignors") or {}).get("email") or "").strip()
            if not email:
                mark(n["id"], {"status": "skipped", "last_error": "Consignor has no email on file"})
                skipped += 1
                continue

            attempts = n["attempts"] + 1
            try:
                subject, body = compose(n, portal_url)
                message = EmailMessage()
                message["From"] = formataddr((STORE, sender))
                message["To"] = email
                message["Subject"] = subject
                message["Message-ID"] = make_msgid(domain=sender.split("@")[-1])
                message.set_content(body)
                smtp.send_message(message)

                mark(n["id"], {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat(),
                               "recipient_email": email, "attempts": attempts, "last_error": None})
                sent += 1
            except Exception as error:
                mark(n["id"], {"status": "failed" if attempts >= MAX_ATTEMPTS else "pending",
                               "attempts": attempts, "last_error": str(error)[:500]})
                failed += 1
                print(f"  Could not send {n['notification_type']} to {email}: {error}")

    print(f"Sent {sent}, skipped {skipped} (no email), failed {failed}")


if __name__ == "__main__":
    main()