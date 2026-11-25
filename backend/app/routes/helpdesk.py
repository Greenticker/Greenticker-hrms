"""Help desk: tickets routed by category to team queues (HR, Finance, Accounts, IT/Admin) and
confidential POSH / grievance tickets to the Internal Complaints Committee only.

Employees see only their own tickets; agents only their queue; internal notes are hidden from the
employee; SLA breaches escalate; the employee reopens or closes and rates; history is append-only
(nobody edits or deletes it); an agent never resolves their own ticket."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import DOCUMENTS, audit, read_body, read_fields_and_files, save_upload
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36
from app.utils.workflow import actor_name, employee_name, my_employee_id, notify_user

router = APIRouter()

QUEUES = {
    "HR": ("HR",),
    "FINANCE": ("FINANCE",),
    "ACCOUNTS": ("ACCOUNTS",),
    "IT_ADMIN": ("ADMIN", "ADMIN_1", "ADMIN_2"),
    "ICC": (),  # committee members are named people, see settings
}
CATEGORY_QUEUE = {
    "HR": "HR", "LEAVE": "HR", "DOCUMENTS": "HR", "POLICY": "HR", "BENEFITS": "HR", "GENERAL": "HR",
    "PAYROLL": "FINANCE", "FINANCE": "FINANCE", "REIMBURSEMENT": "FINANCE", "TAX": "FINANCE",
    "ACCOUNTS": "ACCOUNTS",
    "IT": "IT_ADMIN", "ADMIN": "IT_ADMIN", "FACILITIES": "IT_ADMIN", "ACCESS": "IT_ADMIN",
    "POSH": "ICC", "GRIEVANCE": "ICC",
}
CONFIDENTIAL_QUEUES = ("ICC",)
OPEN_STATES = ("OPEN", "IN_PROGRESS", "REOPENED")
CONFIG_ROLES = ("SUPER_ADMIN",)
READ_ALL_ROLES = ("SUPER_ADMIN", "AUDITORS")   # every non-confidential ticket, read-only


def settings() -> dict:
    s = modules_store.helpdeskSettings.setdefault("settings", {"_id": "settings"})
    s.setdefault("slaHours", {"HIGH": 8, "MEDIUM": 24, "LOW": 72})
    s.setdefault("reopenDays", 7)
    if "iccMemberUserIds" not in s:
        s["iccMemberUserIds"] = [u["_id"] for u in db_store.users.values() if u.get("role") == "HR" and u.get("isActive", True)][:1]
    return s


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _migrate() -> None:
    """Older HR requests become tickets once."""
    if modules_store.helpdeskSettings.get("migrated"):
        return
    for r in list(modules_store.hrRequests.values()):
        cat = (r.get("category") or "GENERAL").upper()
        queue = CATEGORY_QUEUE.get(cat, "HR")
        tid = r["_id"]
        if tid in modules_store.tickets:
            continue
        status = {"RESOLVED": "RESOLVED", "CLOSED": "CLOSED", "IN_PROGRESS": "IN_PROGRESS"}.get(r.get("status"), "OPEN")
        modules_store.tickets[tid] = {
            "_id": tid, "ticketNumber": r.get("ticketNumber") or f"TKT-{tid}", "employeeId": r.get("employeeId"), "employeeName": r.get("employeeName"),
            "raisedByUserId": next((u["_id"] for u in db_store.users.values() if u.get("employeeId") == r.get("employeeId")), None),
            "category": cat, "queue": queue, "confidential": queue in CONFIDENTIAL_QUEUES, "subject": r.get("subject"), "description": r.get("description"),
            "priority": r.get("priority") or "MEDIUM", "status": status, "createdAt": r.get("createdAt") or now_iso(),
            "dueAt": r.get("createdAt") or now_iso(), "resolvedAt": r.get("resolvedAt"),
            "comments": ([{"_id": f"c_{tid}", "text": r["resolutionRemarks"], "internal": False, "by": r.get("assignedTo") or "HR", "at": r.get("resolvedAt") or now_iso()}]
                         if r.get("resolutionRemarks") else []),
            "history": [{"action": "MIGRATED", "at": now_iso(), "by": "System"}], "escalationLevel": 0, "slaBreached": False}
    modules_store.helpdeskSettings["migrated"] = {"_id": "migrated", "at": now_iso()}


def _is_agent(user: dict, t: dict) -> bool:
    if t["queue"] == "ICC":
        return user["_id"] in settings()["iccMemberUserIds"]
    return user.get("role") in QUEUES[t["queue"]]


def _can_view(user: dict, t: dict) -> bool:
    if t.get("raisedByUserId") == user["_id"] or (t.get("employeeId") and t["employeeId"] == my_employee_id(user)):
        return True
    if _is_agent(user, t):
        return True
    return user.get("role") in READ_ALL_ROLES and not t.get("confidential")


def _is_raiser(user: dict, t: dict) -> bool:
    return t.get("raisedByUserId") == user["_id"] or (bool(t.get("employeeId")) and t["employeeId"] == my_employee_id(user))


def _check_sla(t: dict) -> None:
    if t["status"] not in OPEN_STATES or not t.get("dueAt"):
        return
    now = datetime.now(timezone.utc)
    if now > _parse(t["dueAt"]) and t.get("escalationLevel", 0) < 2:
        level = t.get("escalationLevel", 0) + 1
        t.update({"escalationLevel": level, "slaBreached": True, "escalatedAt": now_iso()})
        t["history"].append({"action": f"ESCALATED_L{level}", "at": now_iso(), "by": "System (SLA breach)"})
        # level 1: whole queue + Super Admin; level 2: Super Admin again with the next deadline
        targets = [u["_id"] for u in db_store.users.values() if u.get("role") in CONFIG_ROLES]
        if t["queue"] != "ICC":
            targets += [u["_id"] for u in db_store.users.values() if u.get("role") in QUEUES[t["queue"]]]
        else:
            targets = list(settings()["iccMemberUserIds"])
        for uid in dict.fromkeys(targets):
            notify_user(uid, "Ticket SLA breached", f"{t['ticketNumber']} ({t['category'].title()}) is past its SLA — escalation level {level}.", "HELPDESK")
        t["dueAt"] = (now + timedelta(hours=settings()["slaHours"].get(t["priority"], 24))).isoformat().replace("+00:00", "Z")


def _view(t: dict, user: dict) -> dict:
    agent = _is_agent(user, t)
    out = {k: v for k, v in t.items() if k not in ("comments",)}
    out["comments"] = [c for c in t.get("comments", []) if agent or not c.get("internal")]
    out["isAgent"] = agent
    out["canResolve"] = agent and t["status"] in OPEN_STATES and not _is_raiser(user, t)
    out["canClose"] = _is_raiser(user, t) and t["status"] == "RESOLVED"
    out["canReopen"] = _is_raiser(user, t) and t["status"] == "RESOLVED"
    if t.get("confidential") and not agent and not _is_raiser(user, t):
        out["description"] = "[confidential]"
    return out


def _ticket(tid: str, user: dict) -> dict:
    _migrate()
    t = modules_store.tickets.get(tid) or next((x for x in modules_store.tickets.values() if x.get("ticketNumber") == tid), None)
    if not t:
        raise ApiError(404, "Ticket not found.")
    if not _can_view(user, t):
        audit(user, "TICKET_ACCESS_DENIED", "HELPDESK", "Ticket", t["_id"], {"ticketNumber": t["ticketNumber"]})
        raise ApiError(403, "Access denied: you can only see your own tickets or your team's queue.")
    _check_sla(t)
    return t


@router.get("/helpdesk/settings")
async def get_settings(user: dict = Depends(require_auth)):
    s = settings()
    return {"settings": {**s, "iccMembers": [{"userId": u, "name": actor_name(db_store.users[u])} for u in s["iccMemberUserIds"] if u in db_store.users]},
            "categories": CATEGORY_QUEUE, "canConfigure": user.get("role") in CONFIG_ROLES}


@router.put("/helpdesk/settings")
async def save_settings(request: Request, user: dict = Depends(require_role(*CONFIG_ROLES))):
    b = await read_body(request)
    s = settings()
    old = {"slaHours": dict(s["slaHours"]), "iccMemberUserIds": list(s["iccMemberUserIds"])}
    for p, h in (b.get("slaHours") or {}).items():
        if p in s["slaHours"]:
            s["slaHours"][p] = max(0.0, float(h))
    if "iccMemberUserIds" in b:
        ids = [u for u in b["iccMemberUserIds"] if u in db_store.users]
        if not ids:
            raise ApiError(400, "Name at least one ICC member.")
        s["iccMemberUserIds"] = ids
    audit(user, "HELPDESK_SETTINGS_UPDATED", "HELPDESK", "HelpdeskSettings", "settings",
          {"changes": [{"field": k, "oldValue": old[k], "newValue": s[k]} for k in old if old[k] != s[k]]})
    return {"settings": s}


@router.get("/helpdesk/tickets")
async def list_tickets(scope: str = "auto", status: Optional[str] = None, user: dict = Depends(require_auth)):
    _migrate()
    rows = []
    for t in modules_store.tickets.values():
        if not _can_view(user, t):
            continue
        if scope == "mine" and not _is_raiser(user, t):
            continue
        if scope == "queue" and not _is_agent(user, t):
            continue
        _check_sla(t)
        if status and status != "ALL" and t["status"] != status:
            continue
        rows.append(_view(t, user))
    return {"tickets": sorted(rows, key=lambda t: t["createdAt"], reverse=True)}


@router.get("/helpdesk/tickets/{tid}")
async def get_ticket(tid: str, user: dict = Depends(require_auth)):
    return {"ticket": _view(_ticket(tid, user), user)}


@router.post("/helpdesk/tickets")
async def raise_ticket(request: Request, user: dict = Depends(require_auth)):
    _migrate()
    if "multipart" in (request.headers.get("content-type") or ""):
        b, files = await read_fields_and_files(request)
        upload = (files.get("attachment") or [None])[0]
    else:
        b, upload = await read_body(request), None
    cat = js_str(b.get("category") or "").upper()
    subject, desc = js_str(b.get("subject") or "").strip(), js_str(b.get("description") or "").strip()
    priority = js_str(b.get("priority") or "MEDIUM").upper()
    if cat not in CATEGORY_QUEUE:
        raise ApiError(400, f"Category must be one of {', '.join(CATEGORY_QUEUE)}.")
    if not subject or not desc:
        raise ApiError(400, "Subject and description are required.")
    if priority not in ("HIGH", "MEDIUM", "LOW"):
        raise ApiError(400, "Priority must be HIGH, MEDIUM or LOW.")
    attachment = None
    if upload:
        saved = await save_upload(upload, DOCUMENTS)
        attachment = {"fileName": upload.filename, "fileUrl": f"/uploads/documents/{saved['storedFileName']}"}
    queue = CATEGORY_QUEUE[cat]
    seq = len(modules_store.tickets) + 1001
    tid = f"tkt_{now_ms()}_{rand_base36(4)}"
    me = my_employee_id(user)
    created = datetime.now(timezone.utc)
    t = {"_id": tid, "ticketNumber": f"{queue[:2]}-TKT-{seq}", "employeeId": me, "employeeName": employee_name(me) if me else actor_name(user),
         "raisedByUserId": user["_id"], "category": cat, "queue": queue, "confidential": queue in CONFIDENTIAL_QUEUES,
         "subject": subject, "description": desc, "priority": priority, "attachment": attachment, "status": "OPEN",
         "createdAt": now_iso(), "dueAt": (created + timedelta(hours=settings()["slaHours"][priority])).isoformat().replace("+00:00", "Z"),
         "escalationLevel": 0, "slaBreached": False, "comments": [],
         "history": [{"action": "CREATED", "at": now_iso(), "by": actor_name(user)}]}
    # an agent raising a ticket in their own queue: it goes to the other agents
    agents = (settings()["iccMemberUserIds"] if queue == "ICC" else [u["_id"] for u in db_store.users.values() if u.get("role") in QUEUES[queue] and u.get("isActive", True)])
    others = [a for a in agents if a != user["_id"]]
    if user["_id"] in agents:
        t["assignedToUserId"] = others[0] if others else None
        t["assignedTo"] = actor_name(db_store.users[others[0]]) if others else "Super Admin (no other agent)"
        t["history"].append({"action": "ASSIGNED_AWAY_FROM_RAISER", "at": now_iso(), "by": "System", "to": t["assignedTo"]})
        if not others:
            others = [u["_id"] for u in db_store.users.values() if u.get("role") in CONFIG_ROLES]
    modules_store.tickets[tid] = t
    for a in others:
        notify_user(a, f"New {'confidential ' if t['confidential'] else ''}ticket", f"{t['ticketNumber']}: {subject if not t['confidential'] else 'confidential complaint'}", "HELPDESK")
    notify_user(user["_id"], "Ticket raised", f"Your ticket {t['ticketNumber']} has been logged. Response due by {t['dueAt'][:16].replace('T', ' ')} UTC.", "HELPDESK")
    audit(user, "TICKET_RAISED", "HELPDESK", "Ticket", tid, {"ticketNumber": t["ticketNumber"], "category": cat, "queue": queue})
    return JSONResponse({"ticket": _view(t, user), "acknowledgement": f"Ticket {t['ticketNumber']} logged and routed to the {queue.replace('_', '/')} team."},
                        status_code=201)


@router.get("/helpdesk/tickets/{tid}/attachment")
async def ticket_attachment(tid: str, user: dict = Depends(require_auth)):
    from app.routes.common import stored_file_response
    t = _ticket(tid, user)
    a = t.get("attachment") or {}
    resp = await stored_file_response(DOCUMENTS, a.get("fileUrl", "").rsplit("/", 1)[-1], a.get("fileName"), inline=True) if a else None
    if not resp:
        raise ApiError(404, "No attachment.")
    return resp


@router.post("/helpdesk/tickets/{tid}/comments")
async def add_comment(tid: str, request: Request, user: dict = Depends(require_auth)):
    t = _ticket(tid, user)
    agent, raiser = _is_agent(user, t), _is_raiser(user, t)
    if not (agent or raiser):
        raise ApiError(403, "Only the person who raised the ticket and the team handling it can comment.")
    b = await read_body(request)
    text = js_str(b.get("text") or "").strip()
    internal = bool(b.get("internal"))
    if not text:
        raise ApiError(400, "Write a comment.")
    if internal and not agent:
        raise ApiError(403, "Only agents can add internal notes.")
    if t["status"] == "CLOSED":
        raise ApiError(409, "The ticket is closed.")
    t["comments"].append({"_id": f"c_{now_ms()}_{rand_base36(3)}", "text": text, "internal": internal, "by": actor_name(user), "byUserId": user["_id"], "at": now_iso()})
    if agent and t["status"] == "OPEN" and not internal:
        t["status"] = "IN_PROGRESS"
        t["history"].append({"action": "IN_PROGRESS", "at": now_iso(), "by": actor_name(user)})
    if agent and not internal and t.get("raisedByUserId"):
        notify_user(t["raisedByUserId"], "Reply on your ticket", f"{t['ticketNumber']}: {text[:80]}", "HELPDESK")
    audit(user, "TICKET_NOTE_ADDED" if internal else "TICKET_COMMENT_ADDED", "HELPDESK", "Ticket", t["_id"], {"internal": internal})
    return {"ticket": _view(t, user)}


@router.post("/helpdesk/tickets/{tid}/resolve")
async def resolve(tid: str, request: Request, user: dict = Depends(require_auth)):
    t = _ticket(tid, user)
    if not _is_agent(user, t):
        raise ApiError(403, "Only the team handling this ticket can resolve it.")
    if _is_raiser(user, t):
        raise ApiError(403, "You cannot resolve your own ticket; another agent must handle it.")
    if t["status"] not in OPEN_STATES:
        raise ApiError(409, "The ticket is not open.")
    text = js_str((await read_body(request)).get("resolution") or "").strip()
    if not text:
        raise ApiError(400, "Write the resolution.")
    t["comments"].append({"_id": f"c_{now_ms()}_{rand_base36(3)}", "text": text, "internal": False, "by": actor_name(user), "byUserId": user["_id"],
                          "at": now_iso(), "resolution": True})
    t.update({"status": "RESOLVED", "resolvedAt": now_iso(), "resolvedBy": actor_name(user), "resolvedByUserId": user["_id"]})
    t["history"].append({"action": "RESOLVED", "at": now_iso(), "by": actor_name(user)})
    if t.get("raisedByUserId"):
        notify_user(t["raisedByUserId"], "Ticket resolved", f"{t['ticketNumber']} was resolved. Close and rate it, or reopen it.", "HELPDESK")
    audit(user, "TICKET_RESOLVED", "HELPDESK", "Ticket", t["_id"], {})
    return {"ticket": _view(t, user)}


@router.post("/helpdesk/tickets/{tid}/reopen")
async def reopen(tid: str, request: Request, user: dict = Depends(require_auth)):
    t = _ticket(tid, user)
    if not _is_raiser(user, t):
        raise ApiError(403, "Only the person who raised the ticket can reopen it.")
    if t["status"] != "RESOLVED":
        raise ApiError(409, "Only resolved tickets can be reopened.")
    if datetime.now(timezone.utc) - _parse(t["resolvedAt"]) > timedelta(days=settings()["reopenDays"]):
        raise ApiError(409, f"Tickets can be reopened within {settings()['reopenDays']} days of resolution; raise a new one.")
    reason = js_str((await read_body(request)).get("reason") or "").strip()
    if not reason:
        raise ApiError(400, "Say why you are reopening it.")
    t.update({"status": "REOPENED", "dueAt": (datetime.now(timezone.utc) + timedelta(hours=settings()["slaHours"][t["priority"]])).isoformat().replace("+00:00", "Z")})
    t["comments"].append({"_id": f"c_{now_ms()}_{rand_base36(3)}", "text": f"Reopened: {reason}", "internal": False, "by": actor_name(user), "at": now_iso()})
    t["history"].append({"action": "REOPENED", "at": now_iso(), "by": actor_name(user), "reason": reason})
    if t.get("resolvedByUserId"):
        notify_user(t["resolvedByUserId"], "Ticket reopened", f"{t['ticketNumber']}: {reason}", "HELPDESK")
    audit(user, "TICKET_REOPENED", "HELPDESK", "Ticket", t["_id"], {"reason": reason})
    return {"ticket": _view(t, user)}


@router.post("/helpdesk/tickets/{tid}/close")
async def close(tid: str, request: Request, user: dict = Depends(require_auth)):
    t = _ticket(tid, user)
    if not _is_raiser(user, t):
        raise ApiError(403, "Only the person who raised the ticket can close it.")
    if t["status"] != "RESOLVED":
        raise ApiError(409, "Only resolved tickets can be closed.")
    b = await read_body(request)
    try:
        rating = int(b.get("rating"))
    except (TypeError, ValueError):
        raise ApiError(400, "Rate the support from 1 to 5.")
    if not 1 <= rating <= 5:
        raise ApiError(400, "Rate the support from 1 to 5.")
    t.update({"status": "CLOSED", "closedAt": now_iso(), "rating": rating, "feedback": js_str(b.get("feedback") or "")})
    t["history"].append({"action": "CLOSED", "at": now_iso(), "by": actor_name(user), "rating": rating})
    audit(user, "TICKET_CLOSED", "HELPDESK", "Ticket", t["_id"], {"rating": rating})
    return {"ticket": _view(t, user)}


@router.post("/helpdesk/escalations/run")
async def run_escalations(user: dict = Depends(require_role(*CONFIG_ROLES, "ADMIN", "ADMIN_1"))):
    _migrate()
    before = {t["_id"]: t.get("escalationLevel", 0) for t in modules_store.tickets.values()}
    for t in modules_store.tickets.values():
        _check_sla(t)
    escalated = [t["ticketNumber"] for t in modules_store.tickets.values() if t.get("escalationLevel", 0) > before[t["_id"]]]
    audit(user, "TICKET_SLA_CHECK_RUN", "HELPDESK", "Ticket", "sla", {"escalated": escalated})
    return {"escalated": escalated}


# History is evidence: no edits, no deletes, for anyone
@router.put("/helpdesk/tickets/{tid}")
@router.delete("/helpdesk/tickets/{tid}")
@router.put("/helpdesk/tickets/{tid}/comments/{cid}")
@router.delete("/helpdesk/tickets/{tid}/comments/{cid}")
async def immutable(tid: str, request: Request, cid: Optional[str] = None, user: dict = Depends(require_auth)):
    audit(user, "TICKET_HISTORY_EDIT_BLOCKED", "HELPDESK", "Ticket", tid, {"method": request.method, "commentId": cid})
    raise ApiError(403, "Ticket history cannot be edited or deleted. Add a new comment instead.")


# Old endpoints used by the AI assistant and older pages
@router.get("/hr-requests")
async def legacy_list(user: dict = Depends(require_auth)):
    return await list_tickets("auto", None, user)
