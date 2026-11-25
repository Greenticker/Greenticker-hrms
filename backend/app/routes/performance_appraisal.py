"""
Performance Management (PMS) – Phase 3: year-end appraisal, calibration, publish /
accept / appeal, payroll export and improvement plans (PIPs).

Flow (sheet 3_Workflow steps 10-16):
  SELF -> MANAGER -> REVIEWER -> CALIBRATION -> FINAL -> PUBLISHED -> CLOSED
                                                                   \-> APPEAL -> CLOSED
Limits (sheet 1_Overview / 2_Features): the manager may move the KPI score by at most
1 point, the reviewer and HR (calibration / appeal) may move the rating by at most 1
point, and every change needs a reason. Employees see the rating only once published.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.auth.module_access import can_read, can_write
from app.routes.performance import (
    HR_ROLE, MODULE, VIEW_ALL_ROLES, _actor_name, _can_view_all, _iso_date, _kpi_section, _num, _text, _weights_for,
    check_deadline, ineligible_reason, notify_employee, notify_hr,
)
from app.utils.salary_revisions import apply_due_revisions
from app.routes.performance_feedback import compute_report_360
from app.stores.db_store import db_store
from app.stores.pms_store import pms_store, stamp
from app.utils import pms_calc
from app.utils.jsutil import now_iso, now_ms, rand_base36, today_str

router = APIRouter(prefix="/performance")

# Sheet 7_Roles: Management approves calibration (Super Admin, Admin and HR here)
MANAGEMENT_ROLES = VIEW_ALL_ROLES
AUTO_ACCEPT_DAYS = 7
PIP_DAYS = 90
VISIBLE_TO_EMPLOYEE = ("PUBLISHED", "APPEAL", "CLOSED")
INACTIVE = ("INACTIVE", "TERMINATED", "EXITED")


# ------------------------------------------------------------------ helpers

def _active_cycle() -> dict:
    cycle = pms_store.active_cycle()
    if not cycle:
        raise ApiError(400, "There is no active appraisal cycle.")
    return cycle


def _rel(ap: dict, user: dict) -> dict:
    me = user.get("employeeId")
    is_hr = user.get("role") == HR_ROLE
    return {
        "owner": bool(me) and ap["employeeId"] == me,
        "manager": (bool(me) and ap.get("managerId") == me) or (not ap.get("managerId") and is_hr),
        "reviewer": bool(me) and bool(ap.get("reviewerId")) and ap.get("reviewerId") == me,
        "hr": is_hr,
        "viewAll": _can_view_all(user),
        "management": user.get("role") in MANAGEMENT_ROLES,
    }


def _ratings(raw: dict, competencies: list, label: str, required: bool) -> dict:
    out = {}
    for comp in competencies:
        v = _num((raw or {}).get(comp["_id"]))
        if v is None:
            if required:
                raise ApiError(400, f"{label}: rate every competency from 1 to 5.")
            continue
        if v not in (1, 2, 3, 4, 5):
            raise ApiError(400, f"{label}: ratings must be whole numbers from 1 to 5.")
        out[comp["_id"]] = int(v)
    return out


def _within_one(new: int, base: Optional[int], label: str) -> None:
    if new not in (1, 2, 3, 4, 5):
        raise ApiError(400, f"{label} must be between 1 and 5.")
    if base is not None and abs(new - base) > 1:
        raise ApiError(400, f"{label} can move by at most 1 point (from {base}).")


def _trail(ap: dict, user: dict, action: str, to_status: str, comment: str = "") -> None:
    ap.setdefault("trail", []).append({"at": now_iso(), "byName": _actor_name(user), "action": action,
                                       "fromStatus": ap["status"], "toStatus": to_status, "comment": comment})
    ap["status"] = to_status


def _auto_accept(ap: dict) -> None:
    """Sheet 3_Workflow step 15: auto-accept 7 days after publishing."""
    if ap.get("status") != "PUBLISHED" or not ap.get("publishedOn"):
        return
    published = datetime.fromisoformat(ap["publishedOn"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) - published >= timedelta(days=AUTO_ACCEPT_DAYS):
        ap.setdefault("trail", []).append({"at": now_iso(), "byName": "System", "action": "AUTO_ACCEPTED",
                                           "fromStatus": "PUBLISHED", "toStatus": "CLOSED", "comment": ""})
        ap["status"] = "CLOSED"
        ap["acceptance"] = {"auto": True, "on": now_iso()}


def compute(ap: dict) -> dict:
    """Every score for an appraisal (sheet 4_Calculations), recomputed from its inputs."""
    sheet = pms_store.pmsGoalSheets.get(ap.get("sheetId")) or {}
    cycle = pms_store.pmsCycles.get(ap["cycleId"]) or {}
    kpi_system = _kpi_section(sheet.get("lines") or []) if sheet.get("lines") else None
    mgr = ap.get("manager") or {}
    kpi = mgr.get("kpiOverride") if mgr.get("kpiOverride") is not None else kpi_system
    ratings = list((mgr.get("competencyRatings") or {}).values())
    competency = pms_calc.competency_score(ratings) if ratings else None
    s360 = None
    if (cycle.get("feedback360") or {}).get("closed"):
        s360 = compute_report_360(ap["employeeId"], ap["cycleId"])["score360"]
    w = _weights_for(ap["employeeId"])
    weights = {"kpi": w["kpi"] / 100, "competency": w["competency"] / 100, "feedback360": w["feedback360"] / 100}
    final = pms_calc.final_score(kpi, competency, s360, weights) if kpi is not None and competency is not None else None
    computed = pms_calc.final_rating(final)
    proposed = (ap.get("reviewer") or {}).get("adjustedRating") or computed
    calibrated = (ap.get("calibration") or {}).get("rating") or proposed
    final_rating = (ap.get("appeal") or {}).get("resolvedRating") or calibrated
    r = lambda v: round(v, 4) if v is not None else None
    return {
        "kpiScoreSystem": r(kpi_system), "kpiScore": r(kpi), "competencyScore": r(competency), "score360": r(s360),
        "weights": w, "finalScore": r(final), "computedRating": computed, "proposedRating": proposed,
        "calibratedRating": calibrated, "finalRating": final_rating,
    }


def _permissions(ap: dict, user: dict) -> dict:
    rel = _rel(ap, user)
    s = ap["status"]
    active = (pms_store.pmsCycles.get(ap["cycleId"]) or {}).get("status") == "ACTIVE"
    return {
        "canEditSelf": active and s == "SELF" and rel["owner"],
        "canEditManager": active and s == "MANAGER" and rel["manager"] and not rel["owner"],
        "canReview": active and s == "REVIEWER" and rel["reviewer"] and not rel["owner"],
        "canSendBack": active and ((s == "MANAGER" and rel["manager"] and not rel["owner"]) or (s == "REVIEWER" and rel["reviewer"])),
        "canCalibrate": active and s == "CALIBRATION" and rel["hr"] and not rel["owner"],
        "canAccept": active and s == "PUBLISHED" and rel["owner"],
        "canResolveAppeal": active and s == "APPEAL" and rel["hr"] and not rel["owner"],
        "canReopen": active and rel["hr"] and not rel["owner"]
        and (ap.get("increment") or {}).get("status") != "APPROVED",
    }


def _view(ap: dict, user: dict) -> dict:
    _auto_accept(ap)
    rel = _rel(ap, user)
    staff = rel["manager"] or rel["reviewer"] or rel["viewAll"]
    if not (rel["owner"] or staff):
        raise ApiError(403, "You cannot view this appraisal.")
    emp = pms_store.employee(ap["employeeId"]) or {}
    out = {
        "_id": ap["_id"], "employeeId": ap["employeeId"], "employeeName": pms_store.employee_name(ap["employeeId"]),
        "designation": emp.get("designation"), "department": emp.get("department"),
        "managerName": pms_store.employee_name(ap.get("managerId")) or "HR",
        "reviewerName": pms_store.employee_name(ap.get("reviewerId")),
        "status": ap["status"], "self": ap.get("self") or {}, "trail": ap.get("trail") or [], "deadlineExtension": ap.get("deadlineExtension"),
        "competencies": [{"_id": c["_id"], "name": c["name"], "appliesTo": c.get("appliesTo")} for c in pms_store.competencies_for(ap["employeeId"])],
        "permissions": _permissions(ap, user),
        "publishedOn": ap.get("publishedOn"), "acceptance": ap.get("acceptance"),
        "autoAcceptDays": AUTO_ACCEPT_DAYS,
    }
    # Sheet 1_Overview: the employee sees ratings only after HR publishes
    if staff or ap["status"] in VISIBLE_TO_EMPLOYEE:
        out.update({
            "manager": ap.get("manager") or {}, "reviewer": ap.get("reviewer") or {},
            "calibration": ap.get("calibration") or {}, "appeal": ap.get("appeal") or {},
            "scores": compute(ap),
        })
        if not staff:
            # Employees see the final outcome, not intermediate proposals
            out["scores"] = {k: v for k, v in out["scores"].items() if k not in ("computedRating", "proposedRating", "calibratedRating")}
            out["calibration"] = {}
    else:
        out["appeal"] = ap.get("appeal") or {}
    return out


def _get(ap_id: str) -> dict:
    ap = pms_store.pmsAppraisals.get(ap_id)
    if not ap:
        raise ApiError(404, "Appraisal not found.")
    _auto_accept(ap)
    return ap


def _require(ap: dict, user: dict, perm: str, message: str) -> None:
    if not _permissions(ap, user)[perm]:
        raise ApiError(403, message)


# ------------------------------------------------- literal routes (first)

@router.get("/appraisals/calibration")
async def calibration_list(user: dict = Depends(require_auth)):
    if not _can_view_all(user):
        raise ApiError(403, "Only HR and management can see calibration.")
    cycle = pms_store.active_cycle()
    if not cycle:
        return {"cycle": None, "rows": [], "distribution": {}}
    rows = []
    for ap in pms_store.pmsAppraisals.values():
        if ap["cycleId"] != cycle["_id"]:
            continue
        _auto_accept(ap)
        emp = pms_store.employee(ap["employeeId"]) or {}
        rows.append({
            "_id": ap["_id"], "employeeId": ap["employeeId"], "employeeName": pms_store.employee_name(ap["employeeId"]),
            "employeeCode": emp.get("employeeCode"), "department": emp.get("department"),
            "grade": pms_store.grade_of(ap["employeeId"]), "managerName": pms_store.employee_name(ap.get("managerId")) or "HR",
            "status": ap["status"], "calibration": ap.get("calibration") or {}, "appeal": ap.get("appeal") or {},
            "payrollSentOn": ap.get("payrollSentOn"), **compute(ap),
        })
    started = {r["employeeId"] for r in rows}
    not_started = [
        {"employeeId": e["_id"], "employeeName": pms_store.employee_name(e["_id"]), "department": e.get("department")}
        for e in db_store.employees.values() if e["_id"] not in started and not ineligible_reason(e["_id"], cycle)
    ]
    rated = [r["finalRating"] for r in rows if r["status"] not in ("SELF", "MANAGER", "REVIEWER") and r["finalRating"]]
    distribution = {str(k): {"count": rated.count(k), "pct": round(rated.count(k) / len(rated) * 100, 1) if rated else 0} for k in (5, 4, 3, 2, 1)}
    return {"cycle": cycle, "rows": sorted(rows, key=lambda r: (-(r["finalRating"] or 0), r["employeeName"])),
            "notStarted": sorted(not_started, key=lambda r: r["employeeName"]), "distribution": distribution}


@router.post("/appraisals/calibration/lock")
async def lock_calibration(user: dict = Depends(require_role(*MANAGEMENT_ROLES))):
    cycle = _active_cycle()
    pending = [a for a in pms_store.pmsAppraisals.values() if a["cycleId"] == cycle["_id"] and a["status"] == "CALIBRATION"]
    if not pending:
        raise ApiError(400, "There are no appraisals waiting in calibration.")
    for ap in pending:
        _trail(ap, user, "CALIBRATION_LOCKED", "FINAL")
        stamp(ap, user)
    audit(user, "PMS_CALIBRATION_LOCKED", MODULE, "pms_cycle", cycle["_id"], {"field": "status", "old": "CALIBRATION", "new": "FINAL", "count": len(pending)})
    return {"locked": len(pending)}


@router.post("/appraisals/publish")
async def publish(user: dict = Depends(require_role(HR_ROLE))):
    cycle = _active_cycle()
    final = [a for a in pms_store.pmsAppraisals.values() if a["cycleId"] == cycle["_id"] and a["status"] == "FINAL"]
    if not final:
        raise ApiError(400, "There are no locked ratings to publish.")
    for ap in final:
        _trail(ap, user, "PUBLISHED", "PUBLISHED")
        ap["publishedOn"] = now_iso()
        stamp(ap, user)
        notify_employee(ap["employeeId"], "Your appraisal rating is published",
                        f"Open Performance to see your final rating and accept it or raise a disagreement within {AUTO_ACCEPT_DAYS} days.")
    audit(user, "PMS_RATINGS_PUBLISHED", MODULE, "pms_cycle", cycle["_id"], {"field": "status", "old": "FINAL", "new": "PUBLISHED", "count": len(final)})
    return {"published": len(final)}


@router.get("/appraisals/increment-table")
async def get_increment_table(user: dict = Depends(require_auth)):
    if not _can_view_all(user):
        raise ApiError(403, "Only HR and management can see the increment table.")
    return {"rows": pms_store.increment_table()}


@router.put("/appraisals/increment-table")
async def update_increment_table(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    rows = []
    for raw in (await read_body(request)).get("rows") or []:
        rating, inc, bonus = _num(raw.get("rating")), _num(raw.get("incrementPct")), _num(raw.get("bonusMultiplier"))
        if rating not in (1, 2, 3, 4, 5) or inc is None or bonus is None or inc < 0 or bonus < 0 or inc > 100:
            raise ApiError(400, "Each row needs a rating 1–5, an increment % between 0 and 100, and a bonus multiplier of 0 or more.")
        rows.append({"rating": int(rating), "incrementPct": inc, "bonusMultiplier": bonus})
    if sorted(r["rating"] for r in rows) != [1, 2, 3, 4, 5]:
        raise ApiError(400, "Give exactly one row for each rating from 1 to 5.")
    rows.sort(key=lambda r: -r["rating"])
    settings = pms_store.pmsSettings["incrementTable"]
    old = settings["rows"]
    settings["rows"] = rows
    stamp(settings, user)
    audit(user, "PMS_INCREMENT_TABLE_UPDATED", MODULE, "pms_settings", "incrementTable", {"field": "rows", "old": old, "new": rows})
    return {"rows": rows}


def _payroll_rows(cycle: dict) -> list:
    table = {r["rating"]: r for r in pms_store.increment_table()}
    rows = []
    for ap in pms_store.pmsAppraisals.values():
        if ap["cycleId"] != cycle["_id"]:
            continue
        _auto_accept(ap)
        if ap["status"] != "CLOSED":
            continue
        emp = pms_store.employee(ap["employeeId"]) or {}
        rating = compute(ap)["finalRating"]
        inc = table.get(rating) or {}
        salary = _num(emp.get("annualSalary"))
        rows.append({
            "appraisalId": ap["_id"], "employeeId": ap["employeeId"], "employeeCode": emp.get("employeeCode"),
            "employeeName": pms_store.employee_name(ap["employeeId"]), "department": emp.get("department"),
            "rating": rating, "incrementPct": inc.get("incrementPct"), "bonusMultiplier": inc.get("bonusMultiplier"),
            "currentAnnualSalary": salary,
            "newAnnualSalary": round(salary * (1 + (inc.get("incrementPct") or 0) / 100)) if salary is not None else None,
            "payrollSentOn": ap.get("payrollSentOn"),
            "increment": ap.get("increment"),
        })
    return sorted(rows, key=lambda r: r["employeeName"])


@router.get("/appraisals/payroll-export")
async def payroll_export(user: dict = Depends(require_role(HR_ROLE))):
    cycle = _active_cycle()
    rows = _payroll_rows(cycle)
    waiting = sum(1 for a in pms_store.pmsAppraisals.values() if a["cycleId"] == cycle["_id"] and a["status"] != "CLOSED")
    return {"cycle": {"_id": cycle["_id"], "name": cycle["name"]}, "rows": rows, "notReady": waiting}


@router.post("/appraisals/payroll-sent")
async def mark_payroll_sent(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    """HR proposes the increments from final ratings with an effective date. Nothing changes in
    payroll until a payroll approver (Finance / Admin) approves them."""
    cycle = _active_cycle()
    body = await read_body(request)
    effective = _iso_date(body.get("effectiveFrom"), "Effective date") if body.get("effectiveFrom") else None
    if not effective:
        raise ApiError(400, "Choose the date from which the revised salaries take effect.")
    sent = 0
    for row in _payroll_rows(cycle):
        ap = pms_store.pmsAppraisals[row["appraisalId"]]
        if ap.get("increment") and ap["increment"].get("status") in ("PENDING_APPROVAL", "APPROVED"):
            continue
        if row["currentAnnualSalary"] is None or ap["employeeId"] == user.get("employeeId"):
            continue  # nobody proposes their own increment
        ap["payrollSentOn"] = now_iso()
        ap["payrollSnapshot"] = {k: row[k] for k in ("rating", "incrementPct", "bonusMultiplier")}
        ap["increment"] = {
            "status": "PENDING_APPROVAL", "effectiveFrom": effective, "rating": row["rating"],
            "incrementPct": row["incrementPct"], "oldSalary": row["currentAnnualSalary"], "newSalary": row["newAnnualSalary"],
            "proposedBy": _actor_name(user), "proposedByUserId": user["_id"], "proposedOn": now_iso(),
        }
        stamp(ap, user)
        sent += 1
    if not sent:
        raise ApiError(400, "Nothing new to send. Only accepted (closed) ratings that have no increment pending go to payroll.")
    for u in db_store.users.values():
        if u.get("role") == "FINANCE" and u.get("isActive", True) and u["_id"] != user["_id"]:
            db_store.notifications.insert(0, {
                "_id": f"notif_{now_ms()}_{rand_base36(5)}", "recipientUserId": u["_id"], "title": "Salary increments awaiting approval",
                "message": f"{sent} appraisal increment(s) effective {effective} need payroll approval.",
                "type": "PAYROLL", "isRead": False, "createdAt": now_iso(),
            })
    audit(user, "PMS_SENT_TO_PAYROLL", MODULE, "pms_cycle", cycle["_id"], {"count": sent, "effectiveFrom": effective})
    return {"sent": sent, "effectiveFrom": effective}


def _increment_rows(status: Optional[str] = None) -> list:
    rows = []
    for ap in pms_store.pmsAppraisals.values():
        inc = ap.get("increment")
        if not inc or (status and inc.get("status") != status):
            continue
        emp = pms_store.employee(ap["employeeId"]) or {}
        rows.append({"appraisalId": ap["_id"], "employeeId": ap["employeeId"], "employeeName": pms_store.employee_name(ap["employeeId"]),
                     "employeeCode": emp.get("employeeCode"), "department": emp.get("department"), **inc})
    return sorted(rows, key=lambda r: (r.get("effectiveFrom") or "", r["employeeName"]))


@router.get("/appraisals/increments")
async def list_increments(status: Optional[str] = None, user: dict = Depends(require_auth)):
    if not (can_read(user, "payroll") or _can_view_all(user)):
        raise ApiError(403, "Access denied.")
    rows = _increment_rows(status)
    for r in rows:
        r["canApprove"] = (r["status"] == "PENDING_APPROVAL" and user.get("role") == "FINANCE"
                           and r.get("proposedByUserId") != user["_id"] and r["employeeId"] != user.get("employeeId"))
    return {"increments": rows}


@router.post("/appraisals/increments/approve")
async def approve_increments(request: Request, user: dict = Depends(require_auth)):
    """Payroll approver (Finance / Admin, never the HR user who proposed it) approves or rejects
    appraisal increments. Approved ones become salary revisions that payroll applies from the
    effective date."""
    if user.get("role") != "FINANCE":
        raise ApiError(403, "Only the payroll checker (Finance) can approve salary increments.")
    body = await read_body(request)
    decision = body.get("decision") or "APPROVED"
    comment = _text(body.get("comment"))
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Give a reason for rejecting the increments.")
    ids = body.get("appraisalIds") or [r["appraisalId"] for r in _increment_rows("PENDING_APPROVAL")]
    done, skipped = [], []
    for ap_id in ids:
        ap = pms_store.pmsAppraisals.get(ap_id)
        inc = (ap or {}).get("increment") or {}
        if inc.get("status") != "PENDING_APPROVAL":
            continue
        if inc.get("proposedByUserId") == user["_id"] or ap["employeeId"] == user.get("employeeId"):
            skipped.append(pms_store.employee_name(ap["employeeId"]))
            continue
        inc.update({"status": decision, "decidedBy": _actor_name(user), "decidedByUserId": user["_id"], "decidedOn": now_iso(),
                    "comment": comment or None})
        if decision == "APPROVED":
            emp = db_store.employees.get(ap["employeeId"])
            if emp is not None:
                emp.setdefault("salaryRevisions", []).append({
                    "effectiveFrom": inc["effectiveFrom"], "oldSalary": inc["oldSalary"], "newSalary": inc["newSalary"],
                    "status": "APPROVED", "source": "APPRAISAL", "appraisalId": ap_id, "approvedBy": _actor_name(user),
                    "approvedOn": now_iso(),
                })
        notify_employee(ap["employeeId"], f"Salary increment {decision.lower()}",
                        f"Your appraisal increment ({inc.get('incrementPct')}%) effective {inc['effectiveFrom']} was {decision.lower()}."
                        if decision == "APPROVED" else "Your appraisal increment was not approved; HR will be in touch.")
        audit(user, f"PMS_INCREMENT_{decision}", MODULE, "pms_appraisal", ap_id, {
            "employeeId": ap["employeeId"], "field": "annualSalary", "old": inc["oldSalary"], "new": inc["newSalary"],
            "effectiveFrom": inc["effectiveFrom"], "comment": comment,
        })
        done.append(ap_id)
    if not done and skipped:
        raise ApiError(403, "Maker-checker: you proposed these increments (or they are your own), so another approver must decide: "
                       + ", ".join(skipped))
    if not done:
        raise ApiError(400, "There are no increments waiting for approval.")
    apply_due_revisions()
    return {"decided": len(done), "decision": decision, "skipped": skipped}


# ---------------------------------------------------------------- appraisals

@router.get("/appraisals/employee/{employee_id}")
async def get_or_start(employee_id: str, create: bool = False, user: dict = Depends(require_auth)):
    pms_store.ensure_seeded()
    if not pms_store.employee(employee_id):
        raise ApiError(404, "Employee not found.")
    cycle = _active_cycle()
    ap = pms_store.appraisal_for(employee_id, cycle["_id"])
    if ap:
        return {"appraisal": _view(ap, user)}
    sheet = pms_store.sheet_for(employee_id, cycle["_id"])
    probe = {"employeeId": employee_id, "managerId": pms_store.manager_id(employee_id), "reviewerId": None, "cycleId": cycle["_id"], "status": "SELF"}
    rel = _rel(probe, user)
    if not any(rel[k] for k in ("owner", "manager", "viewAll")) and pms_store.manager_id(pms_store.manager_id(employee_id)) != user.get("employeeId"):
        raise ApiError(403, "You cannot view this appraisal.")
    ready = bool(sheet) and sheet.get("status") == "LOCKED"
    if not create or not rel["owner"]:
        return {"appraisal": None, "goalsLocked": ready}
    if not ready:
        raise ApiError(400, "The year-end appraisal starts once your goals are approved and locked.")
    reason = ineligible_reason(employee_id, cycle)
    if reason:
        raise ApiError(403, f"Not eligible for {cycle.get('name')}: {reason}")
    # Nobody rates or reviews themselves: a top-level employee (no manager, or recorded as their
    # own manager) goes to HR / management, and a reviewer who is the employee is skipped.
    manager = pms_store.manager_id(employee_id)
    if manager == employee_id:
        manager = None
    reviewer = pms_store.manager_id(manager) if manager else None
    if reviewer in (employee_id, manager):
        reviewer = None
    aid = f"appr_{now_ms()}_{rand_base36(5)}"
    ap = stamp({"_id": aid, "cycleId": cycle["_id"], "employeeId": employee_id, "sheetId": sheet["_id"],
                "managerId": manager, "reviewerId": reviewer, "status": "SELF",
                "self": {}, "manager": {}, "reviewer": {}, "calibration": {}, "appeal": {}, "trail": []}, user, created=True)
    pms_store.pmsAppraisals[aid] = ap
    audit(user, "PMS_APPRAISAL_STARTED", MODULE, "pms_appraisal", aid, {"employeeId": employee_id})
    return {"appraisal": _view(ap, user)}


@router.put("/appraisals/{ap_id}/self")
async def save_self(ap_id: str, request: Request, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canEditSelf", "Your self appraisal can't be edited now.")
    body = await read_body(request)
    ap["self"] = {
        "competencyRatings": _ratings(body.get("competencyRatings"), pms_store.competencies_for(ap["employeeId"]), "Self appraisal", False),
        "comments": _text(body.get("comments")),
    }
    stamp(ap, user)
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/self/submit")
async def submit_self(ap_id: str, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canEditSelf", "Your self appraisal can't be submitted now.")
    comps = pms_store.competencies_for(ap["employeeId"])
    _ratings((ap.get("self") or {}).get("competencyRatings"), comps, "Self appraisal", True)
    if not (ap.get("self") or {}).get("comments"):
        raise ApiError(400, "Add your comments before submitting.")
    check_deadline(ap, pms_store.pmsCycles.get(ap["cycleId"]), "self_appraisal", "self appraisal")
    _trail(ap, user, "SELF_SUBMITTED", "MANAGER")
    stamp(ap, user)
    audit(user, "PMS_SELF_APPRAISAL_SUBMITTED", MODULE, "pms_appraisal", ap_id, {"field": "status", "old": "SELF", "new": "MANAGER"})
    if ap.get("managerId"):
        notify_employee(ap["managerId"], "Appraisal waiting for your rating", f"{pms_store.employee_name(ap['employeeId'])} submitted their self appraisal.")
    else:
        notify_hr("Appraisal waiting for rating", f"{pms_store.employee_name(ap['employeeId'])} submitted their self appraisal (no manager on record).")
    return {"appraisal": _view(ap, user)}


@router.put("/appraisals/{ap_id}/manager")
async def save_manager(ap_id: str, request: Request, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canEditManager", "The manager appraisal can't be edited now.")
    body = await read_body(request)
    override = _num(body.get("kpiOverride"))
    reason = _text(body.get("kpiOverrideReason"))
    system = compute(ap)["kpiScoreSystem"]
    if override is not None:
        if system is None:
            raise ApiError(400, "The KPI score can only be adjusted once all KPI actuals are recorded.")
        if not 1 <= override <= 5 or abs(override - system) > 1 + 1e-9:
            raise ApiError(400, f"The KPI score can move by at most 1 point from the calculated {system:.2f}, within 1–5.")
        if not reason:
            raise ApiError(400, "Give a reason for changing the KPI score.")
    old = dict(ap.get("manager") or {})
    ap["manager"] = {
        "competencyRatings": _ratings(body.get("competencyRatings"), pms_store.competencies_for(ap["employeeId"]), "Manager appraisal", False),
        "kpiOverride": round(override, 2) if override is not None else None,
        "kpiOverrideReason": reason if override is not None else "",
        "comments": _text(body.get("comments")),
    }
    stamp(ap, user)
    if old.get("kpiOverride") != ap["manager"]["kpiOverride"]:
        audit(user, "PMS_KPI_SCORE_ADJUSTED", MODULE, "pms_appraisal", ap_id,
              {"field": "kpiScore", "old": old.get("kpiOverride", system), "new": ap["manager"]["kpiOverride"] or system, "reason": reason})
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/manager/submit")
async def submit_manager(ap_id: str, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canEditManager", "The manager appraisal can't be submitted now.")
    _ratings((ap.get("manager") or {}).get("competencyRatings"), pms_store.competencies_for(ap["employeeId"]), "Manager appraisal", True)
    scores = compute(ap)
    if scores["kpiScoreSystem"] is None:
        raise ApiError(400, "Record all KPI actuals on the goal sheet first, so the KPI score can be calculated.")
    if not (ap.get("manager") or {}).get("comments"):
        raise ApiError(400, "Add your comments before submitting.")
    check_deadline(ap, pms_store.pmsCycles.get(ap["cycleId"]), "manager_appraisal", "manager appraisal")
    new = "REVIEWER" if ap.get("reviewerId") else "CALIBRATION"
    if new == "REVIEWER":
        notify_employee(ap["reviewerId"], "Appraisal waiting for your review",
                        f"{pms_store.employee_name(ap['employeeId'])}'s appraisal was rated by their manager and needs your review.")
    else:
        notify_hr("Appraisal ready for calibration", f"{pms_store.employee_name(ap['employeeId'])}'s appraisal is ready for calibration.")
    _trail(ap, user, "MANAGER_SUBMITTED", new)
    stamp(ap, user)
    audit(user, "PMS_MANAGER_APPRAISAL_SUBMITTED", MODULE, "pms_appraisal", ap_id,
          {"field": "status", "old": "MANAGER", "new": new, "finalScore": scores["finalScore"], "rating": scores["computedRating"]})
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/send-back")
async def send_back(ap_id: str, request: Request, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canSendBack", "You can't send this appraisal back.")
    comment = _text((await read_body(request)).get("comment"))
    if not comment:
        raise ApiError(400, "Add a comment explaining what to change.")
    old = ap["status"]
    new = "SELF" if old == "MANAGER" else "MANAGER"
    _trail(ap, user, "SENT_BACK", new, comment)
    stamp(ap, user)
    audit(user, "PMS_APPRAISAL_SENT_BACK", MODULE, "pms_appraisal", ap_id, {"field": "status", "old": old, "new": new, "reason": comment})
    notify_employee(ap["employeeId"] if new == "SELF" else ap.get("managerId"), "Appraisal sent back", f"{_actor_name(user)}: {comment}")
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/reviewer/approve")
async def reviewer_approve(ap_id: str, request: Request, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canReview", "Only the reviewer can approve this appraisal.")
    check_deadline(ap, pms_store.pmsCycles.get(ap["cycleId"]), "reviewer_approval", "reviewer approval")
    body = await read_body(request)
    computed = compute(ap)["computedRating"]
    adjusted = _num(body.get("adjustedRating"))
    reason = _text(body.get("reason"))
    if adjusted is not None and int(adjusted) != computed:
        _within_one(int(adjusted), computed, "The reviewer's rating")
        if not reason:
            raise ApiError(400, "Give a reason for changing the rating.")
        ap["reviewer"] = {"adjustedRating": int(adjusted), "reason": reason}
        audit(user, "PMS_RATING_CHANGED_BY_REVIEWER", MODULE, "pms_appraisal", ap_id,
              {"field": "rating", "old": computed, "new": int(adjusted), "reason": reason})
    else:
        ap["reviewer"] = {"adjustedRating": None, "reason": reason}
    _trail(ap, user, "REVIEWER_APPROVED", "CALIBRATION", reason)
    stamp(ap, user)
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/calibrate")
async def calibrate(ap_id: str, request: Request, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canCalibrate", "Only HR can calibrate ratings in the calibration stage.")
    body = await read_body(request)
    proposed = compute(ap)["proposedRating"]
    rating = _num(body.get("rating"))
    reason = _text(body.get("reason"))
    if rating is None:
        raise ApiError(400, "Choose the calibrated rating.")
    rating = int(rating)
    old = compute(ap)["calibratedRating"]
    if rating == proposed:
        ap["calibration"] = {}
    else:
        _within_one(rating, proposed, "Calibration")
        if not reason:
            raise ApiError(400, "Give a reason for the calibration change.")
        ap["calibration"] = {"rating": rating, "reason": reason, "by": _actor_name(user), "on": now_iso()}
    stamp(ap, user)
    audit(user, "PMS_RATING_CALIBRATED", MODULE, "pms_appraisal", ap_id, {"field": "rating", "old": old, "new": rating, "reason": reason})
    return {"appraisal": _view(ap, user)}


STAGE_ORDER = ["SELF", "MANAGER", "REVIEWER", "CALIBRATION", "FINAL", "PUBLISHED", "APPEAL", "CLOSED"]


@router.post("/appraisals/{ap_id}/reopen")
async def reopen_appraisal(ap_id: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    """HR re-opens a submitted appraisal at an earlier stage (self / manager / reviewer), with a reason
    and optionally a new deadline. Not allowed on one's own appraisal or once the increment is approved."""
    ap = _get(ap_id)
    if ap["employeeId"] == user.get("employeeId"):
        raise ApiError(403, "You cannot re-open your own appraisal. Another HR user must do it.")
    if (pms_store.pmsCycles.get(ap["cycleId"]) or {}).get("status") != "ACTIVE":
        raise ApiError(400, "Re-open the appraisal cycle first.")
    if (ap.get("increment") or {}).get("status") == "APPROVED":
        raise ApiError(400, "The increment from this appraisal is already approved for payroll; it can no longer be re-opened.")
    body = await read_body(request)
    stage = body.get("stage") or "SELF"
    reason = _text(body.get("reason"))
    if stage not in ("SELF", "MANAGER", "REVIEWER"):
        raise ApiError(400, "Re-open to SELF, MANAGER or REVIEWER.")
    if stage == "REVIEWER" and not ap.get("reviewerId"):
        raise ApiError(400, "This appraisal has no reviewer.")
    if not reason:
        raise ApiError(400, "Give a reason for re-opening the appraisal.")
    until = _iso_date(body["extendUntil"], "New deadline") if body.get("extendUntil") else None
    # Same stage = only extend that stage's deadline (e.g. the manager missed the rating deadline)
    if STAGE_ORDER.index(ap["status"]) < STAGE_ORDER.index(stage) or (STAGE_ORDER.index(ap["status"]) == STAGE_ORDER.index(stage) and not until):
        raise ApiError(400, f"The appraisal is at {ap['status'].lower()}, so it is already open at that stage"
                            + (". Give a new deadline to extend it." if ap["status"] == stage else "."))
    if until and until < today_str():
        raise ApiError(400, "The new deadline is in the past.")
    old = ap["status"]
    if until:
        ap["deadlineExtension"] = {"until": until, "reason": reason, "by": _actor_name(user), "on": now_iso()}
    # Anything after the re-opened stage has to be done again
    if STAGE_ORDER.index(old) >= STAGE_ORDER.index("PUBLISHED"):
        ap["publishedOn"] = None
        ap["acceptance"] = None
    if stage in ("SELF", "MANAGER"):
        ap["reviewer"] = {}
    ap["calibration"] = {}
    ap["increment"] = None
    _trail(ap, user, "REOPENED_BY_HR", stage, reason)
    stamp(ap, user)
    audit(user, "PMS_APPRAISAL_REOPENED", MODULE, "pms_appraisal", ap_id,
          {"field": "status", "old": old, "new": stage, "reason": reason, "extendedUntil": until})
    target = {"SELF": ap["employeeId"], "MANAGER": ap.get("managerId"), "REVIEWER": ap.get("reviewerId")}[stage]
    notify_employee(target, "Appraisal re-opened", f"HR re-opened the appraisal of {pms_store.employee_name(ap['employeeId'])}: {reason}"
                    + (f" New deadline {until}." if until else ""))
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/accept")
async def accept(ap_id: str, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canAccept", "This rating can't be accepted now.")
    _trail(ap, user, "ACCEPTED", "CLOSED")
    ap["acceptance"] = {"auto": False, "on": now_iso()}
    stamp(ap, user)
    audit(user, "PMS_RATING_ACCEPTED", MODULE, "pms_appraisal", ap_id, {"field": "status", "old": "PUBLISHED", "new": "CLOSED"})
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/appeal")
async def appeal(ap_id: str, request: Request, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canAccept", "This rating can't be appealed now.")
    reason = _text((await read_body(request)).get("reason"))
    if not reason:
        raise ApiError(400, "Explain why you disagree with the rating.")
    ap["appeal"] = {"reason": reason, "raisedOn": now_iso()}
    _trail(ap, user, "APPEALED", "APPEAL", reason)
    stamp(ap, user)
    notify_hr("Rating disagreement raised", f"{pms_store.employee_name(ap['employeeId'])} disagreed with their rating: {reason}")
    audit(user, "PMS_RATING_APPEALED", MODULE, "pms_appraisal", ap_id, {"field": "status", "old": "PUBLISHED", "new": "APPEAL", "reason": reason})
    return {"appraisal": _view(ap, user)}


@router.post("/appraisals/{ap_id}/resolve-appeal")
async def resolve_appeal(ap_id: str, request: Request, user: dict = Depends(require_auth)):
    ap = _get(ap_id)
    _require(ap, user, "canResolveAppeal", "Only HR can resolve appeals.")
    body = await read_body(request)
    current = compute(ap)["calibratedRating"]
    rating = _num(body.get("rating"))
    rating = int(rating) if rating is not None else current
    reason = _text(body.get("reason"))
    if not reason:
        raise ApiError(400, "Record the outcome of the appeal.")
    if rating != current:
        _within_one(rating, current, "The appeal outcome")
    ap["appeal"] = {**(ap.get("appeal") or {}), "resolvedRating": rating if rating != current else None,
                    "resolution": reason, "resolvedBy": _actor_name(user), "resolvedOn": now_iso()}
    _trail(ap, user, "APPEAL_RESOLVED", "CLOSED", reason)
    stamp(ap, user)
    audit(user, "PMS_APPEAL_RESOLVED", MODULE, "pms_appraisal", ap_id, {"field": "rating", "old": current, "new": rating, "reason": reason})
    return {"appraisal": _view(ap, user)}


# --------------------------------------------------------------------- PIPs

def _pip_view(pip: dict, user: dict) -> dict:
    me = user.get("employeeId")
    rel = {"owner": pip["employeeId"] == me, "manager": pip.get("managerId") == me, "hr": user.get("role") == HR_ROLE, "viewAll": _can_view_all(user)}
    if not any(rel.values()):
        raise ApiError(403, "You cannot view this improvement plan.")
    active = pip["status"] == "ACTIVE"
    return {**pip, "employeeName": pms_store.employee_name(pip["employeeId"]),
            "managerName": pms_store.employee_name(pip.get("managerId")) or "HR",
            "permissions": {"canEdit": active and (rel["manager"] or rel["hr"]) and not rel["owner"],
                            "canClose": active and rel["hr"] and not rel["owner"]}}


@router.get("/pips")
async def list_pips(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    me = user.get("employeeId")
    out = []
    for pip in pms_store.pmsPips.values():
        if employeeId and pip["employeeId"] != employeeId:
            continue
        if _can_view_all(user) or pip["employeeId"] == me or pip.get("managerId") == me:
            out.append(_pip_view(pip, user))
    eligible = []
    if user.get("role") == HR_ROLE and not employeeId:
        cycle = pms_store.active_cycle()
        if cycle:
            has_pip = {p["appraisalId"] for p in pms_store.pmsPips.values()}
            for ap in pms_store.pmsAppraisals.values():
                if ap["cycleId"] == cycle["_id"] and ap["status"] == "CLOSED" and ap["_id"] not in has_pip and compute(ap)["finalRating"] == 1:
                    eligible.append({"appraisalId": ap["_id"], "employeeId": ap["employeeId"], "employeeName": pms_store.employee_name(ap["employeeId"])})
    return {"pips": sorted(out, key=lambda p: p.get("startDate") or "", reverse=True), "eligible": eligible}


@router.post("/pips/start")
async def start_pips(user: dict = Depends(require_role(HR_ROLE))):
    """Sheet 2_Features F21: a 90-day plan with review dates for everyone rated 1."""
    cycle = _active_cycle()
    has_pip = {p["appraisalId"] for p in pms_store.pmsPips.values()}
    start = date.today()
    created = []
    for ap in pms_store.pmsAppraisals.values():
        if ap["cycleId"] != cycle["_id"] or ap["status"] != "CLOSED" or ap["_id"] in has_pip or compute(ap)["finalRating"] != 1:
            continue
        pid = f"pip_{now_ms()}_{rand_base36(5)}"
        pip = stamp({
            "_id": pid, "cycleId": cycle["_id"], "appraisalId": ap["_id"], "employeeId": ap["employeeId"],
            "managerId": ap.get("managerId"), "status": "ACTIVE",
            "startDate": start.isoformat(), "endDate": (start + timedelta(days=PIP_DAYS)).isoformat(),
            "objectives": [],
            "reviews": [{"day": d, "date": (start + timedelta(days=d)).isoformat(), "notes": "", "progress": None} for d in (30, 60, 90)],
            "outcome": None,
        }, user, created=True)
        pms_store.pmsPips[pid] = pip
        created.append(pid)
        audit(user, "PMS_PIP_STARTED", MODULE, "pms_pip", pid, {"employeeId": ap["employeeId"], "endDate": pip["endDate"]})
    if not created:
        raise ApiError(400, "Nobody needs an improvement plan: no accepted rating of 1 without a plan.")
    return {"started": len(created)}


@router.put("/pips/{pip_id}")
async def update_pip(pip_id: str, request: Request, user: dict = Depends(require_auth)):
    pip = pms_store.pmsPips.get(pip_id)
    if not pip:
        raise ApiError(404, "Improvement plan not found.")
    if not _pip_view(pip, user)["permissions"]["canEdit"]:
        raise ApiError(403, "Only the manager or HR can update this plan.")
    body = await read_body(request)
    objectives = [_text(o) for o in body.get("objectives") or [] if _text(o)]
    reviews = pip["reviews"]
    for raw in body.get("reviews") or []:
        for r in reviews:
            if r["day"] == raw.get("day"):
                r["notes"] = _text(raw.get("notes"))
                progress = _text(raw.get("progress")).upper() or None
                if progress not in (None, "ON_TRACK", "AT_RISK", "OFF_TRACK"):
                    raise ApiError(400, "Progress must be ON_TRACK, AT_RISK or OFF_TRACK.")
                r["progress"] = progress
    changes = [{"field": "objectives", "old": pip["objectives"], "new": objectives}] if pip["objectives"] != objectives else []
    pip["objectives"] = objectives
    stamp(pip, user)
    audit(user, "PMS_PIP_UPDATED", MODULE, "pms_pip", pip_id, {"changes": changes})
    return {"pip": _pip_view(pip, user)}


@router.post("/pips/{pip_id}/close")
async def close_pip(pip_id: str, request: Request, user: dict = Depends(require_auth)):
    pip = pms_store.pmsPips.get(pip_id)
    if not pip:
        raise ApiError(404, "Improvement plan not found.")
    if not _pip_view(pip, user)["permissions"]["canClose"]:
        raise ApiError(403, "Only HR can close an improvement plan.")
    body = await read_body(request)
    outcome = _text(body.get("outcome")).upper()
    if outcome not in ("SUCCESSFUL", "UNSUCCESSFUL", "EXTENDED"):
        raise ApiError(400, "Outcome must be SUCCESSFUL, UNSUCCESSFUL or EXTENDED.")
    notes = _text(body.get("notes"))
    if not notes:
        raise ApiError(400, "Add notes on the outcome.")
    if outcome == "EXTENDED":
        pip["endDate"] = (date.fromisoformat(pip["endDate"]) + timedelta(days=30)).isoformat()
        pip.setdefault("extensions", []).append({"on": today_str(), "notes": notes, "by": _actor_name(user)})
    else:
        pip["status"] = "CLOSED"
        pip["outcome"] = {"result": outcome, "notes": notes, "by": _actor_name(user), "on": now_iso()}
    stamp(pip, user)
    audit(user, "PMS_PIP_" + ("EXTENDED" if outcome == "EXTENDED" else "CLOSED"), MODULE, "pms_pip", pip_id, {"outcome": outcome, "reason": notes})
    return {"pip": _pip_view(pip, user)}
