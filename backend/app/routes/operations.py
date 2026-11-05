"""HR service desk, F&F, audit logs, assets, letter templates, AI assistant, notifications, insurance."""

import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.module_access import can_write, require_read, require_write
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.templates.letter_gallery import LETTER_TEMPLATE_GALLERY, get_gallery_template
from app.utils.jsutil import js_str, now_iso, now_ms, num, rand_base36, s, today_str, truthy

router = APIRouter()

ASSET_TYPES = [
    "LAPTOP", "PHONE", "CHARGER", "TABLET", "HEADSET",
    "CHAIR", "DESK", "CABINET",
    "SOFTWARE_LICENSE", "SUBSCRIPTION",
    "CAR", "BIKE", "OTHER",
]


# ---------------------------------------------------------- HR service desk

@router.get("/hr-requests")
async def list_hr_requests(status: Optional[str] = None, user: dict = Depends(require_auth)):
    return {"requests": modules_store.get_hr_requests(user, status)}


@router.post("/hr-requests")
async def create_hr_request(request: Request, user: dict = Depends(require_auth)):
    emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
    if not emp:
        raise ApiError(400, "No employee record linked to current user.")
    body = await read_body(request)
    if not truthy(body.get("subject")) or not truthy(body.get("description")):
        raise ApiError(400, "Subject and description are required.")
    doc = modules_store.create_hr_request({
        "employeeId": emp["_id"],
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "employeeCode": emp.get("employeeCode"),
        "department": emp.get("department"),
        "category": body.get("category") or "GENERAL",
        "subject": body["subject"],
        "description": body["description"],
        "priority": body.get("priority") or "MEDIUM",
    })
    return JSONResponse({"success": True, "request": doc}, status_code=201)


@router.put("/hr-requests/{req_id}/resolve")
async def resolve_hr_request(req_id: str, request: Request, _: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    if not truthy(body.get("remarks")):
        raise ApiError(400, "Resolution remarks are required.")
    updated = modules_store.resolve_hr_request(req_id, body["remarks"])
    if not updated:
        raise ApiError(404, "HR request ticket not found.")
    return {"success": True, "request": updated}


# --------------------------------------------------------------- audit logs
# (Resignations, exits and F&F live in routes/exits.py)

@router.get("/audit-logs")
async def audit_logs(_: dict = Depends(require_read("audit_log"))):
    return {"logs": db_store.auditLogs[:200]}


# ------------------------------------------------------------------ assets

@router.get("/assets")
async def list_assets(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    result = modules_store.get_assets(user, employee_id=employeeId or None)
    return {"assets": result["assets"], "canManage": can_write(user, "asset")}


@router.post("/assets")
async def allocate_asset(request: Request, user: dict = Depends(require_write("asset"))):
    b = await read_body(request)
    employee_id = s(b.get("employeeId") or "")
    a_type = s(b.get("type") or "").upper()
    category = s(b.get("category") or "").upper()
    name = s(b.get("name") or "").strip()
    asset_tag = s(b.get("assetTag") or "").strip()

    if not db_store.employees.get(employee_id):
        raise ApiError(400, "Select a valid employee.")
    if a_type not in ASSET_TYPES:
        raise ApiError(400, "Invalid asset type selected.")
    if not name:
        raise ApiError(400, "Asset name / model is required.")
    if not asset_tag:
        raise ApiError(400, "Asset tag / ID is required.")

    duplicate = next(
        (a for a in modules_store.assets.values()
         if (a.get("assetTag") or "").lower() == asset_tag.lower() and a.get("status") == "ALLOCATED"),
        None,
    )
    if duplicate:
        raise ApiError(409, f"Asset tag {asset_tag} is already allocated to another employee.")

    issued = s(b.get("issuedDate") or "")
    asset = modules_store.allocate_asset({
        "employeeId": employee_id,
        "type": a_type,
        "category": category or None,
        "name": name,
        "assetTag": asset_tag,
        "serialNumber": js_str(b["serialNumber"]).strip() if truthy(b.get("serialNumber")) else None,
        "issuedDate": issued if re.match(r"^\d{4}-\d{2}-\d{2}$", issued) else today_str(),
        "notes": js_str(b["notes"]).strip() if truthy(b.get("notes")) else None,
        "allocatedBy": f"{user.get('firstName')} {user.get('lastName')}".strip(),
    })
    audit(user, "ASSET_ALLOCATED", "ASSETS", "Asset", asset["_id"], {
        "type": a_type, "name": name, "assetTag": asset_tag, "employee": asset.get("employeeName"),
    })
    return JSONResponse({"success": True, "asset": asset}, status_code=201)


@router.put("/assets/{asset_id}/return")
async def return_asset(asset_id: str, user: dict = Depends(require_write("asset"))):
    asset = modules_store.return_asset(asset_id)
    if not asset:
        raise ApiError(404, "Asset not found.")
    audit(user, "ASSET_RETURNED", "ASSETS", "Asset", asset["_id"], {
        "type": asset.get("type"), "assetTag": asset.get("assetTag"), "employee": asset.get("employeeName"),
    })
    return {"success": True, "asset": asset}


# -------------------------------------------------------- letter templates

@router.get("/letter-templates")
async def list_letter_templates(user: dict = Depends(require_auth)):
    return {"templates": modules_store.get_letter_templates(user.get("organizationId"))}


@router.get("/letter-templates/gallery")
async def letter_gallery(_: dict = Depends(require_auth)):
    return {"templates": LETTER_TEMPLATE_GALLERY}


@router.post("/letter-templates/gallery/{key}/preview")
async def preview_gallery_template(key: str, request: Request, user: dict = Depends(require_auth)):
    tmpl = get_gallery_template(key)
    if not tmpl:
        raise ApiError(404, "Gallery template not found.")
    body = await read_body(request)
    content = modules_store.merge_letter_tokens(tmpl["content"], body.get("employeeId"), user.get("organizationId"), user)
    return {"success": True, "title": tmpl["title"], "content": content}


@router.post("/letter-templates/gallery/{key}/use")
async def use_gallery_template(key: str, user: dict = Depends(require_write("core_hr"))):
    """Copies a gallery template into the organisation's own (editable) letter templates."""
    tmpl = get_gallery_template(key)
    if not tmpl:
        raise ApiError(404, "Gallery template not found.")
    created = modules_store.create_letter_template({
        "organizationId": user.get("organizationId"),
        "title": tmpl["title"],
        "category": tmpl["category"],
        "subject": tmpl["subject"],
        "content": tmpl["content"],
    })
    return JSONResponse({"success": True, "template": created}, status_code=201)


@router.post("/letter-templates")
async def create_letter_template(request: Request, user: dict = Depends(require_write("core_hr"))):
    body = await read_body(request)
    title, content = body.get("title"), body.get("content")
    if not truthy(title) or not truthy(content):
        raise ApiError(400, "Title and content are required.")
    tmpl = modules_store.create_letter_template({
        "organizationId": user.get("organizationId"),
        "title": title,
        "category": body.get("category") or "OTHER",
        "subject": body.get("subject") or title,
        "content": content,
    })
    return JSONResponse({"success": True, "template": tmpl}, status_code=201)


@router.put("/letter-templates/{tmpl_id}")
async def update_letter_template(tmpl_id: str, request: Request, _: dict = Depends(require_write("core_hr"))):
    body = await read_body(request)
    updated = modules_store.update_letter_template(tmpl_id, {k: body.get(k) for k in ("title", "category", "subject", "content")})
    if not updated:
        raise ApiError(404, "Template not found.")
    return {"success": True, "template": updated}


@router.delete("/letter-templates/{tmpl_id}")
async def delete_letter_template(tmpl_id: str, _: dict = Depends(require_write("core_hr"))):
    if not modules_store.delete_letter_template(tmpl_id):
        raise ApiError(404, "Template not found.")
    return {"success": True}


@router.post("/letter-templates/{tmpl_id}/preview")
async def preview_letter_template(tmpl_id: str, request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    preview = modules_store.preview_letter_template(tmpl_id, body.get("employeeId"), user.get("organizationId"), user)
    if not preview:
        raise ApiError(404, "Template not found.")
    return {"success": True, **preview}


# ------------------------------------------------------------ AI assistant

AI_MODELS = ("gemini-3.1-flash-lite", "gemini-3.8-flash")
NO_POLICY_TOKEN = "[NO_POLICY_FOUND]"


@router.post("/ai/chat")
async def ai_chat(request: Request, _: dict = Depends(require_auth)):
    body = await read_body(request)
    prompt = s(body.get("prompt") or body.get("message") or "").strip()
    if not prompt:
        raise ApiError(400, "Prompt is required.")

    policy_context = "\n".join(
        f"Title: {p.get('title')}\nCategory: {p.get('category')}\nSummary: {p.get('summary')}\n"
        f"Content/Details: {p.get('summary') or p.get('title')}\n---"
        for p in modules_store.get_policies()
    )

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ApiError(500, "GEMINI_API_KEY is not configured on the server.")

    full_prompt = f"""You are the vetan.ai HR Assistant for vetan.ai HRMS.
Here is the complete list of official company policies currently registered in the organization:
{policy_context or 'No company policies uploaded yet.'}

Employee Query: "{prompt}"

Instructions:
1. Answer the employee's query accurately using the company policies provided above.
2. Carefully evaluate whether the policies cover this query. If there are NO company policies regarding this specific query, you MUST start your response with the exact token "{NO_POLICY_TOKEN}" and state politely that no official company policy was found for this query, then ask the employee if they would like you to raise an HR Support Ticket to the People Operations team for this query.
3. Be professional, helpful, and concise."""

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        try:
            response = await client.aio.models.generate_content(model=AI_MODELS[0], contents=full_prompt)
        except Exception as model_err:  # noqa: BLE001
            print(f"Retrying with {AI_MODELS[1]} after error:", model_err)
            response = await client.aio.models.generate_content(model=AI_MODELS[1], contents=full_prompt)
    except Exception as err:  # noqa: BLE001
        print("Error in AI Assistant Chat:", err)
        raise ApiError(500, str(err) or "Error processing AI chat request.")

    raw_reply = response.text or ""
    payload = {"reply": raw_reply, "noPolicyFound": False}
    if NO_POLICY_TOKEN in raw_reply:
        reply = raw_reply.replace(NO_POLICY_TOKEN, "").strip()
        if "raise" not in reply.lower() and "ticket" not in reply.lower():
            reply += "\n\nWould you like me to raise an HR Support Ticket to the People Operations team for this query?"
        payload = {"reply": reply, "noPolicyFound": True, "pendingQuery": prompt}
    return payload


@router.post("/ai/raise-ticket")
async def ai_raise_ticket(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    query = s(body.get("query") or body.get("prompt") or "Unresolved Policy Query").strip()
    emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
    name = f"{user.get('firstName')} {user.get('lastName')}"

    ticket = modules_store.create_hr_request({
        "employeeId": user.get("employeeId") or "emp_system",
        "employeeName": name,
        "employeeCode": (emp or {}).get("employeeCode") or "RHA-EMP",
        "department": (emp or {}).get("department") or "General Assignment",
        "subject": f"Policy Query Ticket: {query[:50]}{'...' if len(query) > 50 else ''}",
        "description": f'Ticket raised by employee {name} via HR Assistant for query: "{query}"',
        "category": "GENERAL",
        "priority": "MEDIUM",
    })

    for admin in [u for u in db_store.users.values() if u.get("role") == "ADMIN"]:
        db_store.notifications.insert(0, {
            "_id": f"notif_{now_ms()}_{rand_base36(5)}",
            "recipientUserId": admin["_id"],
            "title": f"New Policy Inquiry Ticket ({ticket['ticketNumber']})",
            "message": f'Employee {name} raised ticket {ticket["ticketNumber"]} regarding: "{query}".',
            "type": "POLICY",
            "isRead": False,
            "createdAt": now_iso(),
        })

    audit(user, "HR_TICKET_RAISED_FROM_CHATBOT", "HR_REQUESTS", "HrRequest", ticket["_id"], {
        "ticketNumber": ticket["ticketNumber"], "query": query,
    })
    return {
        "success": True,
        "ticketNumber": ticket["ticketNumber"],
        "reply": f"✅ HR Support Ticket #{ticket['ticketNumber']} has been created for your query!\n\n"
                 "Our People Operations team has been notified and will review your request and get back to you shortly.",
    }


# ------------------------------------------------------------ notifications

def _is_mine(n: dict, user_id: str) -> bool:
    return n.get("recipientUserId") in (user_id, "ALL")


@router.get("/notifications")
async def notifications(user: dict = Depends(require_auth)):
    return {"notifications": [n for n in db_store.notifications if _is_mine(n, user["_id"])]}


@router.post("/notifications/mark-all-read")
async def mark_all_read(user: dict = Depends(require_auth)):
    for n in db_store.notifications:
        if _is_mine(n, user["_id"]):
            n["isRead"] = True
    return {"success": True}


@router.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: str, _: dict = Depends(require_auth)):
    notif = next((n for n in db_store.notifications if n.get("_id") == notif_id), None)
    if notif:
        notif["isRead"] = True
    return {"success": True}


# --------------------------------------------------------------- insurance

@router.get("/insurance/policy")
async def insurance_policy(_: dict = Depends(require_auth)):
    return {"policy": modules_store.get_insurance_policy()}


@router.get("/insurance/enrollment")
async def insurance_enrollment(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    target = employeeId or user.get("employeeId") or "emp_emp_01"
    return {"enrollment": modules_store.get_insurance_enrollment(target)}


@router.post("/insurance/enroll")
async def insurance_enroll(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    target = body.get("employeeId") or user.get("employeeId") or "emp_emp_01"
    enrollment = modules_store.update_insurance_enrollment(target, {
        "sumInsured": body.get("sumInsured"), "dependents": body.get("dependents"), "status": body.get("status"),
    })
    return {"success": True, "enrollment": enrollment}


@router.get("/insurance/claims")
async def insurance_claims(status: Optional[str] = None, employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    return {"claims": modules_store.get_insurance_claims(user, status=status, employee_id=employeeId)}


@router.post("/insurance/claims")
async def submit_insurance_claim(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    if not truthy(body.get("patientName")) or not truthy(body.get("hospitalName")) or not truthy(body.get("amountRequested")):
        raise ApiError(400, "Missing required insurance claim fields.")
    claim = modules_store.submit_insurance_claim(user.get("employeeId") or "emp_emp_01", {
        "patientName": body["patientName"],
        "relation": body.get("relation"),
        "hospitalName": body["hospitalName"],
        "admissionDate": body.get("admissionDate") or today_str(),
        "dischargeDate": body.get("dischargeDate"),
        "claimType": body.get("claimType") or "REIMBURSEMENT",
        "amountRequested": num(body["amountRequested"]),
        "diagnosis": body.get("diagnosis") or "General Medical Treatment",
        "documents": body.get("documents") or [],
    })
    return JSONResponse({"success": True, "claim": claim}, status_code=201)


@router.put("/insurance/claims/{claim_id}/status")
async def update_insurance_claim(claim_id: str, request: Request, user: dict = Depends(require_auth)):
    if user.get("role") != "ADMIN":
        raise ApiError(403, "Unauthorized to review insurance claims.")
    body = await read_body(request)
    updated = modules_store.update_insurance_claim_status(claim_id, body.get("status"), body.get("tpaRemarks"), body.get("amountApproved"))
    if not updated:
        raise ApiError(404, "Insurance claim not found.")
    return {"success": True, "claim": updated}
