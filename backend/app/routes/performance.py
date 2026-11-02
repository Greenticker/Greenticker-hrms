"""
Performance Management (PMS) – Phase 1: setup (cycles, templates, KPI library,
competencies) and goal sheets with the submit -> manager -> reviewer -> locked flow,
HR revision windows and KPI actuals. Rules come from the PMS developer brief.
"""

import copy
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.pms_store import (
    DIRECTIONS,
    default_phases,
    pms_store,
    stamp,
    validate_lines,
)
from app.utils import pms_calc
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str

router = APIRouter(prefix="/performance")

HR_ROLE = "HR"
# Sheet 7_Roles: HR and Management see everyone (Management = Super Admin / Admin / HR here)
VIEW_ALL_ROLES = ("SUPER_ADMIN", "ADMIN", "HR")
MODULE = "PERFORMANCE"


# ------------------------------------------------------------------ helpers

def _num(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value) -> str:
    return js_str(value or "").strip()


def _iso_date(value, label: str) -> str:
    try:
        return date.fromisoformat(_text(value)).isoformat()
    except ValueError:
        raise ApiError(400, f"{label} must be a date in YYYY-MM-DD format.")


def _actor_name(user: dict) -> str:
    return f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or user.get("email") or "User"


def _can_view_all(user: dict) -> bool:
    return user.get("role") in VIEW_ALL_ROLES


def _cycle_or_404(cycle_id: str) -> dict:
    cycle = pms_store.pmsCycles.get(cycle_id)
    if not cycle:
        raise ApiError(404, "Appraisal cycle not found.")
    return cycle


def _sheet_or_404(sheet_id: str) -> dict:
    sheet = pms_store.pmsGoalSheets.get(sheet_id)
    if not sheet:
        raise ApiError(404, "Goal sheet not found.")
    return sheet


def _revision_open(cycle: Optional[dict]) -> bool:
    window = (cycle or {}).get("revisionWindow") or {}
    if not window.get("open"):
        return False
    closes = window.get("closesOn")
    return not closes or today_str() <= closes


def _relation(sheet: dict, user: dict) -> dict:
    me = user.get("employeeId")
    is_hr = user.get("role") == HR_ROLE
    return {
        "owner": bool(me) and sheet.get("employeeId") == me,
        # No manager on record (top of the org): HR stands in for the manager step
        "manager": (bool(me) and sheet.get("managerId") == me) or (not sheet.get("managerId") and is_hr),
        "reviewer": bool(me) and bool(sheet.get("reviewerId")) and sheet.get("reviewerId") == me,
        "hr": is_hr,
        "viewAll": _can_view_all(user),
    }


def _permissions(sheet: dict, user: dict) -> dict:
    rel = _relation(sheet, user)
    cycle = pms_store.pmsCycles.get(sheet.get("cycleId"))
    active = (cycle or {}).get("status") == "ACTIVE"
    status = sheet.get("status")
    return {
        "canView": any(rel.values()),
        "canEdit": active and status == "DRAFT" and (rel["owner"] or rel["manager"]),
        "canSubmit": active and status == "DRAFT" and (rel["owner"] or rel["manager"]),
        "canApprove": active and ((status == "SUBMITTED" and rel["manager"]) or (status == "APPROVED" and rel["reviewer"])),
        "canSendBack": active and ((status == "SUBMITTED" and rel["manager"]) or (status == "APPROVED" and rel["reviewer"])),
        "canRevise": active and status == "LOCKED" and _revision_open(cycle) and (rel["owner"] or rel["manager"]),
        "canRecordActuals": active and status == "LOCKED" and (rel["manager"] or rel["hr"]),
    }


def _require(sheet: dict, user: dict, perm: str, message: str) -> None:
    if not _permissions(sheet, user)[perm]:
        raise ApiError(403, message)


def _weights_for(employee_id: str) -> dict:
    tmpl = pms_store.template_for_grade(pms_store.grade_of(employee_id))
    if not tmpl:
        return {"templateId": None, "templateName": None, "kpi": 70, "competency": 20, "feedback360": 10}
    return {
        "templateId": tmpl["_id"],
        "templateName": tmpl.get("name"),
        "kpi": tmpl.get("kpiWeight", 0),
        "competency": tmpl.get("competencyWeight", 0),
        "feedback360": tmpl.get("feedback360Weight", 0),
    }


def _kpi_section(lines: list) -> Optional[float]:
    score = pms_calc.kpi_section_score({"weight": (l.get("weight") or 0) / 100, "score": l.get("score")} for l in lines)
    return round(score, 4) if score is not None else None


def _summary(employee_id: str, sheet: Optional[dict]) -> dict:
    emp = pms_store.employee(employee_id) or {}
    lines = (sheet or {}).get("lines") or []
    return {
        "sheetId": (sheet or {}).get("_id"),
        "employeeId": employee_id,
        "employeeName": pms_store.employee_name(employee_id),
        "employeeCode": emp.get("employeeCode"),
        "department": emp.get("department"),
        "designation": emp.get("designation"),
        "grade": pms_store.grade_of(employee_id),
        "managerName": pms_store.employee_name((sheet or {}).get("managerId") or pms_store.manager_id(employee_id)),
        "status": (sheet or {}).get("status") or "NOT_STARTED",
        "version": (sheet or {}).get("version"),
        "lineCount": len(lines),
        "weightTotal": sum(l.get("weight") or 0 for l in lines),
        "kpiScore": _kpi_section(lines) if lines else None,
        "updatedOn": (sheet or {}).get("updatedOn"),
    }


def _full(sheet: dict, user: dict) -> dict:
    cycle = pms_store.pmsCycles.get(sheet.get("cycleId")) or {}
    lines = sheet.get("lines") or []
    return {
        **sheet,
        **{k: v for k, v in _summary(sheet["employeeId"], sheet).items() if k not in ("sheetId",)},
        "reviewerName": pms_store.employee_name(sheet.get("reviewerId")),
        "cycle": {"_id": cycle.get("_id"), "name": cycle.get("name"), "status": cycle.get("status"),
                  "revisionOpen": _revision_open(cycle)},
        "weights": _weights_for(sheet["employeeId"]),
        "validationErrors": validate_lines(lines),
        "permissions": _permissions(sheet, user),
    }


def _add_trail(sheet: dict, user: dict, action: str, to_status: str, comment: str = "") -> None:
    sheet.setdefault("trail", []).append({
        "at": now_iso(),
        "byUserId": user.get("_id"),
        "byName": _actor_name(user),
        "action": action,
        "fromStatus": sheet.get("status"),
        "toStatus": to_status,
        "comment": comment,
    })
    sheet["status"] = to_status


def _diff_lines(old: list, new: list) -> list:
    """Field-level changes for the audit log (sheet 1_Overview: who, when, old, new)."""
    changes = []
    old_by_id = {l["_id"]: l for l in old}
    new_ids = {l["_id"] for l in new}
    for line in new:
        before = old_by_id.get(line["_id"])
        if not before:
            changes.append({"line": line["kpi"], "field": "line", "old": None, "new": "added"})
            continue
        for field in ("kra", "kpi", "unit", "direction", "weight", "target"):
            if before.get(field) != line.get(field):
                changes.append({"line": line["kpi"], "field": field, "old": before.get(field), "new": line.get(field)})
    for line in old:
        if line["_id"] not in new_ids:
            changes.append({"line": line["kpi"], "field": "line", "old": "present", "new": "removed"})
    return changes


# ------------------------------------------------------------------ context

@router.get("/context")
async def context(user: dict = Depends(require_auth)):
    pms_store.ensure_seeded()
    me = user.get("employeeId")
    cycle = pms_store.active_cycle()
    return {
        "activeCycle": cycle,
        "revisionOpen": _revision_open(cycle),
        "isHR": user.get("role") == HR_ROLE,
        "canViewAll": _can_view_all(user),
        "employeeId": me if pms_store.employee(me) else None,
        "hasTeam": pms_store.has_reports(me) or (user.get("role") == HR_ROLE),
        "pendingFeedback": sum(
            1 for a in pms_store.pms360Assignments.values()
            if cycle and a["cycleId"] == cycle["_id"] and a["raterId"] == me and a["status"] == "PENDING"
        ) if me and cycle and not (cycle.get("feedback360") or {}).get("closed") else 0,
        "hasReviewees": bool(me) and any(
            pms_store.manager_id(e["_id"]) and pms_store.manager_id(pms_store.manager_id(e["_id"])) == me
            for e in db_store.employees.values()
        ),
        "rules": {"minLines": 3, "maxLines": 8, "minWeight": 5, "maxWeight": 40,
                  "complianceKra": "Compliance (mandatory)", "complianceMinWeight": 10},
    }


# ------------------------------------------------------------------- cycles

@router.get("/cycles")
async def list_cycles(_: dict = Depends(require_auth)):
    return {"cycles": sorted(pms_store.pmsCycles.values(), key=lambda c: c.get("year") or 0, reverse=True)}


@router.get("/cycles/default-phases")
async def cycle_default_phases(year: int, _: dict = Depends(require_role(HR_ROLE))):
    return {"phases": default_phases(year)}


def _cycle_fields(body: dict) -> dict:
    name = _text(body.get("name"))
    try:
        year = int(body.get("year"))
    except (TypeError, ValueError):
        raise ApiError(400, "Cycle year is required (e.g. 2026 for April 2026 – March 2027).")
    if not name:
        name = f"FY {year}-{str(year + 1)[-2:]}"
    start = _iso_date(body.get("startDate") or f"{year}-04-01", "Start date")
    end = _iso_date(body.get("endDate") or f"{year + 1}-03-31", "End date")
    if end <= start:
        raise ApiError(400, "End date must be after the start date.")
    phases = []
    for p in body.get("phases") or default_phases(year):
        label = _text(p.get("label")) or _text(p.get("key"))
        p_start = _iso_date(p.get("start"), f"{label} start")
        p_end = _iso_date(p.get("end"), f"{label} deadline")
        if p_end < p_start:
            raise ApiError(400, f"{label}: the deadline is before the start date.")
        phases.append({"key": _text(p.get("key")), "label": label, "start": p_start, "end": p_end})
    return {"name": name, "year": year, "startDate": start, "endDate": end, "phases": phases}


@router.post("/cycles")
async def create_cycle(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    fields = _cycle_fields(await read_body(request))
    if any(c.get("year") == fields["year"] for c in pms_store.pmsCycles.values()):
        raise ApiError(409, f"A cycle for {fields['year']} already exists.")
    cid = f"cycle_{now_ms()}_{rand_base36(5)}"
    cycle = stamp({"_id": cid, **fields, "status": "DRAFT", "revisionWindow": None}, user, created=True)
    pms_store.pmsCycles[cid] = cycle
    audit(user, "PMS_CYCLE_CREATED", MODULE, "pms_cycle", cid, {"name": cycle["name"], "year": cycle["year"]})
    return {"cycle": cycle}


@router.put("/cycles/{cycle_id}")
async def update_cycle(cycle_id: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    cycle = _cycle_or_404(cycle_id)
    if cycle.get("status") == "CLOSED":
        raise ApiError(400, "A closed cycle cannot be edited.")
    fields = _cycle_fields(await read_body(request))
    changes = [{"field": k, "old": cycle.get(k), "new": v} for k, v in fields.items() if cycle.get(k) != v]
    cycle.update(fields)
    stamp(cycle, user)
    audit(user, "PMS_CYCLE_UPDATED", MODULE, "pms_cycle", cycle_id, {"changes": changes})
    return {"cycle": cycle}


@router.post("/cycles/{cycle_id}/activate")
async def activate_cycle(cycle_id: str, user: dict = Depends(require_role(HR_ROLE))):
    cycle = _cycle_or_404(cycle_id)
    current = pms_store.active_cycle()
    if current and current["_id"] != cycle_id:
        raise ApiError(409, f'"{current.get("name")}" is already active. Close it before activating another cycle.')
    if cycle.get("status") != "DRAFT":
        raise ApiError(400, "Only a draft cycle can be activated.")
    cycle["status"] = "ACTIVE"
    stamp(cycle, user)
    audit(user, "PMS_CYCLE_ACTIVATED", MODULE, "pms_cycle", cycle_id, {"field": "status", "old": "DRAFT", "new": "ACTIVE"})
    return {"cycle": cycle}


@router.post("/cycles/{cycle_id}/close")
async def close_cycle(cycle_id: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    cycle = _cycle_or_404(cycle_id)
    if cycle.get("status") != "ACTIVE":
        raise ApiError(400, "Only the active cycle can be closed.")
    reason = _text((await read_body(request)).get("reason"))
    if not reason:
        raise ApiError(400, "Give a reason for closing the cycle.")
    cycle["status"] = "CLOSED"
    cycle["revisionWindow"] = None
    stamp(cycle, user)
    audit(user, "PMS_CYCLE_CLOSED", MODULE, "pms_cycle", cycle_id,
          {"field": "status", "old": "ACTIVE", "new": "CLOSED", "reason": reason})
    return {"cycle": cycle}


@router.post("/cycles/{cycle_id}/revision-window")
async def set_revision_window(cycle_id: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    cycle = _cycle_or_404(cycle_id)
    if cycle.get("status") != "ACTIVE":
        raise ApiError(400, "Goal revisions can only be opened on the active cycle.")
    body = await read_body(request)
    old = copy.deepcopy(cycle.get("revisionWindow"))
    if body.get("open"):
        reason = _text(body.get("reason"))
        if not reason:
            raise ApiError(400, "Give a reason for opening a revision window.")
        closes_on = _iso_date(body.get("closesOn"), "Closing date")
        if closes_on < today_str():
            raise ApiError(400, "The closing date is in the past.")
        cycle["revisionWindow"] = {"open": True, "closesOn": closes_on, "reason": reason,
                                   "openedBy": _actor_name(user), "openedOn": now_iso()}
    else:
        cycle["revisionWindow"] = None
    stamp(cycle, user)
    audit(user, "PMS_REVISION_WINDOW_" + ("OPENED" if body.get("open") else "CLOSED"), MODULE, "pms_cycle", cycle_id,
          {"field": "revisionWindow", "old": old, "new": cycle["revisionWindow"], "reason": _text(body.get("reason"))})
    return {"cycle": cycle}


# ----------------------------------------------------------------- templates

def _template_fields(body: dict, exclude_id: Optional[str] = None) -> dict:
    name = _text(body.get("name"))
    if not name:
        raise ApiError(400, "Template name is required.")
    weights = {}
    for key, label in (("kpiWeight", "KPI"), ("competencyWeight", "Competency"), ("feedback360Weight", "360°")):
        value = _num(body.get(key))
        if value is None or not 0 <= value <= 100:
            raise ApiError(400, f"{label} weight must be between 0 and 100.")
        weights[key] = value
    if abs(sum(weights.values()) - 100) > 1e-6:
        raise ApiError(400, f"Section weights must add up to 100% (currently {sum(weights.values()):g}%).")
    if weights["kpiWeight"] == 0:
        raise ApiError(400, "The KPI section must have some weight.")
    grades = sorted({_text(g).upper() for g in body.get("grades") or [] if _text(g)})
    for t in pms_store.pmsTemplates.values():
        if t["_id"] == exclude_id:
            continue
        overlap = set(grades) & set(t.get("grades") or [])
        if overlap:
            raise ApiError(409, f'Grade {", ".join(sorted(overlap))} is already covered by "{t.get("name")}".')
    return {"name": name, "grades": grades, "isDefault": bool(body.get("isDefault")), **weights}


def _apply_default(template_id: str, is_default: bool) -> None:
    if is_default:
        for t in pms_store.pmsTemplates.values():
            t["isDefault"] = t["_id"] == template_id


@router.get("/templates")
async def list_templates(_: dict = Depends(require_auth)):
    pms_store.ensure_seeded()
    return {"templates": list(pms_store.pmsTemplates.values())}


@router.post("/templates")
async def create_template(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    fields = _template_fields(await read_body(request))
    tid = f"tmpl_{now_ms()}_{rand_base36(5)}"
    tmpl = stamp({"_id": tid, **fields}, user, created=True)
    pms_store.pmsTemplates[tid] = tmpl
    _apply_default(tid, fields["isDefault"])
    audit(user, "PMS_TEMPLATE_CREATED", MODULE, "pms_template", tid, fields)
    return {"template": tmpl}


@router.put("/templates/{template_id}")
async def update_template(template_id: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    tmpl = pms_store.pmsTemplates.get(template_id)
    if not tmpl:
        raise ApiError(404, "Template not found.")
    fields = _template_fields(await read_body(request), exclude_id=template_id)
    if tmpl.get("isDefault") and not fields["isDefault"]:
        raise ApiError(400, "Make another template the default first.")
    changes = [{"field": k, "old": tmpl.get(k), "new": v} for k, v in fields.items() if tmpl.get(k) != v]
    tmpl.update(fields)
    stamp(tmpl, user)
    _apply_default(template_id, fields["isDefault"])
    audit(user, "PMS_TEMPLATE_UPDATED", MODULE, "pms_template", template_id, {"changes": changes})
    return {"template": tmpl}


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user: dict = Depends(require_role(HR_ROLE))):
    tmpl = pms_store.pmsTemplates.get(template_id)
    if not tmpl:
        raise ApiError(404, "Template not found.")
    if tmpl.get("isDefault"):
        raise ApiError(400, "The default template cannot be deleted.")
    del pms_store.pmsTemplates[template_id]
    audit(user, "PMS_TEMPLATE_DELETED", MODULE, "pms_template", template_id, {"name": tmpl.get("name")})
    return {"success": True}


# --------------------------------------------------------------- KPI library

def _kpi_fields(body: dict) -> dict:
    fields = {k: _text(body.get(k)) for k in ("department", "kra", "kpi", "unit")}
    missing = [k.upper() if k in ("kra", "kpi") else k for k, v in fields.items() if not v]
    if missing:
        raise ApiError(400, f"Required: {', '.join(missing)}.")
    direction = _text(body.get("direction")).upper()
    if direction not in DIRECTIONS:
        raise ApiError(400, "Direction must be HIGHER or LOWER.")
    return {**fields, "direction": direction, "mandatory": bool(body.get("mandatory"))}


@router.get("/kpi-library")
async def list_kpis(_: dict = Depends(require_auth)):
    pms_store.ensure_seeded()
    return {"kpis": sorted(pms_store.pmsKpiLibrary.values(), key=lambda k: (k.get("department") != "All", k.get("department"), k.get("kra"), k.get("kpi")))}


@router.post("/kpi-library")
async def create_kpi(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    fields = _kpi_fields(await read_body(request))
    kid = f"kpi_{now_ms()}_{rand_base36(5)}"
    kpi = stamp({"_id": kid, **fields}, user, created=True)
    pms_store.pmsKpiLibrary[kid] = kpi
    audit(user, "PMS_KPI_CREATED", MODULE, "pms_kpi_library", kid, fields)
    return {"kpi": kpi}


@router.put("/kpi-library/{kpi_id}")
async def update_kpi(kpi_id: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    kpi = pms_store.pmsKpiLibrary.get(kpi_id)
    if not kpi:
        raise ApiError(404, "KPI not found.")
    fields = _kpi_fields(await read_body(request))
    changes = [{"field": k, "old": kpi.get(k), "new": v} for k, v in fields.items() if kpi.get(k) != v]
    kpi.update(fields)
    stamp(kpi, user)
    audit(user, "PMS_KPI_UPDATED", MODULE, "pms_kpi_library", kpi_id, {"changes": changes})
    return {"kpi": kpi}


@router.delete("/kpi-library/{kpi_id}")
async def delete_kpi(kpi_id: str, user: dict = Depends(require_role(HR_ROLE))):
    kpi = pms_store.pmsKpiLibrary.pop(kpi_id, None)
    if not kpi:
        raise ApiError(404, "KPI not found.")
    audit(user, "PMS_KPI_DELETED", MODULE, "pms_kpi_library", kpi_id, {"kpi": kpi.get("kpi")})
    return {"success": True}


# -------------------------------------------------------------- competencies

def _competency_fields(body: dict) -> dict:
    name = _text(body.get("name"))
    if not name:
        raise ApiError(400, "Competency name is required.")
    applies_to = _text(body.get("appliesTo")).upper() or "ALL"
    if applies_to not in ("ALL", "MANAGERS"):
        raise ApiError(400, "Applies to must be ALL or MANAGERS.")
    return {"name": name, "description": _text(body.get("description")), "appliesTo": applies_to}


@router.get("/competencies")
async def list_competencies(_: dict = Depends(require_auth)):
    pms_store.ensure_seeded()
    return {"competencies": list(pms_store.pmsCompetencies.values())}


@router.post("/competencies")
async def create_competency(request: Request, user: dict = Depends(require_role(HR_ROLE))):
    fields = _competency_fields(await read_body(request))
    cid = f"comp_{now_ms()}_{rand_base36(5)}"
    comp = stamp({"_id": cid, **fields}, user, created=True)
    pms_store.pmsCompetencies[cid] = comp
    audit(user, "PMS_COMPETENCY_CREATED", MODULE, "pms_competency", cid, fields)
    return {"competency": comp}


@router.put("/competencies/{comp_id}")
async def update_competency(comp_id: str, request: Request, user: dict = Depends(require_role(HR_ROLE))):
    comp = pms_store.pmsCompetencies.get(comp_id)
    if not comp:
        raise ApiError(404, "Competency not found.")
    fields = _competency_fields(await read_body(request))
    changes = [{"field": k, "old": comp.get(k), "new": v} for k, v in fields.items() if comp.get(k) != v]
    comp.update(fields)
    stamp(comp, user)
    audit(user, "PMS_COMPETENCY_UPDATED", MODULE, "pms_competency", comp_id, {"changes": changes})
    return {"competency": comp}


@router.delete("/competencies/{comp_id}")
async def delete_competency(comp_id: str, user: dict = Depends(require_role(HR_ROLE))):
    comp = pms_store.pmsCompetencies.pop(comp_id, None)
    if not comp:
        raise ApiError(404, "Competency not found.")
    audit(user, "PMS_COMPETENCY_DELETED", MODULE, "pms_competency", comp_id, {"name": comp.get("name")})
    return {"success": True}


# --------------------------------------------------------------- goal sheets

@router.get("/goal-sheets")
async def list_goal_sheets(scope: str = "team", cycleId: Optional[str] = None, user: dict = Depends(require_auth)):
    """scope=team: my direct reports; review: my reports' reports; all: everyone (HR / Management)."""
    cycle = pms_store.pmsCycles.get(cycleId) if cycleId else pms_store.active_cycle()
    if not cycle:
        return {"cycle": None, "rows": []}
    me = user.get("employeeId")
    employees = [e for e in db_store.employees.values() if e.get("status") not in ("INACTIVE", "TERMINATED", "EXITED")]
    if scope == "all":
        if not _can_view_all(user):
            raise ApiError(403, "Only HR and management can see every goal sheet.")
        people = employees
    elif scope == "review":
        people = [e for e in employees if me and pms_store.manager_id(pms_store.manager_id(e["_id"])) == me]
    else:
        people = [e for e in employees if me and e.get("reportingManagerId") == me]
        if user.get("role") == HR_ROLE:
            # HR acts as manager for people with no manager on record
            people += [e for e in employees if not e.get("reportingManagerId") and e["_id"] != me]
    rows = [_summary(e["_id"], pms_store.sheet_for(e["_id"], cycle["_id"])) for e in people]
    return {"cycle": cycle, "rows": sorted(rows, key=lambda r: r["employeeName"])}


@router.get("/goal-sheets/employee/{employee_id}")
async def get_or_start_sheet(employee_id: str, create: bool = False, user: dict = Depends(require_auth)):
    if not pms_store.employee(employee_id):
        raise ApiError(404, "Employee not found.")
    cycle = pms_store.active_cycle()
    if not cycle:
        raise ApiError(404, "There is no active appraisal cycle. HR needs to create and activate one.")
    sheet = pms_store.sheet_for(employee_id, cycle["_id"])
    if sheet:
        if not _permissions(sheet, user)["canView"]:
            raise ApiError(403, "You cannot view this goal sheet.")
        return {"sheet": _full(sheet, user)}
    # No sheet yet: only the employee or their manager may start one
    probe = {"employeeId": employee_id, "managerId": pms_store.manager_id(employee_id), "cycleId": cycle["_id"], "status": "DRAFT"}
    rel = _relation(probe, user)
    if not (rel["owner"] or rel["manager"]):
        if rel["viewAll"]:
            return {"sheet": None}
        raise ApiError(403, "You cannot view this goal sheet.")
    if not create:
        return {"sheet": None}
    sheet = pms_store.create_sheet(employee_id, cycle, user)
    audit(user, "PMS_GOAL_SHEET_CREATED", MODULE, "pms_goal_sheet", sheet["_id"], {"employeeId": employee_id, "cycleId": cycle["_id"]})
    return {"sheet": _full(sheet, user)}


@router.get("/goal-sheets/{sheet_id}")
async def get_sheet(sheet_id: str, user: dict = Depends(require_auth)):
    sheet = _sheet_or_404(sheet_id)
    _require(sheet, user, "canView", "You cannot view this goal sheet.")
    return {"sheet": _full(sheet, user)}


@router.put("/goal-sheets/{sheet_id}/lines")
async def save_lines(sheet_id: str, request: Request, user: dict = Depends(require_auth)):
    sheet = _sheet_or_404(sheet_id)
    _require(sheet, user, "canEdit", "This goal sheet cannot be edited right now.")
    body = await read_body(request)
    old_by_id = {l["_id"]: l for l in sheet.get("lines") or []}
    lines = []
    for raw in body.get("lines") or []:
        line_id = _text(raw.get("_id"))
        previous = old_by_id.get(line_id) if line_id else None
        line = {
            "_id": line_id if previous else f"line_{now_ms()}_{rand_base36(5)}",
            "libraryId": _text(raw.get("libraryId")) or None,
            "kra": _text(raw.get("kra")),
            "kpi": _text(raw.get("kpi")),
            "unit": _text(raw.get("unit")),
            "direction": _text(raw.get("direction")).upper() or "HIGHER",
            "weight": _num(raw.get("weight")),
            "target": _num(raw.get("target")),
            # Actuals survive edits during a revision
            "actual": (previous or {}).get("actual"),
        }
        lines.append(pms_calc.score_goal_line(line))
    if len(lines) > 8:
        raise ApiError(400, "A goal sheet can have at most 8 KPIs.")
    changes = _diff_lines(sheet.get("lines") or [], lines)
    sheet["lines"] = lines
    stamp(sheet, user)
    if changes:
        audit(user, "PMS_GOALS_EDITED", MODULE, "pms_goal_sheet", sheet_id, {"version": sheet.get("version"), "changes": changes})
    return {"sheet": _full(sheet, user)}


@router.post("/goal-sheets/{sheet_id}/submit")
async def submit_sheet(sheet_id: str, request: Request, user: dict = Depends(require_auth)):
    sheet = _sheet_or_404(sheet_id)
    _require(sheet, user, "canSubmit", "This goal sheet cannot be submitted right now.")
    errors = validate_lines(sheet.get("lines") or [])
    if errors:
        raise ApiError(400, "Fix these before submitting: " + " ".join(errors))
    comment = _text((await read_body(request)).get("comment"))
    # Refresh the approval chain in case reporting lines changed since the sheet was started
    sheet["managerId"] = pms_store.manager_id(sheet["employeeId"])
    sheet["reviewerId"] = pms_store.manager_id(sheet["managerId"])
    _add_trail(sheet, user, "SUBMITTED", "SUBMITTED", comment)
    stamp(sheet, user)
    audit(user, "PMS_GOALS_SUBMITTED", MODULE, "pms_goal_sheet", sheet_id, {"field": "status", "old": "DRAFT", "new": "SUBMITTED"})
    return {"sheet": _full(sheet, user)}


@router.post("/goal-sheets/{sheet_id}/approve")
async def approve_sheet(sheet_id: str, request: Request, user: dict = Depends(require_auth)):
    sheet = _sheet_or_404(sheet_id)
    _require(sheet, user, "canApprove", "You cannot approve this goal sheet.")
    comment = _text((await read_body(request)).get("comment"))
    old = sheet["status"]
    if old == "SUBMITTED" and sheet.get("reviewerId"):
        _add_trail(sheet, user, "MANAGER_APPROVED", "APPROVED", comment)
    else:
        # Reviewer approval, or manager approval when there is no reviewer, locks the goals
        _add_trail(sheet, user, "REVIEWER_APPROVED" if old == "APPROVED" else "MANAGER_APPROVED", "LOCKED", comment)
        sheet.setdefault("history", []).append({
            "version": sheet.get("version", 1),
            "lines": copy.deepcopy(sheet.get("lines") or []),
            "lockedOn": now_iso(),
            "lockedBy": _actor_name(user),
        })
    stamp(sheet, user)
    audit(user, "PMS_GOALS_APPROVED", MODULE, "pms_goal_sheet", sheet_id, {"field": "status", "old": old, "new": sheet["status"], "reason": comment})
    return {"sheet": _full(sheet, user)}


@router.post("/goal-sheets/{sheet_id}/send-back")
async def send_back_sheet(sheet_id: str, request: Request, user: dict = Depends(require_auth)):
    sheet = _sheet_or_404(sheet_id)
    _require(sheet, user, "canSendBack", "You cannot send this goal sheet back.")
    comment = _text((await read_body(request)).get("comment"))
    if not comment:
        raise ApiError(400, "Add a comment explaining what needs to change.")
    old = sheet["status"]
    # Back to the previous person: manager -> employee (draft), reviewer -> manager (submitted)
    new = "DRAFT" if old == "SUBMITTED" else "SUBMITTED"
    _add_trail(sheet, user, "SENT_BACK", new, comment)
    stamp(sheet, user)
    audit(user, "PMS_GOALS_SENT_BACK", MODULE, "pms_goal_sheet", sheet_id, {"field": "status", "old": old, "new": new, "reason": comment})
    return {"sheet": _full(sheet, user)}


@router.post("/goal-sheets/{sheet_id}/revise")
async def revise_sheet(sheet_id: str, request: Request, user: dict = Depends(require_auth)):
    sheet = _sheet_or_404(sheet_id)
    _require(sheet, user, "canRevise", "Goals can only be revised while HR has a revision window open.")
    reason = _text((await read_body(request)).get("reason"))
    if not reason:
        raise ApiError(400, "Give a reason for revising the goals.")
    old_version = sheet.get("version", 1)
    sheet["version"] = old_version + 1
    _add_trail(sheet, user, "REVISION_STARTED", "DRAFT", reason)
    stamp(sheet, user)
    audit(user, "PMS_GOALS_REVISION_STARTED", MODULE, "pms_goal_sheet", sheet_id,
          {"field": "version", "old": old_version, "new": sheet["version"], "reason": reason})
    return {"sheet": _full(sheet, user)}


@router.put("/goal-sheets/{sheet_id}/actuals")
async def record_actuals(sheet_id: str, request: Request, user: dict = Depends(require_auth)):
    sheet = _sheet_or_404(sheet_id)
    _require(sheet, user, "canRecordActuals", "Only the manager or HR can record actuals on locked goals.")
    body = await read_body(request)
    actuals = body.get("actuals") or {}
    changes = []
    for line in sheet.get("lines") or []:
        if line["_id"] not in actuals:
            continue
        new = _num(actuals[line["_id"]])
        if new is not None and new < 0:
            raise ApiError(400, f"{line['kpi']}: actual cannot be negative.")
        if new != line.get("actual"):
            changes.append({"line": line["kpi"], "field": "actual", "old": line.get("actual"), "new": new})
            line["actual"] = new
            pms_calc.score_goal_line(line)
    if changes:
        stamp(sheet, user)
        audit(user, "PMS_ACTUALS_RECORDED", MODULE, "pms_goal_sheet", sheet_id,
              {"changes": changes, "reason": _text(body.get("reason"))})
    return {"sheet": _full(sheet, user)}
