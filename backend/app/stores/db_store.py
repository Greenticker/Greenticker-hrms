"""
In-memory core store (users, employees, organisation, documents, attendance, ...).

Containers are plain dicts (insertion ordered, like JS Maps) and lists. They are filled
from the seed file, then replaced by data from MongoDB / data/hrms_store.json at startup
(see app.database.persistence).
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt

from app.stores.seed import seed_container
from app.utils.geofence import distance_from_office, is_valid_fix, is_within_office
from app.utils.jsutil import clean_num, date_ms, js_round, local_hhmm, now_iso, now_ms, rand_int, today_str
from app.utils.overtime import compute_shift_credit, gross_minutes_between

INVITE_TTL_HOURS = 48

_WINDOW_RE = re.compile(r"(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})")


def merge(base: dict, partial: dict) -> dict:
    """{...base, ...partial} where a None value in `partial` acts like `undefined` (removes the key)."""
    out = dict(base)
    for k, v in partial.items():
        if v is None:
            out.pop(k, None)
        else:
            out[k] = v
    return out


def set_or_drop(doc: dict, key: str, value) -> None:
    """doc[key] = value, where None means `undefined` (key is dropped)."""
    if value is None:
        doc.pop(key, None)
    else:
        doc[key] = value


def _demo_hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(10)).decode("utf-8")


DEMO_ACCOUNTS = {
    "superadmin@vetan.ai": {"role": "SUPER_ADMIN", "firstName": "Vikramaditya", "lastName": "Rao", "pass": "SuperAdmin@12345", "empCode": "RHA-000", "dept": "Executive Office", "desig": "Super Administrator"},
    "admin1@vetan.ai": {"role": "ADMIN_1", "firstName": "Rajesh", "lastName": "Singhania", "pass": "Admin1@12345", "empCode": "RHA-001", "dept": "Operations & Governance", "desig": "Admin Level 1 Controller"},
    "admin2@vetan.ai": {"role": "ADMIN_2", "firstName": "Deepika", "lastName": "Sharma", "pass": "Admin2@12345", "empCode": "RHA-002", "dept": "Facility & Assets", "desig": "Admin Level 2 Manager"},
    "finance@vetan.ai": {"role": "FINANCE", "firstName": "Priya", "lastName": "Sharma", "pass": "Finance@12345", "empCode": "RHA-020", "dept": "Finance & Accounts", "desig": "Finance & Payroll Controller"},
    "hr@vetan.ai": {"role": "HR", "firstName": "Aditya", "lastName": "Kapoor", "pass": "HR@12345", "empCode": "RHA-008", "dept": "People Operations & HR", "desig": "Senior HR Operations Lead"},
    "accounts@vetan.ai": {"role": "ACCOUNTS", "firstName": "Neha", "lastName": "Deshmukh", "pass": "Accounts@12345", "empCode": "RHA-030", "dept": "Finance & Compliance", "desig": "Senior Accounts Officer"},
    "auditor@vetan.ai": {"role": "AUDITORS", "firstName": "Tanvi", "lastName": "Agarwal", "pass": "Auditor@12345", "empCode": "RHA-040", "dept": "Legal & Governance", "desig": "Statutory Compliance Auditor"},
    "omkar@greenticker.in": {"role": "ADMIN", "firstName": "Omkar", "lastName": "Despande", "pass": "Admin@12345", "empCode": "RHA-001", "dept": "Executive Board", "desig": "Chief Executive Officer"},
    "manager@vetan.ai": {"role": "MANAGER", "firstName": "Arjun", "lastName": "Khanna", "pass": "Manager@12345", "empCode": "RHA-012", "dept": "Engineering & Technology", "desig": "Engineering Manager"},
    "employee@vetan.ai": {"role": "EMPLOYEE", "firstName": "Rohan", "lastName": "Verma", "pass": "Employee@12345", "empCode": "RHA-101", "dept": "Engineering & Technology", "desig": "Senior Software Engineer"},
    "newhire@vetan.ai": {"role": "EMPLOYEE", "firstName": "Ishita", "lastName": "Iyer", "pass": "NewHire@12345", "empCode": "RHA-201", "dept": "Product & Design", "desig": "Product Designer"},
}


class DbStore:
    def __init__(self) -> None:
        self.users: dict = seed_container("db", "users")
        self.employees: dict = seed_container("db", "employees")
        self.organizations: dict = seed_container("db", "organizations")
        self.departments: dict = seed_container("db", "departments")
        self.designations: dict = seed_container("db", "designations")
        self.locations: dict = seed_container("db", "locations")
        self.onboardingSubmissions: dict = seed_container("db", "onboardingSubmissions")
        self.documents: dict = seed_container("db", "documents")
        self.lifecycleEvents: list = seed_container("db", "lifecycleEvents")
        self.shifts: dict = seed_container("db", "shifts")
        self.attendanceRecords: dict = seed_container("db", "attendanceRecords")
        self.auditLogs: list = seed_container("db", "auditLogs")
        self.notifications: list = seed_container("db", "notifications")

    # ------------------------------------------------------------------ users

    def find_user_by_email(self, email: Optional[str]) -> Optional[dict]:
        if not email:
            return None
        clean = email.strip().lower()
        for u in self.users.values():
            if u.get("email") and u["email"].strip().lower() == clean:
                return u

        # Auto-provision demo accounts if missing from store/MongoDB
        org_id = next(iter(self.organizations), None) or "org_zenith_hq"
        cfg = DEMO_ACCOUNTS.get(clean)
        if not cfg:
            return None

        role = cfg["role"]
        user_id = f"usr_{role.lower()}_auto"
        emp_id = f"emp_{role.lower()}_auto"
        not_new_hire = role != "EMPLOYEE" or clean != "newhire@vetan.ai"
        now = now_iso()
        new_user = {
            "_id": user_id,
            "email": clean,
            "passwordHash": _demo_hash(cfg["pass"]),
            "firstName": cfg["firstName"],
            "lastName": cfg["lastName"],
            "role": role,
            "organizationId": org_id,
            "employeeId": emp_id,
            "onboardingCompleted": not_new_hire,
            "onboardingStep": 9 if not_new_hire else 1,
            "orgSetupCompleted": True,
            "orgSetupStep": 4,
            "isActive": True,
            "createdAt": now,
            "updatedAt": now,
        }
        self.users[user_id] = new_user

        if emp_id not in self.employees:
            self.employees[emp_id] = {
                "_id": emp_id,
                "userId": user_id,
                "organizationId": org_id,
                "employeeCode": cfg["empCode"],
                "firstName": cfg["firstName"],
                "lastName": cfg["lastName"],
                "gender": "Other",
                "dob": "1990-01-01",
                "bloodGroup": "B+",
                "personalEmail": f"{cfg['firstName'].lower()}.{cfg['lastName'].lower()}@gmail.com",
                "workEmail": clean,
                "phone": "+91 98450 11111",
                "department": cfg["dept"],
                "designation": cfg["desig"],
                "joiningDate": "2023-01-01",
                "employmentType": "FULL_TIME",
                "status": "ACTIVE",
                "shift": "Standard General (09:00 - 18:00)",
                "location": "Bengaluru HQ (Prestige Tech Park)",
                "annualSalary": 1500000,
            }
        return new_user

    def find_user_by_id(self, user_id: Optional[str]) -> Optional[dict]:
        return self.users.get(user_id) if user_id else None

    def find_employee_by_user_id(self, user_id: str) -> Optional[dict]:
        for emp in self.employees.values():
            if emp.get("userId") == user_id:
                return emp
        return None

    def get_employee_by_id(self, emp_id: Optional[str]) -> Optional[dict]:
        return self.employees.get(emp_id) if emp_id else None

    def get_employees_for_user(self, user: dict, search: Optional[str] = None, department: Optional[str] = None, status: Optional[str] = None) -> list:
        if user.get("role") == "ADMIN":
            items = list(self.employees.values())
        else:
            # Everyone else sees only themself
            items = [e for e in self.employees.values() if e.get("userId") == user["_id"]]

        if department and department != "ALL":
            dept = department.lower()
            items = [e for e in items if dept in (e.get("department") or "").lower()]
        if status and status != "ALL":
            items = [e for e in items if e.get("status") == status]
        if search:
            q = search.lower()
            items = [
                e for e in items
                if q in (e.get("firstName") or "").lower()
                or q in (e.get("lastName") or "").lower()
                or q in (e.get("employeeCode") or "").lower()
                or q in (e.get("workEmail") or "").lower()
                or q in (e.get("designation") or "").lower()
            ]
        return items

    def create_user(self, user: dict) -> dict:
        user_id = f"usr_{now_ms()}_{rand_int(1000)}"
        now = now_iso()
        new_user = merge({"orgSetupCompleted": True, "orgSetupStep": 4}, user)
        new_user.update({"_id": user_id, "createdAt": now, "updatedAt": now})
        self.users[user_id] = new_user
        return new_user

    def create_employee(self, emp: dict) -> dict:
        emp_id = f"emp_{now_ms()}_{rand_int(1000)}"
        new_emp = merge({}, emp)
        new_emp["_id"] = emp_id
        self.employees[emp_id] = new_emp
        return new_emp

    def update_employee(self, emp_id: str, partial: dict) -> Optional[dict]:
        emp = self.employees.get(emp_id)
        if not emp:
            return None
        updated = merge(emp, partial)
        self.employees[emp_id] = updated
        return updated

    def update_user(self, user_id: str, partial: dict) -> Optional[dict]:
        user = self.users.get(user_id)
        if not user:
            return None
        updated = merge(user, partial)
        updated["updatedAt"] = now_iso()
        self.users[user_id] = updated
        return updated

    def log_audit(self, entry: dict) -> None:
        doc = merge({}, entry)
        doc["ipAddress"] = entry.get("ipAddress") or "103.21.124.89"
        doc["_id"] = f"aud_{now_ms()}_{rand_int(1000)}"
        doc["timestamp"] = now_iso()
        self.auditLogs.insert(0, doc)

    # -------------------------------------------------------------- documents

    def get_documents_for_user(self, user: dict, category: Optional[str] = None, status: Optional[str] = None, employee_id: Optional[str] = None, include_deleted: bool = False) -> list:
        docs = list(self.documents.values())

        if status == "DELETED":
            docs = [d for d in docs if d.get("isDeleted") is True]
        elif not include_deleted:
            docs = [d for d in docs if not d.get("isDeleted")]

        if user.get("role") in ("ADMIN", "HR"):
            if employee_id:
                docs = [d for d in docs if d.get("employeeId") == employee_id]
        else:
            docs = [d for d in docs if d.get("employeeId") == user.get("employeeId")]

        if category and category != "ALL":
            docs = [d for d in docs if d.get("category") == category]

        if status and status not in ("ALL", "DELETED"):
            if status == "REVISION_REQUESTED":
                docs = [d for d in docs if d.get("status") in ("REVISION_REQUESTED", "REJECTED")]
            else:
                docs = [d for d in docs if d.get("status") == status]

        return sorted(docs, key=lambda d: date_ms(d.get("uploadedAt")), reverse=True)

    def create_document(self, doc: dict) -> dict:
        doc_id = f"doc_{now_ms()}_{rand_int(1000)}"
        new_doc = merge({}, doc)
        new_doc["_id"] = doc_id
        self.documents[doc_id] = new_doc
        return new_doc

    def update_document(self, doc_id: str, partial: dict) -> Optional[dict]:
        doc = self.documents.get(doc_id)
        if not doc:
            return None
        updated = merge(doc, partial)
        self.documents[doc_id] = updated
        return updated

    def delete_document(self, doc_id: str) -> bool:
        return self.documents.pop(doc_id, None) is not None

    # -------------------------------------------------------------- lifecycle

    def get_lifecycle_events_for_user(self, user: dict, event_type: Optional[str] = None, employee_id: Optional[str] = None) -> list:
        events = list(self.lifecycleEvents)
        if user.get("role") == "ADMIN":
            if employee_id:
                events = [e for e in events if e.get("employeeId") == employee_id]
        else:
            events = [e for e in events if e.get("employeeId") == user.get("employeeId")]

        if event_type and event_type != "ALL":
            events = [e for e in events if e.get("eventType") == event_type]

        return sorted(events, key=lambda e: date_ms(e.get("effectiveDate")), reverse=True)

    def create_lifecycle_event(self, event: dict) -> dict:
        new_event = merge({}, event)
        new_event["_id"] = f"lc_{now_ms()}_{rand_int(1000)}"
        new_event["initiatedAt"] = now_iso()
        self.lifecycleEvents.insert(0, new_event)
        return new_event

    # ------------------------------------------------------------- onboarding

    def get_onboarding_submissions(self) -> list:
        return sorted(self.onboardingSubmissions.values(), key=lambda s: date_ms(s.get("updatedAt")), reverse=True)

    def get_onboarding_submission_by_id(self, sub_id: str) -> Optional[dict]:
        return self.onboardingSubmissions.get(sub_id)

    def update_onboarding_submission(self, sub_id: str, partial: dict) -> Optional[dict]:
        sub = self.onboardingSubmissions.get(sub_id)
        if not sub:
            return None
        updated = merge(sub, partial)
        updated["updatedAt"] = now_iso()
        self.onboardingSubmissions[sub_id] = updated
        return updated

    # ------------------------------------------- shift resolution & day credit

    def resolve_shift(self, shift_name: Optional[str]) -> Optional[dict]:
        """Employee shift strings ("Standard General (09:00 - 18:00)") don't always equal shift
        names, so match by name/code first, then by the time window in brackets."""
        if not shift_name:
            return None
        n = shift_name.strip().lower()
        shifts = list(self.shifts.values())

        for x in shifts:
            if (x.get("name") or "").lower() == n or (x.get("code") or "").lower() == n:
                return x

        window = _WINDOW_RE.search(shift_name)
        if window:
            for x in shifts:
                if x.get("startTime") == window.group(1) and x.get("endTime") == window.group(2):
                    return x

        for x in shifts:
            name = (x.get("name") or "").lower()
            if name in n or n in name:
                return x
        return None

    def is_night_shift_by_name(self, shift_name: Optional[str]) -> bool:
        shift = self.resolve_shift(shift_name)
        if shift:
            return bool(shift.get("isNightShift"))
        # Unknown shift: treat a window that ends before it starts (e.g. 22:00 - 06:00) as night.
        window = _WINDOW_RE.search(shift_name or "")
        return window.group(2) < window.group(1) if window else False

    def apply_shift_hours(self, record: dict) -> None:
        """Single place that turns check-in/out times into hours + extra-day credit."""
        record["isNightShift"] = self.is_night_shift_by_name(record.get("shiftName"))

        if not record.get("checkInTime") or not record.get("checkOutTime"):
            record["extraDayCredit"] = record.get("extraDayCredit") if record.get("extraDayCredit") is not None else 0
            record["extraPayTier"] = record.get("extraPayTier") if record.get("extraPayTier") is not None else "NONE"
            return

        gross_minutes = gross_minutes_between(record["checkInTime"], record["checkOutTime"])
        record["totalMinutesWorked"] = gross_minutes

        # Effective hours = time actually worked, i.e. gross minus the break.
        net_minutes = max(0, gross_minutes - (record.get("breakMinutes") or 60))
        record["effectiveWorkingHours"] = clean_num(js_round((net_minutes / 60) * 100) / 100)

        # The 8h shift includes the break, so pay tiers use gross time.
        credit = compute_shift_credit(gross_minutes, record["isNightShift"])
        record["overtimeMinutes"] = credit["extraMinutes"]
        record["overtimeHours"] = clean_num(js_round((credit["extraMinutes"] / 60) * 100) / 100)
        record["extraDayCredit"] = credit["extraDayCredit"]
        record["extraPayTier"] = credit["tier"]

    # ------------------------------------------------------------- attendance

    def get_attendance_for_user(self, user: dict, date: Optional[str] = None, month: Optional[str] = None, employee_id: Optional[str] = None, status: Optional[str] = None) -> list:
        records = list(self.attendanceRecords.values())
        if user.get("role") == "ADMIN":
            if employee_id:
                records = [r for r in records if r.get("employeeId") == employee_id]
        else:
            records = [r for r in records if r.get("employeeId") == user.get("employeeId")]

        if date:
            records = [r for r in records if r.get("date") == date]
        if month:
            records = [r for r in records if (r.get("date") or "").startswith(month)]
        if status and status != "ALL":
            records = [r for r in records if r.get("status") == status]

        return sorted(records, key=lambda r: date_ms(r.get("date")), reverse=True)

    def check_in(self, employee_id: str, location: Optional[str] = None, ip_address: Optional[str] = None, geo: Optional[dict] = None, client_time: Optional[str] = None) -> dict:
        emp = self.employees.get(employee_id)
        if not emp:
            raise ValueError("Employee not found")

        today = today_str()
        now_time = client_time or local_hhmm()

        work_mode = "WORK_FROM_HOME"
        check_in_distance_km = None
        if geo and is_valid_fix(geo):
            d = distance_from_office(geo, emp.get("location"))
            check_in_distance_km = d["km"]
            if is_within_office(d["km"]):
                work_mode = "WORK_FROM_OFFICE"

        # Check if already checked in today
        existing = next(
            (r for r in self.attendanceRecords.values() if r.get("employeeId") == employee_id and r.get("date") == today),
            None,
        )
        if existing:
            existing["checkInTime"] = now_time
            existing["status"] = "PRESENT"
            existing["workMode"] = work_mode
            set_or_drop(existing, "checkInDistanceKm", check_in_distance_km)
            if location:
                existing["location"] = location
            return existing

        rec_id = f"att_{now_ms()}_{rand_int(1000)}"
        new_record = {
            "_id": rec_id,
            "employeeId": emp["_id"],
            "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
            "employeeCode": emp.get("employeeCode"),
            "department": emp.get("department"),
            "date": today,
            "shiftName": emp.get("shift") or "Standard Corporate Shift",
            "shiftExpectedHours": 8,
            "checkInTime": now_time,
            "totalMinutesWorked": 0,
            "breakMinutes": 60,
            "effectiveWorkingHours": 0,
            "overtimeMinutes": 0,
            "overtimeHours": 0,
            "isNightShift": self.is_night_shift_by_name(emp.get("shift")),
            "extraDayCredit": 0,
            "extraPayTier": "NONE",
            "status": "PRESENT",
            "workMode": work_mode,
            "checkInDistanceKm": check_in_distance_km,
            "location": location or "Headquarters WiFi",
            "ipAddress": ip_address or "198.51.100.1",
        }
        if check_in_distance_km is None:
            del new_record["checkInDistanceKm"]
        self.attendanceRecords[rec_id] = new_record
        return new_record

    def check_out(self, employee_id: str, location: Optional[str] = None, geo: Optional[dict] = None, client_time: Optional[str] = None) -> dict:
        now = datetime.now(timezone.utc)
        today = now.strftime("%Y-%m-%d")
        yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        now_time = client_time or local_hhmm()

        records = list(self.attendanceRecords.values())
        record = next((r for r in records if r.get("employeeId") == employee_id and r.get("date") == today), None)

        # Night shifts: the person checked in yesterday and is checking out after midnight.
        if not record or not record.get("checkInTime") or record.get("checkOutTime"):
            open_from_yesterday = next(
                (
                    r for r in records
                    if r.get("employeeId") == employee_id
                    and r.get("date") == yesterday
                    and r.get("isNightShift") is True
                    and r.get("checkInTime")
                    and not r.get("checkOutTime")
                ),
                None,
            )
            if open_from_yesterday:
                record = open_from_yesterday

        if not record:
            record = self.check_in(employee_id)
            record["checkInTime"] = "09:00"

        record["checkOutTime"] = now_time
        if location:
            record["checkOutLocation"] = location

        if geo and is_valid_fix(geo):
            emp = self.employees.get(record.get("employeeId"))
            d = distance_from_office(geo, emp.get("location") if emp else None)
            record["checkOutDistanceKm"] = d["km"]
            if record.get("workMode") == "WORK_FROM_OFFICE" and is_within_office(d["km"]):
                record["workMode"] = "WORK_FROM_OFFICE"
            else:
                record["workMode"] = "WORK_FROM_HOME"

        self.apply_shift_hours(record)
        return record

    def regularize_attendance(self, rec_id: str, updates: dict, regularized_by: str) -> Optional[dict]:
        record = self.attendanceRecords.get(rec_id)
        if not record:
            return None
        for k, v in updates.items():
            set_or_drop(record, k, v)
        record["isRegularized"] = True
        record["regularizedBy"] = regularized_by
        # Recalculate hours and shift credit if checkIn / checkOut provided
        self.apply_shift_hours(record)
        return record

    # ----------------------------------------------------------------- shifts

    def get_shifts(self) -> list:
        return list(self.shifts.values())

    def create_shift(self, shift: dict) -> dict:
        shift_id = f"shift_{now_ms()}"
        new_shift = merge({}, shift)
        new_shift["status"] = shift.get("status") or "ACTIVE"
        # A shift that ends before it starts crosses midnight, so it is a night shift.
        new_shift["isNightShift"] = bool(shift.get("isNightShift")) or (shift.get("endTime") or "") < (shift.get("startTime") or "")
        new_shift["_id"] = shift_id
        new_shift["createdAt"] = now_iso()
        self.shifts[shift_id] = new_shift
        return new_shift

    def update_shift(self, shift_id: str, updates: dict) -> Optional[dict]:
        shift = self.shifts.get(shift_id)
        if not shift:
            return None
        updated = merge(shift, updates)
        if (updated.get("endTime") or "") < (updated.get("startTime") or ""):
            updated["isNightShift"] = True
        self.shifts[shift_id] = updated
        return updated

    def end_shift(self, shift_id: str, reason: Optional[str] = None, ended_by: Optional[str] = None) -> Optional[dict]:
        shift = self.shifts.get(shift_id)
        if not shift:
            return None
        updated = {
            **shift,
            "status": "ENDED",
            "isActive": False,
            "endedAt": now_iso(),
            "endedBy": ended_by or "System Admin",
            "endReason": reason or "Shift schedule ended",
        }
        self.shifts[shift_id] = updated

        self.log_audit({
            "userId": "usr_admin",
            "userEmail": ended_by or "admin@zenith.com",
            "role": "ADMIN",
            "action": "END_SHIFT",
            "module": "WORKSHIFTS",
            "entity": "Shift",
            "entityId": shift["_id"],
            "details": {"shiftName": shift.get("name"), "code": shift.get("code"), "reason": reason or "N/A"},
        })
        return updated

    def delete_shift(self, shift_id: str) -> bool:
        if shift_id not in self.shifts:
            return False
        # Instead of deleting, mark as ENDED to preserve history
        self.end_shift(shift_id, "Shift marked as ended/deleted by administrator", "Admin")
        return True


db_store = DbStore()
