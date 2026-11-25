"""
Leave management: leave types and rules, balances, apply / approve / cancel, delegation and
SLA escalation, team calendar, HR adjustments, year-end processing and the link to payroll.

Approval routing
- A request goes to the employee's reporting manager (a manager's own leave goes to *their*
  manager, so nobody approves their own leave). No manager on record -> HR.
- An active delegate of the approver may act for them.
- A request still pending after the SLA (leaveSettings.slaDays) also becomes visible to the
  approver's own manager (escalation).
- HR may act on anyone's request except their own.
Balances: `used` counts approved paid days, `pending` counts days waiting for approval.
Days beyond the balance are blocked, or become LOP when the type allows it.
"""

import calendar
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.employee_access import MASTER_WRITE_ROLES
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.workflow import (
    actor_name, add_payroll_input, cancel_payroll_inputs, employee_name, is_in_team, manager_of,
    my_employee_id, notify_employee, notify_roles,
)

router = APIRouter()

HR_ROLES = MASTER_WRITE_ROLES  # ADMIN, SUPER_ADMIN, ADMIN_1, HR
LEAVE_READ_ALL = HR_ROLES + ("ADMIN_2", "AUDITORS")
GENDERS = ("ANY", "FEMALE", "MALE")
EMPLOYMENT_TYPES = ("FULL_TIME", "PART_TIME", "CONTRACT", "INTERN")
OPEN = ("PENDING", "APPROVED")

DEFAULT_TYPES = [
    # code, name, balanceKey, entitlement, carryMax, encashable, encashMax, halfDay, backdatedDays, gender, minService, sandwich, excess, paid
    ("CL", "Casual Leave", "casual", 12, 0, False, 0, True, 3, "ANY", 0, False, "BLOCK", True),
    ("SL", "Sick Leave", "sick", 10, 5, False, 0, True, 15, "ANY", 0, False, "BLOCK", True),
    ("EL", "Earned / Privilege Leave", "earned", 15, 30, True, 15, False, 7, "ANY", 90, True, "BLOCK", True),
    ("ML", "Maternity Leave", "maternity", 182, 0, False, 0, False, 30, "FEMALE", 80, True, "BLOCK", True),
    ("PTL", "Paternity Leave", "paternity", 15, 0, False, 0, False, 15, "MALE", 0, False, "BLOCK", True),
    ("LOP", "Loss of Pay", "unpaid", 0, 0, False, 0, True, 30, "ANY", 0, False, "ALLOW", False),
    # Credited from attendance (work on a weekly off / holiday), each credit expires
    ("CO", "Compensatory Off", "compoff", 0, 0, False, 0, True, 30, "ANY", 0, False, "BLOCK", True),
]
COMPOFF_KEY = "compoff"


# ------------------------------------------------------------------ setup

def ensure_defaults() -> None:
    for code, name, key, ent, carry, encash, encash_max, half, back, gender, service, sandwich, excess, paid in DEFAULT_TYPES:
        if f"lt_{code}" not in modules_store.leaveTypes:  # add any default type that is missing
            modules_store.leaveTypes[f"lt_{code}"] = {
                "_id": f"lt_{code}", "code": code, "name": name, "balanceKey": key, "annualEntitlement": ent,
                "carryForwardMax": carry, "encashable": encash, "encashMax": encash_max, "allowHalfDay": half,
                "maxBackdatedDays": back, "gender": gender, "minServiceDays": service, "employmentTypes": list(EMPLOYMENT_TYPES),
                "sandwich": sandwich, "excessPolicy": excess, "paid": paid, "active": True,
            }
    if "settings" not in modules_store.leaveSettings:
        modules_store.leaveSettings["settings"] = {"_id": "settings", "slaDays": 3, "weekendDays": [5, 6], "lastYearEnd": None}


def _settings() -> dict:
    ensure_defaults()
    return modules_store.leaveSettings["settings"]


def _types() -> list:
    ensure_defaults()
    return sorted(modules_store.leaveTypes.values(), key=lambda t: t.get("code"))


def _type(code_or_legacy: Optional[str]) -> dict:
    """Leave type by code. Older requests used names like CASUAL / SICK / EARNED / UNPAID."""
    ensure_defaults()
    value = (code_or_legacy or "").upper()
    legacy = {"CASUAL": "CL", "SICK": "SL", "EARNED": "EL", "MATERNITY": "ML", "PATERNITY": "PTL", "UNPAID": "LOP"}
    code = legacy.get(value, value)
    t = next((t for t in modules_store.leaveTypes.values() if t["code"] == code), None)
    if not t:
        raise ApiError(400, f"Unknown leave type {code_or_legacy}.")
    return t


def _emp(emp_id: Optional[str]) -> dict:
    emp = db_store.employees.get(emp_id or "")
    if not emp:
        raise ApiError(404, "Employee not found.")
    return emp


def _is_hr(user: dict) -> bool:
    return user.get("role") in HR_ROLES


# ------------------------------------------------------------------ calendar maths

def holidays_for(emp: Optional[dict]) -> dict:
    """{date: name} of holidays that apply to the employee's location (global ones apply to all)."""
    loc = ((emp or {}).get("location") or "").strip().lower()
    out = {}
    for h in modules_store.holidays.values():
        locs = [x.strip().lower() for x in h.get("locations") or [] if x]
        if not locs or (loc and loc in locs):
            out[h.get("date")] = h.get("name")
    return out


def _dates(start: date, end: date) -> list:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def count_days(emp: dict, ltype: dict, start: date, end: date, half: bool) -> float:
    if half:
        return 0.5
    weekend = set(_settings().get("weekendDays") or [5, 6])
    hols = holidays_for(emp)
    working = [d for d in _dates(start, end) if d.weekday() not in weekend and d.isoformat() not in hols]
    if not working:
        return 0
    if ltype.get("sandwich"):
        # Sandwich rule: weekends / holidays between two leave days count as leave
        return float((working[-1] - working[0]).days + 1)
    return float(len(working))


# ------------------------------------------------------------------ balances

def _refresh_compoff(b: dict) -> None:
    """Comp-off credits expire: used days are taken from the earliest-expiring credits; whatever
    is left on an expired credit lapses. total = used + what is still valid."""
    credits = sorted(b.get("credits") or [], key=lambda c: c.get("expiresOn") or "")
    left_to_allocate = b.get("used") or 0
    valid = 0.0
    for c in credits:
        take = min(c["days"], left_to_allocate)
        left_to_allocate -= take
        unused = c["days"] - take
        if unused and (c.get("expiresOn") or "") >= today_str():
            valid += unused
    b["total"] = round((b.get("used") or 0) + valid, 2)


def credit_compoff(emp_id: str, days: float, expires_on: str, source_id: str) -> None:
    b = _balance_doc(emp_id)[COMPOFF_KEY]
    b.setdefault("credits", []).append({"days": days, "expiresOn": expires_on, "sourceId": source_id, "creditedOn": today_str()})
    _refresh_compoff(b)


def _balance_doc(emp_id: str) -> dict:
    bal = modules_store.get_leave_balance(emp_id)
    for t in _types():
        key = t["balanceKey"]
        if key not in bal:
            bal[key] = {"total": t["annualEntitlement"], "used": 0, "remaining": t["annualEntitlement"]}
        bal[key].setdefault("total", t["annualEntitlement"] if key != "unpaid" else 0)
        bal[key].setdefault("used", 0)
    if COMPOFF_KEY in bal:
        _refresh_compoff(bal[COMPOFF_KEY])
    return bal


def _pending_days(emp_id: str, key: str) -> float:
    total = 0.0
    for r in modules_store.leaveRequests.values():
        if r.get("employeeId") == emp_id and r.get("status") == "PENDING" and _type(r.get("leaveType"))["balanceKey"] == key:
            total += r.get("paidDays", r.get("daysCount") or 0) or 0
    return total


def balance_view(emp_id: str) -> list:
    bal = _balance_doc(emp_id)
    rows = []
    for t in _types():
        if not t.get("active", True):
            continue
        b = bal[t["balanceKey"]]
        pending = _pending_days(emp_id, t["balanceKey"])
        total = b.get("total") or 0
        used = b.get("used") or 0
        rows.append({
            "code": t["code"], "name": t["name"], "paid": t.get("paid", True), "total": total, "used": used,
            "pending": pending, "available": max(0, total - used - pending) if t.get("paid", True) else None,
            "carriedForward": b.get("carriedForward", 0), "adjusted": b.get("adjusted", 0),
        })
        if b.get("credits") is not None:
            # comp-off: show each credit with its expiry so the employee knows when it lapses
            credits = [{"days": c.get("days"), "earnedOn": c.get("creditedOn"), "expiresOn": c.get("expiresOn")} for c in b.get("credits") or []]
            rows[-1]["credits"] = credits
            live = sorted(c["expiresOn"] for c in credits if c.get("expiresOn") and c["expiresOn"] >= today_str())
            rows[-1]["nextExpiry"] = live[0] if live else None
    return rows


def _legacy_balance(emp_id: str) -> dict:
    """The old {casual: {total, used, remaining}} shape some pages still read."""
    bal = _balance_doc(emp_id)
    for key, b in bal.items():
        if isinstance(b, dict) and "total" in b:
            b["remaining"] = max(0, (b.get("total") or 0) - (b.get("used") or 0))
    return bal


def _can_see_employee(user: dict, emp_id: str) -> bool:
    """Own leave, the leave of people who report to you, or everyone for HR / admin / auditors."""
    me = my_employee_id(user)
    return emp_id == me or user.get("role") in LEAVE_READ_ALL or is_in_team(me, emp_id)


# ------------------------------------------------------------------ approval routing

def _delegate_of(approver_emp_id: Optional[str]) -> Optional[str]:
    emp = db_store.employees.get(approver_emp_id or "")
    d = (emp or {}).get("leaveDelegate") or {}
    today = today_str()
    if d.get("delegateId") and (d.get("from") or "") <= today <= (d.get("until") or "9999-12-31"):
        return d["delegateId"]
    return None


def _sla_breached(req: dict) -> bool:
    applied = (req.get("appliedAt") or "")[:10]
    if not applied:
        return False
    try:
        return (date.today() - date.fromisoformat(applied)).days > (_settings().get("slaDays") or 3)
    except ValueError:
        return False


def approvers_of(req: dict) -> dict:
    """{employeeId: why} of people who may decide this request (HR handled separately)."""
    out = {}
    approver = req.get("approverId") or manager_of(req["employeeId"])
    if approver:
        out[approver] = "Reporting manager"
        delegate = _delegate_of(approver)
        if delegate and delegate != req["employeeId"]:
            out[delegate] = f"Delegate of {employee_name(approver)}"
        if req.get("status") == "PENDING" and _sla_breached(req):
            nxt = manager_of(approver)
            if nxt and nxt != req["employeeId"]:
                out[nxt] = "Escalated (SLA passed)"
    out.pop(req["employeeId"], None)  # never yourself
    return out


def _can_decide(user: dict, req: dict) -> Optional[str]:
    me = my_employee_id(user)
    if not me or req["employeeId"] == me:
        return None
    if me in approvers_of(req):
        return approvers_of(req)[me]
    if _is_hr(user):
        return "HR"
    return None


def _view(req: dict, user: dict) -> dict:
    out = dict(req)
    out["leaveTypeName"] = _type(req.get("leaveType"))["name"]
    out["approverName"] = employee_name(req.get("approverId")) or ("HR" if not req.get("approverId") else "")
    out["escalated"] = req.get("status") == "PENDING" and _sla_breached(req)
    out["canDecide"] = req.get("status") == "PENDING" and bool(_can_decide(user, req))
    mine = req["employeeId"] == my_employee_id(user)
    out["canCancel"] = mine and req.get("status") in OPEN and (req.get("status") == "PENDING" or req.get("startDate", "") > today_str())
    out["canEdit"] = mine and req.get("status") in OPEN and req.get("startDate", "") >= today_str()
    return out


# ------------------------------------------------------------------ validation

def _parse(value, label: str) -> date:
    try:
        return date.fromisoformat(js_str(value or "")[:10])
    except ValueError:
        raise ApiError(400, f"{label} must be a date (YYYY-MM-DD).")


def _check_eligibility(emp: dict, ltype: dict) -> None:
    g = (ltype.get("gender") or "ANY").upper()
    gender = (emp.get("gender") or "").upper()
    if g != "ANY" and gender != g:
        raise ApiError(400, f"{ltype['name']} is only available to {g.lower()} employees.")
    types = ltype.get("employmentTypes") or EMPLOYMENT_TYPES
    if (emp.get("employmentType") or "FULL_TIME") not in types:
        raise ApiError(400, f"{ltype['name']} is not available for {(emp.get('employmentType') or '').replace('_', ' ').lower()} employees.")
    service = ltype.get("minServiceDays") or 0
    if service:
        try:
            joined = date.fromisoformat((emp.get("joiningDate") or "")[:10])
        except ValueError:
            joined = None
        if not joined or (date.today() - joined).days < service:
            raise ApiError(400, f"{ltype['name']} needs at least {service} days of service.")


def _overlaps(emp_id: str, start: date, end: date, half: bool, session: Optional[str], exclude_id: Optional[str] = None) -> Optional[dict]:
    for r in modules_store.leaveRequests.values():
        if r.get("employeeId") != emp_id or r.get("status") not in OPEN or r["_id"] == exclude_id:
            continue
        try:
            rs, re_ = date.fromisoformat(r["startDate"][:10]), date.fromisoformat(r["endDate"][:10])
        except (KeyError, ValueError):
            continue
        if rs <= end and start <= re_:
            # Two half days on the same date in different sessions are fine
            if half and r.get("isHalfDay") and rs == start and r.get("halfDaySession") and session and r.get("halfDaySession") != session:
                continue
            return r
    return None


def _evaluate(emp: dict, body: dict, exclude_id: Optional[str] = None, privileged: bool = False) -> dict:
    """Validate an application and work out days, paid days and LOP days."""
    ltype = _type(body.get("leaveType"))
    if not ltype.get("active", True):
        raise ApiError(400, f"{ltype['name']} is not currently offered.")
    start = _parse(body.get("startDate"), "Start date")
    end = _parse(body.get("endDate") or body.get("startDate"), "End date")
    if end < start:
        raise ApiError(400, "End date cannot be before the start date.")
    half = bool(body.get("isHalfDay"))
    session = (body.get("halfDaySession") or "").upper() or None
    if half:
        if not ltype.get("allowHalfDay"):
            raise ApiError(400, f"Half days are not allowed for {ltype['name']}.")
        if start != end:
            raise ApiError(400, "A half day must start and end on the same date.")
        if session not in ("FIRST_HALF", "SECOND_HALF"):
            raise ApiError(400, "Choose the first or second half of the day.")
    reason = js_str(body.get("reason") or "").strip()
    if not reason:
        raise ApiError(400, "Give a reason for the leave.")
    _check_eligibility(emp, ltype)

    back = ltype.get("maxBackdatedDays")
    if back is not None and (date.today() - start).days > back and not privileged:
        raise ApiError(400, f"{ltype['name']} can be applied at most {back} day(s) in the past. Ask HR for older dates.")

    clash = _overlaps(emp["_id"], start, end, half, session, exclude_id)
    if clash:
        raise ApiError(409, f"You already have {clash.get('status', '').lower()} leave from {clash['startDate']} to {clash['endDate']} that overlaps these dates.")

    days = count_days(emp, ltype, start, end, half)
    if days <= 0:
        raise ApiError(400, "These dates fall on weekly offs / holidays only; no leave is needed.")

    paid_days, lop_days = days, 0.0
    if not ltype.get("paid", True):
        paid_days, lop_days = 0.0, days
    else:
        bal = _balance_doc(emp["_id"])[ltype["balanceKey"]]
        pending = _pending_days(emp["_id"], ltype["balanceKey"])
        if exclude_id and exclude_id in modules_store.leaveRequests and modules_store.leaveRequests[exclude_id].get("status") == "PENDING":
            pending -= modules_store.leaveRequests[exclude_id].get("paidDays", 0) or 0
        available = max(0.0, (bal.get("total") or 0) - (bal.get("used") or 0) - pending)
        if days > available:
            if ltype.get("excessPolicy") == "LOP" or body.get("convertExcessToLop"):
                paid_days, lop_days = available, days - available
            else:
                raise ApiError(400, f"Only {available:g} day(s) of {ltype['name']} available; you asked for {days:g}. "
                                    "Reduce the dates or tick 'apply the extra days as loss of pay'.",
                               available=available, requested=days)
    return {"type": ltype, "start": start, "end": end, "half": half, "session": session, "reason": reason,
            "days": days, "paidDays": paid_days, "lopDays": lop_days}


# ------------------------------------------------------------------ reading

@router.get("/leave/types")
async def leave_types(_: dict = Depends(require_auth)):
    return {"types": _types(), "settings": _settings()}


@router.get("/leave/balance")
async def leave_balance(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    target = employeeId or my_employee_id(user)
    if not target:
        raise ApiError(400, "No employee record linked to your login.")
    if not _can_see_employee(user, target):
        raise ApiError(403, "Access denied: you can only view your own (or your team's) leave balance.")
    _emp(target)
    return {"balance": _legacy_balance(target), "balances": balance_view(target), "employeeId": target}


@router.get("/leave/requests")
async def leave_requests(scope: str = "auto", status: Optional[str] = None, employeeId: Optional[str] = None,
                         user: dict = Depends(require_auth)):
    """scope: mine | approvals (waiting for me) | team | all (HR) | auto (mine + what I may decide)."""
    me = my_employee_id(user)
    items = list(modules_store.leaveRequests.values())
    if scope == "mine":
        items = [r for r in items if r["employeeId"] == me]
    elif scope == "approvals":
        items = [r for r in items if r.get("status") == "PENDING" and _can_decide(user, r)]
    elif scope == "team":
        items = [r for r in items if is_in_team(me, r["employeeId"])]
    elif scope == "all":
        if user.get("role") not in LEAVE_READ_ALL:
            raise ApiError(403, "Only HR can see everyone's leave.")
    else:
        items = [r for r in items if r["employeeId"] == me or _can_decide(user, r) or is_in_team(me, r["employeeId"])
                 or user.get("role") in LEAVE_READ_ALL]
    if employeeId:
        if not _can_see_employee(user, employeeId):
            raise ApiError(403, "Access denied.")
        items = [r for r in items if r["employeeId"] == employeeId]
    if status and status != "ALL":
        items = [r for r in items if r.get("status") == status]
    items.sort(key=lambda r: r.get("appliedAt") or "", reverse=True)
    return {"requests": [_view(r, user) for r in items],
            "balance": _legacy_balance(me) if me else None, "balances": balance_view(me) if me else []}


@router.get("/leave/requests/{leave_id}")
async def leave_request(leave_id: str, user: dict = Depends(require_auth)):
    req = modules_store.leaveRequests.get(leave_id)
    if not req:
        raise ApiError(404, "Leave request not found.")
    if not (_can_see_employee(user, req["employeeId"]) or _can_decide(user, req)):
        raise ApiError(403, "Access denied.")
    return {"request": _view(req, user)}


@router.get("/leave/calendar")
async def team_calendar(month: Optional[str] = None, user: dict = Depends(require_auth)):
    """Approved and pending leave in a month: a manager sees their team, HR everyone, others themselves."""
    month = month or today_str()[:7]
    try:
        y, m = (int(x) for x in month.split("-"))
        first, last = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    except ValueError:
        raise ApiError(400, "Month must be YYYY-MM.")
    me = my_employee_id(user)
    if user.get("role") in LEAVE_READ_ALL:
        people = [e for e in db_store.employees.values() if e.get("status") not in ("TERMINATED", "EXITED", "INACTIVE")]
        scope = "ALL"
    else:
        people = [e for e in db_store.employees.values() if is_in_team(me, e["_id"])]
        scope = "TEAM" if people else "SELF"
        if not people and me in db_store.employees:
            people = [db_store.employees[me]]
    ids = {e["_id"] for e in people}
    entries = []
    for r in modules_store.leaveRequests.values():
        if r["employeeId"] not in ids or r.get("status") not in OPEN:
            continue
        try:
            rs, re_ = date.fromisoformat(r["startDate"][:10]), date.fromisoformat(r["endDate"][:10])
        except (KeyError, ValueError):
            continue
        if rs <= last and first <= re_:
            entries.append({"employeeId": r["employeeId"], "employeeName": r.get("employeeName"), "leaveType": _type(r.get("leaveType"))["code"],
                            "startDate": r["startDate"], "endDate": r["endDate"], "status": r["status"], "isHalfDay": r.get("isHalfDay")})
    return {"month": month, "scope": scope, "people": sorted({e["_id"]: employee_name(e["_id"]) for e in people}.items(), key=lambda x: x[1]),
            "entries": entries, "holidays": holidays_for(db_store.employees.get(me or ""))}


# ------------------------------------------------------------------ applying

def _approver_for(emp_id: str) -> Optional[str]:
    return manager_of(emp_id)


@router.post("/leave/apply")
async def apply_leave(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    me = my_employee_id(user)
    target = body.get("targetEmployeeId") or me
    if target != me and not _is_hr(user):
        raise ApiError(403, "You can only apply leave for yourself.")
    emp = _emp(target)
    ev = _evaluate(emp, body, privileged=_is_hr(user) and target != me)
    approver = _approver_for(emp["_id"])
    leave_id = f"leave_{now_ms()}_{rand_base36(4)}"
    req = {
        "_id": leave_id, "employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "employeeCode": emp.get("employeeCode"),
        "department": emp.get("department"), "leaveType": ev["type"]["code"], "startDate": ev["start"].isoformat(),
        "endDate": ev["end"].isoformat(), "daysCount": ev["days"], "paidDays": ev["paidDays"], "lopDays": ev["lopDays"],
        "isHalfDay": ev["half"], "halfDaySession": ev["session"], "reason": ev["reason"], "status": "PENDING",
        "approverId": approver, "appliedAt": now_iso(), "appliedBy": actor_name(user),
        "history": [{"action": "APPLIED", "by": actor_name(user), "at": now_iso()}],
    }
    if target != me:
        req["appliedOnBehalfBy"] = actor_name(user)
    modules_store.leaveRequests[leave_id] = req
    if approver:
        notify_employee(approver, "Leave request to approve",
                        f"{req['employeeName']} applied for {ev['days']:g} day(s) of {ev['type']['name']} ({req['startDate']} to {req['endDate']}).", "LEAVE")
        delegate = _delegate_of(approver)
        if delegate:
            notify_employee(delegate, "Leave request to approve (as delegate)", f"{req['employeeName']} applied for leave.", "LEAVE")
    else:
        notify_roles(("HR",), "Leave request to approve", f"{req['employeeName']} applied for leave (no manager on record).", "LEAVE",
                     exclude_user_id=emp.get("userId"))
    audit(user, "LEAVE_APPLIED", "LEAVE", "LeaveRequest", leave_id, {
        "employeeCode": emp.get("employeeCode"), "leaveType": ev["type"]["code"], "days": ev["days"], "lopDays": ev["lopDays"],
        "startDate": req["startDate"], "endDate": req["endDate"],
    })
    return JSONResponse({"success": True, "leave": _view(req, user)}, status_code=201)


def _apply_to_balance(req: dict, sign: int) -> None:
    """sign=+1 when a leave is approved, -1 when an approved leave is cancelled."""
    ltype = _type(req.get("leaveType"))
    bal = _balance_doc(req["employeeId"])
    if req.get("paidDays"):
        b = bal[ltype["balanceKey"]]
        b["used"] = round((b.get("used") or 0) + sign * req["paidDays"], 2)
    if req.get("lopDays"):
        u = bal["unpaid"]
        u["used"] = round((u.get("used") or 0) + sign * req["lopDays"], 2)


def _push_lop(req: dict, user: dict) -> None:
    """Approved loss-of-pay days go to payroll, month by month."""
    lop = req.get("lopDays") or 0
    if not lop:
        return
    ltype = _type(req.get("leaveType"))
    start, end = date.fromisoformat(req["startDate"]), date.fromisoformat(req["endDate"])
    emp = db_store.employees.get(req["employeeId"])
    weekend = set(_settings().get("weekendDays") or [5, 6])
    hols = holidays_for(emp)
    days = [d for d in _dates(start, end) if ltype.get("sandwich") or (d.weekday() not in weekend and d.isoformat() not in hols)]
    if req.get("isHalfDay"):
        days = [start]
    lop_days = days[-int(lop + 0.5):] if lop >= 1 else days[-1:]
    per_month: dict = {}
    for d in lop_days:
        per_month[d.isoformat()[:7]] = per_month.get(d.isoformat()[:7], 0) + (0.5 if req.get("isHalfDay") else 1)
    for month, n in per_month.items():
        add_payroll_input(req["employeeId"], month, "LOP_DAYS", days=n, source="LEAVE", source_id=f"{req['_id']}:{month}",
                          label=f"LOP {req['startDate']} to {req['endDate']}", by=user)


@router.put("/leave/{leave_id}/status")
async def decide_leave(leave_id: str, request: Request, user: dict = Depends(require_auth)):
    req = modules_store.leaveRequests.get(leave_id)
    if not req:
        raise ApiError(404, "Leave request not found.")
    body = await read_body(request)
    status = body.get("status")
    comment = js_str(body.get("comment") or body.get("rejectionReason") or "").strip()
    if status == "CANCELLED":
        return await _cancel(req, user, comment)
    if status not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Status must be APPROVED or REJECTED.")
    if req.get("status") != "PENDING":
        raise ApiError(400, f"This request is already {req.get('status', '').lower()}.")
    if req["employeeId"] == my_employee_id(user):
        raise ApiError(403, "You cannot approve or reject your own leave. It goes to your manager.")
    why = _can_decide(user, req)
    if not why:
        raise ApiError(403, "Access denied: you are not the approver for this employee's leave.")
    if status == "REJECTED" and not comment:
        raise ApiError(400, "Give a reason for rejecting the leave.")
    if status == "APPROVED" and req.get("paidDays"):
        # Re-check the balance at approval time (other leave may have been approved meanwhile)
        bal = _balance_doc(req["employeeId"])[_type(req["leaveType"])["balanceKey"]]
        if (bal.get("used") or 0) + req["paidDays"] > (bal.get("total") or 0) + 1e-9:
            raise ApiError(409, "Not enough balance left to approve this leave. Ask the employee to re-apply.")
    # Two-level workflow (Admin > Workflows, Super Admin only): the manager's approval sends it on
    # to the next-level manager; only that second approval is final.
    from app.routes.admin import system_settings
    levels = int(system_settings()["workflows"]["leave"].get("levels") or 1)
    if status == "APPROVED" and levels >= 2 and int(req.get("level") or 1) < 2 and why != "HR":
        nxt = manager_of(req.get("approverId") or my_employee_id(user))
        if nxt and nxt != req["employeeId"]:
            req.update({"level": 2, "approverId": nxt, "level1ApprovedBy": actor_name(user), "level1ApprovedAt": now_iso()})
            req.setdefault("history", []).append({"action": "LEVEL1_APPROVED", "by": actor_name(user), "as": why, "at": now_iso(), "comment": comment})
            notify_employee(nxt, "Leave to approve (level 2)", f"{req['employeeName']}: {req['startDate']} to {req['endDate']}, approved by {actor_name(user)} at level 1.", "LEAVE")
            audit(user, "LEAVE_LEVEL1_APPROVED", "LEAVE", "LeaveRequest", leave_id, {"nextApprover": employee_name(nxt)})
            return {"success": True, "leave": _view(req, user)}
    req.update({"status": status, "reviewedBy": actor_name(user), "reviewedById": my_employee_id(user), "reviewedAt": now_iso(),
                "reviewerCapacity": why, "reviewComment": comment or None})
    if status == "REJECTED":
        req["rejectionReason"] = comment
    req.setdefault("history", []).append({"action": status, "by": actor_name(user), "as": why, "at": now_iso(), "comment": comment})
    if status == "APPROVED":
        _apply_to_balance(req, +1)
        _push_lop(req, user)
    notify_employee(req["employeeId"], f"Leave {status.lower()}",
                    f"Your {_type(req['leaveType'])['name']} from {req['startDate']} to {req['endDate']} was {status.lower()} by {actor_name(user)}"
                    + (f": {comment}" if comment else "."), "LEAVE")
    audit(user, f"LEAVE_{status}", "LEAVE", "LeaveRequest", leave_id, {
        "employeeCode": req.get("employeeCode"), "days": req.get("daysCount"), "as": why, "comment": comment,
        "changes": [{"field": "status", "oldValue": "PENDING", "newValue": status}],
    })
    return {"success": True, "leave": _view(req, user)}


async def _cancel(req: dict, user: dict, comment: str) -> dict:
    me = my_employee_id(user)
    if req["employeeId"] != me and not _is_hr(user):
        raise ApiError(403, "Only the employee (or HR) can cancel this leave.")
    if req.get("status") not in OPEN:
        raise ApiError(400, f"This request is already {req.get('status', '').lower()}.")
    was = req["status"]
    if was == "APPROVED" and req["startDate"] <= today_str() and not _is_hr(user):
        raise ApiError(400, "Leave that has already started can only be cancelled by HR.")
    if was == "APPROVED":
        _apply_to_balance(req, -1)
        cancel_payroll_inputs(req["_id"])
        for month in {req["startDate"][:7], req["endDate"][:7]}:
            cancel_payroll_inputs(f"{req['_id']}:{month}")
    req.update({"status": "CANCELLED", "cancelledAt": now_iso(), "cancelledBy": actor_name(user)})
    req.setdefault("history", []).append({"action": "CANCELLED", "by": actor_name(user), "at": now_iso(), "comment": comment})
    approver = req.get("approverId")
    if approver:
        notify_employee(approver, "Leave cancelled",
                        f"{req['employeeName']} cancelled their {'approved' if was == 'APPROVED' else 'pending'} leave from {req['startDate']} to {req['endDate']}.", "LEAVE")
    audit(user, "LEAVE_CANCELLED", "LEAVE", "LeaveRequest", req["_id"], {"previousStatus": was, "balanceRestored": was == "APPROVED"})
    return {"success": True, "leave": _view(req, user)}


@router.put("/leave/requests/{leave_id}")
async def edit_leave(leave_id: str, request: Request, user: dict = Depends(require_auth)):
    """Change dates / type. Any change to an approved leave sends it back for fresh approval."""
    req = modules_store.leaveRequests.get(leave_id)
    if not req:
        raise ApiError(404, "Leave request not found.")
    if req["employeeId"] != my_employee_id(user):
        raise ApiError(403, "You can only change your own leave.")
    if req.get("status") not in OPEN:
        raise ApiError(400, "Only pending or approved leave can be changed.")
    body = await read_body(request)
    merged = {"leaveType": req["leaveType"], "startDate": req["startDate"], "endDate": req["endDate"], "isHalfDay": req.get("isHalfDay"),
              "halfDaySession": req.get("halfDaySession"), "reason": req.get("reason"), **body}
    was = req["status"]
    if was == "APPROVED":
        _apply_to_balance(req, -1)
        for month in {req["startDate"][:7], req["endDate"][:7]}:
            cancel_payroll_inputs(f"{req['_id']}:{month}")
    try:
        ev = _evaluate(_emp(req["employeeId"]), merged, exclude_id=leave_id)
    except ApiError:
        if was == "APPROVED":
            _apply_to_balance(req, +1)
        raise
    old = {k: req.get(k) for k in ("leaveType", "startDate", "endDate", "daysCount")}
    req.update({"leaveType": ev["type"]["code"], "startDate": ev["start"].isoformat(), "endDate": ev["end"].isoformat(),
                "daysCount": ev["days"], "paidDays": ev["paidDays"], "lopDays": ev["lopDays"], "isHalfDay": ev["half"],
                "halfDaySession": ev["session"], "reason": ev["reason"], "status": "PENDING", "appliedAt": now_iso(),
                "reviewedBy": None, "reviewedAt": None})
    req.setdefault("history", []).append({"action": "CHANGED" + ("_AFTER_APPROVAL" if was == "APPROVED" else ""), "by": actor_name(user),
                                          "at": now_iso(), "from": old})
    if req.get("approverId"):
        notify_employee(req["approverId"], "Leave changed - approval needed again" if was == "APPROVED" else "Leave request changed",
                        f"{req['employeeName']} changed their leave to {req['startDate']} - {req['endDate']}.", "LEAVE")
    audit(user, "LEAVE_CHANGED", "LEAVE", "LeaveRequest", leave_id, {
        "previousStatus": was, "changes": [{"field": k, "oldValue": v, "newValue": req.get(k)} for k, v in old.items() if v != req.get(k)],
    })
    return {"success": True, "leave": _view(req, user), "needsApproval": True}


# ------------------------------------------------------------------ delegation

@router.put("/leave/delegate")
async def set_delegate(request: Request, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    body = await read_body(request)
    delegate = body.get("delegateId")
    if not delegate:
        db_store.employees[me].pop("leaveDelegate", None)
        audit(user, "LEAVE_DELEGATE_REMOVED", "LEAVE", "Employee", me, {})
        return {"success": True, "delegate": None}
    if delegate == me:
        raise ApiError(400, "You cannot delegate to yourself.")
    _emp(delegate)
    frm = _parse(body.get("from") or today_str(), "From").isoformat()
    until = _parse(body.get("until"), "Until").isoformat()
    if until < frm:
        raise ApiError(400, "'Until' is before 'from'.")
    db_store.employees[me]["leaveDelegate"] = {"delegateId": delegate, "delegateName": employee_name(delegate), "from": frm, "until": until}
    notify_employee(delegate, "You are a leave approver delegate", f"{actor_name(user)} delegated leave approvals to you from {frm} to {until}.", "LEAVE")
    audit(user, "LEAVE_DELEGATE_SET", "LEAVE", "Employee", me, {"delegate": employee_name(delegate), "from": frm, "until": until})
    return {"success": True, "delegate": db_store.employees[me]["leaveDelegate"]}


@router.get("/leave/delegate")
async def get_delegate(user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    return {"delegate": (db_store.employees.get(me or "") or {}).get("leaveDelegate")}


# ------------------------------------------------------------------ HR: types, adjustments, year end

@router.post("/leave/types")
@router.put("/leave/types/{type_id}")
async def save_leave_type(request: Request, type_id: Optional[str] = None, user: dict = Depends(require_role(*HR_ROLES))):
    ensure_defaults()
    b = await read_body(request)
    existing = modules_store.leaveTypes.get(type_id) if type_id else None
    if type_id and not existing:
        raise ApiError(404, "Leave type not found.")
    code = js_str(b.get("code") or (existing or {}).get("code") or "").strip().upper()
    name = js_str(b.get("name") or "").strip()
    if not code or not name:
        raise ApiError(400, "Code and name are required.")
    if not existing and any(t["code"] == code for t in modules_store.leaveTypes.values()):
        raise ApiError(409, f"Leave type {code} already exists.")

    def num(key, default=0, lo=0, hi=400):
        v = b.get(key, (existing or {}).get(key, default))
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise ApiError(400, f"{key} must be a number.")
        if not lo <= v <= hi:
            raise ApiError(400, f"{key} must be between {lo} and {hi}.")
        return v

    gender = (b.get("gender") or (existing or {}).get("gender") or "ANY").upper()
    if gender not in GENDERS:
        raise ApiError(400, "Gender must be ANY, FEMALE or MALE.")
    types = [t for t in (b.get("employmentTypes") or (existing or {}).get("employmentTypes") or EMPLOYMENT_TYPES) if t in EMPLOYMENT_TYPES]
    excess = (b.get("excessPolicy") or (existing or {}).get("excessPolicy") or "BLOCK").upper()
    doc = {
        "_id": type_id or f"lt_{code}", "code": code, "name": name,
        "balanceKey": (existing or {}).get("balanceKey") or code.lower(),
        "annualEntitlement": num("annualEntitlement"), "carryForwardMax": num("carryForwardMax"),
        "encashable": bool(b.get("encashable", (existing or {}).get("encashable", False))), "encashMax": num("encashMax"),
        "allowHalfDay": bool(b.get("allowHalfDay", (existing or {}).get("allowHalfDay", True))),
        "maxBackdatedDays": num("maxBackdatedDays", 7, 0, 365), "gender": gender, "minServiceDays": num("minServiceDays", 0, 0, 3650),
        "employmentTypes": types or list(EMPLOYMENT_TYPES), "sandwich": bool(b.get("sandwich", (existing or {}).get("sandwich", False))),
        "excessPolicy": "LOP" if excess in ("LOP", "ALLOW") else "BLOCK", "paid": bool(b.get("paid", (existing or {}).get("paid", True))),
        "active": bool(b.get("active", (existing or {}).get("active", True))),
    }
    changes = [{"field": k, "oldValue": (existing or {}).get(k), "newValue": v} for k, v in doc.items() if (existing or {}).get(k) != v]
    modules_store.leaveTypes[doc["_id"]] = doc
    audit(user, "LEAVE_TYPE_UPDATED" if existing else "LEAVE_TYPE_CREATED", "LEAVE", "LeaveType", doc["_id"], {"code": code, "changes": changes})
    return {"success": True, "type": doc}


@router.put("/leave/settings")
async def save_settings(request: Request, user: dict = Depends(require_role(*HR_ROLES))):
    b = await read_body(request)
    s = _settings()
    old = dict(s)
    if "slaDays" in b:
        try:
            s["slaDays"] = max(1, int(b["slaDays"]))
        except (TypeError, ValueError):
            raise ApiError(400, "SLA days must be a whole number.")
    if "weekendDays" in b:
        s["weekendDays"] = sorted({int(d) for d in b["weekendDays"] if str(d).isdigit() and 0 <= int(d) <= 6})
    audit(user, "LEAVE_SETTINGS_UPDATED", "LEAVE", "LeaveSettings", "settings",
          {"changes": [{"field": k, "oldValue": old.get(k), "newValue": s.get(k)} for k in ("slaDays", "weekendDays") if old.get(k) != s.get(k)]})
    return {"success": True, "settings": s}


@router.post("/leave/balance/{employee_id}/adjust")
async def adjust_balance(employee_id: str, request: Request, user: dict = Depends(require_role(*HR_ROLES))):
    if employee_id == my_employee_id(user):
        raise ApiError(403, "You cannot adjust your own leave balance. Another HR user must do it.")
    emp = _emp(employee_id)
    b = await read_body(request)
    ltype = _type(b.get("leaveType"))
    try:
        days = float(b.get("days"))
    except (TypeError, ValueError):
        raise ApiError(400, "Days must be a number (negative to reduce).")
    reason = js_str(b.get("reason") or "").strip()
    if not days or abs(days) > 365:
        raise ApiError(400, "Days must be a non-zero number of at most 365.")
    if not reason:
        raise ApiError(400, "A reason is required for a balance adjustment.")
    bal = _balance_doc(employee_id)[ltype["balanceKey"]]
    old_total = bal.get("total") or 0
    if old_total + days < (bal.get("used") or 0):
        raise ApiError(400, "The adjustment would make the balance negative.")
    bal["total"] = round(old_total + days, 2)
    bal["adjusted"] = round((bal.get("adjusted") or 0) + days, 2)
    adj_id = f"ladj_{now_ms()}_{rand_base36(4)}"
    modules_store.leaveAdjustments[adj_id] = {"_id": adj_id, "employeeId": employee_id, "leaveType": ltype["code"], "days": days,
                                              "reason": reason, "by": actor_name(user), "byUserId": user["_id"], "at": now_iso()}
    notify_employee(employee_id, "Leave balance adjusted", f"{ltype['name']}: {days:+g} day(s). Reason: {reason}", "LEAVE")
    audit(user, "LEAVE_BALANCE_ADJUSTED", "LEAVE", "Employee", employee_id, {
        "employeeCode": emp.get("employeeCode"), "leaveType": ltype["code"], "reason": reason,
        "changes": [{"field": f"{ltype['code']} entitlement", "oldValue": old_total, "newValue": bal["total"]}],
    })
    return {"success": True, "balances": balance_view(employee_id)}


@router.get("/leave/adjustments")
async def list_adjustments(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    if user.get("role") not in LEAVE_READ_ALL and employeeId != my_employee_id(user):
        raise ApiError(403, "Access denied.")
    rows = [a for a in modules_store.leaveAdjustments.values() if not employeeId or a["employeeId"] == employeeId]
    return {"adjustments": sorted(rows, key=lambda a: a["at"], reverse=True)}


def _daily_basic(emp: dict) -> float:
    from app.utils.salary_structure import compute_salary_structure
    ctc = emp.get("annualSalary") or 0
    if not ctc:
        return 0.0
    s = compute_salary_structure(ctc)
    basic = next((l["monthly"] for l in s["wages"] if l["key"] == "basic"), 0)
    return basic / 26  # common Indian practice: monthly basic / 26 working days


@router.post("/leave/year-end")
async def year_end(request: Request, user: dict = Depends(require_role(*HR_ROLES))):
    """Carry forward (up to each type's limit), encash (up to the limit, paid through payroll) and
    lapse the rest; then reset entitlements for the new year. dryRun=true only previews."""
    b = await read_body(request)
    dry = bool(b.get("dryRun"))
    payout_month = js_str(b.get("payoutMonth") or "")[:7] or today_str()[:7]
    if not dry and len(payout_month) != 7:
        raise ApiError(400, "Payout month must be YYYY-MM.")
    rows = []
    for emp in db_store.employees.values():
        if emp.get("status") in ("TERMINATED", "EXITED", "INACTIVE"):
            continue
        bal = _balance_doc(emp["_id"])
        for t in _types():
            if not t.get("paid", True) or not t.get("active", True) or t["balanceKey"] == COMPOFF_KEY:
                continue  # comp-off credits expire on their own dates instead
            b_ = bal[t["balanceKey"]]
            remaining = max(0.0, (b_.get("total") or 0) - (b_.get("used") or 0))
            carry = min(remaining, t.get("carryForwardMax") or 0)
            encash = min(remaining - carry, t.get("encashMax") or 0) if t.get("encashable") else 0
            lapse = remaining - carry - encash
            amount = round(encash * _daily_basic(emp), 2)
            rows.append({"employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "leaveType": t["code"],
                         "remaining": remaining, "carryForward": carry, "encash": encash, "encashAmount": amount, "lapse": lapse})
            if not dry:
                b_.update({"total": t["annualEntitlement"] + carry, "used": 0, "carriedForward": carry, "adjusted": 0})
                if encash:
                    add_payroll_input(emp["_id"], payout_month, "LEAVE_ENCASHMENT", amount=amount, days=encash, source="LEAVE_YEAR_END",
                                      source_id=f"yearend:{today_str()[:4]}:{emp['_id']}:{t['code']}",
                                      label=f"{t['name']} encashment ({encash:g} days)", by=user)
    if not dry:
        _settings()["lastYearEnd"] = {"on": now_iso(), "by": actor_name(user), "payoutMonth": payout_month}
        audit(user, "LEAVE_YEAR_END_PROCESSED", "LEAVE", "LeaveSettings", "yearEnd", {
            "employees": len({r["employeeId"] for r in rows}), "carriedDays": sum(r["carryForward"] for r in rows),
            "encashedDays": sum(r["encash"] for r in rows), "lapsedDays": sum(r["lapse"] for r in rows), "payoutMonth": payout_month,
        })
    return {"dryRun": dry, "payoutMonth": payout_month, "rows": [r for r in rows if r["remaining"]],
            "totals": {k: round(sum(r[k] for r in rows), 2) for k in ("carryForward", "encash", "encashAmount", "lapse")}}
