"""
Attendance workflow on top of daily check-in / check-out:

- Settings (grace, late-mark deduction, geofence policy, overtime rate, comp-off expiry).
- Shift for a date (fixed or rotational), late-coming / early-going marks.
- Requests: regularization (missed punch), overtime and comp-off. They go to the reporting
  manager (a manager's own request goes to *their* manager; nobody approves their own) and
  only change attendance once approved.
- HR bulk upload (row-wise errors), biometric / device punches (de-duplicated), month lock with
  a second-person unlock, and month finalisation that feeds paid days / LOP to payroll.
Finance / Accounts / Auditors have read-only access to attendance.
"""

import csv
import hashlib
import io
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.employee_access import MASTER_WRITE_ROLES
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body, read_fields_and_files
from app.routes.leave import credit_compoff, holidays_for
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.workflow import (
    actor_name, add_payroll_input, cancel_payroll_inputs, employee_name, is_in_team, manager_of, my_employee_id,
    notify_employee, notify_roles,
)

router = APIRouter()

ATT_ADMIN_ROLES = MASTER_WRITE_ROLES + ("ADMIN_2",)          # HR + admins manage attendance
DEVICE_ROLES = ("ADMIN", "SUPER_ADMIN", "ADMIN_1", "ADMIN_2")  # device configuration
ATT_READ_ALL = ATT_ADMIN_ROLES + ("AUDITORS",)
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
PRESENT_STATUSES = ("PRESENT", "LATE", "WORK_FROM_HOME", "HALF_DAY")


# ------------------------------------------------------------------ settings

def settings() -> dict:
    if "settings" not in modules_store.attendanceSettings:
        modules_store.attendanceSettings["settings"] = {
            "_id": "settings",
            "lateMarksPerHalfDay": 3,       # every 3 late marks in a month = 0.5 day LOP
            "outsideGeofence": "FLAG",      # FLAG (accept, marked) or BLOCK
            "otMultiplier": 2.0,            # overtime paid at 2x the hourly rate
            "compOffExpiryDays": 60,
            "halfDayMinHours": 4,
            "fullDayMinHours": 8,
        }
    return modules_store.attendanceSettings["settings"]


@router.get("/attendance/settings")
async def get_settings(_: dict = Depends(require_auth)):
    return {"settings": settings()}


@router.put("/attendance/settings")
async def save_settings(request: Request, user: dict = Depends(require_role(*ATT_ADMIN_ROLES))):
    b = await read_body(request)
    s = settings()
    old = dict(s)
    for key, cast, lo, hi in (("lateMarksPerHalfDay", int, 1, 31), ("otMultiplier", float, 1, 4), ("compOffExpiryDays", int, 1, 365),
                              ("halfDayMinHours", float, 1, 12), ("fullDayMinHours", float, 1, 16)):
        if key in b:
            try:
                v = cast(b[key])
            except (TypeError, ValueError):
                raise ApiError(400, f"{key} must be a number.")
            if not lo <= v <= hi:
                raise ApiError(400, f"{key} must be between {lo} and {hi}.")
            s[key] = v
    if "outsideGeofence" in b:
        if b["outsideGeofence"] not in ("FLAG", "BLOCK"):
            raise ApiError(400, "outsideGeofence must be FLAG or BLOCK.")
        s["outsideGeofence"] = b["outsideGeofence"]
    audit(user, "ATTENDANCE_SETTINGS_UPDATED", "ATTENDANCE", "AttendanceSettings", "settings",
          {"changes": [{"field": k, "oldValue": old.get(k), "newValue": s.get(k)} for k in s if old.get(k) != s.get(k)]})
    return {"settings": s}


# ------------------------------------------------------------------ shifts for a date

def _minutes(hhmm: Optional[str]) -> Optional[int]:
    if not hhmm or not _TIME.match(hhmm):
        return None
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def shift_for(emp: dict, on: str) -> Optional[dict]:
    """The shift an employee works on a date. Rotational shifts cycle through their member
    shifts every `rotateEveryDays` days from `rotationStart`."""
    shift = db_store.resolve_shift(emp.get("shift"))
    if shift and shift.get("type") == "ROTATIONAL" and shift.get("rotationShiftIds"):
        try:
            start = date.fromisoformat(shift.get("rotationStart") or "2026-01-05")
            idx = ((date.fromisoformat(on) - start).days // max(1, int(shift.get("rotateEveryDays") or 7))) % len(shift["rotationShiftIds"])
            return db_store.shifts.get(shift["rotationShiftIds"][idx]) or shift
        except ValueError:
            return shift
    return shift


def mark_timing(record: dict, emp: dict) -> None:
    """Late coming (after start + grace) and early going (before end), using the day's shift."""
    shift = shift_for(emp, record["date"])
    if not shift:
        return
    start, end = _minutes(shift.get("startTime")), _minutes(shift.get("endTime"))
    grace = int(shift.get("gracePeriodMinutes") or 0)
    cin, cout = _minutes(record.get("checkInTime")), _minutes(record.get("checkOutTime"))
    record["shiftName"] = shift.get("name")
    if start is not None and cin is not None:
        late = cin - start
        if shift.get("isNightShift") and late < -12 * 60:
            late += 24 * 60
        record["lateMinutes"] = max(0, late)
        record["isLate"] = late > grace
        if record["isLate"] and record.get("status") in ("PRESENT", None):
            record["status"] = "LATE"
    if end is not None and cout is not None:
        early = end - cout
        if shift.get("isNightShift") and early > 12 * 60:
            early -= 24 * 60
        record["earlyMinutes"] = max(0, early)
        record["isEarlyOut"] = early > 0
    hours = record.get("effectiveWorkingHours") or 0
    if cout is not None and hours and hours < settings()["halfDayMinHours"] - 1e-9:
        record["status"] = "HALF_DAY"


# ------------------------------------------------------------------ locks

def is_locked(month: str) -> bool:
    return bool((modules_store.attendanceLocks.get(month) or {}).get("locked"))


def require_unlocked(day: str) -> None:
    if is_locked(day[:7]):
        raise ApiError(423, f"Attendance for {day[:7]} is locked after payroll cut-off. HR must get it unlocked (with approval) first.")


@router.get("/attendance/locks")
async def list_locks(_: dict = Depends(require_auth)):
    return {"locks": sorted(modules_store.attendanceLocks.values(), key=lambda x: x["_id"], reverse=True)}


@router.post("/attendance/lock")
async def lock_month(request: Request, user: dict = Depends(require_role(*ATT_ADMIN_ROLES))):
    month = js_str((await read_body(request)).get("month") or "")[:7]
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise ApiError(400, "Month must be YYYY-MM.")
    if is_locked(month):
        raise ApiError(400, f"{month} is already locked.")
    lock = modules_store.attendanceLocks.setdefault(month, {"_id": month, "history": []})
    lock.update({"locked": True, "lockedBy": actor_name(user), "lockedAt": now_iso(), "unlockRequest": None})
    lock["history"].append({"action": "LOCKED", "by": actor_name(user), "at": now_iso()})
    audit(user, "ATTENDANCE_MONTH_LOCKED", "ATTENDANCE", "AttendanceMonth", month, {"month": month})
    return {"lock": lock}


@router.post("/attendance/unlock-request")
async def request_unlock(request: Request, user: dict = Depends(require_role(*ATT_ADMIN_ROLES))):
    b = await read_body(request)
    month = js_str(b.get("month") or "")[:7]
    reason = js_str(b.get("reason") or "").strip()
    if not is_locked(month):
        raise ApiError(400, f"{month} is not locked.")
    if not reason:
        raise ApiError(400, "Give the reason for unlocking.")
    lock = modules_store.attendanceLocks[month]
    lock["unlockRequest"] = {"reason": reason, "by": actor_name(user), "byUserId": user["_id"], "at": now_iso()}
    lock["history"].append({"action": "UNLOCK_REQUESTED", "by": actor_name(user), "at": now_iso(), "reason": reason})
    notify_roles(("SUPER_ADMIN", "HR", "ADMIN"), "Attendance unlock needs approval", f"{actor_name(user)} asked to unlock {month}: {reason}",
                 "ATTENDANCE", exclude_user_id=user["_id"])
    audit(user, "ATTENDANCE_UNLOCK_REQUESTED", "ATTENDANCE", "AttendanceMonth", month, {"reason": reason})
    return {"lock": lock}


@router.post("/attendance/unlock/{month}/approve")
async def approve_unlock(month: str, user: dict = Depends(require_role("SUPER_ADMIN", "ADMIN", "HR", "ADMIN_1"))):
    lock = modules_store.attendanceLocks.get(month)
    req = (lock or {}).get("unlockRequest")
    if not req:
        raise ApiError(400, "There is no unlock request for this month.")
    if req["byUserId"] == user["_id"]:
        raise ApiError(403, "Maker-checker: someone other than the requester must approve the unlock.")
    lock.update({"locked": False, "unlockedBy": actor_name(user), "unlockedAt": now_iso(), "unlockRequest": None})
    lock["history"].append({"action": "UNLOCKED", "by": actor_name(user), "at": now_iso(), "requestedBy": req["by"], "reason": req["reason"]})
    audit(user, "ATTENDANCE_MONTH_UNLOCKED", "ATTENDANCE", "AttendanceMonth", month, {"requestedBy": req["by"], "reason": req["reason"]})
    return {"lock": lock}


# ------------------------------------------------------------------ requests (regularization / OT / comp-off)

def _approver(emp_id: str) -> Optional[str]:
    return manager_of(emp_id)


def _can_decide(user: dict, req: dict) -> bool:
    """The reporting manager (or HR), never the person who raised it."""
    me = my_employee_id(user)
    if not me or me == req["employeeId"]:
        return False
    return me == req.get("approverId") or user.get("role") in MASTER_WRITE_ROLES


def _req_view(req: dict, user: dict) -> dict:
    return {**req, "approverName": employee_name(req.get("approverId")) or "HR", "canDecide": req["status"] == "PENDING" and _can_decide(user, req)}


def _record_for(emp_id: str, day: str) -> Optional[dict]:
    return next((r for r in db_store.attendanceRecords.values() if r.get("employeeId") == emp_id and r.get("date") == day), None)


def _hourly_rate(emp: dict) -> float:
    from app.utils.salary_structure import compute_salary_structure
    ctc = emp.get("annualSalary") or 0
    if not ctc:
        return 0.0
    gross = compute_salary_structure(ctc)["netPay"]["monthlyGross"]
    return gross / 26 / 8


def _is_off_day(emp: dict, day: str) -> bool:
    from app.routes.leave import _settings as leave_settings
    d = date.fromisoformat(day)
    return d.weekday() in (leave_settings().get("weekendDays") or [5, 6]) or day in holidays_for(emp)


@router.post("/attendance/requests")
async def raise_request(request: Request, user: dict = Depends(require_auth)):
    b = await read_body(request)
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    emp = db_store.employees[me]
    kind = b.get("kind")
    day = js_str(b.get("date") or "")[:10]
    reason = js_str(b.get("reason") or "").strip()
    try:
        d = date.fromisoformat(day)
    except ValueError:
        raise ApiError(400, "Date must be YYYY-MM-DD.")
    if d > date.today():
        raise ApiError(400, "You cannot raise this for a future date.")
    if not reason:
        raise ApiError(400, "Give a reason.")
    require_unlocked(day)
    if any(r for r in modules_store.attendanceRequests.values()
           if r["employeeId"] == me and r["date"] == day and r["kind"] == kind and r["status"] == "PENDING"):
        raise ApiError(409, "You already have a pending request of this kind for that date.")

    rec = _record_for(me, day)
    data: dict = {}
    if kind == "REGULARIZATION":
        cin, cout = b.get("checkInTime"), b.get("checkOutTime")
        if not (_TIME.match(cin or "") and _TIME.match(cout or "")):
            raise ApiError(400, "Give the correct check-in and check-out times (HH:MM).")
        data = {"checkInTime": cin, "checkOutTime": cout, "previous": {k: (rec or {}).get(k) for k in ("checkInTime", "checkOutTime", "status")}}
    elif kind == "OVERTIME":
        try:
            hours = float(b.get("hours"))
        except (TypeError, ValueError):
            raise ApiError(400, "Overtime hours must be a number.")
        if not rec or not rec.get("checkOutTime"):
            raise ApiError(400, "There is no completed attendance on that date to claim overtime against.")
        worked = (rec.get("totalMinutesWorked") or 0) / 60
        shift = shift_for(emp, day) or {}
        expected = float(shift.get("expectedHours") or 8) + (shift.get("breakMinutes") or 60) / 60
        max_ot = max(0.0, round(worked - expected, 2)) if not _is_off_day(emp, day) else round(worked, 2)
        if hours <= 0 or hours > max_ot + 0.01:
            raise ApiError(400, f"You can claim at most {max_ot:g} overtime hour(s) for {day} based on your punches.")
        data = {"hours": round(hours, 2)}
    elif kind == "COMP_OFF":
        if not _is_off_day(emp, day):
            raise ApiError(400, "Comp-off can only be claimed for work on a weekly off or holiday.")
        if not rec or (rec.get("effectiveWorkingHours") or 0) < settings()["halfDayMinHours"]:
            raise ApiError(400, f"You need at least {settings()['halfDayMinHours']:g} worked hours on {day} to claim comp-off.")
        days = 1.0 if (rec.get("effectiveWorkingHours") or 0) >= settings()["fullDayMinHours"] - 1 else 0.5
        data = {"days": days}
    else:
        raise ApiError(400, "kind must be REGULARIZATION, OVERTIME or COMP_OFF.")

    rid = f"attreq_{now_ms()}_{rand_base36(4)}"
    req = {"_id": rid, "kind": kind, "employeeId": me, "employeeName": employee_name(me), "employeeCode": emp.get("employeeCode"),
           "date": day, "reason": reason, **data, "status": "PENDING", "approverId": _approver(me), "raisedAt": now_iso()}
    modules_store.attendanceRequests[rid] = req
    label = {"REGULARIZATION": "Attendance regularization", "OVERTIME": "Overtime", "COMP_OFF": "Comp-off"}[kind]
    if req["approverId"]:
        notify_employee(req["approverId"], f"{label} to approve", f"{req['employeeName']} raised {label.lower()} for {day}.", "ATTENDANCE")
    else:
        notify_roles(("HR",), f"{label} to approve", f"{req['employeeName']} raised {label.lower()} for {day}.", "ATTENDANCE", exclude_user_id=user["_id"])
    audit(user, f"ATTENDANCE_{kind}_RAISED", "ATTENDANCE", "AttendanceRequest", rid, {"date": day, **{k: v for k, v in data.items() if k != "previous"}})
    return {"request": _req_view(req, user)}


@router.get("/attendance/requests")
async def list_requests(scope: str = "mine", status: Optional[str] = None, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    items = list(modules_store.attendanceRequests.values())
    if scope == "approvals":
        items = [r for r in items if r["status"] == "PENDING" and _can_decide(user, r)]
    elif scope == "all":
        if user.get("role") not in ATT_READ_ALL:
            raise ApiError(403, "Only HR can see everyone's attendance requests.")
    elif scope == "team":
        items = [r for r in items if is_in_team(me, r["employeeId"])]
    else:
        items = [r for r in items if r["employeeId"] == me]
    if status and status != "ALL":
        items = [r for r in items if r["status"] == status]
    items.sort(key=lambda r: r["raisedAt"], reverse=True)
    return {"requests": [_req_view(r, user) for r in items]}


@router.post("/attendance/requests/{req_id}/decide")
async def decide_request(req_id: str, request: Request, user: dict = Depends(require_auth)):
    req = modules_store.attendanceRequests.get(req_id)
    if not req:
        raise ApiError(404, "Request not found.")
    if req["status"] != "PENDING":
        raise ApiError(400, f"This request is already {req['status'].lower()}.")
    if req["employeeId"] == my_employee_id(user):
        raise ApiError(403, "You cannot approve your own request. It goes to your manager.")
    if not _can_decide(user, req):
        raise ApiError(403, "Access denied: you are not the approver for this request.")
    b = await read_body(request)
    decision = b.get("decision")
    comment = js_str(b.get("comment") or "").strip()
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Give a reason for rejecting.")
    require_unlocked(req["date"])
    emp = db_store.employees.get(req["employeeId"]) or {}
    changes = []
    if decision == "APPROVED":
        if req["kind"] == "REGULARIZATION":
            rec = _record_for(req["employeeId"], req["date"])
            if not rec:
                rid = f"att_{now_ms()}_{rand_base36(5)}"
                rec = {"_id": rid, "employeeId": req["employeeId"], "employeeName": req["employeeName"], "employeeCode": req.get("employeeCode"),
                       "department": emp.get("department"), "date": req["date"], "shiftName": emp.get("shift"), "breakMinutes": 60}
                db_store.attendanceRecords[rid] = rec
            before = {k: rec.get(k) for k in ("checkInTime", "checkOutTime", "status")}
            rec.update({"checkInTime": req["checkInTime"], "checkOutTime": req["checkOutTime"], "status": "PRESENT",
                        "isRegularized": True, "regularizedBy": actor_name(user), "regularizationReason": req["reason"]})
            db_store.apply_shift_hours(rec)
            mark_timing(rec, emp)
            changes = [{"field": k, "oldValue": v, "newValue": rec.get(k)} for k, v in before.items() if v != rec.get(k)]
        elif req["kind"] == "OVERTIME":
            amount = round(req["hours"] * _hourly_rate(emp) * float(settings()["otMultiplier"]), 2)
            req["amount"] = amount
            add_payroll_input(req["employeeId"], req["date"][:7], "OVERTIME", amount=amount, days=0, source="ATTENDANCE",
                              source_id=req_id, label=f"Overtime {req['hours']:g}h on {req['date']}", by=user)
        elif req["kind"] == "COMP_OFF":
            expires = (date.fromisoformat(req["date"]) + timedelta(days=int(settings()["compOffExpiryDays"]))).isoformat()
            req["expiresOn"] = expires
            credit_compoff(req["employeeId"], req["days"], expires, req_id)
    req.update({"status": decision, "decidedBy": actor_name(user), "decidedAt": now_iso(), "comment": comment or None})
    notify_employee(req["employeeId"], f"{req['kind'].replace('_', ' ').title()} {decision.lower()}",
                    f"Your request for {req['date']} was {decision.lower()} by {actor_name(user)}" + (f": {comment}" if comment else "."), "ATTENDANCE")
    audit(user, f"ATTENDANCE_{req['kind']}_{decision}", "ATTENDANCE", "AttendanceRequest", req_id,
          {"employeeCode": req.get("employeeCode"), "date": req["date"], "comment": comment, "changes": changes})
    return {"request": _req_view(req, user)}


# ------------------------------------------------------------------ bulk upload

@router.post("/attendance/bulk-upload")
async def bulk_upload(request: Request, user: dict = Depends(require_role(*MASTER_WRITE_ROLES))):
    """CSV: employeeCode,date,checkInTime,checkOutTime[,status]. Valid rows are saved, bad rows reported."""
    _, files = await read_fields_and_files(request)
    upload = (files.get("file") or [None])[0]
    if not upload or not (upload.filename or "").lower().endswith(".csv"):
        raise ApiError(400, "Upload a .csv file.")
    text = (await upload.read()).decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader([ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]))
    if not rows:
        raise ApiError(400, "The file has no rows.")
    by_code = {(e.get("employeeCode") or "").upper(): e for e in db_store.employees.values()}
    results, saved = [], 0
    for i, row in enumerate(rows, start=2):
        row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
        errors = []
        emp = by_code.get(row.get("employeeCode", "").upper())
        if not emp:
            errors.append(f"Unknown employee code '{row.get('employeeCode')}'.")
        day = row.get("date", "")
        try:
            if date.fromisoformat(day) > date.today():
                errors.append("Date is in the future.")
        except ValueError:
            errors.append("Date must be YYYY-MM-DD.")
        cin, cout = row.get("checkInTime", ""), row.get("checkOutTime", "")
        status = (row.get("status") or "").upper()
        if status not in ("", "PRESENT", "ABSENT", "HALF_DAY", "WORK_FROM_HOME"):
            errors.append("Status must be PRESENT, ABSENT, HALF_DAY or WORK_FROM_HOME.")
        if status != "ABSENT" and not (_TIME.match(cin) and _TIME.match(cout)):
            errors.append("Check-in and check-out must be HH:MM.")
        if not errors and is_locked(day[:7]):
            errors.append(f"{day[:7]} is locked.")
        if errors:
            results.append({"row": i, "employeeCode": row.get("employeeCode"), "date": day, "status": "FAILED", "errors": errors})
            continue
        rec = _record_for(emp["_id"], day)
        if not rec:
            rid = f"att_{now_ms()}_{rand_base36(5)}"
            rec = {"_id": rid, "employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "employeeCode": emp.get("employeeCode"),
                   "department": emp.get("department"), "date": day, "shiftName": emp.get("shift"), "breakMinutes": 60}
            db_store.attendanceRecords[rid] = rec
        rec.update({"checkInTime": cin or None, "checkOutTime": cout or None, "status": status or "PRESENT", "source": "BULK_UPLOAD",
                    "uploadedBy": actor_name(user)})
        if cin and cout:
            db_store.apply_shift_hours(rec)
            mark_timing(rec, emp)
        saved += 1
        results.append({"row": i, "employeeCode": emp.get("employeeCode"), "date": day, "status": "SAVED"})
    audit(user, "ATTENDANCE_BULK_UPLOADED", "ATTENDANCE", "AttendanceUpload", f"upload_{now_ms()}",
          {"rows": len(rows), "saved": saved, "failed": len(rows) - saved, "fileName": upload.filename})
    return {"summary": {"rows": len(rows), "saved": saved, "failed": len(rows) - saved}, "results": results}


# ------------------------------------------------------------------ biometric / devices

def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


@router.get("/attendance/devices")
async def list_devices(_: dict = Depends(require_role(*DEVICE_ROLES, "HR", "AUDITORS"))):
    return {"devices": [{k: v for k, v in d.items() if k != "keyHash"} for d in modules_store.attendanceDevices.values()]}


@router.post("/attendance/devices")
async def add_device(request: Request, user: dict = Depends(require_role(*DEVICE_ROLES))):
    b = await read_body(request)
    name = js_str(b.get("name") or "").strip()
    if not name:
        raise ApiError(400, "Device name is required.")
    key = secrets.token_hex(16)
    did = f"dev_{now_ms()}_{rand_base36(4)}"
    dev = {"_id": did, "name": name, "location": js_str(b.get("location") or "").strip(), "syncIntervalMinutes": int(b.get("syncIntervalMinutes") or 5),
           "keyHash": _hash(key), "createdBy": actor_name(user), "createdAt": now_iso(), "lastSyncAt": None, "punchCount": 0}
    modules_store.attendanceDevices[did] = dev
    audit(user, "ATTENDANCE_DEVICE_ADDED", "ATTENDANCE", "Device", did, {"name": name, "location": dev["location"]})
    # The key is shown only once; the server keeps a hash
    return {"device": {k: v for k, v in dev.items() if k != "keyHash"}, "deviceKey": key}


def _ingest_punches(punches: list, source: str, device: Optional[dict]) -> dict:
    """Group punches per employee and day: first = check-in, last = check-out. Punches within a
    minute of one already stored are duplicates and ignored."""
    by_code = {(e.get("employeeCode") or "").upper(): e for e in db_store.employees.values()}
    accepted = duplicates = 0
    errors = []
    for i, p in enumerate(punches, start=1):
        emp = by_code.get(js_str(p.get("employeeCode") or "").upper())
        try:
            ts = datetime.fromisoformat(js_str(p.get("timestamp") or "").replace("Z", ""))
        except ValueError:
            ts = None
        if not emp or not ts:
            errors.append({"index": i, "error": "Unknown employee code or bad timestamp."})
            continue
        day, hhmm = ts.date().isoformat(), ts.strftime("%H:%M")
        next_day = False
        # Night shift crossing midnight: an early-morning punch closes the previous day's shift.
        prev_day = (ts.date() - timedelta(days=1)).isoformat()
        prev_shift = shift_for(emp, prev_day) or {}
        ps, pe = _minutes(prev_shift.get("startTime")), _minutes(prev_shift.get("endTime"))
        prev_rec = _record_for(emp["_id"], prev_day)
        if (prev_shift.get("isNightShift") or (ps is not None and pe is not None and pe < ps)) and pe is not None \
                and _minutes(hhmm) <= pe + 4 * 60 and prev_rec and prev_rec.get("checkInTime"):
            day, next_day = prev_day, True
        if is_locked(day[:7]):
            errors.append({"index": i, "error": f"{day[:7]} is locked."})
            continue
        rec = _record_for(emp["_id"], day)
        if not rec:
            rid = f"att_{now_ms()}_{rand_base36(5)}"
            rec = {"_id": rid, "employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "employeeCode": emp.get("employeeCode"),
                   "department": emp.get("department"), "date": day, "shiftName": emp.get("shift"), "breakMinutes": 60, "status": "PRESENT",
                   "punches": []}
            db_store.attendanceRecords[rid] = rec
        punches_today = rec.setdefault("punches", [])
        abs_min = lambda x: _minutes(x["time"]) + (24 * 60 if x.get("nextDay") else 0)
        this = {"time": hhmm, "source": source, "deviceId": (device or {}).get("_id"), **({"nextDay": True} if next_day else {})}
        if any(abs(abs_min(x) - abs_min(this)) <= 1 for x in punches_today):
            duplicates += 1
            continue
        punches_today.append(this)
        ordered = sorted(punches_today, key=abs_min)
        rec["checkInTime"] = ordered[0]["time"]
        rec["checkOutTime"] = ordered[-1]["time"] if len(ordered) > 1 else None
        if next_day:
            rec["shiftName"] = prev_shift.get("name") or rec.get("shiftName")
        rec["source"] = source
        if rec["checkOutTime"]:
            db_store.apply_shift_hours(rec)
        mark_timing(rec, emp)
        accepted += 1
    if device:
        device["lastSyncAt"] = now_iso()
        device["punchCount"] = (device.get("punchCount") or 0) + accepted
    return {"accepted": accepted, "duplicates": duplicates, "errors": errors}


@router.post("/attendance/device-punches")
async def device_punches(request: Request):
    """Called by a biometric device / its sync service with header X-Device-Key."""
    key = request.headers.get("x-device-key") or ""
    device = next((d for d in modules_store.attendanceDevices.values() if key and d["keyHash"] == _hash(key)), None)
    if not device:
        raise ApiError(401, "Unknown device key.")
    b = await read_body(request)
    return _ingest_punches(b.get("punches") or [], "BIOMETRIC", device)


@router.post("/attendance/device-punches/upload")
async def upload_punch_file(request: Request, user: dict = Depends(require_role(*DEVICE_ROLES, "HR"))):
    """Manual import of a device export (CSV: employeeCode,timestamp)."""
    _, files = await read_fields_and_files(request)
    upload = (files.get("file") or [None])[0]
    if not upload:
        raise ApiError(400, "Upload the device export (.csv).")
    rows = list(csv.DictReader(io.StringIO((await upload.read()).decode("utf-8-sig", errors="replace"))))
    result = _ingest_punches(rows, "BIOMETRIC_FILE", None)
    audit(user, "ATTENDANCE_PUNCHES_IMPORTED", "ATTENDANCE", "DevicePunches", f"import_{now_ms()}", {k: v for k, v in result.items() if k != "errors"})
    return result


# ------------------------------------------------------------------ month summary / finalise

def _month_days(month: str) -> list:
    y, m = (int(x) for x in month.split("-"))
    d = date(y, m, 1)
    out = []
    while d.month == m:
        out.append(d)
        d += timedelta(days=1)
    return out


def summarise(emp: dict, month: str) -> dict:
    from app.routes.leave import _settings as leave_settings
    weekend = set(leave_settings().get("weekendDays") or [5, 6])
    hols = holidays_for(emp)
    joined = (emp.get("joiningDate") or "0000")[:10]
    exited = (emp.get("exitedOn") or "9999")[:10]
    last_day = min(date.today().isoformat(), exited)
    recs = {r["date"]: r for r in db_store.attendanceRecords.values() if r.get("employeeId") == emp["_id"] and (r.get("date") or "").startswith(month)}
    leave_days = {}
    for lr in modules_store.leaveRequests.values():
        if lr.get("employeeId") != emp["_id"] or lr.get("status") != "APPROVED":
            continue
        for d in _month_days(month):
            if lr["startDate"] <= d.isoformat() <= lr["endDate"]:
                leave_days[d.isoformat()] = 0.5 if lr.get("isHalfDay") else 1
    working = present = absent = half = on_leave = 0.0
    late = 0
    for d in _month_days(month):
        day = d.isoformat()
        if day < joined or day > last_day or d.weekday() in weekend or day in hols:
            continue
        working += 1
        rec = recs.get(day)
        if day in leave_days:
            on_leave += leave_days[day]
            if leave_days[day] == 0.5 and rec and rec.get("status") in PRESENT_STATUSES:
                present += 0.5
            continue
        if rec and rec.get("status") in PRESENT_STATUSES:
            if rec.get("status") == "HALF_DAY":
                present += 0.5
                half += 0.5
            else:
                present += 1
            late += 1 if rec.get("isLate") or rec.get("status") == "LATE" else 0
        else:
            absent += 1
    per_half = int(settings()["lateMarksPerHalfDay"])
    late_deduction = (late // per_half) * 0.5
    ot_hours = sum(r.get("hours") or 0 for r in modules_store.attendanceRequests.values()
                   if r["employeeId"] == emp["_id"] and r["kind"] == "OVERTIME" and r["status"] == "APPROVED" and r["date"].startswith(month))
    return {"employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "employeeCode": emp.get("employeeCode"),
            "department": emp.get("department"), "month": month, "workingDays": working, "presentDays": present,
            "leaveDays": on_leave, "halfDays": half, "absentDays": absent, "lateMarks": late, "lateDeductionDays": late_deduction,
            "lopDays": absent + half + late_deduction, "approvedOvertimeHours": round(ot_hours, 2)}


@router.get("/attendance/summary")
async def month_summary(month: str, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if user.get("role") in ATT_READ_ALL + ("FINANCE", "ACCOUNTS"):
        people = [e for e in db_store.employees.values() if e.get("status") not in ("TERMINATED", "INACTIVE")]
    else:
        people = [e for e in db_store.employees.values() if e["_id"] == me or is_in_team(me, e["_id"])]
    final = modules_store.attendanceSummaries.get(month)
    rows = [((final or {}).get("rows") or {}).get(e["_id"]) or summarise(e, month) for e in people]
    return {"month": month, "finalised": bool(final), "finalisedBy": (final or {}).get("by"), "locked": is_locked(month), "rows": rows}


@router.post("/attendance/finalize")
async def finalize_month(request: Request, user: dict = Depends(require_role(*MASTER_WRITE_ROLES))):
    """Freeze the month's attendance summary and send LOP days to payroll (overtime goes on approval)."""
    b = await read_body(request)
    month = js_str(b.get("month") or "")[:7]
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise ApiError(400, "Month must be YYYY-MM.")
    if month > today_str()[:7]:
        raise ApiError(400, "You cannot finalise a future month.")
    if is_locked(month):
        raise ApiError(423, f"{month} is locked; unlock it to re-finalise.")
    rows = {e["_id"]: summarise(e, month) for e in db_store.employees.values() if e.get("status") not in ("TERMINATED", "INACTIVE")}
    if b.get("dryRun"):
        return {"dryRun": True, "rows": list(rows.values())}
    for emp_id, row in rows.items():
        cancel_payroll_inputs(f"attendance:{month}:{emp_id}")
        if row["lopDays"]:
            add_payroll_input(emp_id, month, "LOP_DAYS", days=row["lopDays"], source="ATTENDANCE", source_id=f"attendance:{month}:{emp_id}",
                              label=f"Attendance LOP {month} (absent {row['absentDays']:g}, half days {row['halfDays']:g}, late {row['lateDeductionDays']:g})",
                              by=user)
    modules_store.attendanceSummaries[month] = {"_id": month, "rows": rows, "by": actor_name(user), "at": now_iso()}
    audit(user, "ATTENDANCE_MONTH_FINALISED", "ATTENDANCE", "AttendanceMonth", month,
          {"employees": len(rows), "lopDays": sum(r["lopDays"] for r in rows.values())})
    return {"dryRun": False, "rows": list(rows.values())}
