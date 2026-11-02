"""
Performance Management (PMS) – Phase 2: quarterly check-ins, mid-year review and
360° feedback (nominate raters, feedback form, anonymous report).

Anonymity (sheet 1_Overview / 7_Roles): 360 answers are stored in pms360Responses
without the rater's id, so no API – and no one reading the data – can tell who
gave which answer. Group results are shown only with 3+ replies (manager 1+).
"""

import random
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.routes.performance import HR_ROLE, MODULE, _actor_name, _can_view_all, _cycle_or_404, _num, _text
from app.stores.db_store import db_store
from app.stores.pms_store import CHECKIN_PERIODS, GROUPS_360, MAX_RATERS_360, pms_store, stamp
from app.utils import pms_calc
from app.utils.jsutil import now_iso, now_ms, rand_base36, today_str

router = APIRouter(prefix="/performance")

PERIOD_KEYS = {key: (label, phase) for key, label, phase in CHECKIN_PERIODS}
GROUP_LABEL = {"MANAGER": "Manager", "PEER": "Peers", "TEAM": "Team members", "OTHER_DEPT": "Other departments"}
INACTIVE = ("INACTIVE", "TERMINATED", "EXITED")


# ------------------------------------------------------------------ helpers

def _active_cycle_or_400() -> dict:
    cycle = pms_store.active_cycle()
    if not cycle:
        raise ApiError(400, "There is no active appraisal cycle.")
    return cycle


def _employee_or_404(employee_id: str) -> dict:
    emp = pms_store.employee(employee_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    return emp


def _rel(employee_id: str, user: dict) -> dict:
    me = user.get("employeeId")
    manager = pms_store.manager_id(employee_id)
    is_hr = user.get("role") == HR_ROLE
    return {
        "owner": bool(me) and me == employee_id,
        "manager": (bool(me) and manager == me) or (not manager and is_hr),
        "reviewer": bool(me) and bool(manager) and pms_store.manager_id(manager) == me,
        "hr": is_hr,
        "viewAll": _can_view_all(user),
    }


def _require_view(employee_id: str, user: dict) -> dict:
    rel = _rel(employee_id, user)
    if not any(rel.values()):
        raise ApiError(403, "You cannot view this employee's performance records.")
    return rel


def _phase(cycle: dict, key: str) -> Optional[dict]:
    return next((p for p in cycle.get("phases") or [] if p.get("key") == key), None)


def _fb_state(cycle: dict) -> dict:
    return cycle.get("feedback360") or {"closed": False, "released": False}


# ---------------------------------------------------------------- check-ins

def _checkin_doc(employee_id: str, cycle_id: str, period: str) -> Optional[dict]:
    return next(
        (c for c in pms_store.pmsCheckins.values()
         if c["employeeId"] == employee_id and c["cycleId"] == cycle_id and c["period"] == period),
        None,
    )


def _checkin_view(employee_id: str, cycle: dict, period: str, rel: dict, sheet: Optional[dict]) -> dict:
    label, phase_key = PERIOD_KEYS[period]
    doc = _checkin_doc(employee_id, cycle["_id"], period) or {}
    status = doc.get("status") or "OPEN"
    phase = _phase(cycle, phase_key) or {}
    locked = bool(sheet) and sheet.get("status") == "LOCKED"
    active = cycle.get("status") == "ACTIVE"
    progress = {p["lineId"]: p.get("value") for p in doc.get("progress") or []}
    lines = []
    for line in (sheet or {}).get("lines") or []:
        value = progress.get(line["_id"])
        ach = pms_calc.achievement(line.get("direction", "HIGHER"), line.get("target"), value)
        lines.append({
            "lineId": line["_id"], "kpi": line.get("kpi"), "unit": line.get("unit"),
            "direction": line.get("direction"), "weight": line.get("weight"), "target": line.get("target"),
            "value": value, "achievement": round(ach, 4) if ach is not None else None, "score": pms_calc.kpi_score(ach),
        })
    return {
        "period": period,
        "label": label,
        "start": phase.get("start"),
        "due": phase.get("end"),
        "overdue": bool(phase.get("end")) and status != "DONE" and today_str() > phase["end"],
        "status": status,
        "employeeComment": doc.get("employeeComment") or "",
        "managerComment": doc.get("managerComment") or "",
        "submittedOn": doc.get("submittedOn"),
        "completedOn": doc.get("completedOn"),
        "completedBy": doc.get("completedBy"),
        "lines": lines,
        "permissions": {
            "canEdit": active and locked and status == "OPEN" and rel["owner"],
            "canSubmit": active and locked and status == "OPEN" and rel["owner"],
            "canComplete": active and locked and status == "WITH_MANAGER" and rel["manager"],
        },
    }


@router.get("/checkins/{employee_id}")
async def list_checkins(employee_id: str, user: dict = Depends(require_auth)):
    _employee_or_404(employee_id)
    rel = _require_view(employee_id, user)
    cycle = _active_cycle_or_400()
    sheet = pms_store.sheet_for(employee_id, cycle["_id"])
    return {
        "goalsLocked": bool(sheet) and sheet.get("status") == "LOCKED",
        "checkins": [_checkin_view(employee_id, cycle, key, rel, sheet) for key, _, _ in CHECKIN_PERIODS],
    }


def _checkin_for_write(employee_id: str, period: str, user: dict, perm: str, message: str):
    if period not in PERIOD_KEYS:
        raise ApiError(404, "Unknown check-in period.")
    _employee_or_404(employee_id)
    cycle = _active_cycle_or_400()
    sheet = pms_store.sheet_for(employee_id, cycle["_id"])
    rel = _rel(employee_id, user)
    view = _checkin_view(employee_id, cycle, period, rel, sheet)
    if not view["permissions"][perm]:
        raise ApiError(403, message)
    doc = _checkin_doc(employee_id, cycle["_id"], period)
    if not doc:
        cid = f"checkin_{now_ms()}_{rand_base36(5)}"
        doc = stamp({"_id": cid, "cycleId": cycle["_id"], "employeeId": employee_id, "sheetId": sheet["_id"],
                     "period": period, "status": "OPEN", "progress": [], "employeeComment": "", "managerComment": ""},
                    user, created=True)
        pms_store.pmsCheckins[cid] = doc
    return cycle, sheet, rel, doc


@router.put("/checkins/{employee_id}/{period}")
async def save_checkin(employee_id: str, period: str, request: Request, user: dict = Depends(require_auth)):
    cycle, sheet, rel, doc = _checkin_for_write(employee_id, period, user, "canEdit", "This check-in cannot be edited.")
    body = await read_body(request)
    line_ids = {l["_id"] for l in sheet.get("lines") or []}
    progress = []
    for line_id, value in (body.get("progress") or {}).items():
        if line_id not in line_ids:
            continue
        v = _num(value)
        if v is not None and v < 0:
            raise ApiError(400, "Progress values cannot be negative.")
        progress.append({"lineId": line_id, "value": v})
    doc["progress"] = progress
    doc["employeeComment"] = _text(body.get("employeeComment"))
    stamp(doc, user)
    return {"checkin": _checkin_view(employee_id, cycle, period, rel, sheet)}


@router.post("/checkins/{employee_id}/{period}/submit")
async def submit_checkin(employee_id: str, period: str, user: dict = Depends(require_auth)):
    cycle, sheet, rel, doc = _checkin_for_write(employee_id, period, user, "canSubmit", "This check-in cannot be submitted.")
    if not doc.get("employeeComment"):
        raise ApiError(400, "Add your comments on progress before sending this to your manager.")
    doc["status"] = "WITH_MANAGER"
    doc["submittedOn"] = now_iso()
    stamp(doc, user)
    audit(user, "PMS_CHECKIN_SUBMITTED", MODULE, "pms_checkin", doc["_id"],
          {"period": period, "field": "status", "old": "OPEN", "new": "WITH_MANAGER"})
    return {"checkin": _checkin_view(employee_id, cycle, period, rel, sheet)}


@router.post("/checkins/{employee_id}/{period}/complete")
async def complete_checkin(employee_id: str, period: str, request: Request, user: dict = Depends(require_auth)):
    cycle, sheet, rel, doc = _checkin_for_write(employee_id, period, user, "canComplete", "Only the manager can complete this check-in.")
    comment = _text((await read_body(request)).get("managerComment"))
    if not comment:
        raise ApiError(400, "Add your comments before completing the check-in.")
    doc["managerComment"] = comment
    doc["status"] = "DONE"
    doc["completedOn"] = now_iso()
    doc["completedBy"] = _actor_name(user)
    stamp(doc, user)
    audit(user, "PMS_CHECKIN_COMPLETED", MODULE, "pms_checkin", doc["_id"],
          {"period": period, "field": "status", "old": "WITH_MANAGER", "new": "DONE"})
    return {"checkin": _checkin_view(employee_id, cycle, period, rel, sheet)}


# ------------------------------------------------------------ 360 questions

@router.get("/360/questions")
async def list_questions(_: dict = Depends(require_auth)):
    pms_store.ensure_seeded_360()
    out = []
    for q in sorted(pms_store.pms360Questions.values(), key=lambda q: q.get("order") or 0):
        comp = pms_store.pmsCompetencies.get(q.get("competencyId")) or {}
        out.append({**q, "competencyName": comp.get("name"), "appliesTo": comp.get("appliesTo")})
    return {"questions": out}


def _question_fields(body: dict) -> dict:
    text = _text(body.get("text"))
    if not text:
        raise ApiError(400, "Question text is required.")
    comp_id = _text(body.get("competencyId"))
    if comp_id not in pms_store.pmsCompetencies:
        raise ApiError(400, "Choose the competency this question measures.")
    order = _num(body.get("order"))
    return {"text": text, "competencyId": comp_id, "order": int(order) if order is not None else len(pms_store.pms360Questions) + 1}


def _no_live_feedback() -> None:
    cycle = pms_store.active_cycle()
    if cycle and any(a["cycleId"] == cycle["_id"] and a["status"] == "SUBMITTED" for a in pms_store.pms360Assignments.values()):
        raise ApiError(409, "Feedback has already been given this cycle, so the questions can't change until next cycle.")


@router.post("/360/questions")
async def create_question(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    _no_live_feedback()
    fields = _question_fields(await read_body(request))
    qid = f"q360_{now_ms()}_{rand_base36(5)}"
    q = stamp({"_id": qid, **fields}, user, created=True)
    pms_store.pms360Questions[qid] = q
    audit(user, "PMS_360_QUESTION_CREATED", MODULE, "pms_360_question", qid, fields)
    return {"question": q}


@router.put("/360/questions/{qid}")
async def update_question(qid: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    q = pms_store.pms360Questions.get(qid)
    if not q:
        raise ApiError(404, "Question not found.")
    _no_live_feedback()
    fields = _question_fields(await read_body(request))
    changes = [{"field": k, "old": q.get(k), "new": v} for k, v in fields.items() if q.get(k) != v]
    q.update(fields)
    stamp(q, user)
    audit(user, "PMS_360_QUESTION_UPDATED", MODULE, "pms_360_question", qid, {"changes": changes})
    return {"question": q}


@router.delete("/360/questions/{qid}")
async def delete_question(qid: str, user: dict = Depends(require_role(HR_ROLE))):
    _no_live_feedback()
    q = pms_store.pms360Questions.pop(qid, None)
    if not q:
        raise ApiError(404, "Question not found.")
    audit(user, "PMS_360_QUESTION_DELETED", MODULE, "pms_360_question", qid, {"text": q.get("text")})
    return {"success": True}


# ------------------------------------------------------ 360 cycle controls

@router.post("/cycles/{cycle_id}/360-close")
async def close_360(cycle_id: str, user: dict = Depends(require_role(HR_ROLE))):
    cycle = _cycle_or_404(cycle_id)
    state = _fb_state(cycle)
    if state.get("closed"):
        raise ApiError(400, "360° feedback is already closed.")
    cycle["feedback360"] = {**state, "closed": True, "closedOn": now_iso(), "closedBy": _actor_name(user)}
    stamp(cycle, user)
    audit(user, "PMS_360_CLOSED", MODULE, "pms_cycle", cycle_id, {"field": "feedback360.closed", "old": False, "new": True})
    return {"cycle": cycle}


@router.post("/cycles/{cycle_id}/360-release")
async def release_360(cycle_id: str, user: dict = Depends(require_role(HR_ROLE))):
    cycle = _cycle_or_404(cycle_id)
    state = _fb_state(cycle)
    if not state.get("closed"):
        raise ApiError(400, "Close 360° feedback before releasing results to employees.")
    cycle["feedback360"] = {**state, "released": True, "releasedOn": now_iso(), "releasedBy": _actor_name(user)}
    stamp(cycle, user)
    audit(user, "PMS_360_RELEASED", MODULE, "pms_cycle", cycle_id, {"field": "feedback360.released", "old": False, "new": True})
    return {"cycle": cycle}


# --------------------------------------------------- 360 rater assignments
# (declared before /360/{employee_id} so the literal paths win)

@router.get("/360/assignments/mine")
async def my_assignments(user: dict = Depends(require_auth)):
    cycle = pms_store.active_cycle()
    me = user.get("employeeId")
    if not cycle or not me:
        return {"assignments": [], "closed": False}
    rows = []
    for a in pms_store.pms360Assignments.values():
        if a["cycleId"] != cycle["_id"] or a["raterId"] != me:
            continue
        ratee = pms_store.employee(a["rateeId"]) or {}
        rows.append({
            "_id": a["_id"], "rateeId": a["rateeId"], "rateeName": pms_store.employee_name(a["rateeId"]),
            "rateeDesignation": ratee.get("designation"), "rateeDepartment": ratee.get("department"),
            "group": a["group"], "status": a["status"],
        })
    phase = _phase(cycle, "feedback_360") or {}
    return {"assignments": sorted(rows, key=lambda r: (r["status"] != "PENDING", r["rateeName"])),
            "closed": bool(_fb_state(cycle).get("closed")), "due": phase.get("end")}


def _my_pending_assignment(assignment_id: str, user: dict) -> tuple:
    a = pms_store.pms360Assignments.get(assignment_id)
    if not a or a["raterId"] != user.get("employeeId"):
        raise ApiError(404, "Feedback request not found.")
    cycle = pms_store.pmsCycles.get(a["cycleId"]) or {}
    if cycle.get("status") != "ACTIVE" or _fb_state(cycle).get("closed"):
        raise ApiError(400, "360° feedback for this cycle is closed.")
    if a["status"] != "PENDING":
        raise ApiError(400, "You have already given this feedback. Answers can't be viewed or changed after submitting.")
    return a, cycle


@router.get("/360/assignments/{assignment_id}/form")
async def feedback_form(assignment_id: str, user: dict = Depends(require_auth)):
    pms_store.ensure_seeded_360()
    a, _ = _my_pending_assignment(assignment_id, user)
    return {
        "assignmentId": a["_id"],
        "rateeName": pms_store.employee_name(a["rateeId"]),
        "group": a["group"],
        "questions": [{"_id": q["_id"], "text": q["text"], "competencyName": q["competencyName"]}
                      for q in pms_store.questions_for(a["rateeId"])],
    }


@router.post("/360/assignments/{assignment_id}/submit")
async def submit_feedback(assignment_id: str, request: Request, user: dict = Depends(require_auth)):
    a, cycle = _my_pending_assignment(assignment_id, user)
    body = await read_body(request)
    questions = pms_store.questions_for(a["rateeId"])
    raw = body.get("answers") or {}
    answers = {}
    for q in questions:
        score = _num(raw.get(q["_id"]))
        if score is None or score not in (1, 2, 3, 4, 5):
            raise ApiError(400, "Rate every question from 1 to 5.")
        answers[q["_id"]] = int(score)
    comment = _text(body.get("comment"))
    if len(comment) > 2000:
        raise ApiError(400, "Keep the comment under 2000 characters.")
    # No rater id, no time-based id, no timestamp, and stored in shuffled order: nothing
    # links a response to the assignment (or audit entry) that produced it.
    rid = f"r360_{rand_base36(16)}"
    pms_store.pms360Responses[rid] = {
        "_id": rid, "cycleId": a["cycleId"], "rateeId": a["rateeId"], "group": a["group"],
        "answers": answers, "comment": comment,
    }
    items = list(pms_store.pms360Responses.items())
    random.shuffle(items)
    pms_store.pms360Responses.clear()
    pms_store.pms360Responses.update(items)
    a["status"] = "SUBMITTED"
    a["submittedOn"] = today_str()
    audit(user, "PMS_360_FEEDBACK_GIVEN", MODULE, "pms_360_assignment", a["_id"], {"group": a["group"]})
    return {"success": True}


# --------------------------------------------------------- 360 nominations

def _nomination(employee_id: str, cycle_id: str) -> Optional[dict]:
    return next(
        (n for n in pms_store.pms360Nominations.values() if n["rateeId"] == employee_id and n["cycleId"] == cycle_id),
        None,
    )


def _nom_permissions(nom: Optional[dict], cycle: dict, rel: dict) -> dict:
    status = (nom or {}).get("status") or "DRAFT"
    open_ = cycle.get("status") == "ACTIVE" and not _fb_state(cycle).get("closed")
    approver = rel["manager"] or rel["hr"]
    return {
        "canEdit": open_ and ((status == "DRAFT" and (rel["owner"] or approver)) or (status == "SUBMITTED" and approver)),
        "canSubmit": open_ and status == "DRAFT" and rel["owner"],
        "canApprove": open_ and status in ("DRAFT", "SUBMITTED") and approver and not rel["owner"],
        "canSendBack": open_ and status == "SUBMITTED" and approver and not rel["owner"],
    }


def _rater_row(employee_id: str, rater_id: str) -> dict:
    emp = pms_store.employee(rater_id) or {}
    return {
        "employeeId": rater_id, "name": pms_store.employee_name(rater_id),
        "designation": emp.get("designation"), "department": emp.get("department"),
        "group": pms_store.group_360(employee_id, rater_id),
    }


def _progress(employee_id: str, cycle_id: str, rel: dict) -> dict:
    assigned = [a for a in pms_store.pms360Assignments.values() if a["rateeId"] == employee_id and a["cycleId"] == cycle_id]
    total = {"assigned": len(assigned), "submitted": sum(a["status"] == "SUBMITTED" for a in assigned)}
    if rel["owner"] and not (rel["manager"] or rel["viewAll"]):
        # Per-group live counts would let the employee work out who has replied
        return {"total": total, "groups": None}
    groups = {g: {"assigned": 0, "submitted": 0} for g in GROUPS_360}
    for a in assigned:
        groups[a["group"]]["assigned"] += 1
        groups[a["group"]]["submitted"] += a["status"] == "SUBMITTED"
    return {"total": total, "groups": groups}


@router.get("/360/overview")
async def overview_360(user: dict = Depends(require_auth)):
    if not _can_view_all(user):
        raise ApiError(403, "Only HR and management can see the 360° tracker.")
    cycle = pms_store.active_cycle()
    if not cycle:
        return {"cycle": None, "rows": []}
    rows = []
    for e in db_store.employees.values():
        if e.get("status") in INACTIVE:
            continue
        nom = _nomination(e["_id"], cycle["_id"])
        assigned = [a for a in pms_store.pms360Assignments.values() if a["rateeId"] == e["_id"] and a["cycleId"] == cycle["_id"]]
        rows.append({
            "employeeId": e["_id"], "employeeName": pms_store.employee_name(e["_id"]),
            "department": e.get("department"), "nominationStatus": (nom or {}).get("status") or "NOT_STARTED",
            "nominated": len((nom or {}).get("raters") or []), "assigned": len(assigned),
            "submitted": sum(a["status"] == "SUBMITTED" for a in assigned),
        })
    return {"cycle": cycle, "feedback360": _fb_state(cycle), "rows": sorted(rows, key=lambda r: r["employeeName"])}


@router.get("/360/{employee_id}")
async def get_360(employee_id: str, user: dict = Depends(require_auth)):
    pms_store.ensure_seeded_360()
    _employee_or_404(employee_id)
    rel = _require_view(employee_id, user)
    cycle = _active_cycle_or_400()
    nom = _nomination(employee_id, cycle["_id"])
    manager_id = pms_store.manager_id(employee_id)
    state = _fb_state(cycle)
    can_see_report = state.get("closed") and (rel["manager"] or rel["reviewer"] or rel["viewAll"]) or (state.get("released") and rel["owner"])
    phases = {k: _phase(cycle, k) or {} for k in ("raters_360", "feedback_360")}
    return {
        "feedback360": state,
        "nominationDue": phases["raters_360"].get("end"),
        "feedbackDue": phases["feedback_360"].get("end"),
        "manager": _rater_row(employee_id, manager_id) if manager_id else None,
        "nomination": {
            "status": (nom or {}).get("status") or "DRAFT",
            "raters": [_rater_row(employee_id, r) for r in (nom or {}).get("raters") or []],
            "trail": (nom or {}).get("trail") or [],
        },
        "permissions": {**_nom_permissions(nom, cycle, rel), "canSeeReport": bool(can_see_report)},
        "progress": _progress(employee_id, cycle["_id"], rel),
        "minPerGroup": 3,
    }


@router.get("/360/{employee_id}/candidates")
async def rater_candidates(employee_id: str, user: dict = Depends(require_auth)):
    _require_view(employee_id, user)
    manager_id = pms_store.manager_id(employee_id)
    rows = [
        _rater_row(employee_id, e["_id"])
        for e in db_store.employees.values()
        if e["_id"] not in (employee_id, manager_id) and e.get("status") not in INACTIVE and pms_store.user_for_employee(e["_id"])
    ]
    return {"candidates": sorted(rows, key=lambda r: (r["group"], r["name"]))}


def _nomination_for_write(employee_id: str, user: dict, perm: str, message: str):
    _employee_or_404(employee_id)
    cycle = _active_cycle_or_400()
    rel = _rel(employee_id, user)
    nom = _nomination(employee_id, cycle["_id"])
    if not _nom_permissions(nom, cycle, rel)[perm]:
        raise ApiError(403, message)
    if not nom:
        nid = f"nom360_{now_ms()}_{rand_base36(5)}"
        nom = stamp({"_id": nid, "cycleId": cycle["_id"], "rateeId": employee_id, "status": "DRAFT", "raters": [], "trail": []},
                    user, created=True)
        pms_store.pms360Nominations[nid] = nom
    return cycle, rel, nom


def _nom_trail(nom: dict, user: dict, action: str, to_status: str, comment: str = "") -> None:
    nom["trail"].append({"at": now_iso(), "byName": _actor_name(user), "action": action,
                         "fromStatus": nom["status"], "toStatus": to_status, "comment": comment})
    nom["status"] = to_status


@router.put("/360/{employee_id}/nominations")
async def save_nominations(employee_id: str, request: Request, user: dict = Depends(require_auth)):
    _, _, nom = _nomination_for_write(employee_id, user, "canEdit", "These nominations can't be changed right now.")
    manager_id = pms_store.manager_id(employee_id)
    ids = []
    for rid in (await read_body(request)).get("raterIds") or []:
        rid = _text(rid)
        if rid in ids:
            continue
        emp = pms_store.employee(rid)
        if not emp or emp.get("status") in INACTIVE:
            raise ApiError(400, "One of the selected people is not an active employee.")
        if rid == employee_id:
            raise ApiError(400, "You can't nominate yourself.")
        if rid == manager_id:
            continue  # the manager is always included automatically
        if not pms_store.user_for_employee(rid):
            raise ApiError(400, f"{pms_store.employee_name(rid)} has no login, so they can't give feedback.")
        ids.append(rid)
    if len(ids) > MAX_RATERS_360:
        raise ApiError(400, f"Nominate at most {MAX_RATERS_360} people.")
    old = list(nom["raters"])
    nom["raters"] = ids
    stamp(nom, user)
    if old != ids:
        audit(user, "PMS_360_NOMINATIONS_EDITED", MODULE, "pms_360_nomination", nom["_id"],
              {"field": "raters", "old": len(old), "new": len(ids)})
    return await get_360(employee_id, user)


@router.post("/360/{employee_id}/nominations/submit")
async def submit_nominations(employee_id: str, user: dict = Depends(require_auth)):
    _, _, nom = _nomination_for_write(employee_id, user, "canSubmit", "These nominations can't be submitted.")
    if not nom["raters"]:
        raise ApiError(400, "Nominate at least one person before submitting.")
    _nom_trail(nom, user, "SUBMITTED", "SUBMITTED")
    stamp(nom, user)
    audit(user, "PMS_360_NOMINATIONS_SUBMITTED", MODULE, "pms_360_nomination", nom["_id"], {"field": "status", "old": "DRAFT", "new": "SUBMITTED"})
    return await get_360(employee_id, user)


@router.post("/360/{employee_id}/nominations/send-back")
async def send_back_nominations(employee_id: str, request: Request, user: dict = Depends(require_auth)):
    _, _, nom = _nomination_for_write(employee_id, user, "canSendBack", "You can't send these nominations back.")
    comment = _text((await read_body(request)).get("comment"))
    if not comment:
        raise ApiError(400, "Add a comment explaining what to change.")
    _nom_trail(nom, user, "SENT_BACK", "DRAFT", comment)
    stamp(nom, user)
    audit(user, "PMS_360_NOMINATIONS_SENT_BACK", MODULE, "pms_360_nomination", nom["_id"],
          {"field": "status", "old": "SUBMITTED", "new": "DRAFT", "reason": comment})
    return await get_360(employee_id, user)


@router.post("/360/{employee_id}/nominations/approve")
async def approve_nominations(employee_id: str, request: Request, user: dict = Depends(require_auth)):
    cycle, _, nom = _nomination_for_write(employee_id, user, "canApprove", "Only the manager or HR can approve nominations.")
    raters = list(nom["raters"])
    manager_id = pms_store.manager_id(employee_id)
    if manager_id:
        raters.append(manager_id)
    if not raters:
        raise ApiError(400, "There is nobody to ask for feedback yet.")
    old = nom["status"]
    _nom_trail(nom, user, "APPROVED", "APPROVED", _text((await read_body(request)).get("comment")))
    stamp(nom, user)
    existing = {a["raterId"] for a in pms_store.pms360Assignments.values() if a["rateeId"] == employee_id and a["cycleId"] == cycle["_id"]}
    created = 0
    for rid in raters:
        if rid in existing:
            continue
        aid = f"a360_{now_ms()}_{rand_base36(6)}"
        pms_store.pms360Assignments[aid] = {
            "_id": aid, "cycleId": cycle["_id"], "rateeId": employee_id, "raterId": rid,
            "group": pms_store.group_360(employee_id, rid), "status": "PENDING", "createdOn": now_iso(),
        }
        created += 1
    audit(user, "PMS_360_NOMINATIONS_APPROVED", MODULE, "pms_360_nomination", nom["_id"],
          {"field": "status", "old": old, "new": "APPROVED", "ratersAssigned": created})
    return await get_360(employee_id, user)


# ---------------------------------------------------------------- 360 report

@router.get("/360/{employee_id}/report")
async def report_360(employee_id: str, user: dict = Depends(require_auth)):
    _employee_or_404(employee_id)
    rel = _require_view(employee_id, user)
    cycle = _active_cycle_or_400()
    state = _fb_state(cycle)
    allowed = (state.get("closed") and (rel["manager"] or rel["reviewer"] or rel["viewAll"])) or (state.get("released") and rel["owner"])
    if not allowed:
        raise ApiError(403, "The 360° report is available once HR closes feedback (and, for employees, after HR releases it).")
    return {"feedback360": state, **compute_report_360(employee_id, cycle["_id"])}


def compute_report_360(employee_id: str, cycle_id: str) -> dict:
    """Anonymous 360 summary for one ratee; also feeds the year-end 360 score."""
    responses = [r for r in pms_store.pms360Responses.values() if r["rateeId"] == employee_id and r["cycleId"] == cycle_id]
    by_group = defaultdict(list)
    for r in responses:
        by_group[r["group"]].append(r)
    counted = {g for g, rs in by_group.items() if len(rs) >= pms_calc.MIN_REPLIES_360[g]}

    questions = pms_store.questions_for(employee_id)
    comp_questions = defaultdict(list)
    comp_names = {}
    for q in questions:
        comp_questions[q["competencyId"]].append(q["_id"])
        comp_names[q["competencyId"]] = q["competencyName"]

    def avg(values):
        values = [v for v in values if v is not None]
        return sum(values) / len(values) if values else None

    group_rows = []
    group_avgs = {}
    for g in GROUPS_360:
        rs = by_group.get(g, [])
        if g in counted:
            group_avgs[g] = {"responses": len(rs), "average": avg([s for r in rs for s in r["answers"].values()])}
        group_rows.append({
            "group": g, "label": GROUP_LABEL[g], "weight": pms_calc.GROUP_WEIGHTS_360[g],
            "counted": g in counted,
            # Hidden groups don't reveal how many people replied
            "responses": len(rs) if g in counted else None,
            "average": round(group_avgs[g]["average"], 2) if g in counted and group_avgs[g]["average"] is not None else None,
        })

    competencies = []
    for cid, qids in comp_questions.items():
        per_group = {}
        for g in counted:
            a = avg([r["answers"].get(q) for r in by_group[g] for q in qids])
            if a is not None:
                per_group[g] = {"responses": len(by_group[g]), "average": a}
        score = pms_calc.score_360(per_group)
        competencies.append({
            "competencyId": cid, "name": comp_names[cid],
            "score": round(score, 2) if score is not None else None,
            "byGroup": {g: round(v["average"], 2) for g, v in per_group.items()},
        })

    overall = pms_calc.score_360(group_avgs)
    comments = [r["comment"] for g in counted for r in by_group[g] if r.get("comment")]
    random.shuffle(comments)  # no ordering that hints at group or timing
    return {
        "score360": round(overall, 4) if overall is not None else None,
        "groups": group_rows,
        "competencies": competencies,
        "comments": comments,
        "minPerGroup": 3,
    }
