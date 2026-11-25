"""System administration: users (always linked to an employee, named logins only, never your own
role), role / module permissions, security policy (password rules, lockout, MFA, session timeout),
company settings, approval workflows, integrations (secrets never returned), backup / restore and
the role-conflict report. Every change is written to the audit log with old and new values.

Matrix: Admin manages users (not themselves); Super Admin has full configuration (logged);
Auditors view the logs; nobody else has access."""

import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.auth.security import hash_password, require_auth, require_role
from app.errors import ApiError
from app.routes.common import EMAIL_RE, audit, issue_invite, read_body, unusable_password_hash
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, today_str
from app.utils.workflow import actor_name, my_employee_id, notify_user

router = APIRouter()

USER_ADMINS = ("ADMIN", "ADMIN_1", "ADMIN_2", "SUPER_ADMIN")
SA = ("SUPER_ADMIN",)
LOG_VIEWERS = ("SUPER_ADMIN", "AUDITORS")
ROLES = ("SUPER_ADMIN", "ADMIN", "ADMIN_1", "ADMIN_2", "HR", "FINANCE", "ACCOUNTS", "AUDITORS", "MANAGER", "EMPLOYEE")
PRIVILEGED = ("SUPER_ADMIN", "ADMIN", "ADMIN_1", "ADMIN_2", "HR", "FINANCE", "ACCOUNTS", "AUDITORS")
GENERIC_LOCALPARTS = re.compile(r"^(admin|administrator|hr|hr\d*|finance|accounts?|payroll|test|testing|user\d*|info|support|helpdesk|it|office|"
                                r"team|guest|demo|root|system|shared|common|temp)$", re.IGNORECASE)
# Role pairs one person must never hold (across all their logins)
CONFLICTING = [("SUPER_ADMIN", "FINANCE"), ("SUPER_ADMIN", "HR"), ("SUPER_ADMIN", "ACCOUNTS"), ("ADMIN", "FINANCE"),
               ("FINANCE", "ACCOUNTS"), ("HR", "FINANCE"), ("AUDITORS", "SUPER_ADMIN"), ("AUDITORS", "FINANCE"), ("AUDITORS", "HR")]

DEFAULTS = {
    "passwordPolicy": {"minLength": 8, "requireUpper": True, "requireLower": True, "requireDigit": True, "requireSpecial": True,
                       "expiryDays": 90, "historyCount": 3},
    "lockout": {"maxAttempts": 5, "lockMinutes": 30},
    "mfa": {"enabled": False, "roles": ["SUPER_ADMIN"], "otpMinutes": 5, "maxAttempts": 5},
    "session": {"idleTimeoutMinutes": 30, "maxSessionHours": 12},
    "company": {"name": "", "financialYearStartMonth": 4, "currency": "INR", "currencySymbol": "₹", "timezone": "Asia/Kolkata",
                "dateFormat": "DD/MM/YYYY", "emailTemplates": {
                    "leaveApproved": {"subject": "Your leave has been approved", "body": "Hi {name}, your {leaveType} from {from} to {to} is approved."},
                    "payslipReady": {"subject": "Your payslip for {month} is ready", "body": "Hi {name}, your payslip for {month} is available in the HRMS."}}},
    "workflows": {"leave": {"levels": 1}, "expense": {"levels": 2, "description": "Manager, then Finance"},
                  "asset": {"levels": 2, "description": "Manager, then Admin issue"}},
    "integrations": {"biometric": {"enabled": True, "mode": "PUSH_API", "syncIntervalMinutes": 5},
                     "bank": {"enabled": True, "format": "NEFT_CSV", "debitAccount": ""},
                     "erp": {"enabled": True, "format": "TALLY_XML"},
                     "email": {"enabled": True, "provider": "RESEND"},
                     "sms": {"enabled": False, "provider": ""}},
}
SECRET_FIELDS = {"biometric": ["apiKey"], "bank": ["apiKey", "password"], "erp": ["apiKey", "password"], "email": ["apiKey"], "sms": ["apiKey", "authToken"]}


def system_settings() -> dict:
    s = modules_store.systemSettings.setdefault("settings", {"_id": "settings"})
    for k, v in DEFAULTS.items():
        if k not in s:
            s[k] = json.loads(json.dumps(v))
        elif isinstance(v, dict):
            for kk, vv in v.items():
                s[k].setdefault(kk, json.loads(json.dumps(vv)))
    s.setdefault("rolePermissions", {})
    return s


def _secrets() -> dict:
    return modules_store.systemSettings.setdefault("secrets", {"_id": "secrets"})


def _mask(v: str) -> str:
    return ("•" * 8 + v[-4:]) if v and len(v) > 4 else ("•" * 8 if v else "")


def password_problems(password: str, user: Optional[dict] = None) -> list:
    from app.auth.security import compare_password
    p = system_settings()["passwordPolicy"]
    errs = []
    if len(password) < p["minLength"]:
        errs.append(f"at least {p['minLength']} characters")
    if p["requireUpper"] and not re.search(r"[A-Z]", password):
        errs.append("an uppercase letter")
    if p["requireLower"] and not re.search(r"[a-z]", password):
        errs.append("a lowercase letter")
    if p["requireDigit"] and not re.search(r"\d", password):
        errs.append("a digit")
    if p["requireSpecial"] and not re.search(r"[^A-Za-z0-9]", password):
        errs.append("a special character")
    out = [f"Password must contain {', '.join(errs)}."] if errs else []
    if user:
        if (user.get("email") or "").split("@")[0].lower() in password.lower() and len((user.get("email") or "").split("@")[0]) >= 3:
            out.append("Password must not contain your login name.")
        recent = ([user.get("passwordHash")] + list(user.get("passwordHistory") or []))[: max(1, p["historyCount"])]
        if any(h and compare_password(password, h) for h in recent):
            out.append(f"You cannot reuse any of your last {p['historyCount']} passwords.")
    return out


def set_password(user: dict, password: str) -> None:
    p = system_settings()["passwordPolicy"]
    if user.get("passwordHash") and not user.get("passwordPending"):
        user["passwordHistory"] = ([user["passwordHash"]] + list(user.get("passwordHistory") or []))[: max(1, p["historyCount"])]
    user["passwordHash"] = hash_password(password)
    user["passwordChangedAt"] = now_iso()
    user.pop("mustChangePassword", None)


def password_expired(user: dict) -> bool:
    days = system_settings()["passwordPolicy"]["expiryDays"]
    changed = user.get("passwordChangedAt")
    if not days or not changed:
        return False
    from datetime import datetime, timezone
    age = datetime.now(timezone.utc) - datetime.fromisoformat(changed.replace("Z", "+00:00"))
    return age.days >= days


def record_login(email: str, user: Optional[dict], success: bool, reason: str, ip: str) -> None:
    from app.utils.jsutil import now_ms, rand_base36
    lid = f"login_{now_ms()}_{rand_base36(4)}"
    modules_store.loginHistory[lid] = {"_id": lid, "email": email, "userId": (user or {}).get("_id"), "role": (user or {}).get("role"),
                                       "success": success, "reason": reason, "ipAddress": ip, "at": now_iso()}


def module_overrides() -> dict:
    return system_settings().get("rolePermissions") or {}


# ------------------------------------------------------------------ settings

def _public(s: dict) -> dict:
    out = json.loads(json.dumps({k: v for k, v in s.items() if k != "_id"}))
    sec = _secrets()
    for name, fields in SECRET_FIELDS.items():
        for f in fields:
            val = (sec.get(name) or {}).get(f)
            out["integrations"].setdefault(name, {})[f] = _mask(val) if val else ""
            out["integrations"][name][f + "Set"] = bool(val)
    import os
    out["integrations"]["email"]["apiKeySet"] = out["integrations"]["email"].get("apiKeySet") or bool(os.environ.get("RESEND_API_KEY"))
    return out


@router.get("/admin/settings")
async def get_settings(user: dict = Depends(require_role(*USER_ADMINS, "AUDITORS"))):
    return {"settings": _public(system_settings()), "canEdit": user.get("role") in SA, "roles": ROLES}


@router.get("/settings/public")
async def public_settings(user: dict = Depends(require_auth)):
    s = system_settings()
    return {"company": {k: s["company"].get(k) for k in ("name", "financialYearStartMonth", "currency", "currencySymbol", "timezone", "dateFormat")},
            "session": s["session"]}


@router.put("/admin/settings/{section}")
async def save_section(section: str, request: Request, user: dict = Depends(require_role(*SA))):
    """Super Admin only, every change logged. Workflows in particular: approvers cannot change the
    rules that govern their own approvals."""
    s = system_settings()
    if section not in ("passwordPolicy", "lockout", "mfa", "session", "company", "workflows", "integrations"):
        raise ApiError(404, "Unknown settings section.")
    b = await read_body(request)
    old = json.loads(json.dumps(s[section]))
    new = json.loads(json.dumps(old))
    errors = []
    if section == "passwordPolicy":
        for k in ("minLength", "expiryDays", "historyCount"):
            if k in b:
                new[k] = int(b[k])
        for k in ("requireUpper", "requireLower", "requireDigit", "requireSpecial"):
            if k in b:
                new[k] = bool(b[k])
        if new["minLength"] < 8:
            errors.append("Minimum length cannot be below 8.")
        if not 0 <= new["historyCount"] <= 24:
            errors.append("Password history must be 0–24.")
    elif section == "lockout":
        for k in ("maxAttempts", "lockMinutes"):
            if k in b:
                new[k] = int(b[k])
        if not 3 <= new["maxAttempts"] <= 10:
            errors.append("Lock after 3–10 failed attempts.")
    elif section == "mfa":
        if "enabled" in b:
            new["enabled"] = bool(b["enabled"])
        if "roles" in b:
            new["roles"] = [r for r in b["roles"] if r in ROLES]
        for k in ("otpMinutes", "maxAttempts"):
            if k in b:
                new[k] = int(b[k])
    elif section == "session":
        for k in ("idleTimeoutMinutes", "maxSessionHours"):
            if k in b:
                new[k] = int(b[k])
        if not 1 <= new["idleTimeoutMinutes"] <= 240:
            errors.append("Idle timeout must be 1–240 minutes.")
    elif section == "company":
        for k in ("name", "currency", "currencySymbol", "timezone", "dateFormat"):
            if k in b:
                new[k] = js_str(b[k]).strip()
        if "financialYearStartMonth" in b:
            new["financialYearStartMonth"] = int(b["financialYearStartMonth"])
            if not 1 <= new["financialYearStartMonth"] <= 12:
                errors.append("Financial year must start in month 1–12.")
        if isinstance(b.get("emailTemplates"), dict):
            for key, t in b["emailTemplates"].items():
                if not js_str((t or {}).get("subject") or "").strip():
                    errors.append(f"Template {key} needs a subject.")
                new["emailTemplates"][key] = {"subject": js_str(t.get("subject")), "body": js_str(t.get("body") or "")}
    elif section == "workflows":
        for mod, conf in (b or {}).items():
            if mod not in new:
                errors.append(f"Unknown workflow {mod}.")
                continue
            levels = int((conf or {}).get("levels", new[mod]["levels"]))
            if mod == "leave" and levels not in (1, 2):
                errors.append("Leave approval can have 1 or 2 levels.")
            new[mod]["levels"] = levels
    elif section == "integrations":
        sec = _secrets()
        for name, conf in (b or {}).items():
            if name not in new:
                errors.append(f"Unknown integration {name}.")
                continue
            for k, v in (conf or {}).items():
                if k in SECRET_FIELDS.get(name, []):
                    if v and "•" not in js_str(v):
                        sec.setdefault(name, {})[k] = js_str(v)   # stored server-side only, never returned
                elif not k.endswith("Set"):
                    new[name][k] = v
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the settings.", errors=errors)
    s[section] = new
    changes = [{"field": f"{section}.{k}", "oldValue": old.get(k), "newValue": new.get(k)} for k in set(old) | set(new) if old.get(k) != new.get(k)]
    if section == "integrations":
        changes = [{"field": c["field"], "oldValue": "(changed)", "newValue": "(changed)"} if any(x in c["field"] for x in ("apiKey", "password", "authToken")) else c
                   for c in changes]
    audit(user, "SYSTEM_SETTINGS_CHANGED", "ADMIN", "SystemSettings", section, {"changes": changes})
    return {"settings": _public(s)}


@router.post("/admin/integrations/{name}/test")
async def test_integration(name: str, user: dict = Depends(require_role(*SA))):
    import os
    s = system_settings()["integrations"]
    if name not in s:
        raise ApiError(404, "Unknown integration.")
    ok, detail = True, ""
    if name == "biometric":
        devices = list(modules_store.attendanceDevices.values())
        ok = bool(devices)
        detail = f"{len(devices)} device(s) registered; last sync {max((d.get('lastSyncAt') or '' for d in devices), default='') or 'never'}."
    elif name == "bank":
        detail = "Salary bank advice is generated as NEFT CSV from approved payroll."
    elif name == "erp":
        detail = "Journals export as Tally XML / CSV from Finance."
    elif name == "email":
        ok = bool(os.environ.get("RESEND_API_KEY")) or bool((_secrets().get("email") or {}).get("apiKey"))
        detail = "Resend API key configured." if ok else "No email API key configured; emails are simulated."
    elif name == "sms":
        ok = bool(s["sms"].get("enabled")) and bool((_secrets().get("sms") or {}).get("apiKey"))
        detail = "SMS gateway configured." if ok else "SMS gateway not configured."
    audit(user, "INTEGRATION_TESTED", "ADMIN", "Integration", name, {"ok": ok})
    return {"integration": name, "ok": ok, "detail": detail}


# ------------------------------------------------------------------ roles & permissions

@router.get("/admin/roles")
async def roles_matrix(user: dict = Depends(require_role(*USER_ADMINS, "AUDITORS"))):
    from app.auth.module_access import MATRIX, read_roles, write_roles
    out = []
    for module in MATRIX:
        w, r = write_roles(module), read_roles(module)
        out.append({"module": module, "access": {role: ("READ_WRITE" if role in w else "READ_ONLY" if role in r else "NO_ACCESS") for role in PRIVILEGED}})
    return {"matrix": out, "overrides": module_overrides(), "canEdit": user.get("role") in SA}


@router.put("/admin/roles/{role}/permissions")
async def set_permissions(role: str, request: Request, user: dict = Depends(require_role(*SA))):
    from app.auth.module_access import MATRIX, NO_ADMIN_MODULES
    if role not in PRIVILEGED:
        raise ApiError(400, "Unknown role.")
    if role == "SUPER_ADMIN":
        raise ApiError(403, "Super Admin cannot change the permissions of their own role.")
    b = await read_body(request)
    overrides = system_settings()["rolePermissions"]
    old = json.loads(json.dumps(overrides))
    for module, access in (b or {}).items():
        if module not in MATRIX or access not in ("READ_WRITE", "READ_ONLY", "NO_ACCESS", "DEFAULT"):
            raise ApiError(400, f"Invalid permission {module}={access}.")
        if role == "AUDITORS" and access == "READ_WRITE":
            raise ApiError(400, "Auditors are read-only by design.")
        if role in ("ADMIN", "ADMIN_1", "ADMIN_2") and module in NO_ADMIN_MODULES and access != "NO_ACCESS" and access != "DEFAULT":
            raise ApiError(400, "Admins cannot be given salary (payroll) access.")
        if access == "DEFAULT":
            overrides.get(module, {}).pop(role, None)
        else:
            overrides.setdefault(module, {})[role] = access
    audit(user, "ROLE_PERMISSIONS_CHANGED", "ADMIN", "Role", role,
          {"changes": [{"field": m, "oldValue": (old.get(m) or {}).get(role), "newValue": (overrides.get(m) or {}).get(role)} for m in b]})
    return {"overrides": overrides}


# ------------------------------------------------------------------ users

def _user_row(u: dict) -> dict:
    emp = db_store.employees.get(u.get("employeeId") or "") or {}
    return {"_id": u["_id"], "email": u.get("email"), "name": f"{u.get('firstName', '')} {u.get('lastName', '')}".strip(), "role": u.get("role"),
            "employeeId": u.get("employeeId"), "employeeCode": emp.get("employeeCode"), "employeeStatus": emp.get("status"),
            "isActive": u.get("isActive", True), "lockedUntil": u.get("lockedUntil"), "failedLogins": u.get("failedLogins", 0),
            "mfaEnabled": bool(u.get("mfaEnabled")), "lastLoginAt": u.get("lastLoginAt"), "pendingRole": u.get("pendingRoleChange")}


@router.get("/admin/users")
async def list_users(user: dict = Depends(require_role(*USER_ADMINS, "AUDITORS"))):
    return {"users": sorted((_user_row(u) for u in db_store.users.values()), key=lambda r: r["email"] or ""), "roles": ROLES}


@router.post("/admin/users")
async def create_user(request: Request, user: dict = Depends(require_role(*USER_ADMINS))):
    b = await read_body(request)
    emp_id, role = b.get("employeeId"), b.get("role")
    emp = db_store.employees.get(emp_id or "")
    errors = []
    if not emp:
        errors.append("Every login must be linked to an employee record (no ghost users).")
    if role not in ROLES:
        errors.append("Choose a valid role.")
    if emp_id and emp_id == my_employee_id(user):
        errors.append("You cannot create a login for yourself.")
    if role in ("SUPER_ADMIN", "ADMIN") and user.get("role") not in SA:
        errors.append("Only a Super Admin can create Super Admin / Admin logins.")
    if emp and any(u.get("employeeId") == emp_id for u in db_store.users.values()):
        errors.append(f"{emp.get('firstName')} {emp.get('lastName')} already has a login; one person, one login.")
    email = js_str(b.get("email") or (emp or {}).get("workEmail") or "").strip().lower()
    if not EMAIL_RE.match(email):
        errors.append("A valid work email is required.")
    elif GENERIC_LOCALPARTS.match(email.split("@")[0]):
        errors.append("Generic or shared logins (admin@, hr1@, info@ ...) are not allowed; use the person's own email.")
    elif db_store.find_user_by_email(email):
        errors.append("That email is already used by another login.")
    if emp and emp.get("status") in ("EXITED", "TERMINATED", "INACTIVE"):
        errors.append("The employee has exited.")
    if errors:
        raise ApiError(400 if len(errors) > 1 or "ghost" not in errors[0] else 400, errors[0] if len(errors) == 1 else "The login cannot be created.", errors=errors)
    new_user = db_store.create_user({"email": email, "firstName": emp.get("firstName"), "lastName": emp.get("lastName"), "role": role,
                                     "organizationId": emp.get("organizationId"), "employeeId": emp_id, "isActive": True,
                                     "passwordHash": unusable_password_hash(), "passwordPending": True, "onboardingCompleted": True,
                                     "createdBy": actor_name(user), "createdByUserId": user["_id"]})
    emp["userId"] = new_user["_id"]
    audit(user, "USER_CREATED", "ADMIN", "User", new_user["_id"], {"email": email, "role": role, "employeeCode": emp.get("employeeCode")})
    invite = await issue_invite(request, new_user, emp, user, False)
    return JSONResponse({"user": _user_row(new_user), "invite": invite}, status_code=201)


@router.put("/admin/users/{uid}/role")
async def change_role(uid: str, request: Request, user: dict = Depends(require_role(*USER_ADMINS))):
    target = db_store.users.get(uid)
    if not target:
        raise ApiError(404, "User not found.")
    if uid == user["_id"] or (target.get("employeeId") and target["employeeId"] == my_employee_id(user)):
        audit(user, "SELF_ROLE_CHANGE_BLOCKED", "ADMIN", "User", uid, {"requestedRole": (await read_body(request)).get("role")})
        raise ApiError(403, "You cannot change your own role. Another Super Admin must do it.")
    role = (await read_body(request)).get("role")
    if role not in ROLES:
        raise ApiError(400, "Choose a valid role.")
    if role == target.get("role"):
        raise ApiError(400, "The user already has this role.")
    if user.get("role") not in SA:
        # Admins request; a Super Admin approves (second approval)
        target["pendingRoleChange"] = {"role": role, "requestedBy": actor_name(user), "requestedByUserId": user["_id"], "requestedAt": now_iso()}
        for u in db_store.users.values():
            if u.get("role") in SA and u["_id"] != user["_id"]:
                notify_user(u["_id"], "Role change to approve", f"{target.get('email')}: {target.get('role')} → {role}", "ADMIN")
        audit(user, "ROLE_CHANGE_REQUESTED", "ADMIN", "User", uid, {"changes": [{"field": "role", "oldValue": target.get("role"), "newValue": role}]})
        return {"user": _user_row(target), "pendingApproval": True}
    old = target.get("role")
    target["role"] = role
    target.pop("pendingRoleChange", None)
    audit(user, "ROLE_CHANGED", "ADMIN", "User", uid, {"changes": [{"field": "role", "oldValue": old, "newValue": role}]})
    return {"user": _user_row(target)}


@router.post("/admin/users/{uid}/role/approve")
async def approve_role(uid: str, request: Request, user: dict = Depends(require_role(*SA))):
    target = db_store.users.get(uid)
    pending = (target or {}).get("pendingRoleChange")
    if not pending:
        raise ApiError(404, "No role change is waiting.")
    if uid == user["_id"] or pending["requestedByUserId"] == user["_id"]:
        raise ApiError(403, "You cannot approve this role change.")
    decision = (await read_body(request)).get("decision", "APPROVED")
    old = target.get("role")
    if decision == "APPROVED":
        target["role"] = pending["role"]
    target.pop("pendingRoleChange")
    audit(user, f"ROLE_CHANGE_{decision}", "ADMIN", "User", uid, {"changes": [{"field": "role", "oldValue": old, "newValue": target["role"]}],
                                                                   "requestedBy": pending["requestedBy"]})
    return {"user": _user_row(target)}


@router.put("/admin/users/{uid}/status")
async def set_status(uid: str, request: Request, user: dict = Depends(require_role(*USER_ADMINS))):
    target = db_store.users.get(uid)
    if not target:
        raise ApiError(404, "User not found.")
    if uid == user["_id"]:
        raise ApiError(403, "You cannot deactivate or reactivate your own login.")
    if target.get("role") in SA and user.get("role") not in SA:
        raise ApiError(403, "Only a Super Admin can change a Super Admin login.")
    active = bool((await read_body(request)).get("isActive"))
    old = target.get("isActive", True)
    target["isActive"] = active
    audit(user, "USER_ACTIVATED" if active else "USER_DEACTIVATED", "ADMIN", "User", uid, {"changes": [{"field": "isActive", "oldValue": old, "newValue": active}]})
    return {"user": _user_row(target)}


@router.post("/admin/users/{uid}/unlock")
async def unlock(uid: str, user: dict = Depends(require_role(*USER_ADMINS))):
    target = db_store.users.get(uid)
    if not target:
        raise ApiError(404, "User not found.")
    if uid == user["_id"]:
        raise ApiError(403, "You cannot unlock your own login.")
    target.update({"lockedUntil": None, "failedLogins": 0})
    audit(user, "ACCOUNT_UNLOCKED", "ADMIN", "User", uid, {})
    return {"user": _user_row(target)}


@router.put("/admin/users/{uid}/mfa")
async def set_mfa(uid: str, request: Request, user: dict = Depends(require_role(*USER_ADMINS))):
    target = db_store.users.get(uid)
    if not target:
        raise ApiError(404, "User not found.")
    on = bool((await read_body(request)).get("enabled"))
    target["mfaEnabled"] = on
    audit(user, "MFA_ENABLED" if on else "MFA_DISABLED", "ADMIN", "User", uid, {})
    return {"user": _user_row(target)}


@router.get("/admin/role-conflicts")
async def role_conflicts(user: dict = Depends(require_role(*USER_ADMINS, "AUDITORS"))):
    by_emp: dict = {}
    findings = []
    for u in db_store.users.values():
        if not u.get("isActive", True):
            continue
        local = (u.get("email") or "").split("@")[0]
        if not u.get("employeeId") or u["employeeId"] not in db_store.employees:
            findings.append({"type": "NO_EMPLOYEE_LINK", "severity": "HIGH", "email": u.get("email"), "role": u.get("role"),
                             "detail": "Login is not linked to an employee record."})
        else:
            by_emp.setdefault(u["employeeId"], []).append(u)
        if GENERIC_LOCALPARTS.match(local):
            findings.append({"type": "GENERIC_LOGIN", "severity": "MEDIUM", "email": u.get("email"), "role": u.get("role"),
                             "detail": "Looks like a shared / generic login; accounts must be named."})
    for emp_id, users in by_emp.items():
        roles = {u.get("role") for u in users}
        if len(users) > 1:
            findings.append({"type": "MULTIPLE_LOGINS", "severity": "HIGH", "email": ", ".join(u["email"] for u in users), "role": ", ".join(sorted(roles)),
                             "detail": "One person holds more than one login."})
        for a, b in CONFLICTING:
            if a in roles and b in roles:
                findings.append({"type": "ROLE_CONFLICT", "severity": "HIGH", "email": ", ".join(u["email"] for u in users), "role": f"{a} + {b}",
                                 "detail": f"{a} and {b} must not be held by the same person."})
    audit(user, "ROLE_CONFLICT_REPORT_RUN", "ADMIN", "User", "report", {"findings": len(findings)})
    return {"findings": findings, "rules": [f"{a} + {b}" for a, b in CONFLICTING]}


# ------------------------------------------------------------------ backup / restore

def _bindings():
    from app.database.persistence import BINDINGS, _entries_of
    return BINDINGS, _entries_of


@router.get("/admin/backup")
async def backup(user: dict = Depends(require_role(*SA))):
    bindings, entries_of = _bindings()
    data = {"_meta": {"createdAt": now_iso(), "createdBy": user.get("email"), "format": "vetan-hrms-backup-v1"}}
    counts = {}
    for b in bindings:
        rows = [{"key": k, "value": v} for k, v in entries_of(b)]
        data[b.name] = rows
        counts[b.name] = len(rows)
    audit(user, "BACKUP_TAKEN", "ADMIN", "System", "backup", {"collections": len(counts), "records": sum(counts.values())})
    return Response(json.dumps(data, ensure_ascii=False, default=str), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="hrms_backup_{today_str()}.json"'})


@router.post("/admin/restore")
async def restore(request: Request, user: dict = Depends(require_role(*SA))):
    b = await read_body(request)
    if b.get("confirm") != "RESTORE":
        raise ApiError(400, 'Type RESTORE to confirm; this replaces all current data.')
    data = b.get("backup")
    if not isinstance(data, dict) or (data.get("_meta") or {}).get("format") != "vetan-hrms-backup-v1":
        raise ApiError(400, "This is not an HRMS backup file.")
    bindings, _ = _bindings()
    restored = {}
    for bd in bindings:
        rows = data.get(bd.name)
        # the audit trail is never overwritten (it would let a restore hide changes)
        if not isinstance(rows, list) or bd.name in ("auditLogs", "loginHistory"):
            continue
        c = bd.container()
        if isinstance(c, dict):
            c.clear()
            for r in rows:
                c[r["key"]] = r["value"]
        else:
            c.clear()
            c.extend(r["value"] for r in rows)
        restored[bd.name] = len(rows)
    audit(user, "BACKUP_RESTORED", "ADMIN", "System", "restore", {"from": (data.get("_meta") or {}).get("createdAt"), "records": sum(restored.values())})
    return {"restored": restored}
