"""
Creates the 8 TEST staff logins used while building the frontend.

For each one it (1) adds a staff invite, so the database gives the new login
the right role, then (2) creates the login in Supabase Auth, already confirmed.
Safe to run again: accounts that already exist are skipped.

Run from the project root (needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env):
    python supabase/seed/create_staff_accounts.py

These are test accounts. Delete them or reset their passwords before launch.
"""
import getpass
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

BASE = os.environ["SUPABASE_URL"].rstrip("/").removesuffix("/rest/v1")
KEY = os.environ["SUPABASE_SECRET_KEY"]
DOMAIN = "pursemaison.com"  # must match STAFF_EMAIL_DOMAIN in purse_maison_web/js/config.js

HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# username, database role, full name
STAFF = [
    ("superadmin",     "super_admin",      "Super Admin Owner"),
    ("manager",        "manager",          "Victoria Sterling"),
    ("consignment",    "consignment_team", "Claire Vance"),
    ("authenticator",  "authenticator",    "John Doe"),
    ("photographer",   "photographer",     "Julian Mercer"),
    ("designer",       "designer",         "Elena Rostova"),
    ("pricing",        "pricing_team",     "Marcus Chen"),
    ("salesassociate", "sales_associate",  "Alex Rivera"),
]

password = getpass.getpass("Password to use for all 8 test accounts (min 12 characters): ")
if len(password) < 12:
    sys.exit("Password is too short. Nothing was created.")
if getpass.getpass("Type it again: ") != password:
    sys.exit("Passwords did not match. Nothing was created.")

for username, role, full_name in STAFF:
    email = f"{username}@{DOMAIN}"

    invite = requests.post(
        f"{BASE}/rest/v1/staff_invites",
        headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
        params={"on_conflict": "email"},
        json={"email": email, "role": role, "full_name": full_name},
        timeout=30,
    )
    if invite.status_code not in (200, 201, 204):
        print(f"{email}: invite failed ({invite.status_code}) {invite.text}")
        continue

    created = requests.post(
        f"{BASE}/auth/v1/admin/users",
        headers=HEADERS,
        json={"email": email, "password": password, "email_confirm": True,
              "user_metadata": {"full_name": full_name, "username": username}},
        timeout=30,
    )
    if created.status_code in (200, 201):
        print(f"{email}: created as {role}")
    elif created.status_code == 422 and "registered" in created.text.lower():
        print(f"{email}: already exists, skipped")
    else:
        print(f"{email}: failed ({created.status_code}) {created.text}")

print("Done. Check with:  select username, email, role from public.profiles order by role;")
