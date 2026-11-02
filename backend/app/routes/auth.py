import re

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import compare_password, generate_token, hash_password, require_auth
from app.errors import ApiError
from app.routes.common import (
    EMAIL_RE,
    PASSWORD_RE,
    audit,
    check_setup_token,
    hash_setup_token,
    invite_rate_limit,
    mask_email,
    read_body,
    user_payload,
)
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


def _token_response(user: dict, status: int = 200, **user_overrides) -> JSONResponse:
    return JSONResponse(
        {"accessToken": generate_token(user), "tokenType": "bearer", "user": user_payload(user, **user_overrides)},
        status_code=status,
    )


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

    user = db_store.find_user_by_email(email)
    password_valid = compare_password(password, user.get("passwordHash")) if user else False

    if not password_valid and user:
        if DEMO_PASSWORDS.get(email) and password == DEMO_PASSWORDS[email]:
            user["passwordHash"] = hash_password(password)
            password_valid = True

    if user and user.get("passwordPending"):
        raise ApiError(403, "Your account is not activated yet. Please use the setup link sent to your email, or ask HR to resend it.")
    if not user or not password_valid:
        raise ApiError(401, "Invalid email or password.")
    if not user.get("isActive"):
        raise ApiError(403, "Account has been deactivated. Please contact HR.")

    audit(user, "USER_LOGIN", "AUTH", "User", user["_id"], {"onboardingCompleted": user.get("onboardingCompleted")})
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

    if not PASSWORD_RE.match(password):
        raise ApiError(400, "Password must be at least 8 characters and include a letter and a number.")
    if password != confirm:
        raise ApiError(400, "Passwords do not match.")

    now = now_iso()
    user = db_store.update_user(check["user"]["_id"], {
        "passwordHash": hash_password(password),
        "passwordPending": False,
        "passwordSetAt": now,
    })
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
    role = body.get("role") if body.get("role") is not None else "EMPLOYEE"

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
