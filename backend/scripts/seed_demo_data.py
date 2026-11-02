"""
Fill every HRMS collection with connected demo data.

Stop the backend first (it keeps its own in-memory copy and would overwrite the result), then:

    cd backend
    .venv\\Scripts\\python scripts\\seed_demo_data.py

Data is loaded exactly like the server does (data/hrms_store.json, then MongoDB if reachable),
demo records are added, and the result is saved back to both. Only records whose id is not
present yet are added, so existing data is never changed and the script is safe to re-run.

- Every demo login (see DEMO_ACCOUNTS in app/stores/db_store.py) gets a user + employee record.
- The richer seed records (app/stores/seed/seed_data.json) are merged in, re-pointed at those logins.
- Attendance (last 6 weeks), payslips (last 6 months), leave, expenses, documents, reviews,
  recruitment, assets, insurance, tax, notifications and audit logs are generated around them.
"""

import asyncio
import json
import random
import re
import socket
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import PORT  # noqa: E402  (also loads backend/.env)
from app.database import persistence  # noqa: E402
from app.stores.db_store import DEMO_ACCOUNTS, _demo_hash, db_store  # noqa: E402
from app.stores.modules_store import _default_leave_balance, modules_store  # noqa: E402
from app.stores.seed import seed_container  # noqa: E402

rng = random.Random(2026)
TODAY = date.today()
ORG_ID = "org_zenith_hq"
DEMO_PASSWORD = "Demo@12345"  # for the seeded colleagues that are not in DEMO_ACCOUNTS
HR_REVIEWER = "Aditya Kapoor (HR Lead)"
MANAGER_REVIEWER = "Arjun Khanna (Engineering Manager)"
FINANCE_REVIEWER = "Priya Sharma (Finance)"

# Seed ids -> ids of the demo login accounts, so seed records land on people who can log in.
ID_MAP = {
    "usr_admin_01": "usr_admin_auto", "emp_admin_01": "emp_admin_auto",
    "usr_hr_01": "usr_hr_auto", "emp_hr_01": "emp_hr_auto",
    "usr_mgr_01": "usr_manager_auto", "emp_mgr_01": "emp_manager_auto",
    "usr_emp_01": "usr_employee_auto", "emp_emp_01": "emp_employee_auto",
    "usr_new_01": "usr_newhire_auto", "emp_new_01": "emp_newhire_auto",
    "usr_new_hire": "usr_newhire_auto", "emp_new_hire": "emp_newhire_auto",
    "usr_fin_01": "usr_finance_auto", "emp_fin_01": "emp_finance_auto",
    "emp_fin_head": "emp_admin_1_auto",
    "usr_emp_ind_01": "usr_admin_2_auto", "emp_ind_01": "emp_admin_2_auto",
    "usr_emp_ind_05": "usr_accounts_auto", "emp_ind_05": "emp_accounts_auto",
    "usr_emp_ind_09": "usr_auditors_auto", "emp_ind_09": "emp_auditors_auto",
}

added: Counter = Counter()


# --------------------------------------------------------------------------- helpers

def iso_at(d: date, hh: int = 10, mm: int = 0) -> str:
    return f"{d.isoformat()}T{hh:02d}:{mm:02d}:00Z"


def ago(days: int) -> date:
    return TODAY - timedelta(days=days)


def rng_for(*parts: str) -> random.Random:
    """Per-record random source, so a re-run makes the same choices and adds nothing new."""
    return random.Random(":".join(parts))


def put(name: str, container: dict, doc: dict, key: str = None) -> bool:
    key = key or doc["_id"]
    if key in container:
        return False
    container[key] = doc
    added[name] += 1
    return True


def push(name: str, items: list, docs: list) -> None:
    """Add docs to a newest-first array, skipping ids already present."""
    have = {i.get("_id") for i in items}
    new = [d for d in docs if d["_id"] not in have]
    new.sort(key=lambda d: d.get("timestamp") or d.get("createdAt") or d.get("initiatedAt") or "", reverse=True)
    items[0:0] = new
    if new:
        added[name] += len(new)


def remap(obj):
    text = json.dumps(obj, ensure_ascii=False)
    for old, new in ID_MAP.items():
        text = text.replace(f'"{old}"', f'"{new}"')
    return json.loads(text)


def seed_entries(store: str, name: str) -> list:
    c = seed_container(store, name)
    return [remap(v) for v in (c.values() if isinstance(c, dict) else c)]


def full_name(emp: dict) -> str:
    return f"{emp.get('firstName')} {emp.get('lastName')}"


def stamp(doc: dict) -> dict:
    """Make employeeName/Code/department on a record match its employee."""
    emp = db_store.employees.get(doc.get("employeeId"))
    if emp:
        doc["employeeName"] = full_name(emp)
        doc["employeeCode"] = emp.get("employeeCode")
        doc["department"] = emp.get("department")
    return doc


def weekdays_between(start: date, end: date) -> int:
    return sum(1 for i in range((end - start).days + 1) if (start + timedelta(days=i)).weekday() < 5)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def backend_running() -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


# --------------------------------------------------------------------------- people

def seed_people() -> None:
    users, employees = db_store.users, db_store.employees
    seed_emps = {e["_id"]: e for e in seed_entries("db", "employees")}
    seed_users = seed_entries("db", "users")
    emails = {(u.get("email") or "").lower() for u in users.values()}
    codes = {e.get("employeeCode") for e in employees.values()}

    def free_code(*preferred: str) -> str:
        for c in preferred:
            if c and c not in codes:
                return c
        n = 200
        while f"RHA-{n}" in codes:
            n += 1
        return f"RHA-{n}"

    # 1. Demo login accounts
    for email, cfg in DEMO_ACCOUNTS.items():
        role = cfg["role"]
        key = "newhire" if email == "newhire@vetan.ai" else role.lower()
        user_id, emp_id = f"usr_{key}_auto", f"emp_{key}_auto"
        if email in emails:
            existing = next(u for u in users.values() if (u.get("email") or "").lower() == email)
            user_id, emp_id = existing["_id"], existing.get("employeeId") or emp_id
        else:
            now = iso_at(ago(30))
            put("users", users, {
                "_id": user_id, "email": email, "passwordHash": _demo_hash(cfg["pass"]),
                "firstName": cfg["firstName"], "lastName": cfg["lastName"], "role": role,
                "organizationId": ORG_ID, "employeeId": emp_id,
                "onboardingCompleted": key != "newhire", "onboardingStep": 1 if key == "newhire" else 9,
                "orgSetupCompleted": True, "orgSetupStep": 4, "isActive": True, "createdAt": now, "updatedAt": now,
            })
            emails.add(email)

        seed_src = seed_emps.get(emp_id) or {}
        emp = employees.get(emp_id)
        if emp is None:
            code = free_code(cfg["empCode"], seed_src.get("employeeCode"))
            codes.add(code)
            emp = {
                **seed_src,
                "_id": emp_id, "userId": user_id, "organizationId": ORG_ID, "employeeCode": code,
                "firstName": cfg["firstName"], "lastName": cfg["lastName"], "workEmail": email,
                "department": cfg["dept"], "designation": cfg["desig"],
            }
            emp.setdefault("status", "PROBATION" if key == "newhire" else "ACTIVE")
            emp.setdefault("employmentType", "FULL_TIME")
            emp.setdefault("joiningDate", "2023-01-01")
            emp.setdefault("shift", "Standard General (09:00 - 18:00)")
            emp.setdefault("location", "Bengaluru Tech Center (Prestige Tech Park)")
            emp.setdefault("annualSalary", 1500000)
            emp.setdefault("gender", "Female" if cfg["firstName"] in ("Deepika", "Priya", "Neha", "Tanvi", "Ishita") else "Male")
            emp.setdefault("personalEmail", f"{cfg['firstName'].lower()}.{cfg['lastName'].lower()}@gmail.com")
            emp.setdefault("phone", f"+91 98{rng.randint(100, 999)} {rng.randint(10000, 99999)}")
            if key == "newhire":
                emp["joiningDate"] = ago(12).isoformat()
            put("employees", employees, emp)
        else:
            # Auto-provisioned records only hold placeholders: fill in the profile from the seed.
            placeholders = {"gender": "Other", "dob": "1990-01-01", "phone": "+91 98450 11111", "joiningDate": "2023-01-01"}
            for k, v in seed_src.items():
                if k in ("_id", "userId", "employeeCode", "workEmail", "firstName", "lastName"):
                    continue
                if k not in emp or emp[k] == placeholders.get(k):
                    emp[k] = v

    # 2. Remaining seeded colleagues
    demo_hash = _demo_hash(DEMO_PASSWORD)
    for su in seed_users:
        if su["_id"].endswith("_auto"):
            continue
        su["email"] = su["email"].replace("k. r..nambiar", "kr.nambiar")
        if su["email"].lower() in emails:
            continue
        put("users", users, {**su, "passwordHash": demo_hash})
        emails.add(su["email"].lower())
    for emp_id, se in seed_emps.items():
        if emp_id.endswith("_auto") or emp_id in employees:
            continue
        se["workEmail"] = se["workEmail"].replace("k. r..nambiar", "kr.nambiar")
        se["employeeCode"] = free_code(se.get("employeeCode"))
        codes.add(se["employeeCode"])
        put("employees", employees, se)

    # 3. A few extra people so exits, probation and notice periods have data
    extras = [
        ("emp_ex_01", "Sneha", "Patel", "Female", "Product & Design", "Senior UX Researcher", "TERMINATED", "2023-03-06", 1450000),
        ("emp_demo_notice_01", "Karan", "Mehta", "Male", "Sales & Growth", "Regional Sales Manager", "NOTICE", "2021-07-12", 1700000),
        ("emp_demo_notice_02", "Pallavi", "Ghosh", "Female", "Customer Success", "Support Team Lead", "NOTICE", "2022-04-18", 1150000),
        ("emp_demo_exit_01", "Rakesh", "Jain", "Male", "Finance & Compliance", "Accounts Executive", "TERMINATED", "2020-11-02", 800000),
        ("emp_demo_prob_01", "Ananya", "Kulkarni", "Female", "Engineering & Technology", "Software Engineer", "PROBATION", ago(70).isoformat(), 1100000),
        ("emp_demo_prob_02", "Farhan", "Qureshi", "Male", "Customer Success", "Customer Success Associate", "PROBATION", ago(45).isoformat(), 750000),
        ("emp_demo_leave_01", "Meera", "Nair", "Female", "People Operations & HR", "Talent Acquisition Partner", "ON_LEAVE", "2022-02-14", 1250000),
    ]
    for emp_id, first, last, gender, dept, desig, status, joined, ctc in extras:
        if emp_id in employees:
            continue
        email = f"{first.lower()}.{last.lower()}@vetan.ai"
        user_id = emp_id.replace("emp_", "usr_")
        if email not in emails:
            put("users", users, {
                "_id": user_id, "email": email, "passwordHash": demo_hash, "firstName": first, "lastName": last,
                "role": "EMPLOYEE", "organizationId": ORG_ID, "employeeId": emp_id, "onboardingCompleted": True,
                "onboardingStep": 9, "orgSetupCompleted": True, "orgSetupStep": 4, "isActive": status != "TERMINATED",
                "createdAt": iso_at(date.fromisoformat(joined)), "updatedAt": iso_at(ago(5)),
            })
            emails.add(email)
        code = free_code()
        codes.add(code)
        put("employees", employees, {
            "_id": emp_id, "userId": user_id, "organizationId": ORG_ID, "employeeCode": code,
            "firstName": first, "lastName": last, "gender": gender, "dob": f"19{rng.randint(88, 99)}-0{rng.randint(1, 9)}-1{rng.randint(0, 9)}",
            "bloodGroup": rng.choice(["A+", "B+", "O+", "AB+", "O-"]), "personalEmail": f"{first.lower()}.{last.lower()}@gmail.com",
            "workEmail": email, "phone": f"+91 9{rng.randint(1000, 9999)} {rng.randint(10000, 99999)}",
            "department": dept, "designation": desig, "reportingManagerId": "emp_manager_auto",
            "reportingManagerName": "Arjun Khanna", "joiningDate": joined, "employmentType": "FULL_TIME", "status": status,
            "shift": "Standard General (09:00 - 18:00)", "location": rng.choice(["Pune Innovation Hub (Hinjawadi)", "Bengaluru Tech Center (Prestige Tech Park)", "Mumbai Financial Hub (BKC)"]),
            "annualSalary": ctc,
            "bankInfo": {"bankName": rng.choice(["HDFC Bank", "ICICI Bank", "Axis Bank"]), "accountHolder": f"{first} {last}",
                         "accountNumberMasked": f"••••••••{rng.randint(1000, 9999)}", "ifsc": "HDFC0001234", "branch": "Main Branch"},
        })


# --------------------------------------------------------------------------- organisation

def seed_organization() -> None:
    for name in ("organizations", "departments", "designations", "locations", "shifts"):
        container = getattr(db_store, name)
        for doc in seed_entries("db", name):
            put(name, container, doc)

    employees = list(db_store.employees.values())
    known_depts = {d.get("name") for d in db_store.departments.values()}
    for dept in sorted({e.get("department") for e in employees if e.get("department")} - known_depts):
        members = [e for e in employees if e.get("department") == dept]
        head = max(members, key=lambda e: e.get("annualSalary") or 0)
        put("departments", db_store.departments, {
            "_id": f"dept_demo_{slug(dept)}", "name": dept, "code": "".join(w[0] for w in re.findall(r"[A-Za-z]+", dept)).upper()[:4],
            "headEmployeeId": head["_id"], "headName": full_name(head),
            "description": f"{dept} team.", "subdepartments": sorted({e["subdepartment"] for e in members if e.get("subdepartment")}),
            "createdAt": "2022-01-01T00:00:00Z",
        })

    known_titles = {d.get("title") for d in db_store.designations.values()}
    for e in employees:
        title = e.get("designation")
        if title and title not in known_titles:
            known_titles.add(title)
            put("designations", db_store.designations, {
                "_id": f"desig_demo_{slug(title)}", "title": title, "departmentName": e.get("department"),
                "level": rng.choice(["L3 - Associate", "L4 - Senior", "L5 - Lead", "L6 - Manager"]),
            })


# --------------------------------------------------------------------------- seed modules

def seed_modules() -> None:
    simple = ["policies", "poshCases", "holidays", "announcements", "performanceReviews", "jobOpenings",
              "jobCandidates", "assets", "hrRequests", "fullFinalSettlements", "insuranceClaims",
              "leaveRequests", "expenseClaims"]
    for name in simple:
        container = getattr(modules_store, name)
        for doc in seed_entries("modules", name):
            put(name, container, stamp(doc))

    # keyed by employee id
    for name in ("insuranceEnrollments", "taxDeclarations", "leaveBalances"):
        container = getattr(modules_store, name)
        for key, doc in seed_container("modules", name).items():
            key = ID_MAP.get(key, key)
            if key in db_store.employees:
                put(name, container, stamp(remap(doc)) if "employeeId" in doc else remap(doc), key)

    for doc in seed_entries("db", "documents"):
        put("documents", db_store.documents, stamp(doc))
    for doc in seed_entries("db", "onboardingSubmissions"):
        if doc.get("userId") not in db_store.users:  # the new-hire login fills in its own form
            put("onboardingSubmissions", db_store.onboardingSubmissions, doc)
    push("lifecycleEvents", db_store.lifecycleEvents, [stamp(e) for e in seed_entries("db", "lifecycleEvents")])
    push("auditLogs", db_store.auditLogs, seed_entries("db", "auditLogs"))


# --------------------------------------------------------------------------- generated data

def active_employees() -> list:
    return [e for e in db_store.employees.values() if e.get("status") in ("ACTIVE", "PROBATION", "NOTICE", "PERMANENT")]


def login_employee_ids() -> set:
    return {u.get("employeeId") for u in db_store.users.values() if (u.get("email") or "").lower() in DEMO_ACCOUNTS}


LEAVE_REASONS = {
    "CASUAL": ["Personal errand at the bank.", "Attending a family function.", "Moving to a new apartment.", "Sibling's wedding preparations."],
    "SICK": ["Viral fever, doctor advised rest.", "Migraine and dizziness.", "Dental surgery recovery.", "Seasonal flu."],
    "EARNED": ["Family vacation to Kerala.", "Annual trip to hometown for Diwali.", "Short holiday in Goa.", "Visiting parents in Jaipur."],
    "UNPAID": ["Extended personal leave for family matters."],
}


def gen_leaves() -> None:
    reqs = modules_store.leaveRequests
    emps = active_employees()
    must = login_employee_ids()
    for emp in emps:
        pick = rng_for(emp["_id"], "leave")
        if emp["_id"] not in must and pick.random() > 0.65:
            continue
        for n in range(pick.randint(1, 3)):
            ltype = rng.choices(["CASUAL", "SICK", "EARNED", "UNPAID"], [4, 3, 3, 0.5])[0]
            start = TODAY + timedelta(days=rng.randint(-75, 35))
            while start.weekday() >= 5:
                start += timedelta(days=1)
            end = start + timedelta(days=rng.choice([0, 0, 1, 2, 4]))
            future = start > TODAY
            status = rng.choices(["PENDING", "APPROVED"], [6, 4])[0] if future else rng.choices(["APPROVED", "REJECTED", "CANCELLED"], [8, 1.5, 0.5])[0]
            if emp["_id"] in must and n == 0:
                status, start = "PENDING", TODAY + timedelta(days=rng.randint(6, 20))
                while start.weekday() >= 5:
                    start += timedelta(days=1)
                end = start + timedelta(days=1)
            applied = min(start - timedelta(days=rng.randint(2, 14)), TODAY)
            doc = {
                "_id": f"leave_demo_{emp['_id']}_{n}", "employeeId": emp["_id"], "leaveType": ltype,
                "startDate": start.isoformat(), "endDate": end.isoformat(), "daysCount": max(1, weekdays_between(start, end)),
                "isHalfDay": False, "reason": rng.choice(LEAVE_REASONS[ltype]), "status": status,
                "appliedAt": iso_at(applied, rng.randint(8, 18), rng.choice([0, 15, 30, 45])),
            }
            if status in ("APPROVED", "REJECTED"):
                doc["reviewedBy"] = rng.choice([HR_REVIEWER, MANAGER_REVIEWER])
                doc["reviewedAt"] = iso_at(min(applied + timedelta(days=1), TODAY), 11)
            if status == "REJECTED":
                doc["rejectionReason"] = "Critical release window; please reschedule to the following week."
            put("leaveRequests", reqs, stamp(doc))

    # balances that agree with the approved requests
    for emp in db_store.employees.values():
        if emp["_id"] in modules_store.leaveBalances:
            continue
        bal = _default_leave_balance()
        for r in reqs.values():
            if r.get("employeeId") == emp["_id"] and r.get("status") == "APPROVED":
                k = {"CASUAL": "casual", "SICK": "sick", "EARNED": "earned"}.get(r.get("leaveType"))
                if k:
                    bal[k]["used"] += r.get("daysCount") or 0
                elif r.get("leaveType") == "UNPAID":
                    bal["unpaid"]["used"] += r.get("daysCount") or 0
        for k in ("casual", "sick", "earned"):
            bal[k]["used"] = min(bal[k]["total"], bal[k]["used"] + rng.randint(0, 2))
            bal[k]["remaining"] = bal[k]["total"] - bal[k]["used"]
        put("leaveBalances", modules_store.leaveBalances, bal, emp["_id"])


def shift_window(shift_name: str) -> tuple:
    m = re.search(r"(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})", shift_name or "")
    if not m:
        return 9 * 60, 18 * 60
    return int(m[1]) * 60 + int(m[2]), int(m[3]) * 60 + int(m[4])


def hhmm(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def gen_attendance() -> None:
    records = db_store.attendanceRecords
    holidays = {h.get("date") for h in modules_store.holidays.values()}
    taken = {(r.get("employeeId"), r.get("date")) for r in records.values()}
    on_leave = set()
    for r in modules_store.leaveRequests.values():
        if r.get("status") == "APPROVED":
            d, end = date.fromisoformat(r["startDate"]), date.fromisoformat(r["endDate"])
            while d <= end:
                on_leave.add((r["employeeId"], d.isoformat()))
                d += timedelta(days=1)
    logins = login_employee_ids()
    offices = ["Pune HQ (Multicon Square) WiFi", "Bengaluru Tech Center (Floor 6)", "Mumbai BKC Office", "Hyderabad HITEC City"]

    for emp in active_employees():
        start_min, end_min = shift_window(emp.get("shift"))
        night = end_min < start_min
        expected_min = 8 * 60
        for back in range(42, -1, -1):
            d = ago(back)
            ds = d.isoformat()
            if d.weekday() >= 5 or ds in holidays or (emp["_id"], ds) in taken or ds < (emp.get("joiningDate") or ""):
                continue
            if back == 0 and (emp["_id"] in logins or rng_for(emp["_id"], "today").random() < 0.15):
                continue  # leave today open so demo logins can check in themselves
            if (emp["_id"], ds) in on_leave:
                status = "ON_LEAVE"
            else:
                status = rng.choices(["PRESENT", "WORK_FROM_HOME", "LATE", "HALF_DAY", "ABSENT"], [70, 13, 10, 4, 3])[0]
            doc = {
                "_id": f"att_demo_{emp['_id']}_{ds.replace('-', '')}", "employeeId": emp["_id"], "date": ds,
                "shiftName": emp.get("shift") or "Standard General (09:00 - 18:00)", "shiftExpectedHours": 8,
                "totalMinutesWorked": 0, "breakMinutes": 60, "effectiveWorkingHours": 0, "overtimeMinutes": 0,
                "overtimeHours": 0, "isNightShift": night, "extraDayCredit": 0, "extraPayTier": "NONE", "status": status,
            }
            if status in ("PRESENT", "WORK_FROM_HOME", "LATE", "HALF_DAY"):
                cin = start_min + (rng.randint(18, 70) if status == "LATE" else rng.randint(-25, 10))
                doc["checkInTime"] = hhmm(cin)
                doc["workMode"] = "WORK_FROM_HOME" if status == "WORK_FROM_HOME" else "WORK_FROM_OFFICE"
                doc["location"] = "Remote (Home Network)" if status == "WORK_FROM_HOME" else rng.choice(offices)
                doc["ipAddress"] = f"103.21.{rng.randint(100, 199)}.{rng.randint(2, 250)}"
                if back > 0:
                    span = (expected_min + 60 + rng.randint(-20, 90)) if status != "HALF_DAY" else rng.randint(240, 290)
                    worked = max(0, span - 60) if status != "HALF_DAY" else span
                    overtime = max(0, worked - expected_min)
                    doc.update({
                        "checkOutTime": hhmm(cin + span), "totalMinutesWorked": span,
                        "breakMinutes": 60 if status != "HALF_DAY" else 0,
                        "effectiveWorkingHours": round(worked / 60, 2), "overtimeMinutes": overtime,
                        "overtimeHours": round(overtime / 60, 2),
                    })
                    if status == "LATE":
                        doc["notes"] = rng.choice(["Traffic on the expressway.", "Metro delay.", "Doctor's appointment in the morning."])
                    if rng.random() < 0.04:
                        doc.update({"isRegularized": True, "regularizationReason": "Forgot to check out; confirmed by manager.", "regularizedBy": MANAGER_REVIEWER})
            elif status == "ABSENT":
                doc["notes"] = "No check-in recorded."
            put("attendanceRecords", records, stamp(doc))


def gen_payslips() -> None:
    months = []
    first = TODAY.replace(day=1)
    for _ in range(6):
        first = (first - timedelta(days=1)).replace(day=1)
        months.append(first)
    for m in months:
        last_day = (m.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        month_str = m.strftime("%Y-%m")
        for emp in db_store.employees.values():
            if emp.get("status") not in ("ACTIVE", "PROBATION", "NOTICE", "ON_LEAVE", "PERMANENT"):
                continue
            if emp.get("joiningDate") and emp["joiningDate"] > last_day.isoformat():
                continue
            key = f"pay_{emp['_id']}_{month_str.replace('-', '_', 1)}"
            if key in modules_store.payslips:
                continue
            slip = modules_store.build_payslip(emp, month_str, m.strftime("%B %Y"), {
                "_id": key, "payDate": last_day.isoformat(), "workedDays": weekdays_between(m, last_day),
            })
            if slip:
                put("payslips", modules_store.payslips, slip)


EXPENSES = [
    ("Client visit - Mumbai flight & cab", "TRAVEL", 18450, "Return flight PNQ-BOM and airport cabs for the client workshop."),
    ("Team lunch after sprint release", "MEALS", 6200, "Celebration lunch for the 8-member squad after the v4.2 release."),
    ("Home broadband - monthly", "INTERNET", 1199, "Monthly broadband reimbursement as per remote work policy."),
    ("Ergonomic keyboard & mouse", "OFFICE_SUPPLIES", 7800, "Logitech MX Keys combo for home office setup."),
    ("Udemy - System Design course", "LEARNING", 3499, "Approved learning budget for system design upskilling."),
    ("Dinner with prospective client", "CLIENT_ENTERTAINMENT", 9650, "Dinner meeting with the procurement head of a fintech prospect."),
    ("Hotel stay - Bengaluru offsite", "TRAVEL", 14200, "Two nights at the offsite venue."),
    ("Conference ticket - JSConf India", "LEARNING", 12000, "Speaker pass for JSConf India."),
    ("Printer cartridges", "OFFICE_SUPPLIES", 2450, "Replacement cartridges for the HR desk printer."),
    ("Local travel - vendor meetings", "TRAVEL", 2860, "Auto and cab fares for three vendor meetings."),
]


def gen_expenses() -> None:
    emps = active_employees()
    logins = login_employee_ids()
    pool = [e for e in emps if e["_id"] in logins] + rng.sample(emps, min(10, len(emps)))
    for i, emp in enumerate(pool):
        title, cat, amount, desc = EXPENSES[i % len(EXPENSES)]
        spent = ago(rng.randint(3, 60))
        status = rng.choices(["SUBMITTED", "MANAGER_APPROVED", "HR_APPROVED", "REIMBURSED", "REJECTED"], [3, 2, 1, 3, 1])[0]
        doc = {
            "_id": f"exp_demo_{i:02d}", "employeeId": emp["_id"], "title": title, "category": cat,
            "amount": amount + rng.randint(-300, 300), "currency": "INR", "expenseDate": spent.isoformat(),
            "description": desc, "receiptName": f"receipt_{slug(title)[:20]}.pdf", "status": status,
            "submittedAt": iso_at(spent + timedelta(days=1), 12),
        }
        if status != "SUBMITTED":
            doc["reviewedBy"] = MANAGER_REVIEWER if status == "MANAGER_APPROVED" else FINANCE_REVIEWER
            doc["reviewedAt"] = iso_at(min(spent + timedelta(days=3), TODAY), 10)
        if status == "REIMBURSED":
            doc["reimbursedAt"] = iso_at(min(spent + timedelta(days=7), TODAY), 16)
            doc["paymentReference"] = f"NEFT-EXP-{rng.randint(100000, 999999)}"
        if status == "REJECTED":
            doc["rejectionReason"] = "Receipt is not itemised. Please re-submit with a GST invoice."
        put("expenseClaims", modules_store.expenseClaims, stamp(doc))


DOC_TYPES = [
    ("IDENTITY", "Aadhaar & PAN Card", "aadhaar_pan.pdf", "1.8 MB"),
    ("EDUCATION", "Degree Certificate", "degree_certificate.pdf", "2.6 MB"),
    ("EMPLOYMENT", "Previous Employer Relieving Letter", "relieving_letter.pdf", "540 KB"),
    ("TAX", "Form 16 (Previous Employer)", "form16.pdf", "320 KB"),
    ("CERTIFICATION", "Professional Certification", "certification.pdf", "1.1 MB"),
]


def gen_documents() -> None:
    have = {(d.get("employeeId"), d.get("category")) for d in db_store.documents.values()}
    for emp in db_store.employees.values():
        pick = rng_for(emp["_id"], "docs")
        for cat, title, file_name, size in pick.sample(DOC_TYPES, pick.randint(2, 4)):
            if (emp["_id"], cat) in have:
                continue
            uploaded = ago(rng.randint(5, 400))
            status = rng.choices(["VERIFIED", "PENDING", "REJECTED"], [7, 2, 1])[0]
            doc = {
                "_id": f"doc_demo_{emp['_id']}_{cat.lower()}", "employeeId": emp["_id"], "category": cat, "title": title,
                "fileName": f"{emp['firstName'].lower()}_{slug(emp.get('lastName') or '')}_{file_name}",
                "fileType": "application/pdf", "fileSize": size, "uploadedBy": full_name(emp),
                "uploadedAt": iso_at(uploaded, rng.randint(9, 18)), "status": status,
            }
            if cat == "IDENTITY":
                doc["expiryDate"] = (uploaded + timedelta(days=3650)).isoformat()
            if status == "VERIFIED":
                doc.update({"verifiedBy": HR_REVIEWER, "verifiedAt": iso_at(min(uploaded + timedelta(days=2), TODAY), 14)})
            if status == "REJECTED":
                doc["rejectionReason"] = "Scan is blurred; please upload a clearer copy."
            put("documents", db_store.documents, stamp(doc))


GOALS = [
    ("Delivery commitments", "Ship planned roadmap items for the cycle on time and to quality bar."),
    ("Customer & stakeholder impact", "Improve satisfaction scores of internal and external stakeholders."),
    ("Process improvement", "Automate or simplify at least one recurring manual workflow."),
    ("Learning & mentorship", "Complete one certification and mentor a junior colleague."),
]


def gen_reviews() -> None:
    have = {r.get("employeeId") for r in modules_store.performanceReviews.values()}
    for emp in active_employees():
        if emp["_id"] in have:
            continue
        status = rng.choices(["GOAL_SETTING", "SELF_REVIEW", "MANAGER_REVIEW", "HR_CALIBRATION", "COMPLETED"], [1, 2, 3, 1, 3])[0]
        goals = []
        for (title, desc), w in zip(rng.sample(GOALS, 3), (40, 30, 30)):
            g = {"title": title, "description": desc, "weightage": w}
            if status != "GOAL_SETTING":
                g["selfRating"] = rng.choice([3, 4, 4, 5])
            if status in ("HR_CALIBRATION", "COMPLETED") or (status == "MANAGER_REVIEW" and rng.random() < 0.5):
                g["managerRating"] = rng.choice([2, 3, 4, 4, 5])
                g["comments"] = rng.choice(["Consistently strong delivery.", "Good progress, needs more ownership.", "Exceeded the target.", "Partially met; carried over."])
            goals.append(g)
        doc = {
            "_id": f"rev_demo_{emp['_id']}_2026h1", "employeeId": emp["_id"], "cycle": "2026-H1 Appraisal Cycle",
            "status": status, "goals": goals,
        }
        if all("selfRating" in g for g in goals):
            doc["overallSelfRating"] = round(sum(g["selfRating"] * g["weightage"] for g in goals) / 100, 1)
        if all("managerRating" in g for g in goals):
            doc["overallManagerRating"] = round(sum(g["managerRating"] * g["weightage"] for g in goals) / 100, 1)
            doc["strengths"] = "Reliable, collaborative and quick to unblock others."
            doc["areasOfImprovement"] = "Communicate risks earlier and document decisions."
            doc["promotionRecommendation"] = rng.choice(["RECOMMENDED", "READY_NEXT_CYCLE", "NOT_APPLICABLE"])
        if status == "COMPLETED":
            doc["completedAt"] = iso_at(ago(rng.randint(20, 90)), 17)
        put("performanceReviews", modules_store.performanceReviews, stamp(doc))


def gen_recruitment() -> None:
    jobs = [
        ("job_demo_01", "Backend Engineer (Python/FastAPI)", "Engineering & Technology", "Pune Innovation Hub (Hinjawadi)", "FULL_TIME", "3-5 years", 3, "OPEN", ["Python", "FastAPI", "MongoDB", "AWS"]),
        ("job_demo_02", "Payroll Specialist", "Finance & Compliance", "Mumbai Financial Hub (BKC)", "FULL_TIME", "4+ years", 1, "OPEN", ["Payroll", "TDS", "PF/ESI", "Excel"]),
        ("job_demo_03", "Product Designer", "Product & Design", "Bengaluru Tech Center (Prestige Tech Park)", "FULL_TIME", "2-4 years", 1, "ON_HOLD", ["Figma", "Design Systems", "User Research"]),
        ("job_demo_04", "Sales Development Representative", "Sales & Growth", "Remote - India", "CONTRACT", "1-2 years", 4, "OPEN", ["Outbound", "CRM", "Communication"]),
        ("job_demo_05", "HR Business Partner", "People Operations & HR", "Pune Innovation Hub (Hinjawadi)", "FULL_TIME", "6+ years", 1, "CLOSED", ["Employee Relations", "Policy", "HRMS"]),
    ]
    for jid, title, dept, loc, jtype, exp, n, status, skills in jobs:
        put("jobOpenings", modules_store.jobOpenings, {
            "_id": jid, "title": title, "department": dept, "location": loc, "type": jtype, "experienceRequired": exp,
            "openingsCount": n, "status": status, "postedDate": ago(rng.randint(10, 50)).isoformat(),
            "description": f"We are hiring a {title} to join our {dept} team.", "skillsRequired": skills,
        })
    names = ["Aditi Rao", "Kunal Bhatia", "Sana Shaikh", "Rohit Pawar", "Divya Menon", "Arnav Gupta", "Ishaan Chopra",
             "Prerna Joshi", "Tejas Kulkarni", "Lavanya Reddy", "Zoya Khan", "Harsh Vardhan", "Nandini Iyer", "Yash Thakur"]
    companies = ["Infosys", "TCS", "Razorpay", "Freshworks", "Zoho", "Persistent Systems", "Swiggy", "Wipro"]
    stages = ["APPLIED", "SCREENING", "TECHNICAL_INTERVIEW", "HR_INTERVIEW", "OFFERED", "HIRED", "REJECTED"]
    open_jobs = [j for j in jobs if j[7] != "CLOSED"]
    for i, name in enumerate(names):
        job = open_jobs[i % len(open_jobs)]
        stage = stages[i % len(stages)]
        cand = {
            "_id": f"cand_demo_{i:02d}", "jobId": job[0], "jobTitle": job[1], "fullName": name,
            "email": f"{slug(name).replace('_', '.')}@gmail.com", "phone": f"+91 9{rng.randint(100000000, 999999999)}",
            "stage": stage, "experienceYears": rng.randint(1, 9), "currentCompany": rng.choice(companies),
            "appliedDate": ago(rng.randint(3, 40)).isoformat(), "rating": round(rng.uniform(3.2, 4.9), 1),
            "notes": rng.choice(["Strong fundamentals.", "Good culture fit.", "Needs a second technical opinion.", "Notice period 60 days."]),
        }
        if stage in ("TECHNICAL_INTERVIEW", "HR_INTERVIEW"):
            when = TODAY + timedelta(days=rng.randint(1, 7))
            cand["interviewRounds"] = [{
                "roundNumber": 1, "roundName": "Round 1: Technical Interview", "date": when.isoformat(), "time": "15:00",
                "durationMinutes": 45, "mode": "VIDEO", "locationOrLink": "https://meet.google.com/abc-defg-hij",
                "interviewer": MANAGER_REVIEWER, "status": "SCHEDULED", "scheduledBy": HR_REVIEWER, "scheduledAt": iso_at(ago(2)),
            }]
        if stage in ("OFFERED", "HIRED"):
            cand["offer"] = {"ctc": rng.choice([900000, 1200000, 1600000]), "joiningDate": (TODAY + timedelta(days=30)).isoformat(), "status": "ACCEPTED" if stage == "HIRED" else "SENT"}
        put("jobCandidates", modules_store.jobCandidates, cand)

    reqs = [
        ("Data Analyst", "Finance & Compliance", 1, "HIGH", "SUBMITTED", "Month-end reporting backlog needs a dedicated analyst."),
        ("QA Automation Engineer", "Engineering & Technology", 2, "MEDIUM", "APPROVED", "Release cadence is blocked on manual regression."),
        ("Office Administrator", "Facility & Assets", 1, "LOW", "REJECTED", "Can be covered by the existing facility vendor."),
        ("Customer Success Manager", "Customer Success", 1, "HIGH", "SUBMITTED", "Two enterprise accounts are onboarding next quarter."),
    ]
    for i, (title, dept, n, prio, status, why) in enumerate(reqs):
        doc = {
            "_id": f"req_demo_{i:02d}", "requestedById": "emp_manager_auto", "requestedByName": "Arjun Khanna",
            "title": title, "department": dept, "positions": n, "employmentType": "FULL_TIME",
            "experienceRequired": "2-5 years", "skillsRequired": [], "priority": prio,
            "expectedJoiningDate": (TODAY + timedelta(days=45)).isoformat(), "budgetRange": "₹8L - ₹14L",
            "location": "Pune Innovation Hub (Hinjawadi)", "justification": why, "status": status,
            "createdAt": iso_at(ago(rng.randint(3, 25))),
        }
        if status != "SUBMITTED":
            doc.update({"reviewedBy": "Omkar Despande", "reviewedAt": iso_at(ago(2)), "reviewNote": "Discussed in the leadership sync."})
        put("requirements", modules_store.requirements, doc)

    referrers = [e for e in active_employees() if e["_id"] in login_employee_ids()] or active_employees()
    refs = [("Pranav Desai", "job_demo_01", "Ex-colleague", "SUBMITTED"), ("Ritika Saxena", "job_demo_02", "College friend", "IN_REVIEW"),
            ("Manav Arora", "job_demo_04", "Ex-colleague", "SHORTLISTED"), ("Gauri Patil", "job_demo_01", "Friend", "NOT_SELECTED")]
    for i, (name, job_id, rel, status) in enumerate(refs):
        by = referrers[i % len(referrers)]
        user = next((u for u in db_store.users.values() if u.get("employeeId") == by["_id"]), {})
        put("referrals", modules_store.referrals, {
            "_id": f"ref_demo_{i:02d}", "fullName": name, "email": f"{slug(name).replace('_', '.')}@outlook.com",
            "phone": f"+91 9{rng.randint(100000000, 999999999)}", "city": rng.choice(["Pune", "Mumbai", "Bengaluru"]),
            "experienceYears": rng.randint(2, 8), "jobId": job_id, "jobTitle": modules_store.jobOpenings[job_id]["title"],
            "relationship": rel, "notes": "Worked together on a payments project.", "status": status,
            "referredById": by["_id"], "referredByName": full_name(by), "referredByRole": user.get("role", "EMPLOYEE"),
            "createdAt": iso_at(ago(rng.randint(2, 30))),
        })


def gen_assets() -> None:
    have = {a.get("employeeId") for a in modules_store.assets.values()}
    laptops = [("MacBook Air 13\" M3", "C02"), ("Dell Latitude 5440", "DL"), ("Lenovo ThinkPad T14", "PF"), ("HP EliteBook 840", "5CG")]
    n = 100
    for emp in db_store.employees.values():
        if emp["_id"] in have:
            continue
        model, prefix = rng.choice(laptops)
        issued = max(date.fromisoformat(emp.get("joiningDate") or "2023-01-01"), ago(900))
        returned = emp.get("status") == "TERMINATED"
        doc = {
            "_id": f"asset_demo_{n}", "employeeId": emp["_id"], "category": "ELECTRONICS", "type": "LAPTOP", "name": model,
            "assetTag": f"AST-LAP-{n:04d}", "serialNumber": f"{prefix}{rng.randint(10000000, 99999999)}",
            "issuedDate": issued.isoformat(), "status": "RETURNED" if returned else "ALLOCATED",
            "notes": "Standard issue laptop.", "allocatedBy": "IT Helpdesk",
        }
        if returned:
            doc["returnedDate"] = ago(55).isoformat()
        put("assets", modules_store.assets, stamp(doc))
        n += 1
        if rng.random() < 0.35:
            put("assets", modules_store.assets, stamp({
                "_id": f"asset_demo_{n}", "employeeId": emp["_id"], "category": "ELECTRONICS", "type": "PHONE",
                "name": rng.choice(["iPhone 15", "Samsung Galaxy S24", "OnePlus 12"]), "assetTag": f"AST-PHN-{n:04d}",
                "serialNumber": f"IMEI{rng.randint(10**11, 10**12 - 1)}", "issuedDate": issued.isoformat(),
                "status": "ALLOCATED", "notes": "Corporate phone with MDM.", "allocatedBy": "IT Helpdesk",
            }))
            n += 1


HR_TICKETS = [
    ("PAYROLL", "Incorrect HRA in September payslip", "HRA appears lower than my salary structure. Please check."),
    ("LEAVE_ATTENDANCE", "Attendance not marked on client visit day", "I was at the client site and could not check in."),
    ("BENEFITS", "Add newborn to medical insurance", "Please add my daughter to the group health policy."),
    ("DOCUMENTS", "Address proof letter for passport", "Need an address proof letter on company letterhead."),
    ("IT_ASSETS", "Laptop battery draining fast", "Battery lasts under 2 hours; requesting replacement."),
    ("GENERAL", "Parking slot request", "Requesting a two-wheeler parking slot at the Pune office."),
    ("PAYROLL", "Investment proof submission deadline", "What is the last date for submitting 80C proofs?"),
]


def gen_hr_requests() -> None:
    emps = active_employees()
    logins = [e for e in emps if e["_id"] in login_employee_ids()]
    for i, (cat, subject, desc) in enumerate(HR_TICKETS):
        emp = logins[i % len(logins)] if i < 3 and logins else rng.choice(emps)
        status = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"][i % 4]
        created = ago(rng.randint(1, 30))
        doc = {
            "_id": f"hrreq_demo_{i:02d}", "ticketNumber": f"HR-REQ-{2100 + i}", "employeeId": emp["_id"], "category": cat,
            "subject": subject, "description": desc, "priority": rng.choice(["LOW", "MEDIUM", "HIGH", "URGENT"]),
            "status": status, "assignedTo": HR_REVIEWER, "createdAt": iso_at(created, 10, 30),
        }
        if status in ("RESOLVED", "CLOSED"):
            doc.update({"resolvedAt": iso_at(min(created + timedelta(days=2), TODAY), 15), "resolutionRemarks": "Resolved and confirmed with the employee."})
        put("hrRequests", modules_store.hrRequests, stamp(doc))


def gen_exits() -> None:
    for emp_id, resigned, lwd, status, cleared in [
        ("emp_demo_notice_01", ago(40), TODAY + timedelta(days=20), "DEPARTMENT_CLEARANCE", 1),
        ("emp_demo_notice_02", ago(50), TODAY + timedelta(days=10), "FINANCE_CLEARANCE", 3),
        ("emp_demo_exit_01", ago(120), ago(60), "DISBURSED", 4),
    ]:
        emp = db_store.employees.get(emp_id)
        if not emp:
            continue
        keys = ["department", "itAssets", "finance", "admin"]
        clearances = {k: {"cleared": i < cleared, "remarks": "Cleared." if i < cleared else "Pending.", "clearedBy": "Clearance Owner" if i < cleared else ""} for i, k in enumerate(keys)}
        unpaid = round((emp.get("annualSalary") or 1200000) / 12 * 0.6)
        enc_days = rng.randint(5, 15)
        enc = round((emp.get("annualSalary") or 1200000) / 365 * enc_days)
        put("fullFinalSettlements", modules_store.fullFinalSettlements, stamp({
            "_id": f"fnf_demo_{emp_id}", "employeeId": emp_id, "resignationDate": resigned.isoformat(),
            "lastWorkingDay": lwd.isoformat(), "noticePeriodDays": 60, "noticeServedDays": min(60, (min(lwd, TODAY) - resigned).days),
            "status": status, "clearances": clearances,
            "settlementComponents": {"unpaidSalary": unpaid, "leaveEncashmentDays": enc_days, "leaveEncashmentAmount": enc,
                                     "gratuity": 0, "noticePayShortfallDeduction": 0, "bonusOrIncentive": 0, "totalPayable": unpaid + enc},
            "notes": "Resigned for a role closer to hometown.",
        }))


def gen_insurance_tax() -> None:
    for emp in active_employees():
        if emp["_id"] not in modules_store.insuranceEnrollments and rng_for(emp["_id"], "insurance").random() < 0.7:
            sum_insured = rng.choice([300000, 500000, 500000, 1000000])
            premium = sum_insured // 50
            deps = [] if rng.random() < 0.3 else [{"name": f"{rng.choice(['Kavya', 'Rhea', 'Aryan', 'Vivaan'])} {emp.get('lastName')}",
                                                  "relation": rng.choice(["Spouse", "Child"]), "dob": f"20{rng.randint(10, 22)}-0{rng.randint(1, 9)}-15",
                                                  "gender": rng.choice(["Male", "Female"])}]
            put("insuranceEnrollments", modules_store.insuranceEnrollments, stamp({
                "_id": f"ins_enr_demo_{emp['_id']}", "employeeId": emp["_id"], "grade": "Standard",
                "sumInsured": sum_insured, "premiumAnnual": premium, "monthlyPayrollDeduction": premium // 12,
                "dependents": deps, "eCardNumber": f"MA-GMC-2026-{rng.randint(100000, 999999)}", "status": "ACTIVE",
            }), emp["_id"])
        if emp["_id"] not in modules_store.taxDeclarations and rng_for(emp["_id"], "tax").random() < 0.6:
            elss, ppf = rng.choice([0, 20000, 50000]), rng.choice([0, 30000, 50000])
            epf = round(min(emp.get("annualSalary") or 0, 1800000) * 0.024)
            total80c = min(150000, epf + elss + ppf)
            d80 = rng.choice([0, 25000, 50000])
            rent = rng.choice([0, 240000, 300000])
            regime = rng.choice(["NEW", "NEW", "OLD"])
            put("taxDeclarations", modules_store.taxDeclarations, {
                "_id": f"tax_demo_{emp['_id']}", "employeeId": emp["_id"], "financialYear": "2026-2027", "regime": regime,
                "section80C": {"epf": epf, "ppf": ppf, "elss": elss, "lifeInsurance": 0, "taxSaverFD": 0, "total": total80c, "maxLimit": 150000},
                "section80D": {"selfSpouseChildren": d80, "parents": 0, "total": d80},
                "hraExemption": {"annualRentPaid": rent, "cityType": "METRO", "calculatedExemption": round(rent * 0.6)},
                "section80CCD_1B": 0, "homeLoanInterest80EE": 0,
                "totalDeductionsDeclared": total80c + d80 + round(rent * 0.6),
                "estimatedTaxPayable": round((emp.get("annualSalary") or 0) * rng.uniform(0.04, 0.12)),
                "submittedAt": iso_at(ago(rng.randint(30, 150))), "status": rng.choice(["SUBMITTED", "VERIFIED"]),
            }, emp["_id"])

    claims = [("Fortis Hospital, Mulund", "Dengue fever", 62000, "CASHLESS", "TPA_REVIEW"),
              ("Ruby Hall Clinic, Pune", "Appendectomy", 135000, "CASHLESS", "APPROVED"),
              ("Columbia Asia, Hebbal", "Fractured wrist", 28500, "REIMBURSEMENT", "QUERY_RAISED"),
              ("Jehangir Hospital, Pune", "Cataract surgery", 54000, "REIMBURSEMENT", "SUBMITTED")]
    enrolled = [e for e in modules_store.insuranceEnrollments.values() if e.get("employeeId") in db_store.employees]
    for i, (hosp, diag, amount, ctype, status) in enumerate(claims):
        if not enrolled:
            break
        enr = enrolled[i % len(enrolled)]
        adm = ago(rng.randint(10, 45))
        dep = (enr.get("dependents") or [None])[0]
        doc = {
            "_id": f"ins_clm_demo_{i:02d}", "employeeId": enr["employeeId"],
            "patientName": dep["name"] if dep else enr.get("employeeName"), "relation": dep["relation"] if dep else "Self",
            "hospitalName": hosp, "admissionDate": adm.isoformat(), "dischargeDate": (adm + timedelta(days=rng.randint(1, 4))).isoformat(),
            "claimType": ctype, "amountRequested": amount, "status": status, "diagnosis": diag,
            "submittedAt": iso_at(adm + timedelta(days=5)), "documents": ["DischargeSummary.pdf", "FinalBill.pdf"],
        }
        if status == "APPROVED":
            doc.update({"amountApproved": amount - 4500, "tpaRemarks": "Approved less non-medical consumables."})
        if status == "QUERY_RAISED":
            doc["tpaRemarks"] = "Please share the X-ray report and pharmacy bills."
        put("insuranceClaims", modules_store.insuranceClaims, stamp(doc))


def gen_policy_acks() -> None:
    have = {(a.get("policyId"), a.get("employeeId")) for a in modules_store.policyAcknowledgements}
    policies = list(modules_store.policies.values())
    new = []
    for emp in active_employees():
        for pol in policies:
            if (pol["_id"], emp["_id"]) in have or rng_for(emp["_id"], pol["_id"]).random() < 0.45:
                continue
            new.append({
                "_id": f"ack_demo_{emp['_id']}_{pol['_id']}", "policyId": pol["_id"], "employeeId": emp["_id"],
                "employeeName": full_name(emp), "acknowledgedAt": iso_at(ago(rng.randint(1, 120)), rng.randint(9, 18)),
                "ipAddress": f"103.21.{rng.randint(100, 199)}.{rng.randint(2, 250)}",
                "digitalSignature": f"{full_name(emp)} ({emp.get('employeeCode')})",
            })
    modules_store.policyAcknowledgements.extend(new)  # oldest-first array
    if new:
        added["policyAcknowledgements"] += len(new)


def gen_announcements() -> None:
    items = [
        ("ann_demo_01", "Diwali celebrations on Friday", "Join us for rangoli, lunch and the gift exchange at 3 PM in the cafeteria.", "CELEBRATION", "NORMAL", 2, True),
        ("ann_demo_02", "Investment proofs due by 15 January", "Upload your 80C, 80D and HRA proofs on the Tax page to avoid higher TDS.", "HR_ALERT", "HIGH", 4, False),
        ("ann_demo_03", "Updated Work From Home policy", "Teams can now work from home up to 2 days a week. Read the policy and acknowledge it.", "POLICY", "NORMAL", 9, False),
        ("ann_demo_04", "Welcome our new joiners", "Please welcome Ananya Kulkarni (Engineering) and Farhan Qureshi (Customer Success).", "GENERAL", "LOW", 12, False),
    ]
    for _id, title, content, cat, prio, days, pinned in items:
        put("announcements", modules_store.announcements, {
            "_id": _id, "title": title, "content": content, "category": cat, "priority": prio,
            "publishedBy": "People Operations", "publishedAt": iso_at(ago(days), 9, 30), "pinned": pinned,
        })


def gen_lifecycle() -> None:
    events = []
    for i, emp in enumerate(rng.sample(active_employees(), min(10, len(active_employees())))):
        kind = ["PROMOTION", "SALARY_REVISION", "TRANSFER", "CONFIRMATION", "MANAGER_CHANGE"][i % 5]
        ctc = emp.get("annualSalary") or 1000000
        prev, new = {
            "PROMOTION": (f"Associate {emp.get('designation')}", emp.get("designation")),
            "SALARY_REVISION": (f"₹{round(ctc / 1.1):,}", f"₹{ctc:,}"),
            "TRANSFER": ("Mumbai Financial Hub (BKC)", emp.get("location") or "Pune Innovation Hub (Hinjawadi)"),
            "CONFIRMATION": ("PROBATION", "ACTIVE"),
            "MANAGER_CHANGE": ("Omkar Despande", "Arjun Khanna"),
        }[kind]
        eff = ago(rng.randint(5, 200))
        events.append(stamp({
            "_id": f"lc_demo_{i:02d}", "employeeId": emp["_id"], "eventType": kind, "effectiveDate": eff.isoformat(),
            "previousValue": prev, "newValue": new, "reason": "Annual review cycle outcome.",
            "initiatedBy": HR_REVIEWER, "initiatedAt": iso_at(eff - timedelta(days=7)),
            "approvalStatus": "PENDING" if i == 0 else "APPROVED", "department": emp.get("department"),
        }))
    push("lifecycleEvents", db_store.lifecycleEvents, events)


def gen_notifications_and_audit() -> None:
    templates = [
        ("Leave request approved", "Your casual leave request has been approved.", "LEAVE"),
        ("Payslip available", f"Your payslip for {(TODAY.replace(day=1) - timedelta(days=1)).strftime('%B %Y')} is ready to download.", "PAYROLL"),
        ("Policy acknowledgement pending", "Please read and acknowledge the updated Work From Home policy.", "POLICY"),
        ("Document verified", "HR verified your Aadhaar & PAN document.", "DOCUMENT"),
        ("New announcement", "Diwali celebrations on Friday - see Announcements.", "ANNOUNCEMENT"),
    ]
    admin_templates = [
        ("Leave approval pending", "3 leave requests are waiting for your review.", "LEAVE"),
        ("New onboarding submission", "A new hire submitted onboarding details for verification.", "ONBOARDING"),
        ("Expense claims to review", "5 expense claims are awaiting approval.", "EXPENSE"),
    ]
    notifs = []
    for u in db_store.users.values():
        if (u.get("email") or "").lower() not in DEMO_ACCOUNTS:
            continue
        pool = templates + (admin_templates if u.get("role") not in ("EMPLOYEE",) else [])
        for j, (title, msg, typ) in enumerate(pool):
            notifs.append({
                "_id": f"notif_demo_{u['_id']}_{j}", "recipientUserId": u["_id"], "title": title, "message": msg,
                "type": typ, "isRead": j >= 3, "createdAt": iso_at(ago(j), 9 + j),
            })
    push("notifications", db_store.notifications, notifs)

    actions = [("USER_LOGIN", "AUTH", "User"), ("LEAVE_APPROVED", "LEAVE", "LeaveRequest"), ("EMPLOYEE_UPDATED", "EMPLOYEES", "Employee"),
               ("PAYROLL_RUN", "PAYROLL", "PayrollRun"), ("DOCUMENT_VERIFIED", "DOCUMENTS", "Document"),
               ("EXPENSE_REIMBURSED", "EXPENSES", "ExpenseClaim"), ("POLICY_PUBLISHED", "POLICIES", "Policy"),
               ("ASSET_ALLOCATED", "ASSETS", "Asset"), ("CANDIDATE_STAGE_UPDATED", "RECRUITMENT", "Candidate")]
    actors = [u for u in db_store.users.values() if u.get("role") in ("ADMIN", "HR", "FINANCE", "MANAGER")] or list(db_store.users.values())
    logs = []
    for i in range(40):
        u = rng.choice(actors)
        action, module, entity = rng.choice(actions)
        when = datetime.now(timezone.utc) - timedelta(hours=rng.randint(1, 24 * 30), minutes=rng.randint(0, 59))
        logs.append({
            "_id": f"aud_demo_{i:02d}", "userId": u["_id"], "userEmail": u.get("email"), "role": u.get("role"),
            "action": action, "module": module, "entity": entity, "entityId": f"{entity.lower()}_{rng.randint(100, 999)}",
            "details": {"source": "demo data"}, "ipAddress": f"103.21.124.{rng.randint(2, 250)}",
            "timestamp": when.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        })
    push("auditLogs", db_store.auditLogs, logs)


# --------------------------------------------------------------------------- main

async def main() -> None:
    if backend_running() and "--force" not in sys.argv:
        print(f"The backend is running on port {PORT}. Stop it first (it would overwrite the new data), "
              "or pass --force if that port is something else.")
        sys.exit(1)

    await persistence.connect()
    print("Target:", "MongoDB + data/hrms_store.json" if persistence.is_connected() else "data/hrms_store.json only")

    seed_people()
    seed_organization()
    seed_modules()
    gen_leaves()
    gen_attendance()
    gen_payslips()
    gen_expenses()
    gen_documents()
    gen_reviews()
    gen_recruitment()
    gen_assets()
    gen_hr_requests()
    gen_exits()
    gen_insurance_tax()
    gen_policy_acks()
    gen_announcements()
    gen_lifecycle()
    gen_notifications_and_audit()

    await persistence.flush_and_close()

    if not added:
        print("Nothing to add - demo data is already present.")
        return
    print("Added:")
    for name, n in sorted(added.items()):
        print(f"  {name:<24}{n:>5}")
    print(f"\nDemo logins: see DEMO_ACCOUNTS in app/stores/db_store.py. Other seeded colleagues use password {DEMO_PASSWORD}.")


if __name__ == "__main__":
    asyncio.run(main())
