from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, issue_invite, read_body, sanitize_employee, unusable_password_hash
from app.routes.onboarding import ensure_onboarding_submission
from app.stores.db_store import db_store
from app.utils.jsutil import add_months_date, is_finite_number, js_str, num, rand_int, today_str, truthy

router = APIRouter()


@router.get("/employees")
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    raw = db_store.get_employees_for_user(user, search=search, department=department, status=status)
    sanitized = [
        sanitize_employee(emp, user.get("role") == "ADMIN" or emp.get("userId") == user["_id"])
        for emp in raw
    ]
    return {"total": len(sanitized), "employees": sanitized, "userRole": user.get("role")}


@router.get("/employees/{emp_id}")
async def get_employee(emp_id: str, user: dict = Depends(require_auth)):
    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee record not found.")

    is_self = emp.get("userId") == user["_id"]
    if user.get("role") == "EMPLOYEE" and not is_self:
        raise ApiError(403, "Access Denied: Employees can view their own profile only.")

    can_see = user.get("role") == "ADMIN" or is_self
    return {"employee": sanitize_employee(emp, can_see), "accessLevel": "SELF" if is_self else user.get("role")}


@router.post("/employees")
async def create_employee(request: Request, actor: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    first_name = body.get("firstName")
    last_name = body.get("lastName")
    personal_email = body.get("personalEmail")
    work_email = body.get("workEmail")
    department = body.get("department")
    subdepartment = body.get("subdepartment")
    designation = body.get("designation")
    reporting_manager_id = body.get("reportingManagerId")
    joining_date = body.get("joiningDate")
    employment_type = body.get("employmentType") if body.get("employmentType") is not None else "FULL_TIME"
    shift = body.get("shift") if body.get("shift") is not None else "Standard General (09:00 - 18:00)"
    location = body.get("location") if body.get("location") is not None else "San Francisco HQ"
    annual_salary = body.get("annualSalary") if body.get("annualSalary") is not None else 120000

    if not truthy(first_name) or not truthy(last_name) or not truthy(work_email) or not truthy(department) or not truthy(designation):
        raise ApiError(400, "Required fields missing (firstName, lastName, workEmail, department, designation).")

    clean_email = js_str(work_email).strip().lower()
    if db_store.find_user_by_email(clean_email):
        raise ApiError(409, "An account with this work email already exists.")

    new_user = db_store.create_user({
        "email": clean_email,
        "passwordHash": unusable_password_hash(),
        "passwordPending": True,
        "firstName": js_str(first_name).strip(),
        "lastName": js_str(last_name).strip(),
        "role": "EMPLOYEE",
        "organizationId": actor.get("organizationId"),
        "onboardingCompleted": False,
        "onboardingStep": 1,
        "isActive": True,
    })

    reporting_manager_name = None
    if reporting_manager_id:
        mgr = db_store.get_employee_by_id(reporting_manager_id)
        if mgr:
            reporting_manager_name = f"{mgr.get('firstName')} {mgr.get('lastName')} ({mgr.get('designation')})"

    probation_months = num(body.get("probationMonths")) if truthy(body.get("probationMonths")) else 6
    if body.get("probationEndDate"):
        probation_end = body["probationEndDate"]
    else:
        probation_end = add_months_date(joining_date, probation_months or 0)

    emp_code = f"ZEN-{100 + rand_int(900)}"
    new_emp = db_store.create_employee({
        "userId": new_user["_id"],
        "organizationId": actor.get("organizationId"),
        "employeeCode": emp_code,
        "firstName": new_user["firstName"],
        "lastName": new_user["lastName"],
        "gender": body.get("gender") or "Unspecified",
        "dob": body.get("dob") or "1995-01-01",
        "bloodGroup": body.get("bloodGroup") or "O+",
        "personalEmail": js_str(personal_email).strip().lower() if personal_email else clean_email,
        "workEmail": clean_email,
        "phone": body.get("phone") or "+91 98000 00000",
        "department": js_str(department).strip(),
        "subdepartment": js_str(subdepartment).strip() if subdepartment else None,
        "designation": js_str(designation).strip(),
        "reportingManagerId": reporting_manager_id,
        "reportingManagerName": reporting_manager_name,
        "joiningDate": joining_date or today_str(),
        "employmentType": employment_type,
        "status": body.get("status") or "PROBATION",
        "probationMonths": probation_months,
        "probationEndDate": probation_end,
        "shift": shift,
        "location": js_str(location).strip(),
        "annualSalary": num(annual_salary),
        "currentAddress": {
            "line": "Pending Employee Update",
            "city": "San Francisco",
            "state": "CA",
            "country": "USA",
            "postalCode": "94105",
        },
    })

    db_store.update_user(new_user["_id"], {"employeeId": new_emp["_id"]})

    sub = ensure_onboarding_submission(new_user, new_emp)
    db_store.update_onboarding_submission(sub["_id"], {
        "status": "IN_PROGRESS",
        "sectionsData": {
            **(sub.get("sectionsData") or {}),
            "employmentDetails": {
                "employeeCode": emp_code,
                "joiningDate": new_emp.get("joiningDate"),
                "employmentType": new_emp.get("employmentType"),
                "department": new_emp.get("department"),
                "designation": new_emp.get("designation"),
                "location": new_emp.get("location"),
                "reportingManagerName": new_emp.get("reportingManagerName") or "",
                "filledBy": f"{actor.get('firstName')} {actor.get('lastName')} ({actor.get('role')})",
            },
        },
    })

    audit(actor, "EMPLOYEE_CREATED", "EMPLOYEE", "Employee", new_emp["_id"], {
        "employeeCode": emp_code,
        "name": f"{new_user['firstName']} {new_user['lastName']}",
        "department": new_emp.get("department"),
    })

    invite = await issue_invite(request, new_user, new_emp, actor, False)
    return JSONResponse(
        {
            "success": True,
            "message": "Employee record created and onboarding invite link sent.",
            "employee": new_emp,
            "submissionId": sub["_id"],
            "loginEmail": clean_email,
            "invite": invite,
        },
        status_code=201,
    )


SELF_EDITABLE_FIELDS = ("personalEmail", "phone", "alternatePhone", "bio", "currentAddress", "emergencyContact")


@router.put("/employees/{emp_id}")
async def update_employee(emp_id: str, request: Request, user: dict = Depends(require_auth)):
    updates = await read_body(request)
    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")

    is_self = emp.get("userId") == user["_id"]
    if user.get("role") == "EMPLOYEE" and not is_self:
        raise ApiError(403, "Unauthorized to modify other employee records.")

    allowed: dict = {}
    if user.get("role") == "ADMIN":
        allowed = {k: v for k, v in updates.items() if k not in ("_id", "userId")}
    elif is_self:
        allowed = {k: updates[k] for k in SELF_EDITABLE_FIELDS if truthy(updates.get(k))}

    updated = db_store.update_employee(emp_id, allowed)
    audit(user, "EMPLOYEE_UPDATED", "EMPLOYEE", "Employee", emp_id, {"updatedFields": list(allowed.keys())})
    return {"success": True, "employee": updated}


@router.patch("/employees/{emp_id}/status")
async def update_employee_status(emp_id: str, request: Request, admin: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    status = body.get("status")
    is_active = body.get("isActive")

    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")

    updated = db_store.update_employee(emp_id, {"status": status or emp.get("status")})
    if isinstance(is_active, bool) and emp.get("userId"):
        db_store.update_user(emp["userId"], {"isActive": is_active})

    details = {k: v for k, v in {"newStatus": status, "isActive": is_active}.items() if v is not None}
    audit(admin, "EMPLOYEE_DEACTIVATED" if is_active is False else "EMPLOYEE_STATUS_CHANGED", "EMPLOYEE", "Employee", emp_id, details)
    return {"success": True, "employee": updated}


@router.patch("/employees/{emp_id}/probation")
async def update_probation(emp_id: str, request: Request, admin: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    probation_months = body.get("probationMonths")
    probation_end_date = body.get("probationEndDate")
    status = body.get("status")

    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")

    updates: dict = {}
    if is_finite_number(probation_months):
        updates["probationMonths"] = max(1, probation_months)
        if not probation_end_date and emp.get("joiningDate"):
            updates["probationEndDate"] = add_months_date(emp["joiningDate"], updates["probationMonths"])
    if probation_end_date:
        updates["probationEndDate"] = probation_end_date
    if status:
        updates["status"] = status

    updated = db_store.update_employee(emp_id, updates)
    details = {k: v for k, v in {
        "probationMonths": probation_months, "probationEndDate": probation_end_date, "status": status,
    }.items() if v is not None}
    audit(admin, "EMPLOYEE_PROBATION_ADJUSTED", "EMPLOYEE", "Employee", emp_id, details)
    return {"success": True, "employee": updated}
