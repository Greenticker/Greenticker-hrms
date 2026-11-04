"""
Performance Management (PMS) – Phase 4 and the brief's "Later" items:
  F7  bulk upload of goals & actuals with an error report
  F23 reminders (3 and 1 days before a deadline; alert the next level 3+ days overdue)
  F24 reports (status tracker, rating spread, final ratings, 360 summary)
  F11 continuous feedback notes
  F22 training needs (low-rated competencies)
"""

import asyncio
import os
from collections import Counter, defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.security import require_auth, require_role
from app.database import persistence
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.routes.performance import HR_ROLE, MODULE, _actor_name, _can_view_all, _kpi_section, _num, _text
from app.routes.performance_appraisal import compute as compute_appraisal
from app.routes.performance_feedback import compute_report_360
from app.services.mailer import _shell, esc, send_mail
from app.stores.db_store import db_store
from app.stores.pms_store import CHECKIN_PERIODS, DIRECTIONS, pms_store, stamp, validate_lines
from app.utils import pms_calc
from app.utils.jsutil import now_iso, now_ms, rand_base36, today_str

router = APIRouter(prefix="/performance")

INACTIVE = ("INACTIVE", "TERMINATED", "EXITED")
TRAINING_NEED_MAX = 2  # competency rated 2 or below is a training need


def _active_cycle() -> dict:
    cycle = pms_store.active_cycle()
    if not cycle:
        raise ApiError(400, "There is no active appraisal cycle.")
    return cycle


def _people() -> list:
    return [e for e in db_store.employees.values() if e.get("status") not in INACTIVE]


def _by_code() -> dict:
    return {(e.get("employeeCode") or "").strip().upper(): e for e in _people() if e.get("employeeCode")}


# ================================================================== F7 bulk upload

def _direction(value) -> Optional[str]:
    v = _text(value).upper()
    if v.startswith("HIGH"):
        return "HIGHER"
    if v.startswith("LOW"):
        return "LOWER"
    return v if v in DIRECTIONS else None


@router.post("/bulk/goals")
async def bulk_goals(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    """rows: [{rowNumber, employeeCode, kra, kpi, unit, direction, weight, target}]; commit=false is a dry run.

    An employee's goals are imported only if every row for them is valid and the sheet
    passes the goal rules, so a sheet is never half-loaded.
    """
    cycle = _active_cycle()
    body = await read_body(request)
    commit = bool(body.get("commit"))
    codes = _by_code()
    report, grouped = [], defaultdict(list)
    for i, raw in enumerate(body.get("rows") or [], 1):
        row_no = raw.get("rowNumber") or i + 1
        code = _text(raw.get("employeeCode")).upper()
        problems = []
        emp = codes.get(code)
        if not code:
            problems.append("Employee code is missing.")
        elif not emp:
            problems.append(f"No active employee with code {code}.")
        line = {
            "kra": _text(raw.get("kra")), "kpi": _text(raw.get("kpi")), "unit": _text(raw.get("unit")),
            "direction": _direction(raw.get("direction")), "weight": _num(raw.get("weight")), "target": _num(raw.get("target")),
        }
        for field in ("kra", "kpi", "unit"):
            if not line[field]:
                problems.append(f"{field.upper() if field != 'unit' else 'Unit'} is missing.")
        if not line["direction"]:
            problems.append('Direction must be "Higher" or "Lower".')
        if line["weight"] is None:
            problems.append("Weight must be a number (e.g. 30 for 30%).")
        if line["target"] is None:
            problems.append("Target must be a number.")
        report.append({"rowNumber": row_no, "employeeCode": code, "kpi": line["kpi"], "ok": not problems, "message": " ".join(problems)})
        if emp:
            grouped[emp["_id"]].append((report[-1], line))

    employees, imported = [], 0
    for emp_id, items in grouped.items():
        emp = db_store.employees[emp_id]
        sheet = pms_store.sheet_for(emp_id, cycle["_id"])
        lines = [l for _, l in items]
        issues = []
        if any(not r["ok"] for r, _ in items):
            issues.append("Some rows have errors.")
        if sheet and sheet["status"] != "DRAFT":
            issues.append(f"Goal sheet is already {sheet['status'].lower()}; goals can only be loaded into a draft.")
        issues += validate_lines(lines)
        ok = not issues
        if ok and commit:
            if not sheet:
                sheet = pms_store.create_sheet(emp_id, cycle, user)
            sheet["lines"] = [pms_calc.score_goal_line({"_id": f"line_{now_ms()}_{rand_base36(5)}", "libraryId": None, "actual": None, **l}) for l in lines]
            stamp(sheet, user)
            imported += 1
            audit(user, "PMS_GOALS_BULK_LOADED", MODULE, "pms_goal_sheet", sheet["_id"], {"lines": len(lines), "source": "excel"})
        employees.append({
            "employeeCode": emp.get("employeeCode"), "employeeName": pms_store.employee_name(emp_id),
            "lines": len(lines), "weightTotal": sum(l["weight"] or 0 for l in lines), "ok": ok, "issues": issues,
        })
    return {"commit": commit, "rows": report, "employees": sorted(employees, key=lambda e: e["employeeName"]), "imported": imported}


@router.post("/bulk/actuals")
async def bulk_actuals(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    """rows: [{rowNumber, employeeCode, kpi, actual}]; matches the KPI by name on a locked goal sheet."""
    cycle = _active_cycle()
    body = await read_body(request)
    commit = bool(body.get("commit"))
    codes = _by_code()
    report, applied = [], 0
    changed_sheets = defaultdict(list)
    for i, raw in enumerate(body.get("rows") or [], 1):
        row_no = raw.get("rowNumber") or i + 1
        code = _text(raw.get("employeeCode")).upper()
        kpi_name = _text(raw.get("kpi"))
        actual = _num(raw.get("actual"))
        problems, line, sheet = [], None, None
        emp = codes.get(code)
        if not emp:
            problems.append(f"No active employee with code {code}." if code else "Employee code is missing.")
        else:
            sheet = pms_store.sheet_for(emp["_id"], cycle["_id"])
            if not sheet or sheet["status"] != "LOCKED":
                problems.append("Goals are not locked yet, so actuals can't be recorded.")
            else:
                matches = [l for l in sheet["lines"] if l["kpi"].strip().lower() == kpi_name.lower()]
                if not matches:
                    problems.append(f'No KPI called "{kpi_name}" on this goal sheet.')
                elif len(matches) > 1:
                    problems.append(f'More than one KPI is called "{kpi_name}"; record this one on the goal sheet.')
                else:
                    line = matches[0]
        if actual is None or actual < 0:
            problems.append("Actual must be a number of 0 or more.")
        ok = not problems
        report.append({"rowNumber": row_no, "employeeCode": code, "kpi": kpi_name, "ok": ok, "message": " ".join(problems),
                       "old": line.get("actual") if line else None, "new": actual})
        if ok and commit and actual != line.get("actual"):
            changed_sheets[sheet["_id"]].append({"line": line["kpi"], "field": "actual", "old": line.get("actual"), "new": actual})
            line["actual"] = actual
            pms_calc.score_goal_line(line)
            applied += 1
    for sid, changes in changed_sheets.items():
        stamp(pms_store.pmsGoalSheets[sid], user)
        audit(user, "PMS_ACTUALS_RECORDED", MODULE, "pms_goal_sheet", sid, {"changes": changes, "reason": "Excel upload"})
    return {"commit": commit, "rows": report, "applied": applied}


# ==================================================================== F23 reminders

def _phase_end(cycle: dict, key: str) -> Optional[str]:
    return next((p["end"] for p in cycle.get("phases") or [] if p["key"] == key), None)


def pending_tasks(cycle: dict) -> list:
    """Every open task in the cycle: who must act, by when, and who to alert if it's late."""
    tasks = []
    hr = "HR"

    def add(key, label, phase, who, about, escalate):
        due = _phase_end(cycle, phase)
        if due and who:
            tasks.append({"key": key, "label": label, "due": due, "who": who, "about": about, "escalateTo": escalate or hr})

    fb_closed = (cycle.get("feedback360") or {}).get("closed")
    for emp in _people():
        eid = emp["_id"]
        mgr = pms_store.manager_id(eid) or hr
        rev = pms_store.manager_id(mgr) if mgr != hr else None
        name = pms_store.employee_name(eid)
        sheet = pms_store.sheet_for(eid, cycle["_id"])
        status = (sheet or {}).get("status") or "DRAFT"
        if status == "DRAFT":
            add(f"goals:{eid}", "Submit your goal sheet", "goal_setting", eid, eid, mgr)
        elif status == "SUBMITTED":
            add(f"goals-mgr:{eid}", f"Approve {name}'s goal sheet", "goal_setting", mgr, eid, rev)
        elif status == "APPROVED":
            add(f"goals-rev:{eid}", f"Approve {name}'s goal sheet as reviewer", "goal_setting", (sheet or {}).get("reviewerId") or hr, eid, hr)

        if status == "LOCKED":
            for period, label, phase in CHECKIN_PERIODS:
                doc = next((c for c in pms_store.pmsCheckins.values() if c["employeeId"] == eid and c["cycleId"] == cycle["_id"] and c["period"] == period), None)
                st = (doc or {}).get("status") or "OPEN"
                if st == "OPEN":
                    add(f"checkin:{period}:{eid}", f"Complete your {label}", phase, eid, eid, mgr)
                elif st == "WITH_MANAGER":
                    add(f"checkin-mgr:{period}:{eid}", f"Review {name}'s {label}", phase, mgr, eid, rev)

        if not fb_closed:
            nom = next((n for n in pms_store.pms360Nominations.values() if n["rateeId"] == eid and n["cycleId"] == cycle["_id"]), None)
            nst = (nom or {}).get("status") or "DRAFT"
            if nst == "DRAFT":
                add(f"nom:{eid}", "Nominate your 360° feedback givers", "raters_360", eid, eid, mgr)
            elif nst == "SUBMITTED":
                add(f"nom-mgr:{eid}", f"Approve {name}'s 360° nominations", "raters_360", mgr, eid, rev)

        ap = pms_store.appraisal_for(eid, cycle["_id"])
        ast = (ap or {}).get("status")
        if status == "LOCKED" and ast in (None, "SELF"):
            add(f"self:{eid}", "Complete your self appraisal", "self_appraisal", eid, eid, mgr)
        elif ast == "MANAGER":
            add(f"appr-mgr:{eid}", f"Complete {name}'s appraisal", "manager_appraisal", mgr, eid, rev)
        elif ast == "REVIEWER":
            add(f"appr-rev:{eid}", f"Approve {name}'s appraisal", "reviewer_approval", (ap or {}).get("reviewerId") or hr, eid, hr)

    if not fb_closed:
        for a in pms_store.pms360Assignments.values():
            if a["cycleId"] == cycle["_id"] and a["status"] == "PENDING":
                add(f"fb:{a['_id']}", f"Give 360° feedback for {pms_store.employee_name(a['rateeId'])}", "feedback_360",
                    a["raterId"], a["rateeId"], pms_store.manager_id(a["raterId"]))
    pending_cal = sum(1 for a in pms_store.pmsAppraisals.values() if a["cycleId"] == cycle["_id"] and a["status"] == "CALIBRATION")
    if pending_cal:
        add("calibration", f"Calibrate {pending_cal} ratings", "calibration", hr, None, None)
    pending_pub = sum(1 for a in pms_store.pmsAppraisals.values() if a["cycleId"] == cycle["_id"] and a["status"] == "FINAL")
    if pending_pub:
        add("publish", f"Publish {pending_pub} locked ratings", "publish", hr, None, None)
    return tasks


def _kind(due: str, today: str) -> Optional[str]:
    """Sheet 3_Workflow: remind 3 and 1 days before; alert the next level 3+ days overdue."""
    days = (date.fromisoformat(due) - date.fromisoformat(today)).days
    if 1 < days <= 3:
        return "REMIND_3"
    if 0 <= days <= 1:
        return "REMIND_1"
    if days <= -3:
        return "ESCALATE"
    return None


def _users_for(who: str) -> list:
    if who == "HR":
        return [u for u in db_store.users.values() if u.get("role") == HR_ROLE and u.get("isActive", True)]
    u = pms_store.user_for_employee(who)
    return [u] if u else []


def _recipients(task: dict, kind: str) -> list:
    return _users_for(task["escalateTo"] if kind == "ESCALATE" else task["who"])


def _message(task: dict, kind: str) -> tuple:
    due = date.fromisoformat(task["due"]).strftime("%d %b %Y")
    if kind == "ESCALATE":
        late_by = pms_store.employee_name(task["who"]) if task["who"] != "HR" else "HR"
        return (f"Overdue: {task['label']}", f'"{task["label"]}" was due on {due} and is still pending with {late_by}. Please follow up.')
    when = "in 3 days" if kind == "REMIND_3" else "tomorrow or today"
    return (f"Reminder: {task['label']}", f"{task['label']} is due {when} ({due}). Open Performance in the HRMS to complete it.")


def reminder_plan(cycle: dict, today: Optional[str] = None) -> list:
    today = today or today_str()
    log = pms_store.pmsSettings.get("reminderLog", {}).get("sent", {})
    plan = []
    for task in pending_tasks(cycle):
        kind = _kind(task["due"], today)
        if not kind:
            continue
        title, message = _message(task, kind)
        plan.append({**task, "kind": kind, "title": title, "message": message,
                     "recipients": [{"userId": u["_id"], "email": u.get("email"), "name": f"{u.get('firstName', '')} {u.get('lastName', '')}".strip()} for u in _recipients(task, kind)],
                     "alreadySent": f"{task['key']}|{kind}" in log})
    return plan


async def run_reminders(actor: Optional[dict] = None, today: Optional[str] = None) -> dict:
    cycle = pms_store.active_cycle()
    if not cycle:
        return {"sent": 0, "notifications": 0, "emails": 0}
    settings = pms_store.pmsSettings.setdefault("reminderLog", {"_id": "reminderLog", "sent": {}})
    sent = notifications = emails = 0
    for item in reminder_plan(cycle, today):
        if item["alreadySent"] or not item["recipients"]:
            continue
        for r in item["recipients"]:
            db_store.notifications.insert(0, {
                "_id": f"notif_{now_ms()}_{rand_base36(5)}", "recipientUserId": r["userId"],
                "title": item["title"], "message": item["message"], "type": "PERFORMANCE",
                "isRead": False, "createdAt": now_iso(),
            })
            notifications += 1
            if r.get("email"):
                html = _shell(item["title"], f"<p>Hi {esc(r['name'] or 'there')},</p><p>{esc(item['message'])}</p>")
                result = await send_mail({"to": r["email"], "subject": item["title"], "html": html, "text": item["message"]})
                emails += 1 if result.get("delivered") or result.get("simulated") else 0
        settings["sent"][f"{item['key']}|{item['kind']}"] = {"on": now_iso(), "to": [r["userId"] for r in item["recipients"]]}
        sent += 1
    if sent and actor:
        audit(actor, "PMS_REMINDERS_SENT", MODULE, "pms_settings", "reminderLog", {"reminders": sent, "notifications": notifications})
    return {"sent": sent, "notifications": notifications, "emails": emails}


def reminders_enabled() -> bool:
    return bool(pms_store.pmsSettings.get("reminders", {}).get("enabled"))


async def reminder_loop() -> None:
    """Background job (long-running servers only): send due reminders every 6 hours when HR has
    switched them on. On Vercel, Vercel Cron calls /api/performance/reminders/cron instead."""
    while True:
        await asyncio.sleep(60)
        try:
            # Same load-then-save wrapper as a request, so changes reach MongoDB safely
            async with persistence.request_scope():
                if reminders_enabled():
                    await run_reminders()
        except Exception as err:  # noqa: BLE001 - never kill the loop
            print("[pms] reminder run failed:", err)
        await asyncio.sleep(6 * 3600 - 60)


@router.get("/reminders/cron")
async def reminders_cron(request: Request):
    """Called by Vercel Cron (see backend/vercel.json), which sends 'Authorization: Bearer <CRON_SECRET>'."""
    secret = os.environ.get("CRON_SECRET") or ""
    if not secret or request.headers.get("authorization") != f"Bearer {secret}":
        raise ApiError(401, "Not authorised.")
    if not reminders_enabled():
        return {"skipped": True, "reason": "Automatic reminders are switched off."}
    return await run_reminders()


@router.get("/reminders")
async def reminders_preview(user: dict = Depends(require_role(HR_ROLE))):
    cycle = pms_store.active_cycle()
    plan = reminder_plan(cycle) if cycle else []
    return {"enabled": reminders_enabled(), "plan": plan,
            "pendingTasks": len(pending_tasks(cycle)) if cycle else 0}


@router.put("/reminders/settings")
async def reminders_settings(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    enabled = bool((await read_body(request)).get("enabled"))
    old = reminders_enabled()
    pms_store.pmsSettings["reminders"] = stamp({"_id": "reminders", "enabled": enabled}, user)
    audit(user, "PMS_REMINDERS_" + ("ENABLED" if enabled else "DISABLED"), MODULE, "pms_settings", "reminders", {"field": "enabled", "old": old, "new": enabled})
    return {"enabled": enabled}


@router.post("/reminders/run")
async def reminders_run(user: dict = Depends(require_role(HR_ROLE))):
    _active_cycle()
    return await run_reminders(user)


# ===================================================================== F24 reports

def _report_people(user: dict) -> list:
    if _can_view_all(user):
        return _people()
    me = user.get("employeeId")
    team = [e for e in _people() if me and (pms_store.manager_id(e["_id"]) == me or pms_store.manager_id(pms_store.manager_id(e["_id"])) == me)]
    if not team:
        raise ApiError(403, "Reports are available to HR, management and people managers.")
    return team


@router.get("/reports")
async def reports(user: dict = Depends(require_auth)):
    cycle = _active_cycle()
    people = _report_people(user)
    fb_closed = bool((cycle.get("feedback360") or {}).get("closed"))
    stages = {"goals": Counter(), "appraisal": Counter(), "nominations": Counter()}
    checkins = {p: Counter() for p, _, _ in CHECKIN_PERIODS}
    by_dept = defaultdict(lambda: {"employees": 0, "goalsLocked": 0, "appraisalsDone": 0, "ratings": Counter()})
    final_rows, rows_360, training = [], [], []
    feedback_assigned = feedback_given = 0

    for emp in people:
        eid, dept = emp["_id"], emp.get("department") or "Unassigned"
        d = by_dept[dept]
        d["employees"] += 1
        sheet = pms_store.sheet_for(eid, cycle["_id"])
        gst = (sheet or {}).get("status") or "NOT_STARTED"
        stages["goals"][gst] += 1
        d["goalsLocked"] += gst == "LOCKED"
        for p, _, _ in CHECKIN_PERIODS:
            doc = next((c for c in pms_store.pmsCheckins.values() if c["employeeId"] == eid and c["cycleId"] == cycle["_id"] and c["period"] == p), None)
            checkins[p][(doc or {}).get("status") or "OPEN"] += 1
        nom = next((n for n in pms_store.pms360Nominations.values() if n["rateeId"] == eid and n["cycleId"] == cycle["_id"]), None)
        stages["nominations"][(nom or {}).get("status") or "NOT_STARTED"] += 1
        assigned = [a for a in pms_store.pms360Assignments.values() if a["rateeId"] == eid and a["cycleId"] == cycle["_id"]]
        feedback_assigned += len(assigned)
        feedback_given += sum(a["status"] == "SUBMITTED" for a in assigned)

        ap = pms_store.appraisal_for(eid, cycle["_id"])
        ast = (ap or {}).get("status") or "NOT_STARTED"
        stages["appraisal"][ast] += 1
        sc = compute_appraisal(ap) if ap else None
        base = {"employeeId": eid, "employeeName": pms_store.employee_name(eid), "employeeCode": emp.get("employeeCode"),
                "department": dept, "grade": pms_store.grade_of(eid), "managerName": pms_store.employee_name(pms_store.manager_id(eid)) or "HR"}
        if ap and ast in ("CALIBRATION", "FINAL", "PUBLISHED", "APPEAL", "CLOSED"):
            d["appraisalsDone"] += 1
            if sc["finalRating"]:
                d["ratings"][sc["finalRating"]] += 1
            final_rows.append({**base, "status": ast, "kpiScore": sc["kpiScore"], "competencyScore": sc["competencyScore"],
                               "score360": sc["score360"], "finalScore": sc["finalScore"], "finalRating": sc["finalRating"],
                               "publishedOn": ap.get("publishedOn")})

        # F22: competencies the manager rated 2 or below, plus weak 360 competency scores
        comp_names = {c["_id"]: c["name"] for c in pms_store.pmsCompetencies.values()}
        for cid, rating in ((ap or {}).get("manager") or {}).get("competencyRatings", {}).items():
            if rating <= TRAINING_NEED_MAX:
                training.append({**base, "competency": comp_names.get(cid, cid), "score": rating, "source": "Manager rating"})
        if fb_closed and assigned:
            rep = compute_report_360(eid, cycle["_id"])
            rows_360.append({**base, "score360": rep["score360"], "responses": sum(g["responses"] or 0 for g in rep["groups"]),
                             "groupsShown": sum(g["counted"] for g in rep["groups"]),
                             "competencies": {c["name"]: c["score"] for c in rep["competencies"]}})
            for c in rep["competencies"]:
                if c["score"] is not None and c["score"] <= TRAINING_NEED_MAX:
                    training.append({**base, "competency": c["name"], "score": c["score"], "source": "360° feedback"})

    rated = Counter()
    for d in by_dept.values():
        rated.update(d["ratings"])
    total_rated = sum(rated.values())
    spread = {str(k): {"count": rated[k], "pct": round(rated[k] / total_rated * 100, 1) if total_rated else 0} for k in (5, 4, 3, 2, 1)}
    return {
        "cycle": {"_id": cycle["_id"], "name": cycle["name"]},
        "scope": "all" if _can_view_all(user) else "team",
        "headcount": len(people),
        "status": {
            "goals": dict(stages["goals"]), "nominations": dict(stages["nominations"]), "appraisal": dict(stages["appraisal"]),
            "checkins": {p: dict(c) for p, c in checkins.items()},
            "feedback": {"assigned": feedback_assigned, "given": feedback_given},
        },
        "departments": [
            {"department": k, "employees": v["employees"], "goalsLocked": v["goalsLocked"], "appraisalsDone": v["appraisalsDone"],
             "ratings": {str(r): v["ratings"][r] for r in (5, 4, 3, 2, 1)}}
            for k, v in sorted(by_dept.items())
        ],
        "ratingSpread": spread,
        "finalRatings": sorted(final_rows, key=lambda r: (-(r["finalRating"] or 0), r["employeeName"])),
        "report360": sorted(rows_360, key=lambda r: r["employeeName"]) if fb_closed else [],
        "feedback360Closed": fb_closed,
        "trainingNeeds": sorted(training, key=lambda r: (r["employeeName"], r["competency"])),
    }


# ============================================================ F11 continuous feedback

NOTE_KINDS = ("PRAISE", "SUGGESTION")


@router.get("/people")
async def people_directory(user: dict = Depends(require_auth)):
    """Colleagues someone can send a feedback note to (people with a login)."""
    me = user.get("employeeId")
    rows = [{"employeeId": e["_id"], "name": pms_store.employee_name(e["_id"]), "designation": e.get("designation"), "department": e.get("department")}
            for e in _people() if e["_id"] != me and pms_store.user_for_employee(e["_id"])]
    return {"people": sorted(rows, key=lambda r: r["name"])}


def _note_view(n: dict) -> dict:
    return {**n, "fromName": pms_store.employee_name(n["fromEmployeeId"]), "toName": pms_store.employee_name(n["toEmployeeId"])}


@router.post("/notes")
async def create_note(request: Request, user: dict = Depends(require_auth)):
    me = user.get("employeeId")
    if not pms_store.employee(me):
        raise ApiError(403, "Only employees can send feedback notes.")
    body = await read_body(request)
    to = _text(body.get("toEmployeeId"))
    text = _text(body.get("text"))
    kind = _text(body.get("kind")).upper() or "PRAISE"
    if to == me:
        raise ApiError(400, "You can't send a note to yourself.")
    if not pms_store.employee(to):
        raise ApiError(400, "Choose a colleague.")
    if not text or len(text) > 500:
        raise ApiError(400, "Write a note of up to 500 characters.")
    if kind not in NOTE_KINDS:
        raise ApiError(400, "Note type must be PRAISE or SUGGESTION.")
    nid = f"note_{now_ms()}_{rand_base36(5)}"
    note = {"_id": nid, "fromEmployeeId": me, "toEmployeeId": to, "kind": kind, "text": text, "createdOn": now_iso()}
    pms_store.pmsNotes[nid] = note
    recipient = pms_store.user_for_employee(to)
    if recipient:
        db_store.notifications.insert(0, {
            "_id": f"notif_{now_ms()}_{rand_base36(5)}", "recipientUserId": recipient["_id"],
            "title": "New feedback note" if kind == "SUGGESTION" else "You've been recognised",
            "message": f"{_actor_name(user)}: {text[:140]}", "type": "PERFORMANCE", "isRead": False, "createdAt": now_iso(),
        })
    return {"note": _note_view(note)}


@router.get("/notes")
async def list_notes(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    """Notes received by an employee: visible to them, their manager, reviewer, HR and management."""
    me = user.get("employeeId")
    target = employeeId or me
    allowed = target == me or _can_view_all(user) or pms_store.manager_id(target) == me or pms_store.manager_id(pms_store.manager_id(target)) == me
    if not target or not allowed:
        raise ApiError(403, "You cannot view these notes.")
    received = [_note_view(n) for n in pms_store.pmsNotes.values() if n["toEmployeeId"] == target]
    sent = [_note_view(n) for n in pms_store.pmsNotes.values() if n["fromEmployeeId"] == me] if target == me else []
    order = lambda ns: sorted(ns, key=lambda n: n["createdOn"], reverse=True)
    return {"received": order(received), "sent": order(sent)}
