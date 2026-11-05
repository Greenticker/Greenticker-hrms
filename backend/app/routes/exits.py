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

router = APIRouter()

# Official role matrix, Exit Management module (app/auth/module_access.py)
EXIT_VIEW_ROLES = read_roles("exit_mgmt")
EXIT_MANAGE_ROLES = write_roles("exit_mgmt")
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
    return {"canClear": keys if open_ else [], "canApprove": open_ and role in EXIT_MANAGE_ROLES and all_cleared}


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
    audit(user, "RESIGNATION_WITHDRAWN", "EXIT", "Resignation", rid, {"employeeCode": r.get("employeeCode")})
    return {"success": True, "resignation": r}


# ------------------------------------------------------------- HR: exits

@router.get("/resignations")
async def list_resignations(_: dict = Depends(require_role(*EXIT_VIEW_ROLES))):
    rows = sorted(modules_store.resignations.values(), key=lambda r: r.get("submittedOn") or "", reverse=True)
    return {"resignations": rows}


@router.get("/full-final")
async def full_final(user: dict = Depends(require_role(*EXIT_VIEW_ROLES))):
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
    if resignation:
        resignation["status"] = "EXIT_INITIATED"
        resignation["exitId"] = sep_id
        resignation["exitInitiatedOn"] = separation["initiatedOn"]
    emp_user = _user_for_employee(emp["_id"])
    _notify([(emp_user or {}).get("_id")], "Exit process started",
            f"HR has started your exit. Last working day: {separation['lastWorkingDay']}.")
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
    audit(user, "EXIT_APPROVED_FNF_INITIATED", "EXIT", "Separation", sep_id,
          {"field": "status", "old": "FINANCE_CLEARANCE", "new": "HR_APPROVED", "reason": comment, "notified": len(mail)})
    return {"success": True, "settlement": _with_permissions(sep, user), "emails": mail}
