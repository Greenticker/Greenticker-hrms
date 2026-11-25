from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.module_access import require_write
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import DOCUMENTS, MAX_UPLOAD_BYTES, audit, client_ip, format_bytes, read_body, read_fields_and_files, save_upload
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_int, today_str, truthy

router = APIRouter()

# POSH is strictly confidential (Rule 21): executive administration and HR only
POSH_VIEW_ROLES = ("ADMIN", "SUPER_ADMIN", "ADMIN_1", "HR")


# ---------------------------------------------------------------- policies
# Lifecycle: DRAFT -> PENDING_APPROVAL -> PUBLISHED (approved by someone other than the author)
# -> ARCHIVED when a newer version is published. Published text never changes: edits need a new
# version, and employees must acknowledge the new version again. Acknowledgements are permanent.

POLICY_AUTHORS = ("HR", "ADMIN", "SUPER_ADMIN", "ADMIN_1")
POLICY_READ_ALL = POLICY_AUTHORS + ("AUDITORS",)


def _pstatus(p: dict) -> str:
    st = p.get("status") or "PUBLISHED"
    return "PUBLISHED" if st == "ACTIVE" else st


def _applies(p: dict, emp: Optional[dict]) -> bool:
    if not emp:
        return not p.get("applicableLocations") and not p.get("applicableGrades")
    locs, grades = p.get("applicableLocations") or [], p.get("applicableGrades") or []
    return (not locs or (emp.get("location") or "") in locs) and (not grades or (emp.get("grade") or "").upper() in grades)


def _my_emp(user: dict) -> Optional[dict]:
    return db_store.employees.get(user.get("employeeId") or "")


def _acks() -> list:
    return modules_store.policyAcknowledgements


def _policy_view(p: dict, user: dict) -> dict:
    me = user.get("employeeId")
    ack = next((a for a in _acks() if a.get("policyId") == p["_id"] and a.get("employeeId") == me), None)
    out = {**p, "status": _pstatus(p), "acknowledged": bool(ack), "acknowledgedAt": (ack or {}).get("acknowledgedAt"),
           "canApprove": _pstatus(p) == "PENDING_APPROVAL" and user.get("role") in POLICY_AUTHORS and p.get("createdByUserId") != user["_id"],
           "canEdit": _pstatus(p) in ("DRAFT", "REJECTED") and user.get("role") in POLICY_AUTHORS}
    if p.get("viewOnly") and user.get("role") not in POLICY_AUTHORS:
        out.pop("fileUrl", None)
    return out


def _get_policy(policy_id: str, user: dict) -> dict:
    p = modules_store.policies.get(policy_id)
    if not p:
        raise ApiError(404, "Policy not found.")
    if user.get("role") in POLICY_READ_ALL:
        return p
    if _pstatus(p) != "PUBLISHED" or not _applies(p, _my_emp(user)):
        audit(user, "POLICY_ACCESS_DENIED", "POLICIES", "Policy", policy_id, {"status": _pstatus(p)})
        raise ApiError(403, "Access denied: this policy is not published for you.")
    return p


@router.get("/policies")
async def list_policies(status: Optional[str] = None, user: dict = Depends(require_auth)):
    emp = _my_emp(user)
    rows = list(modules_store.policies.values())
    if user.get("role") not in POLICY_READ_ALL:
        rows = [p for p in rows if _pstatus(p) == "PUBLISHED" and _applies(p, emp)]
    elif status and status != "ALL":
        rows = [p for p in rows if _pstatus(p) == status]
    return {"policies": [_policy_view(p, user) for p in sorted(rows, key=lambda p: (p.get("title") or "", p.get("versionNo") or 0))],
            "acknowledgements": [a for a in _acks() if a.get("employeeId") == user.get("employeeId")],
            "canAuthor": user.get("role") in POLICY_AUTHORS,
            "locations": sorted({l.get("name") for l in db_store.locations.values() if l.get("name")}),
            "grades": sorted({(g.get("code") or "").upper() for g in db_store.grades.values() if g.get("code")}) if hasattr(db_store, "grades") else []}


@router.get("/policies/{policy_id}")
async def get_policy(policy_id: str, user: dict = Depends(require_auth)):
    return {"policy": _policy_view(_get_policy(policy_id, user), user)}


def _policy_fields(body: dict, existing: Optional[dict] = None) -> dict:
    title = js_str(body.get("title") or (existing or {}).get("title") or "").strip()
    category = js_str(body.get("category") or (existing or {}).get("category") or "").strip().upper()
    content = js_str(body.get("content") or (existing or {}).get("content") or "").strip()
    eff = js_str(body.get("effectiveDate") or (existing or {}).get("effectiveDate") or today_str())[:10]
    errors = []
    if not title:
        errors.append("Title is required.")
    if not category:
        errors.append("Category is required.")
    if not content and not (existing or {}).get("fileUrl"):
        errors.append("Policy text or a PDF is required.")
    try:
        datetime.strptime(eff, "%Y-%m-%d")
    except ValueError:
        errors.append("Effective date must be YYYY-MM-DD.")
    known = {(l.get("name") or "").strip() for l in db_store.locations.values()}

    def as_list(v):
        if isinstance(v, str):
            v = [x for x in v.split(",")]
        return [js_str(x).strip() for x in v or [] if js_str(x).strip()]
    locs = as_list(body["applicableLocations"]) if "applicableLocations" in body else (existing or {}).get("applicableLocations") or []
    bad = [l for l in locs if known and l not in known]
    if bad:
        errors.append(f"Unknown location(s): {', '.join(bad)}.")
    grades = [g.upper() for g in (as_list(body["applicableGrades"]) if "applicableGrades" in body else (existing or {}).get("applicableGrades") or [])]
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the policy.", errors=errors)
    flag = lambda k, d=False: (body[k] in (True, "true", "on", "1")) if k in body else (existing or {}).get(k, d)
    return {"title": title, "category": category, "content": content, "summary": js_str(body.get("summary") or (existing or {}).get("summary") or ""),
            "effectiveDate": eff, "applicableLocations": locs, "applicableGrades": grades, "mandatory": flag("mandatory", True), "viewOnly": flag("viewOnly")}


async def _save_file(files: dict) -> dict:
    upload = (files.get("policyPdf") or files.get("file") or [None])[0]
    if upload is None:
        return {}
    if (upload.size or 0) > MAX_UPLOAD_BYTES:
        raise ApiError(400, f"Policy PDF size cannot exceed {format_bytes(MAX_UPLOAD_BYTES)}.")
    saved = await save_upload(upload, DOCUMENTS)
    return {"fileUrl": f"/uploads/documents/{saved['storedFileName']}", "fileName": upload.filename, "fileSize": saved["size"],
            "storedFileName": saved["storedFileName"]}


async def _body_and_files(request: Request) -> tuple:
    if "multipart" in (request.headers.get("content-type") or ""):
        return await read_fields_and_files(request)
    return await read_body(request), {}


@router.post("/policies")
@router.post("/policies/upload")
async def create_policy(request: Request, user: dict = Depends(require_role(*POLICY_AUTHORS))):
    body, files = await _body_and_files(request)
    file_info = await _save_file(files)
    if file_info and not body.get("content"):
        body["content"] = f"See the attached document: {file_info['fileName']}"
    fields = _policy_fields(body)
    pid = f"pol_{now_ms()}_{rand_int(999)}"
    policy = {"_id": pid, "policyGroupId": pid, "versionNo": 1, "version": "v1", **fields, **file_info, "status": "DRAFT",
              "createdBy": f"{user.get('firstName')} {user.get('lastName')}", "createdByUserId": user["_id"], "createdAt": now_iso(), "lastUpdated": now_iso()}
    modules_store.policies[pid] = policy
    audit(user, "POLICY_DRAFTED", "POLICIES", "Policy", pid, {"title": policy["title"], "version": "v1"})
    return JSONResponse({"success": True, "policy": _policy_view(policy, user)}, status_code=201)


@router.put("/policies/{policy_id}")
async def edit_policy(policy_id: str, request: Request, user: dict = Depends(require_role(*POLICY_AUTHORS))):
    p = modules_store.policies.get(policy_id)
    if not p:
        raise ApiError(404, "Policy not found.")
    if _pstatus(p) not in ("DRAFT", "REJECTED"):
        raise ApiError(409, "A published (or submitted) policy cannot be edited. Create a new version instead.")
    body, files = await _body_and_files(request)
    file_info = await _save_file(files)
    fields = _policy_fields(body, p)
    changes = [{"field": k, "oldValue": p.get(k), "newValue": v} for k, v in fields.items() if p.get(k) != v and k != "content"]
    p.update({**fields, **file_info, "status": "DRAFT", "lastUpdated": now_iso()})
    audit(user, "POLICY_DRAFT_EDITED", "POLICIES", "Policy", policy_id, {"changes": changes})
    return {"success": True, "policy": _policy_view(p, user)}


@router.post("/policies/{policy_id}/submit")
async def submit_policy(policy_id: str, user: dict = Depends(require_role(*POLICY_AUTHORS))):
    p = modules_store.policies.get(policy_id)
    if not p or _pstatus(p) not in ("DRAFT", "REJECTED"):
        raise ApiError(400, "Only drafts can be sent for approval.")
    p.update({"status": "PENDING_APPROVAL", "submittedBy": f"{user.get('firstName')} {user.get('lastName')}", "submittedAt": now_iso()})
    for u in db_store.users.values():
        if u.get("role") in POLICY_AUTHORS and u["_id"] not in (user["_id"], p.get("createdByUserId")):
            db_store.notifications.insert(0, {"_id": f"notif_{now_ms()}_{rand_int(99999)}", "recipientUserId": u["_id"], "title": "Policy to approve",
                                              "message": f"{p['title']} ({p['version']}) is waiting for approval.", "type": "POLICY", "isRead": False, "createdAt": now_iso()})
    audit(user, "POLICY_SUBMITTED", "POLICIES", "Policy", policy_id, {"version": p.get("version")})
    return {"success": True, "policy": _policy_view(p, user)}


@router.post("/policies/{policy_id}/approve")
async def approve_policy(policy_id: str, request: Request, user: dict = Depends(require_role(*POLICY_AUTHORS))):
    p = modules_store.policies.get(policy_id)
    if not p or _pstatus(p) != "PENDING_APPROVAL":
        raise ApiError(400, "This policy is not waiting for approval.")
    if p.get("createdByUserId") == user["_id"]:
        raise ApiError(403, "A second person must approve: you drafted this policy.")
    body = await read_body(request)
    decision, comment = body.get("decision", "APPROVED"), js_str(body.get("comment") or "").strip()
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED":
        if not comment:
            raise ApiError(400, "Give a reason for rejecting.")
        p.update({"status": "REJECTED", "reviewComment": comment, "reviewedBy": f"{user.get('firstName')} {user.get('lastName')}"})
        audit(user, "POLICY_REJECTED", "POLICIES", "Policy", policy_id, {"comment": comment})
        return {"success": True, "policy": _policy_view(p, user)}
    archived = []
    for other in modules_store.policies.values():
        if other["_id"] != policy_id and (other.get("policyGroupId") or other["_id"]) == p.get("policyGroupId") and _pstatus(other) == "PUBLISHED":
            other.update({"status": "ARCHIVED", "archivedAt": now_iso(), "supersededBy": policy_id})
            archived.append(other["_id"])
    p.update({"status": "PUBLISHED", "approvedBy": f"{user.get('firstName')} {user.get('lastName')}", "approvedByUserId": user["_id"],
              "publishedAt": now_iso(), "lastUpdated": now_iso()})
    notified = 0
    for emp in db_store.employees.values():
        if emp.get("status") in ("EXITED", "TERMINATED", "INACTIVE") or not _applies(p, emp):
            continue
        uid = emp.get("userId") or next((u["_id"] for u in db_store.users.values() if u.get("employeeId") == emp["_id"]), None)
        if uid:
            notified += 1
            db_store.notifications.insert(0, {"_id": f"notif_{now_ms()}_{rand_int(99999)}", "recipientUserId": uid,
                                              "title": "Policy to acknowledge" if not archived else "Updated policy: please acknowledge again",
                                              "message": f"{p['title']} ({p['version']}) is effective {p['effectiveDate']}.", "type": "POLICY",
                                              "isRead": False, "createdAt": now_iso()})
    audit(user, "POLICY_PUBLISHED", "POLICIES", "Policy", policy_id, {"version": p.get("version"), "archived": archived, "notified": notified})
    return {"success": True, "policy": _policy_view(p, user), "archived": archived}


@router.post("/policies/{policy_id}/new-version")
async def new_version(policy_id: str, request: Request, user: dict = Depends(require_role(*POLICY_AUTHORS))):
    p = modules_store.policies.get(policy_id)
    if not p or _pstatus(p) != "PUBLISHED":
        raise ApiError(400, "New versions are made from the published policy.")
    group = p.get("policyGroupId") or p["_id"]
    if any((o.get("policyGroupId") or o["_id"]) == group and _pstatus(o) in ("DRAFT", "PENDING_APPROVAL", "REJECTED") for o in modules_store.policies.values()):
        raise ApiError(409, "A new version of this policy is already being drafted.")
    body, files = await _body_and_files(request)
    file_info = await _save_file(files)
    fields = _policy_fields(body, {k: v for k, v in p.items() if k not in ("fileUrl",)} | ({"fileUrl": p.get("fileUrl")} if not file_info else {}))
    no = int(p.get("versionNo") or 1) + 1
    nid = f"pol_{now_ms()}_{rand_int(999)}"
    doc = {**{k: v for k, v in p.items() if k in ("fileUrl", "fileName", "fileSize", "storedFileName")}, **fields, **file_info,
           "_id": nid, "policyGroupId": group, "versionNo": no, "version": f"v{no}", "previousVersionId": p["_id"], "status": "DRAFT",
           "changeNote": js_str(body.get("changeNote") or ""), "createdBy": f"{user.get('firstName')} {user.get('lastName')}", "createdByUserId": user["_id"],
           "createdAt": now_iso(), "lastUpdated": now_iso()}
    modules_store.policies[nid] = doc
    audit(user, "POLICY_VERSION_DRAFTED", "POLICIES", "Policy", nid, {"from": p.get("version"), "to": doc["version"]})
    return JSONResponse({"success": True, "policy": _policy_view(doc, user)}, status_code=201)


@router.delete("/policies/{policy_id}")
async def delete_policy(policy_id: str, user: dict = Depends(require_role(*POLICY_AUTHORS))):
    p = modules_store.policies.get(policy_id)
    if not p:
        raise ApiError(404, "Policy not found.")
    if _pstatus(p) not in ("DRAFT", "REJECTED"):
        raise ApiError(409, "Published and archived policies are kept for compliance; only drafts can be deleted.")
    modules_store.policies.pop(policy_id)
    audit(user, "POLICY_DRAFT_DELETED", "POLICIES", "Policy", policy_id, {"title": p.get("title")})
    return {"success": True, "message": "Draft deleted."}


@router.get("/policies/{policy_id}/file")
async def policy_file(policy_id: str, download: bool = False, user: dict = Depends(require_auth)):
    p = _get_policy(policy_id, user)
    if not p.get("storedFileName") and not p.get("fileUrl"):
        raise ApiError(404, "This policy has no attached file.")
    if download and p.get("viewOnly") and user.get("role") not in POLICY_AUTHORS:
        audit(user, "POLICY_DOWNLOAD_BLOCKED", "POLICIES", "Policy", policy_id, {})
        raise ApiError(403, "This policy is view-only; downloading is not allowed.")
    import os
    from app.routes.common import stored_file_response
    stored = p.get("storedFileName") or os.path.basename(p.get("fileUrl") or "")
    resp = await stored_file_response(DOCUMENTS, stored, p.get("fileName") or "policy.pdf", inline=not download)
    if not resp:
        raise ApiError(404, "File not found.")
    resp.headers["Cache-Control"] = "no-store"
    audit(user, "POLICY_DOCUMENT_DOWNLOADED" if download else "POLICY_DOCUMENT_VIEWED", "POLICIES", "Policy", policy_id, {})
    return resp


@router.post("/policies/{policy_id}/acknowledge")
async def acknowledge_policy(policy_id: str, request: Request, user: dict = Depends(require_auth)):
    p = _get_policy(policy_id, user)
    if _pstatus(p) != "PUBLISHED":
        raise ApiError(400, "Only published policies can be acknowledged.")
    emp = _my_emp(user)
    if not emp:
        raise ApiError(400, "No employee record linked to your login.")
    if any(a.get("policyId") == policy_id and a.get("employeeId") == emp["_id"] for a in _acks()):
        raise ApiError(409, "You have already acknowledged this version. Acknowledgements cannot be changed or withdrawn.")
    body = await read_body(request)
    name = f"{emp.get('firstName')} {emp.get('lastName')}"
    ack = {"_id": f"ack_{now_ms()}_{rand_int(9999)}", "policyId": policy_id, "policyGroupId": p.get("policyGroupId") or policy_id,
           "version": p.get("version"), "employeeId": emp["_id"], "employeeName": name, "employeeCode": emp.get("employeeCode"),
           "acknowledgedAt": now_iso(), "ipAddress": client_ip(request) or "unknown",
           "digitalSignature": js_str(body.get("signature") or f"{name} ({emp.get('employeeCode')})")}
    _acks().append(ack)
    audit(user, "POLICY_ACKNOWLEDGED", "POLICIES", "Policy", policy_id, {"version": p.get("version")})
    return {"success": True, "acknowledgement": ack}


@router.get("/policies/{policy_id}/acknowledgements")
async def ack_report(policy_id: str, user: dict = Depends(require_role(*POLICY_READ_ALL))):
    p = modules_store.policies.get(policy_id)
    if not p:
        raise ApiError(404, "Policy not found.")
    acks = {a["employeeId"]: a for a in _acks() if a.get("policyId") == policy_id}
    done, pending = [], []
    for emp in db_store.employees.values():
        if emp.get("status") in ("EXITED", "TERMINATED", "INACTIVE") or not _applies(p, emp):
            continue
        row = {"employeeId": emp["_id"], "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}", "employeeCode": emp.get("employeeCode"),
               "department": emp.get("department"), "location": emp.get("location")}
        if emp["_id"] in acks:
            done.append({**row, "acknowledgedAt": acks[emp["_id"]]["acknowledgedAt"], "ipAddress": acks[emp["_id"]].get("ipAddress")})
        else:
            pending.append(row)
    return {"policy": {k: p.get(k) for k in ("_id", "title", "version", "status")}, "acknowledged": done, "pending": pending,
            "summary": {"applicable": len(done) + len(pending), "acknowledged": len(done), "pending": len(pending)}}


@router.put("/policies/{policy_id}/acknowledgements/{ack_id}")
@router.delete("/policies/{policy_id}/acknowledgements/{ack_id}")
@router.delete("/policies/{policy_id}/acknowledge")
async def ack_immutable(policy_id: str, request: Request, ack_id: Optional[str] = None, user: dict = Depends(require_auth)):
    audit(user, "POLICY_ACK_CHANGE_BLOCKED", "POLICIES", "Policy", policy_id, {"method": request.method, "ackId": ack_id})
    raise ApiError(403, "Acknowledgement records are permanent compliance evidence and cannot be edited or deleted.")


# -------------------------------------------------------------------- POSH

@router.get("/posh/cases")
async def posh_cases(_: dict = Depends(require_role(*POSH_VIEW_ROLES))):
    return {"cases": modules_store.get_posh_cases()}


@router.post("/posh/cases")
async def create_posh_case(request: Request, _: dict = Depends(require_write("core_hr"))):
    body = await read_body(request)
    if not truthy(body.get("respondentName")) or not truthy(body.get("description")):
        raise ApiError(400, "Missing required POSH case fields.")
    anonymous = truthy(body.get("isAnonymous"))
    case = modules_store.create_posh_case({
        "caseNumber": f"POSH-2026-{100 + rand_int(900)}",
        "incidentDate": body.get("incidentDate") or today_str(),
        "complainantName": "Protected Anonymous" if anonymous else (body.get("complainantName") or "Anonymous"),
        "complainantCode": "CONFIDENTIAL" if anonymous else (body.get("complainantCode") or "CONFIDENTIAL"),
        "isAnonymous": anonymous,
        "respondentName": body["respondentName"],
        "respondentDesignation": body.get("respondentDesignation") or "Unspecified",
        "respondentDepartment": body.get("respondentDepartment") or "Unspecified",
        "description": body["description"],
        "committeeAssigned": body.get("committeeAssigned") or "Internal Complaints Committee Lead",
    })
    return JSONResponse({"success": True, "case": case}, status_code=201)


@router.put("/posh/cases/{case_id}/stage")
async def update_posh_stage(case_id: str, request: Request, _: dict = Depends(require_write("core_hr"))):
    body = await read_body(request)
    updated = modules_store.update_posh_stage(case_id, body.get("stage"), body.get("notes"), body.get("status"))
    if not updated:
        raise ApiError(404, "POSH case not found.")
    return {"success": True, "case": updated}


# -------------------------------------------------- holidays & announcements

@router.get("/holidays")
async def holidays(all: bool = False, location: Optional[str] = None, user: dict = Depends(require_auth)):
    """Employees see the holidays of their own location (plus company-wide ones). HR can list
    every location's holidays with ?all=true or one location with ?location=..."""
    items = modules_store.get_holidays()
    is_hr = user.get("role") in ("ADMIN", "SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR", "AUDITORS")
    if not (is_hr and (all or location)):
        emp = db_store.employees.get(user.get("employeeId") or "")
        location = (emp or {}).get("location") if not (is_hr and location) else location
    if location or not (is_hr and all):
        loc = (location or "").strip().lower()
        items = [h for h in items if not h.get("locations") or (loc and loc in [x.strip().lower() for x in h["locations"]])]
    return {"holidays": items, "location": location}


def _holiday_fields(body: dict, exclude_id: Optional[str] = None) -> dict:
    """Validate a holiday create/update body and return the stored fields."""
    name = js_str(body.get("name") or "").strip()
    date_str = js_str(body.get("date") or "").strip()
    holiday_type = js_str(body.get("type") or "MANDATORY").strip().upper()
    if not name or not date_str:
        raise ApiError(400, "Holiday name and date are required.")
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise ApiError(400, "Date must be in YYYY-MM-DD format.")
    if holiday_type not in ("MANDATORY", "RESTRICTED"):
        raise ApiError(400, "Holiday type must be MANDATORY or RESTRICTED.")
    # Locations the holiday applies to; empty = every location
    known = {(l.get("name") or "").strip(): l for l in db_store.locations.values()}
    locations = [js_str(x).strip() for x in body.get("locations") or [] if js_str(x).strip()]
    unknown = [x for x in locations if known and x not in known]
    if unknown:
        raise ApiError(400, f"Unknown location(s): {', '.join(unknown)}.")
    for h in modules_store.get_holidays():
        if h.get("_id") != exclude_id and h.get("date") == date_str and (h.get("name") or "").lower() == name.lower()                 and sorted(h.get("locations") or []) == sorted(locations):
            raise ApiError(409, f'"{name}" is already listed on {date_str} for these locations.')
    return {
        "locations": locations,
        "name": name,
        "date": date_str,
        "dayOfWeek": day.strftime("%A"),
        "type": holiday_type,
        "description": js_str(body.get("description") or "").strip(),
    }


@router.post("/holidays")
async def create_holiday(request: Request, user: dict = Depends(require_role("HR", "ADMIN", "SUPER_ADMIN", "ADMIN_1"))):
    hol = modules_store.create_holiday(_holiday_fields(await read_body(request)))
    audit(user, "HOLIDAY_CREATED", "HOLIDAYS", "Holiday", hol["_id"], {"name": hol["name"], "date": hol["date"]})
    return JSONResponse({"success": True, "holiday": hol}, status_code=201)


@router.put("/holidays/{holiday_id}")
async def update_holiday(holiday_id: str, request: Request, user: dict = Depends(require_role("HR", "ADMIN", "SUPER_ADMIN", "ADMIN_1"))):
    if holiday_id not in modules_store.holidays:
        raise ApiError(404, "Holiday not found.")
    hol = modules_store.update_holiday(holiday_id, _holiday_fields(await read_body(request), exclude_id=holiday_id))
    audit(user, "HOLIDAY_UPDATED", "HOLIDAYS", "Holiday", holiday_id, {"name": hol["name"], "date": hol["date"]})
    return {"success": True, "holiday": hol}


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(holiday_id: str, user: dict = Depends(require_role("HR", "ADMIN", "SUPER_ADMIN", "ADMIN_1"))):
    hol = modules_store.delete_holiday(holiday_id)
    if not hol:
        raise ApiError(404, "Holiday not found.")
    audit(user, "HOLIDAY_DELETED", "HOLIDAYS", "Holiday", holiday_id, {"name": hol.get("name"), "date": hol.get("date")})
    return {"success": True}


@router.get("/announcements")
async def announcements(_: dict = Depends(require_auth)):
    return {"announcements": modules_store.get_announcements()}


@router.post("/announcements")
async def create_announcement(request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    if not truthy(body.get("title")) or not truthy(body.get("content")):
        raise ApiError(400, "Title and content are required.")

    poll = body.get("poll")
    poll_data = None
    if isinstance(poll, dict) and truthy(poll.get("question")) and isinstance(poll.get("options"), list) and len(poll["options"]) >= 2:
        stamp = now_ms()
        poll_data = {
            "question": js_str(poll["question"]).strip(),
            "totalVotes": 0,
            "options": [
                {"id": f"opt_{stamp}_{idx}", "text": js_str(text).strip(), "votes": 0, "votedUserIds": []}
                for idx, text in enumerate(poll["options"])
            ],
        }

    announcement = modules_store.create_announcement({
        "title": body["title"],
        "content": body["content"],
        "category": body.get("category") or "GENERAL",
        "priority": body.get("priority") or "NORMAL",
        "publishedBy": f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})",
        "pinned": truthy(body.get("pinned")),
        "targetDepartment": body.get("targetDepartment"),
        "poll": poll_data,
    })
    return JSONResponse({"success": True, "announcement": announcement}, status_code=201)


@router.post("/announcements/{ann_id}/vote")
async def vote(ann_id: str, request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    option_id = body.get("optionId")
    if not truthy(option_id):
        raise ApiError(400, "optionId is required to vote on a poll.")
    updated = modules_store.vote_poll(ann_id, option_id, user["_id"])
    if not updated:
        raise ApiError(404, "Announcement or poll not found.")
    return {"success": True, "announcement": updated}


# ------------------------------------------------------------- performance

@router.get("/performance/reviews")
async def performance_reviews(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    return {"reviews": modules_store.get_performance_reviews(user, employeeId)}
