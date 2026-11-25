"""Letter templates, AI assistant and notifications.
(Help desk: helpdesk.py · assets: assets.py · benefits: benefits.py · audit logs: reports.py)"""

import os

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.module_access import require_write
from app.auth.security import require_auth
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.templates.letter_gallery import LETTER_TEMPLATE_GALLERY, get_gallery_template
from app.utils.jsutil import now_iso, now_ms, rand_base36, s, truthy

router = APIRouter()

ASSET_TYPES = [
    "LAPTOP", "PHONE", "CHARGER", "TABLET", "HEADSET",
    "CHAIR", "DESK", "CABINET",
    "SOFTWARE_LICENSE", "SUBSCRIPTION",
    "CAR", "BIKE", "OTHER",
]


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
    name = f"{user.get('firstName')} {user.get('lastName')}"

    from app.routes.helpdesk import CATEGORY_QUEUE, _migrate, settings as hd_settings
    from datetime import datetime, timedelta, timezone
    _migrate()
    tid = f"tkt_{now_ms()}_{rand_base36(4)}"
    ticket = {"_id": tid, "ticketNumber": f"HR-TKT-{len(modules_store.tickets) + 1001}", "employeeId": user.get("employeeId"),
              "employeeName": name, "raisedByUserId": user["_id"], "category": "POLICY", "queue": CATEGORY_QUEUE["POLICY"], "confidential": False,
              "subject": f"Policy query: {query[:50]}{'...' if len(query) > 50 else ''}",
              "description": f'Raised via the HR assistant for the query: "{query}"', "priority": "MEDIUM", "status": "OPEN",
              "createdAt": now_iso(), "dueAt": (datetime.now(timezone.utc) + timedelta(hours=hd_settings()["slaHours"]["MEDIUM"])).isoformat().replace("+00:00", "Z"),
              "escalationLevel": 0, "slaBreached": False, "comments": [], "history": [{"action": "CREATED", "at": now_iso(), "by": name}]}
    modules_store.tickets[tid] = ticket
    for agent in [u for u in db_store.users.values() if u.get("role") == "HR"]:
        db_store.notifications.insert(0, {
            "_id": f"notif_{now_ms()}_{rand_base36(5)}",
            "recipientUserId": agent["_id"],
            "title": f"New policy query ticket ({ticket['ticketNumber']})",
            "message": f'{name} raised ticket {ticket["ticketNumber"]}: "{query}".',
            "type": "HELPDESK",
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
