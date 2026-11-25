"""
Resignations, exits and the start of Full & Final settlement.

Flow:
  1. Employee submits a resignation      -> email + notification to HR and their manager
  2. HR initiates the exit (from it)     -> separation record, all four clearances pending
  3. Clearances are marked done          -> Department, IT, Finance, Admin
  4. HR gives final approval             -> status HR_APPROVED and F&F initiated
                                            (email + notification to Finance, Accounts, HR)
One record per separation (modules_store.fullFinalSettlements) feeds both the Exit
Management and the F&F Settlement pages.
"""

import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.module_access import read_roles, write_roles
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.services.mailer import _shell, esc, send_mail
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, num, rand_base36, today_str
from app.utils.salary_structure import compute_salary_structure

router = APIRouter()

# Official role matrix, Exit Management module (app/auth/module_access.py)
EXIT_VIEW_ROLES = read_roles("exit_mgmt")
EXIT_MANAGE_ROLES = write_roles("exit_mgmt")
# Settlement amounts and payout are payroll work (Payroll module: read & write)
SETTLEMENT_ROLES = write_roles("payroll")
FNF_MAKER = ("HR",)          # HR prepares the F&F figures
FNF_CHECKER = ("FINANCE",)   # Finance approves and pays (a different person)
SYSTEM_ACTOR = {"_id": "system", "email": "system", "role": "SYSTEM", "firstName": "System"}
SEPARATION_TYPES = ("RESIGNATION", "TERMINATION", "RETIREMENT", "MUTUAL_SEPARATION", "END_OF_CONTRACT")
CLEARANCE_KEYS = ("department", "itAssets", "finance", "admin")
CLEARANCE_LABELS = {"department": "Department", "itAssets": "IT assets", "finance": "Finance", "admin": "Admin"}
APPROVED = ("HR_APPROVED", "DISBURSED")
INACTIVE = ("INACTIVE", "TERMINATED", "EXITED")


# ------------------------------------------------------------------ helpers

def _name(person: Optional[dict]) -> str:
    person = person or {}
    return f"{person.get('firstName', '')} {person.get('lastName', '')}".strip()


def _user_for_employee(employee_id: Optional[str]) -> Optional[dict]:
    return next((u for u in db_store.users.values() if employee_id and u.get("employeeId") == employee_id), None)


def _users_with_roles(*roles: str) -> list:
    return [u for u in db_store.users.values() if u.get("role") in roles and u.get("isActive", True)]


def _hr_users() -> list:
    # Fall back to admins if the organisation has no HR login yet
    return _users_with_roles("HR") or _users_with_roles("ADMIN", "SUPER_ADMIN")


def _notify(user_ids, title: str, message: str) -> None:
    for uid in dict.fromkeys(user_ids):  # de-duplicate, keep order
        if uid:
            db_store.notifications.insert(0, {
                "_id": f"notif_{now_ms()}_{rand_base36(5)}", "recipientUserId": uid,
                "title": title, "message": message, "type": "EXIT", "isRead": False, "createdAt": now_iso(),
            })


async def _email(recipients: list, subject: str, intro: str, rows: list) -> list:
    """Send one email per recipient ({name, email}); returns [{email, delivered}]."""
    table = "".join(
        f'<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;background:#f8fafc;width:170px">{esc(k)}</td>'
        f'<td style="padding:6px 10px;border:1px solid #e2e8f0">{esc(v)}</td></tr>'
        for k, v in rows if v not in (None, "")
    )
    text_rows = "\n".join(f"{k}: {v}" for k, v in rows if v not in (None, ""))
    results, seen = [], set()
    for r in recipients:
        email = (r.get("email") or "").strip()
        if not email or email.lower() in seen:
            continue
        seen.add(email.lower())
        html = _shell(subject, f"<p>Hi {esc(r.get('name') or 'there')},</p><p>{esc(intro)}</p>"
                               f'<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;margin:12px 0">{table}</table>'
                               "<p>Open the HRMS to take action.</p>")
        result = await send_mail({"to": email, "subject": subject, "html": html,
                                  "text": f"Hi {r.get('name') or 'there'},\n\n{intro}\n\n{text_rows}\n\nOpen the HRMS to take action."})
        results.append({"email": email, "delivered": bool(result.get("delivered")), "simulated": bool(result.get("simulated"))})
    return results


def _recipient(user: Optional[dict], employee: Optional[dict] = None) -> Optional[dict]:
    email = (user or {}).get("email") or (employee or {}).get("workEmail")
    return {"name": _name(user or employee), "email": email, "userId": (user or {}).get("_id")} if email else None


def _open_exit(employee_id: str) -> Optional[dict]:
    return next((s for s in modules_store.fullFinalSettlements.values()
                 if s.get("employeeId") == employee_id and s.get("status") != "DISBURSED"), None)


def _open_resignation(employee_id: str) -> Optional[dict]:
    return next((r for r in modules_store.resignations.values()
                 if r.get("employeeId") == employee_id and r.get("status") == "SUBMITTED"), None)


def _derive_status(sep: dict) -> str:
    """Last completed stage, from the clearances (order-independent)."""
    if sep.get("status") in APPROVED:
        return sep["status"]
    c = {k: bool((sep.get("clearances") or {}).get(k, {}).get("cleared")) for k in CLEARANCE_KEYS}
    if all(c.values()):
        return "FINANCE_CLEARANCE"
    if c["department"] and c["itAssets"]:
        return "IT_CLEARANCE"
    if c["department"]:
        return "DEPARTMENT_CLEARANCE"
    return "INITIATED"


def _permissions(sep: dict, user: dict) -> dict:
    role = user.get("role")
    open_ = sep.get("status") not in APPROVED
    keys = list(CLEARANCE_KEYS) if role in EXIT_MANAGE_ROLES else []
    all_cleared = all((sep.get("clearances") or {}).get(k, {}).get("cleared") for k in CLEARANCE_KEYS)
    settling = sep.get("status") == "HR_APPROVED"
    from app.routes.assets import pending_assets
    return {
        "canClear": keys if open_ else [],
        "canApprove": open_ and role in EXIT_MANAGE_ROLES and all_cleared,
        "canSettle": settling and role in FNF_MAKER,
        "canDisburse": settling and role in FNF_CHECKER and (sep.get("fnf") or {}).get("status") == "SETTLEMENT_PREPARED"
                       and (sep.get("fnf") or {}).get("preparedByUserId") != user.get("_id"),
        "pendingAssets": pending_assets(sep.get("employeeId") or ""),
    }


# ------------------------------------------------------------- F&F figures

def _days_in_month(d: date) -> int:
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return (nxt - date(d.year, d.month, 1)).days


def suggest_settlement(sep: dict) -> dict:
    """Suggested F&F figures from salary, leave balance and service, with how each was worked out.
    They are a starting point; Finance can change every figure before saving."""
    emp = db_store.employees.get(sep.get("employeeId") or "") or {}
    ctc = num(emp.get("annualSalary")) or 0
    lwd = date.fromisoformat(sep["lastWorkingDay"])
    if ctc <= 0:
        return {"components": None, "basis": ["No annual salary on the employee record, so figures can't be suggested."]}
    s = compute_salary_structure(ctc)
    gross_m = float(s["totalGross"]["monthly"])
    basic_m = float(next(w["monthly"] for w in s["wages"] if w["key"] == "basic"))
    dim = _days_in_month(lwd)

    unpaid = gross_m / dim * lwd.day
    el = modules_store.get_leave_balance(emp["_id"]).get("earned", {}) if emp else {}
    el_days = max(0, int(num(el.get("remaining")) or 0))
    encash = el_days * basic_m / 26

    basis = [
        f"Unpaid salary: monthly gross ₹{gross_m:,.0f} ÷ {dim} days × {lwd.day} days worked in {lwd.strftime('%B %Y')}.",
        f"Leave encashment: {el_days} earned-leave days × monthly basic ₹{basic_m:,.0f} ÷ 26.",
    ]
    gratuity = 0.0
    try:
        joined = date.fromisoformat(js_str(emp.get("joiningDate") or "")[:10])
        service_days = (lwd - joined).days
        years = service_days / 365.25
        completed = int(years) + (1 if years - int(years) >= 0.5 else 0)
        if service_days >= 4 * 365 + 240:  # 5 years; courts accept 4 years 240 days
            gratuity = min(15 * basic_m * completed / 26, 2_000_000)
            basis.append(f"Gratuity: 15 × monthly basic ₹{basic_m:,.0f} × {completed} years ÷ 26 (capped at ₹20,00,000).")
        else:
            basis.append(f"Gratuity: not payable — {years:.1f} years of service, under the 5-year minimum.")
    except ValueError:
        basis.append("Gratuity: not worked out — no joining date on the employee record.")

    shortfall = max(0, int(sep.get("noticePeriodDays") or 0) - int(sep.get("noticeServedDays") or 0))
    notice = shortfall * gross_m / 30
    basis.append(f"Notice shortfall recovery: {shortfall} days × monthly gross ₹{gross_m:,.0f} ÷ 30.")

    # Approved asset recoveries and loan balances are recovered from the F&F
    recovery = sum((a.get("recovery") or {}).get("amount") or 0 for a in modules_store.assets.values()
                   if (a.get("recovery") or {}).get("employeeId") == emp.get("_id") and (a.get("recovery") or {}).get("status") == "APPROVED"
                   and not (a.get("recovery") or {}).get("recoveredInPayroll"))
    if recovery:
        basis.append(f"Asset recovery: ₹{recovery:,.0f} approved by Finance for lost / damaged assets.")
    from app.routes.finance import _loan_view
    loan_due = sum(max(0, _loan_view(l)["outstanding"]) for l in modules_store.loans.values() if l["employeeId"] == emp.get("_id"))
    if loan_due:
        basis.append(f"Loan / advance outstanding: ₹{loan_due:,.0f} recovered in full.")
    comps = {
        "unpaidSalary": round(unpaid), "leaveEncashmentDays": el_days, "leaveEncashmentAmount": round(encash),
        "gratuity": round(gratuity), "bonusOrIncentive": 0, "noticePayShortfallDeduction": round(notice),
        "assetRecovery": round(recovery), "loanRecovery": round(loan_due), "otherDeductions": 0,
    }
    comps["totalPayable"] = _total(comps)
    return {"components": comps, "basis": basis}


def _total(c: dict) -> int:
    earnings = c["unpaidSalary"] + c["leaveEncashmentAmount"] + c["gratuity"] + c["bonusOrIncentive"]
    return round(earnings - c["noticePayShortfallDeduction"] - c.get("otherDeductions", 0) - c.get("assetRecovery", 0) - c.get("loanRecovery", 0))


def _lifecycle(record: dict, effective: str, previous: str, new: str, reason: str, by: dict, source_id: str) -> None:
    """Add a separation milestone to the employee's Lifecycle timeline."""
    event = db_store.create_lifecycle_event({
        "employeeId": record.get("employeeId"), "employeeName": record.get("employeeName"),
        "employeeCode": record.get("employeeCode"), "department": record.get("department"),
        "eventType": "SEPARATION", "effectiveDate": effective, "previousValue": previous, "newValue": new,
        "reason": reason, "initiatedBy": f"{_name(by) or by.get('email')} ({by.get('role')})",
        "approvalStatus": "APPROVED", "sourceId": source_id,
    })
    event["_id"] = f"lc_sep_{now_ms()}_{rand_base36(6)}"  # several can be written in one request


# ------------------------------------------------------ leaver deactivation

def deactivate_due_exits(today: Optional[str] = None) -> list:
    """After the last working day of an approved exit: employee -> EXITED and their login disabled."""
    today = today or today_str()
    done = []
    for sep in modules_store.fullFinalSettlements.values():
        if sep.get("status") not in APPROVED or (sep.get("lastWorkingDay") or "9999") >= today:
            continue
        emp = db_store.employees.get(sep.get("employeeId") or "")
        if not emp or emp.get("status") == "EXITED":
            continue
        emp["status"] = "EXITED"
        emp["exitedOn"] = sep["lastWorkingDay"]
        emp["exitId"] = sep["_id"]
        user = _user_for_employee(emp["_id"])
        if user:
            user["isActive"] = False
            user["deactivatedOn"] = now_iso()
        sep["employeeDeactivatedOn"] = now_iso()
        audit(SYSTEM_ACTOR, "EMPLOYEE_EXITED", "EXIT", "Employee", emp["_id"], {
            "field": "status", "old": "ACTIVE", "new": "EXITED", "lastWorkingDay": sep["lastWorkingDay"],
            "loginDisabled": bool(user),
        })
        _lifecycle(sep, sep["lastWorkingDay"], "Active", "Exited (login disabled)",
                   "Last working day completed", SYSTEM_ACTOR, sep["_id"])
        done.append(emp["_id"])
    return done


def _with_permissions(sep: dict, user: dict) -> dict:
    return {**sep, "permissions": _permissions(sep, user)}


# ------------------------------------------------------- employee: resignation

@router.get("/resignations/me")
async def my_resignation(user: dict = Depends(require_auth)):
    emp = db_store.employees.get(user.get("employeeId") or "")
    if not emp:
        return {"employee": None, "resignation": None, "exit": None}
    mine = sorted((r for r in modules_store.resignations.values() if r.get("employeeId") == emp["_id"]),
                  key=lambda r: r.get("submittedOn") or "", reverse=True)
    exit_ = sorted((s for s in modules_store.fullFinalSettlements.values() if s.get("employeeId") == emp["_id"]),
                   key=lambda s: s.get("initiatedOn") or s.get("resignationDate") or "", reverse=True)
    manager = db_store.employees.get(emp.get("reportingManagerId") or "")
    latest_exit = exit_[0] if exit_ else None
    return {
        "employee": {"_id": emp["_id"], "name": _name(emp), "employeeCode": emp.get("employeeCode"),
                     "department": emp.get("department"), "managerName": _name(manager) or None},
        "resignation": mine[0] if mine else None,
        # Employees see their exit's progress, not settlement amounts
        "exit": {k: latest_exit.get(k) for k in (
            "_id", "status", "separationType", "resignationDate", "lastWorkingDay", "noticePeriodDays",
            "noticeServedDays", "clearances", "initiatedOn", "exitApprovedOn", "fnf")} if latest_exit else None,
        "canResign": emp.get("status") not in INACTIVE and not _open_resignation(emp["_id"]) and not _open_exit(emp["_id"]),
    }


@router.post("/resignations")
async def submit_resignation(request: Request, user: dict = Depends(require_auth)):
    emp = db_store.employees.get(user.get("employeeId") or "")
    if not emp:
        raise ApiError(403, "Only employees can submit a resignation.")
    if emp.get("status") in INACTIVE:
        raise ApiError(400, "Your employee record is not active.")
    if _open_resignation(emp["_id"]):
        raise ApiError(409, "You already have a resignation waiting for HR.")
    if _open_exit(emp["_id"]):
        raise ApiError(409, "Your exit is already in progress.")

    body = await read_body(request)
    reason = js_str(body.get("reason") or "").strip()
    if not reason:
        raise ApiError(400, "Please give a reason for resigning.")
    if len(reason) > 2000:
        raise ApiError(400, "Keep the reason under 2000 characters.")
    try:
        proposed = date.fromisoformat(js_str(body.get("proposedLastWorkingDay") or ""))
    except ValueError:
        raise ApiError(400, "Choose your proposed last working day.")
    today = date.fromisoformat(today_str())
    if proposed < today:
        raise ApiError(400, "The last working day can't be in the past.")

    manager = db_store.employees.get(emp.get("reportingManagerId") or "")
    rid = f"resig_{now_ms()}_{rand_base36(5)}"
    resignation = {
        "_id": rid, "employeeId": emp["_id"], "employeeName": _name(emp), "employeeCode": emp.get("employeeCode") or "",
        "department": emp.get("department") or "", "designation": emp.get("designation") or "",
        "managerId": manager["_id"] if manager else None, "managerName": _name(manager) or None,
        "submittedOn": now_iso(), "noticeDate": today.isoformat(), "proposedLastWorkingDay": proposed.isoformat(),
        "reason": reason, "status": "SUBMITTED", "exitId": None,
    }
    modules_store.resignations[rid] = resignation

    hr = [_recipient(u) for u in _hr_users()]
    mgr = _recipient(_user_for_employee(manager["_id"]), manager) if manager else None
    recipients = [r for r in hr + [mgr] if r]
    subject = f"Resignation submitted: {resignation['employeeName']} ({resignation['employeeCode']})"
    rows = [("Employee", f"{resignation['employeeName']} ({resignation['employeeCode']})"),
            ("Department", resignation["department"]), ("Designation", resignation["designation"]),
            ("Reporting manager", resignation["managerName"]), ("Resignation date", resignation["noticeDate"]),
            ("Proposed last working day", resignation["proposedLastWorkingDay"]), ("Reason", reason)]
    mail = await _email(recipients, subject, f"{resignation['employeeName']} has submitted their resignation.", rows)
    _notify([r.get("userId") for r in recipients], "Resignation submitted",
            f"{resignation['employeeName']} resigned. Proposed last working day: {resignation['proposedLastWorkingDay']}.")
    resignation["notified"] = {"emails": [m["email"] for m in mail], "on": now_iso()}
    _lifecycle(resignation, resignation["noticeDate"], "Active",
               f"Resignation submitted (proposed last day {resignation['proposedLastWorkingDay']})", reason, user, rid)
    audit(user, "RESIGNATION_SUBMITTED", "EXIT", "Resignation", rid,
          {"employeeCode": resignation["employeeCode"], "proposedLastWorkingDay": resignation["proposedLastWorkingDay"],
           "notified": len(mail)})
    return JSONResponse({"success": True, "resignation": resignation, "emails": mail}, status_code=201)


@router.post("/resignations/{rid}/withdraw")
async def withdraw_resignation(rid: str, user: dict = Depends(require_auth)):
    r = modules_store.resignations.get(rid)
    if not r or r.get("employeeId") != user.get("employeeId"):
        raise ApiError(404, "Resignation not found.")
    if r.get("status") != "SUBMITTED":
        raise ApiError(400, "This resignation can no longer be withdrawn; HR has already started your exit.")
    r["status"] = "WITHDRAWN"
    r["withdrawnOn"] = now_iso()
    mgr_user = _user_for_employee(r.get("managerId"))
    _notify([u["_id"] for u in _hr_users()] + [(mgr_user or {}).get("_id")], "Resignation withdrawn",
            f"{r['employeeName']} withdrew their resignation.")
    _lifecycle(r, today_str(), "Resignation submitted", "Resignation withdrawn", "Withdrawn by the employee", user, rid)
    audit(user, "RESIGNATION_WITHDRAWN", "EXIT", "Resignation", rid, {"employeeCode": r.get("employeeCode")})
    return {"success": True, "resignation": r}


# ------------------------------------------------------------- HR: exits

@router.get("/resignations")
async def list_resignations(_: dict = Depends(require_role(*EXIT_VIEW_ROLES))):
    rows = sorted(modules_store.resignations.values(), key=lambda r: r.get("submittedOn") or "", reverse=True)
    return {"resignations": rows}


@router.get("/full-final")
async def full_final(user: dict = Depends(require_role(*EXIT_VIEW_ROLES))):
    deactivate_due_exits()
    return {
        "settlements": [_with_permissions(s, user) for s in modules_store.get_full_final_settlements()],
        "canInitiate": user.get("role") in EXIT_MANAGE_ROLES,
        "pendingResignations": sum(1 for r in modules_store.resignations.values() if r.get("status") == "SUBMITTED"),
    }


@router.post("/full-final")
async def initiate_exit(request: Request, user: dict = Depends(require_role(*EXIT_MANAGE_ROLES))):
    """Start an employee's exit (optionally from their resignation): first stage, every clearance pending."""
    body = await read_body(request)
    emp = db_store.employees.get(js_str(body.get("employeeId") or ""))
    if not emp:
        raise ApiError(400, "Choose the employee who is leaving.")
    if emp.get("status") in INACTIVE:
        raise ApiError(400, "This employee is not active.")
    if _open_exit(emp["_id"]):
        raise ApiError(409, "An exit is already in progress for this employee.")

    resignation = None
    if body.get("resignationId"):
        resignation = modules_store.resignations.get(js_str(body["resignationId"]))
        if not resignation or resignation.get("employeeId") != emp["_id"]:
            raise ApiError(400, "That resignation doesn't belong to this employee.")
        if resignation.get("status") != "SUBMITTED":
            raise ApiError(409, "That resignation has already been handled.")

    separation_type = js_str(body.get("separationType") or "RESIGNATION").upper()
    if separation_type not in SEPARATION_TYPES:
        raise ApiError(400, "Choose a valid separation type.")
    try:
        notice_date = date.fromisoformat(js_str(body.get("resignationDate") or today_str()))
        last_day = date.fromisoformat(js_str(body.get("lastWorkingDay") or ""))
    except ValueError:
        raise ApiError(400, "Enter the notice date and last working day as valid dates.")
    if last_day < notice_date:
        raise ApiError(400, "The last working day can't be before the notice date.")
    raw_notice = body.get("noticePeriodDays")
    notice_days = None if raw_notice in (None, "") else num(raw_notice)
    if notice_days is None or not 0 <= notice_days <= 365:
        raise ApiError(400, "Notice period must be between 0 and 365 days.")
    notice_days = int(notice_days)
    reason = js_str(body.get("reason") or "").strip()
    if len(reason) > 2000:
        raise ApiError(400, "Keep the reason under 2000 characters.")

    sep_id = f"fnf_{now_ms()}_{rand_base36(5)}"
    pending = {"cleared": False, "remarks": "", "clearedBy": ""}
    separation = {
        "_id": sep_id,
        "employeeId": emp["_id"],
        "employeeName": _name(emp),
        "employeeCode": emp.get("employeeCode") or "",
        "department": emp.get("department") or "",
        "separationType": separation_type,
        "resignationId": (resignation or {}).get("_id"),
        "resignationDate": notice_date.isoformat(),
        "lastWorkingDay": last_day.isoformat(),
        "noticePeriodDays": notice_days,
        # Days of notice that will be served by the last working day
        "noticeServedDays": min(notice_days, (last_day - notice_date).days),
        "status": "INITIATED",
        "clearances": {k: dict(pending) for k in CLEARANCE_KEYS},
        "settlementComponents": {
            "unpaidSalary": 0, "leaveEncashmentDays": 0, "leaveEncashmentAmount": 0, "gratuity": 0,
            "noticePayShortfallDeduction": 0, "bonusOrIncentive": 0, "totalPayable": 0,
        },
        "notes": reason,
        "initiatedBy": _name(user) or user.get("email"),
        "initiatedOn": now_iso(),
    }
    modules_store.fullFinalSettlements[sep_id] = separation
    # Payroll prorates the last month and stops paying after this date
    emp["lastWorkingDay"] = separation["lastWorkingDay"]
    # Group insurance ends on the last working day (insurer deletion list picks it up)
    from app.routes.benefits import end_coverage
    end_coverage(emp["_id"], separation["lastWorkingDay"], user)
    if resignation:
        resignation["status"] = "EXIT_INITIATED"
        resignation["exitId"] = sep_id
        resignation["exitInitiatedOn"] = separation["initiatedOn"]
    emp_user = _user_for_employee(emp["_id"])
    _notify([(emp_user or {}).get("_id")], "Exit process started",
            f"HR has started your exit. Last working day: {separation['lastWorkingDay']}.")
    _lifecycle(separation, separation["resignationDate"], "Resignation submitted" if resignation else "Active",
               f"Exit initiated: {separation_type.replace('_', ' ').title()}, last day {separation['lastWorkingDay']}",
               reason or "Exit initiated by HR", user, sep_id)
    audit(user, "EXIT_INITIATED", "EXIT", "Separation", sep_id, {
        "employeeCode": separation["employeeCode"], "separationType": separation_type,
        "lastWorkingDay": separation["lastWorkingDay"], "resignationId": separation["resignationId"],
    })
    return JSONResponse({"success": True, "settlement": _with_permissions(separation, user)}, status_code=201)


@router.put("/full-final/{sep_id}/clearances/{key}")
async def set_clearance(sep_id: str, key: str, request: Request, user: dict = Depends(require_role(*EXIT_VIEW_ROLES))):
    sep = modules_store.fullFinalSettlements.get(sep_id)
    if not sep:
        raise ApiError(404, "Exit record not found.")
    if key not in CLEARANCE_KEYS:
        raise ApiError(404, "Unknown clearance.")
    if key not in _permissions(sep, user)["canClear"]:
        raise ApiError(403, "You can't change this clearance." if sep.get("status") not in APPROVED
                       else "This exit has already been approved.")
    body = await read_body(request)
    cleared = bool(body.get("cleared", True))
    remarks = js_str(body.get("remarks") or "").strip()
    if cleared and not remarks:
        raise ApiError(400, "Add a remark, e.g. what was handed over or returned.")
    if cleared and key == "itAssets":
        from app.routes.assets import pending_assets
        pending = pending_assets(sep.get("employeeId") or "")
        if pending:
            raise ApiError(400, "Assets still with the employee: " + ", ".join(f"{a['assetTag']} ({a['name']})" for a in pending)
                           + ". Return them or get a recovery approved by Finance first.", pendingAssets=pending)
    old = dict(sep["clearances"].get(key) or {})
    sep["clearances"][key] = {"cleared": cleared, "remarks": remarks,
                              "clearedBy": (_name(user) or user.get("email")) if cleared else "",
                              "clearedOn": now_iso() if cleared else None}
    sep["status"] = _derive_status(sep)
    audit(user, "EXIT_CLEARANCE_" + ("GIVEN" if cleared else "REOPENED"), "EXIT", "Separation", sep_id,
          {"field": f"clearances.{key}", "old": old.get("cleared", False), "new": cleared, "reason": remarks})
    return {"success": True, "settlement": _with_permissions(sep, user)}


@router.post("/full-final/{sep_id}/approve")
async def approve_exit(sep_id: str, request: Request, user: dict = Depends(require_role(*EXIT_MANAGE_ROLES))):
    """Final exit approval: requires every clearance, then starts Full & Final settlement."""
    sep = modules_store.fullFinalSettlements.get(sep_id)
    if not sep:
        raise ApiError(404, "Exit record not found.")
    if sep.get("status") in APPROVED:
        raise ApiError(409, "This exit has already been approved.")
    pending = [CLEARANCE_LABELS[k] for k in CLEARANCE_KEYS if not sep["clearances"].get(k, {}).get("cleared")]
    if pending:
        raise ApiError(400, "Clear these first: " + ", ".join(pending) + ".")
    from app.routes.assets import pending_assets
    if pending_assets(sep.get("employeeId") or ""):
        raise ApiError(400, "The employee still holds company assets; F&F cannot start until they are returned or recovered.")
    comment = js_str((await read_body(request)).get("comment") or "").strip()
    approver = _name(user) or user.get("email")
    now = now_iso()
    sep["status"] = "HR_APPROVED"
    sep["exitApprovedBy"] = approver
    sep["exitApprovedOn"] = now
    sep["exitApprovalComment"] = comment
    sep["fnf"] = {"status": "INITIATED", "initiatedOn": now, "initiatedBy": approver}

    finance = [_recipient(u) for u in _users_with_roles("FINANCE", "ACCOUNTS") + _hr_users()]
    subject = f"F&F initiated: {sep['employeeName']} ({sep['employeeCode']})"
    rows = [("Employee", f"{sep['employeeName']} ({sep['employeeCode']})"), ("Department", sep.get("department")),
            ("Last working day", sep.get("lastWorkingDay")),
            ("Notice served", f"{sep.get('noticeServedDays')} of {sep.get('noticePeriodDays')} days"),
            ("Exit approved by", approver), ("Comment", comment)]
    mail = await _email([r for r in finance if r], subject,
                        f"The exit of {sep['employeeName']} has received final approval. Full & Final settlement can now be prepared.", rows)
    emp_user = _user_for_employee(sep.get("employeeId"))
    _notify([r.get("userId") for r in finance if r], "F&F initiated",
            f"Exit of {sep['employeeName']} approved. Prepare the Full & Final settlement.")
    _notify([(emp_user or {}).get("_id")], "Exit approved",
            "Your exit has been approved and your Full & Final settlement has started.")
    _lifecycle(sep, today_str(), "Clearances complete", "Exit approved, F&F initiated", comment or "Final approval", user, sep_id)
    audit(user, "EXIT_APPROVED_FNF_INITIATED", "EXIT", "Separation", sep_id,
          {"field": "status", "old": "FINANCE_CLEARANCE", "new": "HR_APPROVED", "reason": comment, "notified": len(mail)})
    deactivate_due_exits()  # last working day may already be past
    return {"success": True, "settlement": _with_permissions(sep, user), "emails": mail}


# ------------------------------------------------------------- F&F settlement

def _settling(sep_id: str, user: dict) -> dict:
    sep = modules_store.fullFinalSettlements.get(sep_id)
    if not sep:
        raise ApiError(404, "Exit record not found.")
    if sep.get("status") == "DISBURSED":
        raise ApiError(409, "This settlement has already been paid.")
    if sep.get("status") != "HR_APPROVED":
        raise ApiError(400, "The F&F settlement starts after the exit's final approval.")
    return sep


@router.get("/full-final/{sep_id}/settlement-suggestion")
async def settlement_suggestion(sep_id: str, user: dict = Depends(require_role(*SETTLEMENT_ROLES, "AUDITORS"))):
    return suggest_settlement(_settling(sep_id, user))


@router.put("/full-final/{sep_id}/settlement")
async def save_settlement(sep_id: str, request: Request, user: dict = Depends(require_role(*FNF_MAKER))):
    sep = _settling(sep_id, user)
    from app.routes.assets import pending_assets
    if pending_assets(sep.get("employeeId") or ""):
        raise ApiError(400, "F&F is blocked: the employee still holds company assets. Return them or approve a recovery first.")
    body = await read_body(request)
    comps = {}
    for key in ("unpaidSalary", "leaveEncashmentDays", "leaveEncashmentAmount", "gratuity", "bonusOrIncentive",
                "noticePayShortfallDeduction", "assetRecovery", "loanRecovery", "otherDeductions"):
        raw = body.get(key)
        value = 0 if raw in (None, "") else num(raw)
        if value is None or value < 0:
            raise ApiError(400, "Every amount must be a number of 0 or more.")
        comps[key] = round(value) if key != "leaveEncashmentDays" else int(value)
    comps["totalPayable"] = _total(comps)
    note = js_str(body.get("otherDeductionsNote") or "").strip()
    if comps["otherDeductions"] and not note:
        raise ApiError(400, "Say what the other deductions are for.")
    old = dict(sep.get("settlementComponents") or {})
    sep["settlementComponents"] = {**comps, "otherDeductionsNote": note}
    sep["fnf"] = {**(sep.get("fnf") or {}), "status": "SETTLEMENT_PREPARED",
                  "preparedBy": _name(user) or user.get("email"), "preparedByUserId": user["_id"], "preparedOn": now_iso()}
    # recoveries settled in F&F must not also be deducted in a later payroll
    from app.utils.workflow import cancel_payroll_inputs
    for a in modules_store.assets.values():
        rec = a.get("recovery") or {}
        if rec.get("employeeId") == sep.get("employeeId") and rec.get("status") == "APPROVED" and comps.get("assetRecovery"):
            cancel_payroll_inputs(f"asset:{a['_id']}")
            rec["settledInFnf"] = sep_id
    audit(user, "FNF_SETTLEMENT_PREPARED", "EXIT", "Separation", sep_id, {
        "changes": [{"field": k, "old": old.get(k), "new": v} for k, v in comps.items() if old.get(k) != v],
    })
    return {"success": True, "settlement": _with_permissions(sep, user)}


@router.post("/full-final/{sep_id}/disburse")
async def disburse_settlement(sep_id: str, request: Request, user: dict = Depends(require_role(*FNF_CHECKER))):
    sep = _settling(sep_id, user)
    if (sep.get("fnf") or {}).get("preparedByUserId") == user["_id"]:
        raise ApiError(403, "Maker-checker: the person who prepared the settlement cannot also pay it.")
    if (sep.get("fnf") or {}).get("status") != "SETTLEMENT_PREPARED":
        raise ApiError(400, "Save the settlement figures before marking it as paid.")
    body = await read_body(request)
    reference = js_str(body.get("paymentReference") or "").strip()
    if not reference:
        raise ApiError(400, "Enter the payment reference (e.g. bank transaction ID).")
    try:
        paid_on = date.fromisoformat(js_str(body.get("paidOn") or today_str())).isoformat()
    except ValueError:
        raise ApiError(400, "Enter the payment date as a valid date.")
    payer = _name(user) or user.get("email")
    sep["status"] = "DISBURSED"
    sep["fnf"] = {**sep["fnf"], "status": "PAID", "paidOn": paid_on, "paymentReference": reference,
                  "paidBy": payer, "markedPaidOn": now_iso()}

    emp = db_store.employees.get(sep.get("employeeId") or "") or {}
    emp_user = _user_for_employee(emp.get("_id"))
    # The leaver may already have lost their login, so prefer a personal address
    emp_email = emp.get("personalEmail") or (emp_user or {}).get("email") or emp.get("workEmail")
    total = sep["settlementComponents"]["totalPayable"]
    mail = await _email(
        [{"name": sep["employeeName"], "email": emp_email}],
        "Your Full & Final settlement has been paid",
        "Your Full & Final settlement has been processed.",
        [("Net amount", f"₹{total:,}"), ("Paid on", paid_on), ("Payment reference", reference)],
    ) if emp_email else []
    _notify([u["_id"] for u in _hr_users()], "F&F paid", f"F&F of {sep['employeeName']} paid (₹{total:,}).")
    _lifecycle(sep, paid_on, "F&F initiated", "F&F settled", "Full & Final settlement paid", user, sep_id)
    audit(user, "FNF_DISBURSED", "EXIT", "Separation", sep_id, {
        "field": "status", "old": "HR_APPROVED", "new": "DISBURSED", "amount": total, "paymentReference": reference,
    })
    deactivate_due_exits()
    return {"success": True, "settlement": _with_permissions(sep, user), "emails": mail}


@router.get("/exits/cron")
async def exits_cron(request: Request):
    """Daily Vercel Cron (backend/vercel.json): deactivate employees whose last working day has passed."""
    secret = os.environ.get("CRON_SECRET") or ""
    if not secret or request.headers.get("authorization") != f"Bearer {secret}":
        raise ApiError(401, "Not authorised.")
    return {"deactivated": deactivate_due_exits()}
