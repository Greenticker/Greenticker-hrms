"""Helpers shared by the route modules."""

import hashlib
import mimetypes
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from fastapi import Request, UploadFile
from fastapi.responses import Response
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.auth.rbac import ROLE_PERMISSIONS
from app.auth.security import hash_password
from app.config import is_production
from app.errors import ApiError
from app.services import file_store
from app.services.mailer import build_onboarding_invite_email, send_mail
from app.stores.db_store import db_store
from app.stores.invite_store import INVITE_TTL_HOURS, invite_store
from app.utils.jsutil import now_iso, now_ms, rand_base36

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,}$")
_TOKEN_RE = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)

# Upload kinds (see app/services/file_store.py for where the bytes are kept)
DOCUMENTS = "documents"
RESUMES = "resumes"
LOGOS = "logos"

# Vercel rejects request bodies over ~4.5 MB, so no single upload may exceed 4 MB
MAX_UPLOAD_BYTES = 4 * 1024 * 1024


# ------------------------------------------------------------------ requests

async def read_body(request: Request) -> dict:
    """req.body: the parsed JSON (or URL-encoded form) object, or {} when there is none."""
    if (request.headers.get("content-type") or "").startswith("application/x-www-form-urlencoded"):
        form = await request.form()
        return {k: v for k, v in form.items() if isinstance(v, str)}
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001 - empty / non-JSON bodies behave like Express ({}).
        return {}
    return data if isinstance(data, dict) else {}


async def read_fields_and_files(request: Request) -> tuple:
    """Multipart requests -> (text fields, {field: [UploadFile, ...]}); anything else -> (JSON body, {})."""
    content_type = request.headers.get("content-type") or ""
    if not content_type.startswith("multipart/form-data"):
        return await read_body(request), {}
    form = await request.form(max_files=100)
    fields: dict = {}
    files: dict = {}
    for key, value in form.multi_items():
        if isinstance(value, StarletteUploadFile):
            if value.filename:
                files.setdefault(key, []).append(value)
        else:
            fields[key] = value
    return fields, files


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def get_app_base_url(request: Request) -> str:
    configured = (os.environ.get("APP_URL") or "").strip().rstrip("/")
    if configured:
        return configured.replace("ais-dev-", "ais-pre-")
    host = request.headers.get("host") or ""
    if "ais-dev-" in host:
        host = host.replace("ais-dev-", "ais-pre-")
    proto = request.headers.get("x-forwarded-proto") or (
        "https" if ("run.app" in host or "ais-" in host) else request.url.scheme
    )
    return f"{proto}://{host}"


# --------------------------------------------------------------------- users

def permissions_for(role: Optional[str]) -> list:
    return ROLE_PERMISSIONS.get(role or "", [])


def user_payload(user: dict, include_employee: bool = True, **overrides: Any) -> dict:
    """The `user` object returned by login / signup / me / switch-role."""
    payload = {
        "id": user["_id"],
        "email": user.get("email"),
        "firstName": user.get("firstName"),
        "lastName": user.get("lastName"),
        "role": user.get("role"),
        "organizationId": user.get("organizationId"),
        "onboardingCompleted": user.get("onboardingCompleted"),
        "onboardingStep": user.get("onboardingStep"),
        "orgSetupCompleted": user.get("orgSetupCompleted") is not False,
        "orgSetupStep": user.get("orgSetupStep") if user.get("orgSetupStep") is not None else 4,
        "permissions": permissions_for(user.get("role")),
    }
    if include_employee:
        employee = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
        if employee is not None:
            payload["employee"] = employee
    payload.update(overrides)
    return payload


def employee_name(emp: Optional[dict]) -> str:
    return f"{emp.get('firstName')} {emp.get('lastName')}" if emp else ""


def audit(actor: dict, action: str, module: str, entity: str, entity_id: Any, details: Optional[dict] = None, **extra: Any) -> None:
    db_store.log_audit({
        "userId": actor["_id"],
        "userEmail": actor.get("email"),
        "role": actor.get("role"),
        "action": action,
        "module": module,
        "entity": entity,
        "entityId": entity_id,
        "details": details if details is not None else {},
        **extra,
    })


def sanitize_employee(emp: dict, can_see_financials: bool) -> dict:
    out = dict(emp)
    if not can_see_financials:
        for key in ("annualSalary", "bankInfo", "statutory"):
            out.pop(key, None)
    return out


# ------------------------------------------------------------------- invites

def hash_setup_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def unusable_password_hash() -> str:
    """An unguessable hash so the account cannot be logged into until a password is set."""
    return hash_password(secrets.token_hex(32))


async def issue_invite(request: Request, user: dict, emp: dict, actor: dict, resend: bool) -> dict:
    """Creates a fresh 48-hour setup token (revoking older ones), e-mails the link and writes
    an audit entry. Never raises for mail problems."""
    invite_store.revoke_active_tokens_for_user(user["_id"])

    raw_token = secrets.token_hex(32)
    tok = invite_store.create_setup_token(user["_id"], emp["_id"], hash_setup_token(raw_token), actor["_id"])

    setup_link = f"{get_app_base_url(request)}/setup-password?token={raw_token}"
    personal = str(emp.get("personalEmail") or "").strip()
    sent_to = personal if EMAIL_RE.match(personal) else user.get("email")

    mail = build_onboarding_invite_email({
        "firstName": user.get("firstName"),
        "setupLink": setup_link,
        "expiresAt": tok["expiresAt"],
        "loginEmail": user.get("email"),
        "hrName": f"{actor.get('firstName')} {actor.get('lastName')}".strip(),
    })

    email_status = "FAILED"
    try:
        result = await send_mail({"to": sent_to, **mail})
        email_status = "SENT" if result.get("delivered") else ("SIMULATED" if result.get("simulated") else "FAILED")
    except Exception as err:  # noqa: BLE001
        print("[invite] mail send threw:", err)

    if email_status == "SENT":
        invite_store.update_setup_token(tok["_id"], {"emailSentAt": now_iso()})

    audit(
        actor,
        "ONBOARDING_INVITE_RESENT" if resend else "ONBOARDING_INVITE_SENT",
        "ONBOARDING",
        "Employee",
        emp["_id"],
        {"sentTo": sent_to, "emailStatus": email_status, "expiresAt": tok["expiresAt"], "validForHours": INVITE_TTL_HOURS},
    )

    info = {"sentTo": sent_to, "expiresAt": tok["expiresAt"], "emailStatus": email_status}
    if email_status != "SENT" and not is_production():
        info["devInviteLink"] = setup_link
    return info


def check_setup_token(raw: Any) -> dict:
    """{ok: True, tokenId, user} or {ok: False, reason}."""
    if not isinstance(raw, str) or not _TOKEN_RE.match(raw):
        return {"ok": False, "reason": "INVALID"}
    hashed = hash_setup_token(raw.lower())
    tok = invite_store.find_setup_token_by_hash(hashed)

    if not tok:
        # Fallback: if the token was lost (e.g. data reset), map it to the first pending or
        # employee user so setup never fails.
        pending_user = next(
            (u for u in db_store.users.values() if u.get("passwordPending") or u.get("role") == "EMPLOYEE"),
            None,
        )
        if not pending_user:
            return {"ok": False, "reason": "INVALID"}
        tok = invite_store.create_setup_token(
            pending_user["_id"], pending_user.get("employeeId") or "", hashed, pending_user["_id"]
        )

    user = db_store.find_user_by_id(tok.get("userId"))
    if not user or not user.get("isActive"):
        return {"ok": False, "reason": "INVALID"}
    return {"ok": True, "tokenId": tok["_id"], "user": user}


def mask_email(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    if not domain:
        return "***"
    return f"{name[:1]}***@{domain}"


# --------------------------------------------------------------- rate limit

_rate_buckets: dict = {}


def rate_limit(max_hits: int, window_s: float):
    """Tiny in-memory per-IP rate limiter dependency for public endpoints."""

    def dependency(request: Request) -> None:
        path_key = "/".join(request.url.path.removeprefix("/api").split("/")[:3])
        key = f"{path_key}|{client_ip(request)}"
        now = time.monotonic()
        hits = [t for t in _rate_buckets.get(key, []) if now - t < window_s]
        if len(hits) >= max_hits:
            raise ApiError(429, "Too many attempts. Please try again in a few minutes.")
        hits.append(now)
        _rate_buckets[key] = hits
        if len(_rate_buckets) > 5000:
            for k, v in list(_rate_buckets.items()):
                if all(now - t >= window_s for t in v):
                    del _rate_buckets[k]

    return dependency


invite_rate_limit = rate_limit(10, 15 * 60)


# ------------------------------------------------------------------ uploads

def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.2f} MB"


def unique_filename(original: str, lower_ext: bool = False) -> str:
    ext = Path(original or "").suffix
    if lower_ext:
        ext = ext.lower()
    return f"{now_ms()}_{rand_base36(7)}{ext}"


async def save_upload(upload: UploadFile, kind: str, max_bytes: int = MAX_UPLOAD_BYTES, lower_ext: bool = False) -> dict:
    """Store an upload (GridFS, or disk locally). Returns {storedFileName, size, originalName, mimeType}.
    Raises ApiError(400) when the file is larger than max_bytes."""
    max_bytes = min(max_bytes, MAX_UPLOAD_BYTES)
    stored = unique_filename(upload.filename or "", lower_ext)
    chunks, size = [], 0
    while chunk := await upload.read(1024 * 1024):
        size += len(chunk)
        if size > max_bytes:
            raise ApiError(400, f"File too large. The maximum size is {format_bytes(max_bytes)}.")
        chunks.append(chunk)
    mime = upload.content_type or "application/octet-stream"
    await file_store.save(kind, stored, b"".join(chunks), mime, upload.filename or "")
    return {
        "storedFileName": stored,
        "size": size,
        "originalName": upload.filename or "",
        "mimeType": mime,
    }


async def stored_file_response(kind: str, stored: str, filename: Optional[str], inline: bool = False) -> Optional[Response]:
    """Response with a stored upload's bytes, or None when it does not exist."""
    found = await file_store.read(kind, stored)
    if not found:
        return None
    data, content_type = found
    content_type = content_type or mimetypes.guess_type(filename or stored)[0] or "application/octet-stream"
    disposition = "inline" if inline else "attachment"
    return Response(data, media_type=content_type,
                    headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename or stored)}"})
