import re

from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import compare_password, generate_token, hash_password, require_auth
from app.errors import ApiError
from app.routes.common import (
    EMAIL_RE,
    audit,
    check_setup_token,
    hash_setup_token,
    invite_rate_limit,
    mask_email,
    read_body,
    user_payload,
)
from app.routes.exits import deactivate_due_exits
from app.stores.db_store import db_store
from app.stores.invite_store import invite_store
from app.utils.jsutil import iso_from_ms, js_str, now_iso, now_ms, rand_base36, rand_int, today_str

router = APIRouter()

DEMO_PASSWORDS = {
    "superadmin@vetan.ai": "SuperAdmin@12345",
    "admin1@vetan.ai": "Admin1@12345",
    "admin2@vetan.ai": "Admin2@12345",
    "finance@vetan.ai": "Finance@12345",
    "hr@vetan.ai": "HR@12345",
    "accounts@vetan.ai": "Accounts@12345",
    "auditor@vetan.ai": "Auditor@12345",
    "omkar@greenticker.in": "Admin@12345",
    "manager@vetan.ai": "Manager@12345",
    "employee@vetan.ai": "Employee@12345",
    "newhire@vetan.ai": "NewHire@12345",
}

ROLE_DEMO_EMAILS = {
    "SUPER_ADMIN": "superadmin@vetan.ai",
    "ADMIN_1": "admin1@vetan.ai",
    "ADMIN_2": "admin2@vetan.ai",
    "FINANCE": "finance@vetan.ai",
    "HR": "hr@vetan.ai",
    "ACCOUNTS": "accounts@vetan.ai",
    "AUDITORS": "auditor@vetan.ai",
    "ADMIN": "omkar@greenticker.in",
    "MANAGER": "manager@vetan.ai",
    "EMPLOYEE": "employee@vetan.ai",
}


def _token_response(user: dict, status: int = 200, session_start: Optional[int] = None, **user_overrides) -> JSONResponse:
    from app.routes.admin import password_expired, system_settings
    sess = system_settings()["session"]
    payload = user_payload(user, **user_overrides)
    if password_expired(user) or user.get("mustChangePassword"):
        user["mustChangePassword"] = True
        payload["mustChangePassword"] = True
    return JSONResponse(
        {"accessToken": generate_token(user, idle_minutes=sess["idleTimeoutMinutes"], session_start=session_start),
         "tokenType": "bearer", "idleTimeoutMinutes": sess["idleTimeoutMinutes"], "user": payload},
        status_code=status,
    )


def _client_ip(request: Request) -> str:
    from app.routes.common import client_ip
    return client_ip(request) or "unknown"


async def _start_mfa(user: dict) -> JSONResponse:
    """Email a 6-digit one-time code; the sign-in finishes at /auth/verify-otp."""
    import secrets as _secrets
    from datetime import datetime, timedelta, timezone
    from app.config import is_production
    from app.routes.admin import system_settings
    from app.services.mailer import send_mail
    from app.stores.modules_store import modules_store
    conf = system_settings()["mfa"]
    code = f"{_secrets.randbelow(1000000):06d}"
    cid = f"otp_{now_ms()}_{rand_base36(6)}"
    modules_store.otpChallenges[cid] = {"_id": cid, "userId": user["_id"], "codeHash": hash_setup_token(code), "attempts": 0,
                                        "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=conf["otpMinutes"])).isoformat()}
    result = await send_mail({"to": user.get("email"), "subject": "Your sign-in code",
                              "html": f"<p>Your vetan.ai HRMS sign-in code is <b style='font-size:20px'>{code}</b>. It expires in {conf['otpMinutes']} minutes.</p>",
                              "text": f"Your sign-in code is {code}. It expires in {conf['otpMinutes']} minutes."})
    audit(user, "MFA_CODE_SENT", "AUTH", "User", user["_id"], {"delivered": bool(result.get("delivered"))})
    body = {"mfaRequired": True, "challengeId": cid, "message": f"We sent a 6-digit code to {mask_email(user.get('email') or '')}."}
    if not result.get("delivered") and not is_production():
        body["devOtp"] = code  # email is not configured (local / test): show the code so sign-in can be tested
    return JSONResponse(body)


@router.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": now_iso(),
        "service": "vetan.ai HRMS API (FastAPI + Python)",
    }


@router.post("/auth/login")
async def login(request: Request):
    body = await read_body(request)
    email = js_str(body.get("email") or "").strip().lower()
    password = js_str(body.get("password") or "").strip()
    if not email or not password:
        raise ApiError(400, "Email and password are required.")

    # Accounts whose last working day has passed are disabled before the sign-in is checked
    deactivate_due_exits()
    from datetime import datetime, timedelta, timezone
    from app.routes.admin import record_login, system_settings
    ip = _client_ip(request)
    lock_conf = system_settings()["lockout"]

    user = db_store.find_user_by_email(email)
    if user and user.get("lockedUntil"):
        until = datetime.fromisoformat(user["lockedUntil"].replace("Z", "+00:00"))
        if until > datetime.now(timezone.utc):
            record_login(email, user, False, "LOCKED", ip)
            raise ApiError(423, f"Account locked after too many failed attempts. Try again after {until.astimezone().strftime('%H:%M')} or ask an admin to unlock it.")
        user.update({"lockedUntil": None, "failedLogins": 0})
    password_valid = compare_password(password, user.get("passwordHash")) if user else False

    # demo accounts accept their published demo password until the user sets their own
    if not password_valid and user and not user.get("passwordChangedAt"):
        if DEMO_PASSWORDS.get(email) and password == DEMO_PASSWORDS[email]:
            user["passwordHash"] = hash_password(password)
            password_valid = True

    if user and user.get("passwordPending"):
        record_login(email, user, False, "NOT_ACTIVATED", ip)
        raise ApiError(403, "Your account is not activated yet. Please use the setup link sent to your email, or ask HR to resend it.")
    if not user or not password_valid:
        if user:
            user["failedLogins"] = int(user.get("failedLogins") or 0) + 1
            if user["failedLogins"] >= lock_conf["maxAttempts"]:
                user["lockedUntil"] = (datetime.now(timezone.utc) + timedelta(minutes=lock_conf["lockMinutes"])).isoformat().replace("+00:00", "Z")
                record_login(email, user, False, "LOCKED_OUT", ip)
                audit(user, "ACCOUNT_LOCKED", "AUTH", "User", user["_id"], {"failedAttempts": user["failedLogins"], "lockMinutes": lock_conf["lockMinutes"]})
                raise ApiError(423, f"Too many failed attempts. The account is locked for {lock_conf['lockMinutes']} minutes.")
        record_login(email, user, False, "BAD_PASSWORD" if user else "UNKNOWN_USER", ip)
        if user:
            audit(user, "LOGIN_FAILED", "AUTH", "User", user["_id"], {"failedAttempts": user["failedLogins"]})
        raise ApiError(401, "Invalid email or password.")
    emp = db_store.employees.get(user.get("employeeId") or "") or {}
    if not user.get("isActive") or emp.get("status") in ("EXITED", "TERMINATED"):
        record_login(email, user, False, "DEACTIVATED", ip)
        raise ApiError(403, "Account has been deactivated. Please contact HR.")

    user["failedLogins"] = 0
    mfa = system_settings()["mfa"]
    if user.get("mfaEnabled") or (mfa.get("enabled") and user.get("role") in (mfa.get("roles") or [])):
        record_login(email, user, True, "PASSWORD_OK_MFA_PENDING", ip)
        return await _start_mfa(user)
    user["lastLoginAt"] = now_iso()
    record_login(email, user, True, "OK", ip)
    audit(user, "USER_LOGIN", "AUTH", "User", user["_id"], {"onboardingCompleted": user.get("onboardingCompleted")})
    return _token_response(user)


@router.post("/auth/verify-otp")
async def verify_otp(request: Request):
    from datetime import datetime, timezone
    from app.routes.admin import record_login, system_settings
    from app.stores.modules_store import modules_store
    body = await read_body(request)
    ch = modules_store.otpChallenges.get(js_str(body.get("challengeId") or ""))
    if not ch:
        raise ApiError(400, "This sign-in code request has expired. Sign in again.")
    user = db_store.find_user_by_id(ch["userId"])
    if datetime.fromisoformat(ch["expiresAt"]) < datetime.now(timezone.utc) or not user:
        modules_store.otpChallenges.pop(ch["_id"], None)
        raise ApiError(400, "The code has expired. Sign in again.")
    if hash_setup_token(js_str(body.get("code") or "").strip()) != ch["codeHash"]:
        ch["attempts"] += 1
        record_login(user.get("email"), user, False, "BAD_OTP", _client_ip(request))
        audit(user, "MFA_CODE_REJECTED", "AUTH", "User", user["_id"], {"attempts": ch["attempts"]})
        if ch["attempts"] >= system_settings()["mfa"]["maxAttempts"]:
            modules_store.otpChallenges.pop(ch["_id"], None)
            raise ApiError(401, "Too many wrong codes. Sign in again.")
        raise ApiError(401, "Wrong code.")
    modules_store.otpChallenges.pop(ch["_id"], None)
    user["lastLoginAt"] = now_iso()
    record_login(user.get("email"), user, True, "OK_MFA", _client_ip(request))
    audit(user, "USER_LOGIN", "AUTH", "User", user["_id"], {"mfa": True})
    return _token_response(user)


@router.post("/auth/refresh")
async def refresh(request: Request, user: dict = Depends(require_auth)):
    """Called while the user is active: extends the idle timeout, never past the maximum session length."""
    import time as _time
    from app.routes.admin import system_settings
    start = int((request.state.jwt_payload or {}).get("sst") or _time.time())
    if _time.time() - start > system_settings()["session"]["maxSessionHours"] * 3600:
        raise ApiError(401, "Your session has reached its maximum length. Please sign in again.")
    return _token_response(user, session_start=start)


@router.post("/auth/change-password")
async def change_password(request: Request, user: dict = Depends(require_auth)):
    from app.routes.admin import password_problems, set_password
    body = await read_body(request)
    current = js_str(body.get("currentPassword") or "")
    new = js_str(body.get("newPassword") or "")
    if not compare_password(current, user.get("passwordHash")):
        raise ApiError(400, "Your current password is wrong.")
    problems = password_problems(new, user)
    if problems:
        raise ApiError(400, problems[0] if len(problems) == 1 else "The new password does not meet the policy.", errors=problems)
    set_password(user, new)
    audit(user, "PASSWORD_CHANGED", "AUTH", "User", user["_id"], {})
    return _token_response(user)


@router.get("/auth/setup-link/{token}", dependencies=[Depends(invite_rate_limit)])
async def setup_link(token: str):
    check = check_setup_token(token)
    if not check["ok"]:
        return {"valid": False, "reason": check["reason"]}
    tok = invite_store.find_setup_token_by_id(check["tokenId"]) or invite_store.find_setup_token_by_hash(hash_setup_token(token.lower()))
    return {
        "valid": True,
        "firstName": check["user"].get("firstName"),
        "email": mask_email(check["user"].get("email") or ""),
        "expiresAt": tok["expiresAt"] if tok else iso_from_ms(now_ms() + 48 * 3600 * 1000),
    }


@router.post("/auth/setup-password", dependencies=[Depends(invite_rate_limit)])
async def setup_password(request: Request):
    body = await read_body(request)
    password = js_str(body.get("password") or "").strip()
    confirm = js_str(body.get("confirmPassword") or "").strip()

    check = check_setup_token(body.get("token"))
    if not check["ok"]:
        reason = check["reason"]
        msg = {
            "EXPIRED": "This link has expired. Please ask HR to send you a new invite.",
            "USED": "This link has already been used. Please sign in with your password.",
            "REPLACED": "This link has been replaced by a newer invite. Please use the latest email.",
        }.get(reason, "This link is invalid.")
        raise ApiError(400, msg, reason=reason)

    from app.routes.admin import password_problems, set_password
    problems = password_problems(password, check["user"])
    if problems:
        raise ApiError(400, problems[0] if len(problems) == 1 else "The password does not meet the policy.", errors=problems)
    if password != confirm:
        raise ApiError(400, "Passwords do not match.")

    now = now_iso()
    user = check["user"]
    set_password(user, password)
    user = db_store.update_user(user["_id"], {"passwordPending": False, "passwordSetAt": now})
    invite_store.update_setup_token(check["tokenId"], {"usedAt": now})
    invite_store.revoke_active_tokens_for_user(user["_id"])

    audit(user, "PASSWORD_SET_VIA_INVITE", "AUTH", "User", user["_id"], {})
    return _token_response(user)


@router.post("/auth/signup")
async def signup(request: Request):
    body = await read_body(request)
    email = body.get("email")
    password = body.get("password")
    first_name = body.get("firstName")
    last_name = body.get("lastName")
    # Self sign-up always creates a plain employee; roles are only ever granted by an admin.
    role = "EMPLOYEE"

    if not email or not password or not first_name or not last_name:
        raise ApiError(400, "All fields (email, password, firstName, lastName) are required.")
    if not EMAIL_RE.match(js_str(email)):
        raise ApiError(400, "Invalid email address format.")
    if len(js_str(password)) < 6:
        raise ApiError(400, "Password must be at least 6 characters.")

    clean_email = js_str(email).strip().lower()
    if db_store.find_user_by_email(clean_email):
        raise ApiError(409, "An account with this email already exists.")

    user = db_store.create_user({
        "email": clean_email,
        "passwordHash": hash_password(js_str(password)),
        "firstName": js_str(first_name).strip(),
        "lastName": js_str(last_name).strip(),
        "role": role,
        "organizationId": "org_zenith_hq",
        "onboardingCompleted": False,
        "onboardingStep": 1,
        "isActive": True,
    })

    emp_id = f"emp_{now_ms()}"
    db_store.employees[emp_id] = {
        "_id": emp_id,
        "userId": user["_id"],
        "organizationId": user["organizationId"],
        "employeeCode": f"ZEN-{100 + rand_int(900)}",
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "gender": "Unspecified",
        "dob": "1995-01-01",
        "bloodGroup": "Unspecified",
        "personalEmail": clean_email,
        "workEmail": clean_email,
        "phone": "",
        "department": "Engineering & Technology",
        "designation": "Associate Engineer",
        "joiningDate": today_str(),
        "employmentType": "FULL_TIME",
        "status": "PROBATION",
        "shift": "Standard General (09:00 - 18:00)",
        "location": "San Francisco HQ",
    }
    db_store.update_user(user["_id"], {"employeeId": emp_id})

    audit(user, "USER_SIGNUP", "AUTH", "User", user["_id"], {"role": user.get("role"), "onboardingCompleted": False})
    # The response uses the user as created (before employeeId was set), plus the new employee.
    payload = user_payload(user, include_employee=False)
    payload["employee"] = db_store.employees.get(emp_id)
    return JSONResponse({"accessToken": generate_token(user), "tokenType": "bearer", "user": payload}, status_code=201)


@router.post("/auth/register-company")
async def register_company(request: Request):
    body = await read_body(request)
    first_name = js_str(body.get("firstName") or "").strip()
    last_name = js_str(body.get("lastName") or "").strip()
    email = js_str(body.get("email") or "").strip().lower()
    password = js_str(body.get("password") or "")
    company_name = js_str(body.get("companyName") or "").strip()

    if not first_name or not last_name or not email or not password or not company_name:
        raise ApiError(400, "firstName, lastName, email, password and companyName are required.")
    if not EMAIL_RE.match(email):
        raise ApiError(400, "Invalid email address format.")
    if len(password) < 8:
        raise ApiError(400, "Password must be at least 8 characters.")
    if len(company_name) < 2 or len(company_name) > 100:
        raise ApiError(400, "Company name must be between 2 and 100 characters.")
    if db_store.find_user_by_email(email):
        raise ApiError(409, "An account with this email already exists.")

    # Unique organisation code, e.g. "Acme Corp" -> ACMECO, then ACMECO2, ACMECO3...
    base = re.sub(r"[^A-Z0-9]", "", company_name.upper())[:6] or "ORG"
    used_codes = {o.get("code") for o in db_store.organizations.values()}
    code, n = base, 1
    while code in used_codes:
        n += 1
        code = f"{base}{n}"

    org_id = f"org_{now_ms()}_{rand_base36(6)}"
    db_store.organizations[org_id] = {
        "_id": org_id,
        "name": company_name,
        "code": code,
        "domain": email.split("@")[1],
        "address": {"street": "", "city": "", "state": "", "country": "", "zipCode": ""},
        "contactEmail": email,
        "phone": "",
        "taxIdentificationNumber": "",
        "createdAt": now_iso(),
    }

    # Role is forced to ADMIN here and is never read from the request.
    user = db_store.create_user({
        "email": email,
        "passwordHash": hash_password(password),
        "firstName": first_name,
        "lastName": last_name,
        "role": "ADMIN",
        "organizationId": org_id,
        "onboardingCompleted": True,
        "onboardingStep": 9,
        "orgSetupCompleted": False,
        "orgSetupStep": 1,
        "isActive": True,
    })

    audit(user, "USER_SIGNUP", "AUTH", "User", user["_id"], {"role": "ADMIN", "organizationId": org_id, "companyName": company_name})
    return _token_response(user, status=201, include_employee=False, orgSetupCompleted=False, orgSetupStep=1)


@router.get("/auth/me")
async def me(user: dict = Depends(require_auth)):
    return {"user": user_payload(user)}


@router.post("/auth/switch-role")
async def switch_role(request: Request):
    body = await read_body(request)
    target_role = body.get("targetRole")
    email = ROLE_DEMO_EMAILS.get(target_role) or "omkar@greenticker.in"
    user = db_store.find_user_by_email(email)
    if not user:
        raise ApiError(404, f"Demo user for role {js_str(target_role) if target_role is not None else 'undefined'} not found.")
    return _token_response(user)
