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

@router.get("/policies")
async def list_policies(user: dict = Depends(require_auth)):
    return {
        "policies": modules_store.get_policies(),
        "acknowledgements": modules_store.get_policy_acknowledgements(user.get("employeeId")),
    }


@router.post("/policies")
async def create_policy(request: Request, _: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    title, category, content = body.get("title"), body.get("category"), body.get("content")
    if not truthy(title) or not truthy(category) or not truthy(content):
        raise ApiError(400, "title, category, and content are required.")

    policy_id = f"pol_{now_ms()}"
    now = now_iso()
    policy = {
        "_id": policy_id,
        "title": js_str(title).strip(),
        "category": category,
        "version": body.get("version") or "1.0",
        "summary": body.get("summary") or "",
        "content": js_str(content).strip(),
        "mandatory": truthy(body.get("mandatory")),
        "effectiveDate": body.get("effectiveDate") or now[:10],
        "lastUpdated": now,
        "status": "ACTIVE",
    }
    modules_store.policies[policy_id] = policy
    return JSONResponse({"success": True, "policy": policy}, status_code=201)


@router.post("/policies/upload")
async def upload_policy(request: Request, _: dict = Depends(require_role("ADMIN"))):
    body, files = await read_fields_and_files(request)
    upload = (files.get("policyPdf") or [None])[0]
    if upload is None:
        raise ApiError(400, "No PDF file uploaded.")
    if (upload.size or 0) > MAX_UPLOAD_BYTES:
        raise ApiError(400, f"Policy PDF size cannot exceed {format_bytes(MAX_UPLOAD_BYTES)}.")

    saved = await save_upload(upload, DOCUMENTS)
    policy_id = f"pol_{now_ms()}"
    mandatory = body.get("mandatory")
    policy = {
        "_id": policy_id,
        "title": js_str(body.get("title") or upload.filename),
        "category": body.get("category") or "GENERAL",
        "version": js_str(body.get("version") or "v1.0"),
        "summary": js_str(body.get("summary") or ""),
        "content": f"Uploaded PDF Policy Document: {upload.filename}",
        "fileUrl": f"/uploads/documents/{saved['storedFileName']}",
        "fileName": upload.filename,
        "fileSize": saved["size"],
        "mandatory": mandatory == "true" or mandatory is True,
        "effectiveDate": js_str(body.get("effectiveDate") or today_str()),
        "lastUpdated": today_str(),
    }
    modules_store.policies[policy_id] = policy
    return JSONResponse({"success": True, "policy": policy}, status_code=201)


@router.delete("/policies/{policy_id}")
async def delete_policy(policy_id: str, _: dict = Depends(require_role("ADMIN"))):
    if modules_store.policies.pop(policy_id, None) is None:
        raise ApiError(404, "Policy not found.")
    return {"success": True, "message": "Policy deleted successfully."}


@router.post("/policies/{policy_id}/acknowledge")
async def acknowledge_policy(policy_id: str, request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
    name = f"{emp.get('firstName')} {emp.get('lastName')}" if emp else f"{user.get('firstName')} {user.get('lastName')}"
    signature = body.get("signature") or f"{name} (Digital)"
    ack = modules_store.acknowledge_policy(
        policy_id, user.get("employeeId") or "emp_01", name, signature, client_ip(request) or "127.0.0.1"
    )
    return {"success": True, "acknowledgement": ack}


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
async def holidays(_: dict = Depends(require_auth)):
    return {"holidays": modules_store.get_holidays()}


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
    for h in modules_store.get_holidays():
        if h.get("_id") != exclude_id and h.get("date") == date_str and (h.get("name") or "").lower() == name.lower():
            raise ApiError(409, f'"{name}" is already listed on {date_str}.')
    return {
        "name": name,
        "date": date_str,
        "dayOfWeek": day.strftime("%A"),
        "type": holiday_type,
        "description": js_str(body.get("description") or "").strip(),
    }


@router.post("/holidays")
async def create_holiday(request: Request, user: dict = Depends(require_role("HR"))):
    hol = modules_store.create_holiday(_holiday_fields(await read_body(request)))
    audit(user, "HOLIDAY_CREATED", "HOLIDAYS", "Holiday", hol["_id"], {"name": hol["name"], "date": hol["date"]})
    return JSONResponse({"success": True, "holiday": hol}, status_code=201)


@router.put("/holidays/{holiday_id}")
async def update_holiday(holiday_id: str, request: Request, user: dict = Depends(require_role("HR"))):
    if holiday_id not in modules_store.holidays:
        raise ApiError(404, "Holiday not found.")
    hol = modules_store.update_holiday(holiday_id, _holiday_fields(await read_body(request), exclude_id=holiday_id))
    audit(user, "HOLIDAY_UPDATED", "HOLIDAYS", "Holiday", holiday_id, {"name": hol["name"], "date": hol["date"]})
    return {"success": True, "holiday": hol}


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(holiday_id: str, user: dict = Depends(require_role("HR"))):
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
