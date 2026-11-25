"""Reports and audit.

Standard reports (headcount, attrition, joiners / leavers, leave, attendance, payroll register,
payroll cost, own statement) scoped by role: HR and Auditors everything, Managers their team,
employees only their own statement, Finance / Accounts the payroll reports. Exports apply the same
scope and mask sensitive fields for roles that may not see them; every export is logged. Bulk
salary / PII exports are restricted to HR and Finance.

The audit trail (old / new value, user, time, IP) and login history are read-only for everyone;
Auditors sign off reviews of the log (independent reviewer)."""

import csv
import io
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.services.mailer import send_mail
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.workflow import actor_name, is_in_team, my_employee_id

router = APIRouter()

ALL_SCOPE = ("HR", "AUDITORS", "SUPER_ADMIN", "ADMIN")
INACTIVE = ("EXITED", "TERMINATED", "INACTIVE")

# report -> roles allowed ("TEAM" = managers see their team)
REPORTS = {
    "headcount": {"title": "Headcount", "roles": ALL_SCOPE + ("ADMIN_1", "ADMIN_2", "FINANCE", "TEAM")},
    "attrition": {"title": "Attrition", "roles": ALL_SCOPE + ("ADMIN_1",)},
    "joiners-leavers": {"title": "Joiners and leavers", "roles": ALL_SCOPE + ("ADMIN_1", "TEAM")},
    "leave": {"title": "Leave summary", "roles": ALL_SCOPE + ("ADMIN_1", "TEAM")},
    "attendance": {"title": "Attendance summary", "roles": ALL_SCOPE + ("ADMIN_1", "FINANCE", "TEAM")},
    "payroll-register": {"title": "Payroll register", "roles": ("HR", "FINANCE", "AUDITORS")},
    "payroll-cost": {"title": "Payroll cost by department", "roles": ("HR", "FINANCE", "ACCOUNTS", "AUDITORS")},
    "employee-master": {"title": "Employee master (PII)", "roles": ALL_SCOPE + ("ADMIN_1", "ADMIN_2", "FINANCE")},
    "my-statement": {"title": "My statement", "roles": ("*",)},
}
SALARY_ROLES = ("HR", "FINANCE", "AUDITORS")
PII_ROLES = ("HR", "FINANCE", "AUDITORS")
BULK_SENSITIVE_EXPORT = ("HR", "FINANCE")      # may export unmasked salary / PII in bulk


def _mask(v, keep: int = 4) -> str:
    v = js_str(v or "")
    return ("X" * max(0, len(v) - keep) + v[-keep:]) if v else ""


def _allowed(user: dict, key: str) -> str:
    """'' if not allowed, else the scope: ALL | TEAM | SELF."""
    conf = REPORTS.get(key)
    if not conf:
        raise ApiError(404, "Unknown report.")
    role = user.get("role")
    if "*" in conf["roles"]:
        return "SELF"
    if role in conf["roles"]:
        return "ALL"
    me = my_employee_id(user)
    if "TEAM" in conf["roles"] and me and any(is_in_team(me, e["_id"]) for e in db_store.employees.values()):
        return "TEAM"
    return ""


def _people(user: dict, scope: str, filters: dict) -> list:
    me = my_employee_id(user)
    rows = list(db_store.employees.values())
    if scope == "TEAM":
        rows = [e for e in rows if is_in_team(me, e["_id"])]
    elif scope == "SELF":
        rows = [e for e in rows if e["_id"] == me]
    for f in ("department", "location"):
        if filters.get(f):
            rows = [e for e in rows if (e.get(f) or "") == filters[f]]
    if filters.get("status"):
        rows = [e for e in rows if (e.get("status") or "ACTIVE") == filters["status"]]
    return rows


def _period(filters: dict) -> tuple:
    frm = filters.get("from") or f"{today_str()[:4]}-01-01"
    to = filters.get("to") or today_str()
    return frm, to


def build(user: dict, key: str, filters: dict) -> dict:
    scope = _allowed(user, key)
    if not scope:
        raise ApiError(403, "Access denied: this report is not available for your role.")
    people = _people(user, scope, filters)
    frm, to = _period(filters)
    cols: list
    rows: list = []
    if key == "headcount":
        groups: dict = {}
        by = filters.get("groupBy") or "department"
        for e in people:
            if (e.get("status") or "ACTIVE") in INACTIVE:
                continue
            g = groups.setdefault(e.get(by) or "Unassigned", {"group": e.get(by) or "Unassigned", "headcount": 0, "male": 0, "female": 0, "other": 0})
            g["headcount"] += 1
            gender = (e.get("gender") or "").lower()
            g["male" if gender == "male" else "female" if gender == "female" else "other"] += 1
        cols = ["group", "headcount", "male", "female", "other"]
        rows = sorted(groups.values(), key=lambda r: r["group"])
    elif key == "attrition":
        active_start = [e for e in people if (e.get("joiningDate") or "9999") <= frm and ((e.get("exitedOn") or e.get("lastWorkingDay") or "9999") >= frm)]
        leavers = [e for e in people if frm <= (e.get("exitedOn") or e.get("lastWorkingDay") or "") <= to]
        active_end = [e for e in people if (e.get("joiningDate") or "9999") <= to and (e.get("exitedOn") or "9999") > to]
        avg = (len(active_start) + len(active_end)) / 2 or 1
        cols = ["metric", "value"]
        rows = [{"metric": "Headcount at start", "value": len(active_start)}, {"metric": "Headcount at end", "value": len(active_end)},
                {"metric": "Leavers", "value": len(leavers)}, {"metric": "Attrition %", "value": round(len(leavers) / avg * 100, 2)}]
    elif key == "joiners-leavers":
        cols = ["employeeCode", "name", "department", "type", "date"]
        for e in people:
            if frm <= (e.get("joiningDate") or "")[:10] <= to:
                rows.append({"employeeCode": e.get("employeeCode"), "name": f"{e.get('firstName')} {e.get('lastName')}", "department": e.get("department"),
                             "type": "JOINER", "date": e["joiningDate"][:10]})
            lwd = (e.get("exitedOn") or e.get("lastWorkingDay") or "")[:10]
            if lwd and frm <= lwd <= to:
                rows.append({"employeeCode": e.get("employeeCode"), "name": f"{e.get('firstName')} {e.get('lastName')}", "department": e.get("department"),
                             "type": "LEAVER", "date": lwd})
        rows.sort(key=lambda r: r["date"])
    elif key == "leave":
        ids = {e["_id"] for e in people}
        agg: dict = {}
        for r in modules_store.leaveRequests.values():
            if r.get("employeeId") not in ids or not (frm <= (r.get("startDate") or "")[:10] <= to):
                continue
            a = agg.setdefault(r["employeeId"], {"employeeCode": r.get("employeeCode"), "name": r.get("employeeName"), "approvedDays": 0.0,
                                                 "pendingDays": 0.0, "lopDays": 0.0, "requests": 0})
            a["requests"] += 1
            days = float(r.get("daysCount") or r.get("days") or 0)
            if r.get("status") == "APPROVED":
                a["approvedDays"] += days
                a["lopDays"] += float(r.get("lopDays") or 0)
            elif r.get("status") == "PENDING":
                a["pendingDays"] += days
        cols = ["employeeCode", "name", "requests", "approvedDays", "pendingDays", "lopDays"]
        rows = sorted(agg.values(), key=lambda r: r["employeeCode"] or "")
    elif key == "attendance":
        from app.routes.attendance_mgmt import summarise
        month = filters.get("month") or today_str()[:7]
        cols = ["employeeCode", "employeeName", "workingDays", "presentDays", "leaveDays", "absentDays", "lateMarks", "lopDays"]
        rows = [summarise(e, month) for e in people if (e.get("status") or "ACTIVE") not in INACTIVE]
    elif key in ("payroll-register", "payroll-cost"):
        month = filters.get("month") or today_str()[:7]
        ids = {e["_id"] for e in people}
        slips = [p for p in modules_store.payslips.values() if p.get("month") == month and p.get("status") in ("APPROVED", "PAID") and p["employeeId"] in ids]
        if key == "payroll-register":
            cols = ["employeeCode", "employeeName", "department", "workedDays", "grossSalary", "providentFund", "tds", "totalDeductions", "netSalary"]
            rows = [{c: p.get(c) for c in cols} for p in sorted(slips, key=lambda p: p.get("employeeCode") or "")]
        else:
            agg = {}
            for p in slips:
                d = agg.setdefault(p.get("department") or "Unassigned", {"department": p.get("department") or "Unassigned", "headcount": 0, "gross": 0.0,
                                                                        "employerCost": 0.0, "net": 0.0})
                d["headcount"] += 1
                d["gross"] += p.get("grossSalary") or 0
                d["net"] += p.get("netSalary") or 0
                d["employerCost"] += sum(c["amount"] for c in p.get("employerContributions") or [])
            cols = ["department", "headcount", "gross", "employerCost", "net"]
            rows = [{**r, "gross": round(r["gross"], 2), "net": round(r["net"], 2), "employerCost": round(r["employerCost"], 2)} for r in agg.values()]
    elif key == "employee-master":
        cols = ["employeeCode", "name", "department", "designation", "location", "status", "joiningDate", "workEmail", "phone",
                "annualSalary", "bankAccount", "pan"]
        for e in people:
            st, bank = e.get("statutory") or {}, e.get("bankInfo") or {}
            rows.append({"employeeCode": e.get("employeeCode"), "name": f"{e.get('firstName')} {e.get('lastName')}", "department": e.get("department"),
                         "designation": e.get("designation"), "location": e.get("location"), "status": e.get("status"), "joiningDate": e.get("joiningDate"),
                         "workEmail": e.get("workEmail"), "phone": e.get("phone"), "annualSalary": e.get("annualSalary"),
                         "bankAccount": bank.get("accountNumber") or bank.get("accountNumberMasked"), "pan": st.get("panNumber") or st.get("panMasked")})
    elif key == "my-statement":
        me = my_employee_id(user)
        from app.routes.leave import balance_view
        cols = ["item", "detail"]
        rows = [{"item": f"Leave balance {b['code']}", "detail": f"{b.get('available')} available of {b.get('total')}"} for b in (balance_view(me) if me else [])]
        rows += [{"item": f"Payslip {p['monthName']}", "detail": f"Net ₹{p['netSalary']:,.2f}"} for p in modules_store.payslips.values()
                 if p.get("employeeId") == me and p.get("status") in ("APPROVED", "PAID")]
    else:
        raise ApiError(404, "Unknown report.")
    # masking by role
    role = user.get("role")
    masked = []
    if role not in SALARY_ROLES:
        for c in ("annualSalary", "grossSalary", "netSalary", "totalDeductions", "providentFund", "tds"):
            if c in cols:
                masked.append(c)
                for r in rows:
                    r[c] = "***"
    if role not in PII_ROLES:
        for c in ("bankAccount", "pan", "phone"):
            if c in cols:
                masked.append(c)
                for r in rows:
                    r[c] = _mask(r.get(c))
    return {"key": key, "title": REPORTS[key]["title"], "scope": scope, "columns": cols, "rows": rows, "masked": masked,
            "filters": {**filters, "from": frm, "to": to}, "generatedAt": now_iso()}


@router.get("/reports")
async def catalog(user: dict = Depends(require_auth)):
    return {"reports": [{"key": k, "title": v["title"], "scope": _allowed(user, k)} for k, v in REPORTS.items() if _allowed(user, k)]}


@router.get("/reports/{key}")
async def run_report(key: str, request: Request, user: dict = Depends(require_auth)):
    data = build(user, key, dict(request.query_params))
    audit(user, "REPORT_VIEWED", "REPORTS", "Report", key, {"scope": data["scope"], "rows": len(data["rows"])})
    return data


@router.get("/reports/{key}/export")
async def export_report(key: str, request: Request, user: dict = Depends(require_auth)):
    filters = dict(request.query_params)
    if key in ("employee-master", "payroll-register") and filters.get("unmasked") == "true" and user.get("role") not in BULK_SENSITIVE_EXPORT:
        audit(user, "BULK_EXPORT_DENIED", "REPORTS", "Report", key, {"filters": filters})
        raise ApiError(403, "Bulk export of salary / personal data is allowed only for HR and Finance.")
    data = build(user, key, filters)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(data["columns"])
    for r in data["rows"]:
        w.writerow([r.get(c) for c in data["columns"]])
    audit(user, "REPORT_EXPORTED", "REPORTS", "Report", key, {"scope": data["scope"], "rows": len(data["rows"]), "masked": data["masked"], "filters": filters})
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{key}_{today_str()}.csv"'})


# ------------------------------------------------------------------ scheduled reports

def _user_can_receive(u: dict, key: str) -> bool:
    return bool(u.get("isActive", True)) and bool(_allowed(u, key)) and REPORTS[key]["roles"] != ("*",)


@router.get("/reports-schedules")
async def list_schedules(user: dict = Depends(require_auth)):
    rows = [s for s in modules_store.reportSchedules.values() if s["ownerUserId"] == user["_id"] or user.get("role") in ("SUPER_ADMIN", "AUDITORS")]
    return {"schedules": sorted(rows, key=lambda s: s["createdAt"], reverse=True)}


@router.post("/reports-schedules")
async def create_schedule(request: Request, user: dict = Depends(require_auth)):
    b = await read_body(request)
    key = b.get("reportKey")
    if not _allowed(user, key or "") or key == "my-statement":
        raise ApiError(403, "You cannot schedule this report.")
    freq = (b.get("frequency") or "MONTHLY").upper()
    if freq not in ("DAILY", "WEEKLY", "MONTHLY"):
        raise ApiError(400, "Frequency must be DAILY, WEEKLY or MONTHLY.")
    recipients, rejected = [], []
    for r in b.get("recipients") or []:
        u = db_store.users.get(r) or db_store.find_user_by_email(js_str(r))
        if not u:
            rejected.append(f"{r}: not a user of the HRMS (reports are never sent outside)")
        elif not _user_can_receive(u, key):
            rejected.append(f"{u.get('email')}: not authorised to see this report")
        else:
            recipients.append(u["_id"])
    if rejected:
        raise ApiError(400, "Some recipients are not allowed.", errors=rejected)
    if not recipients:
        raise ApiError(400, "Add at least one recipient.")
    sid = f"rsch_{now_ms()}_{rand_base36(4)}"
    doc = {"_id": sid, "reportKey": key, "title": REPORTS[key]["title"], "frequency": freq, "filters": b.get("filters") or {},
           "recipientUserIds": recipients, "recipients": [db_store.users[r].get("email") for r in recipients], "ownerUserId": user["_id"],
           "owner": actor_name(user), "createdAt": now_iso(), "lastRunAt": None, "active": True}
    modules_store.reportSchedules[sid] = doc
    audit(user, "REPORT_SCHEDULED", "REPORTS", "ReportSchedule", sid, {"report": key, "recipients": doc["recipients"], "frequency": freq})
    return JSONResponse({"schedule": doc}, status_code=201)


async def _run_schedule(s: dict) -> list:
    owner = db_store.users.get(s["ownerUserId"])
    if not owner:
        return []
    results = []
    for uid in s["recipientUserIds"]:
        u = db_store.users.get(uid)
        if not u or not _user_can_receive(u, s["reportKey"]):
            results.append({"userId": uid, "sent": False, "reason": "no longer authorised"})
            continue
        data = build(u, s["reportKey"], s.get("filters") or {})   # each recipient gets their own scope / masking
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(data["columns"])
        for r in data["rows"]:
            w.writerow([r.get(c) for c in data["columns"]])
        res = await send_mail({"to": u.get("email"), "subject": f"Scheduled report: {s['title']}",
                               "html": f"<p>Attached: {s['title']} ({len(data['rows'])} rows, {data['scope'].lower()} scope).</p>",
                               "text": f"Attached: {s['title']}", "attachments": [{"filename": f"{s['reportKey']}_{today_str()}.csv", "content": out.getvalue().encode("utf-8"), "contentType": "text/csv"}]})
        results.append({"userId": uid, "email": u.get("email"), "sent": bool(res.get("delivered") or res.get("simulated")), "rows": len(data["rows"])})
    s["lastRunAt"] = now_iso()
    return results


@router.post("/reports-schedules/{sid}/run")
async def run_schedule(sid: str, user: dict = Depends(require_auth)):
    s = modules_store.reportSchedules.get(sid)
    if not s or (s["ownerUserId"] != user["_id"] and user.get("role") != "SUPER_ADMIN"):
        raise ApiError(404, "Schedule not found.")
    results = await _run_schedule(s)
    audit(user, "SCHEDULED_REPORT_SENT", "REPORTS", "ReportSchedule", sid, {"results": results})
    return {"results": results}


# ------------------------------------------------------------------ audit trail

AUDIT_SCOPES = {
    "SUPER_ADMIN": None, "AUDITORS": None,                                   # all logs
    "ADMIN": ("AUTH", "ADMIN", "SYSTEM", "ONBOARDING", "HELPDESK"),          # system logs
    "ADMIN_1": ("AUTH", "ADMIN", "SYSTEM", "ONBOARDING", "HELPDESK"),
    "ADMIN_2": ("AUTH", "ADMIN", "SYSTEM", "ONBOARDING", "HELPDESK"),
    "HR": ("EMPLOYEE", "LEAVE", "ATTENDANCE", "ONBOARDING", "EXIT", "PERFORMANCE", "RECRUITMENT", "POLICIES", "BENEFITS", "DOCUMENTS"),
    "FINANCE": ("PAYROLL", "FINANCE", "EXPENSES", "ASSETS", "BENEFITS"),
    "ACCOUNTS": ("FINANCE", "EXPENSES", "ASSETS"),
}


@router.get("/audit-logs")
async def audit_logs(module: Optional[str] = None, action: Optional[str] = None, userEmail: Optional[str] = None, entityId: Optional[str] = None,
                     dateFrom: Optional[str] = None, dateTo: Optional[str] = None, limit: int = 500, user: dict = Depends(require_auth)):
    role = user.get("role")
    if role not in AUDIT_SCOPES:
        raise ApiError(403, "Access denied: audit logs are for administrators and auditors.")
    allowed = AUDIT_SCOPES[role]
    rows = []
    for l in db_store.auditLogs:
        if allowed is not None and (l.get("module") or "").upper() not in allowed:
            continue
        if module and (l.get("module") or "") != module:
            continue
        if action and action.upper() not in (l.get("action") or ""):
            continue
        if userEmail and userEmail.lower() not in (l.get("userEmail") or "").lower():
            continue
        if entityId and l.get("entityId") != entityId:
            continue
        ts = (l.get("timestamp") or "")[:10]
        if (dateFrom and ts < dateFrom) or (dateTo and ts > dateTo):
            continue
        rows.append(l)
        if len(rows) >= min(max(1, limit), 5000):
            break
    return {"logs": rows, "scope": "ALL" if allowed is None else list(allowed), "immutable": True}


@router.put("/audit-logs/{log_id}")
@router.patch("/audit-logs/{log_id}")
@router.delete("/audit-logs/{log_id}")
@router.delete("/audit-logs")
async def audit_tamper(request: Request, log_id: Optional[str] = None, user: dict = Depends(require_auth)):
    audit(user, "AUDIT_LOG_TAMPER_BLOCKED", "SYSTEM", "AuditLog", log_id or "*", {"method": request.method})
    raise ApiError(403, "Audit logs are immutable: nobody can edit or delete them.")


@router.get("/audit/login-history")
async def login_history(email: Optional[str] = None, success: Optional[bool] = None, user: dict = Depends(require_role("SUPER_ADMIN", "AUDITORS", "ADMIN", "ADMIN_1", "ADMIN_2"))):
    rows = [r for r in modules_store.loginHistory.values() if (not email or email.lower() in (r.get("email") or "").lower())
            and (success is None or r["success"] == success)]
    rows.sort(key=lambda r: r["at"], reverse=True)
    return {"history": rows[:1000], "lockouts": [r for r in rows if r["reason"] in ("LOCKED_OUT", "LOCKED")][:200]}


@router.get("/audit/reviews")
async def list_reviews(user: dict = Depends(require_role("SUPER_ADMIN", "AUDITORS"))):
    rows = [v for k, v in modules_store.systemSettings.items() if k.startswith("review_")]
    return {"reviews": sorted(rows, key=lambda r: r["at"], reverse=True)}


@router.post("/audit/reviews")
async def sign_review(request: Request, user: dict = Depends(require_role("AUDITORS"))):
    """Only Auditors review the audit trail, so nobody reviews their own changes."""
    b = await read_body(request)
    frm, to = js_str(b.get("from") or "")[:10], js_str(b.get("to") or "")[:10]
    try:
        date.fromisoformat(frm)
        date.fromisoformat(to)
    except ValueError:
        raise ApiError(400, "Give the review period (from / to, YYYY-MM-DD).")
    entries = [l for l in db_store.auditLogs if frm <= (l.get("timestamp") or "")[:10] <= to]
    own = [l for l in entries if l.get("userId") == user["_id"] and l.get("action") not in ("REPORT_VIEWED", "USER_LOGIN")]
    rid = f"review_{now_ms()}_{rand_base36(4)}"
    doc = {"_id": rid, "from": frm, "to": to, "entries": len(entries), "findings": js_str(b.get("findings") or ""),
           "reviewer": actor_name(user), "reviewerUserId": user["_id"], "at": now_iso(), "reviewerOwnChanges": len(own)}
    modules_store.systemSettings[rid] = doc
    audit(user, "AUDIT_LOG_REVIEWED", "SYSTEM", "AuditLog", rid, {"from": frm, "to": to, "entries": len(entries)})
    return JSONResponse({"review": doc}, status_code=201)
