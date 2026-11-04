import re
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import LOGOS, audit, read_body, save_upload
from app.services.mailer import send_mail
from app.stores.db_store import db_store
from app.utils.jsutil import js_str, now_iso, now_ms, truthy

router = APIRouter()


def _encode_uri_component(value: str) -> str:
    return quote(value, safe="-_.!~*'()")


def _subdept_id(dept_id: str, name: str) -> str:
    slug = re.sub(r"\s+", "_", name.lower())  # outside the f-string: Python < 3.12 rejects backslashes there
    return f"subdept_{dept_id}_{_encode_uri_component(slug)}"


# -------------------------------------------------------------- departments

@router.get("/departments")
async def list_departments(_: dict = Depends(require_auth)):
    employees = list(db_store.employees.values())
    out = []
    for d in db_store.departments.values():
        name = (d.get("name") or "").lower()
        count = sum(
            1 for e in employees
            if name in (e.get("department") or "").lower() or (e.get("department") or "").lower() in name
        )
        out.append({**d, "memberCount": count})
    return {"departments": out}


@router.post("/departments")
async def create_department(request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    name, code = body.get("name"), body.get("code")
    head_employee_id = body.get("headEmployeeId")
    if not truthy(name) or not truthy(code):
        raise ApiError(400, "Name and code are required.")

    head_name = None
    if head_employee_id:
        head = db_store.get_employee_by_id(head_employee_id)
        if head:
            head_name = f"{head.get('firstName')} {head.get('lastName')}"

    dept_id = f"dept_{now_ms()}"
    new_dept = {
        "_id": dept_id,
        "name": name,
        "code": js_str(code).upper(),
        "headEmployeeId": head_employee_id,
        "headName": head_name,
        "description": body.get("description") or "",
        "createdAt": now_iso(),
    }
    new_dept = {k: v for k, v in new_dept.items() if v is not None}
    db_store.departments[dept_id] = new_dept
    audit(user, "DEPARTMENT_CREATED", "ORGANIZATION", "Department", dept_id, {"name": name, "code": code})
    return JSONResponse({"success": True, "department": new_dept}, status_code=201)


@router.get("/subdepartments")
async def list_subdepartments(_: dict = Depends(require_auth)):
    employees = list(db_store.employees.values())
    out = []
    for dept in db_store.departments.values():
        for sub_name in dept.get("subdepartments") or []:
            low = sub_name.lower()
            count = sum(
                1 for e in employees
                if (e.get("subdepartment") and e["subdepartment"].lower() == low)
                or (
                    e.get("department")
                    and e["department"].lower() == (dept.get("name") or "").lower()
                    and (e.get("subdepartment") or "").lower() == low
                )
            )
            suffix = re.sub(r"[^A-Za-z0-9]", "", sub_name)[:3].upper()
            out.append({
                "_id": _subdept_id(dept["_id"], sub_name),
                "name": sub_name,
                "code": f"{dept.get('code')}-{suffix}",
                "departmentId": dept["_id"],
                "departmentName": dept.get("name"),
                "description": f"Subdepartment of {dept.get('name')}",
                "memberCount": count,
            })
    return {"subdepartments": out}


@router.post("/subdepartments")
async def create_subdepartment(request: Request, user: dict = Depends(require_role("ADMIN", "HR"))):
    body = await read_body(request)
    name = body.get("name")
    department_name = body.get("departmentName")
    department_id = body.get("departmentId")
    if not truthy(name) or (not truthy(department_name) and not truthy(department_id)):
        raise ApiError(400, "Subdepartment name and parent department are required.")

    clean_name = js_str(name).strip()
    target = db_store.departments.get(department_id) if department_id else None
    if not target and department_name:
        wanted = js_str(department_name).strip().lower()
        target = next((d for d in db_store.departments.values() if (d.get("name") or "").lower() == wanted), None)
    if not target:
        # If not found, attach to the first department
        target = next(iter(db_store.departments.values()), None)
    if not target:
        raise ApiError(404, "Parent department not found.")

    if not target.get("subdepartments"):
        target["subdepartments"] = []
    if clean_name not in target["subdepartments"]:
        target["subdepartments"].append(clean_name)

    suffix = js_str(body.get("code") or re.sub(r"[^A-Za-z0-9]", "", clean_name)[:3]).upper()
    new_sub = {
        "_id": _subdept_id(target["_id"], clean_name),
        "name": clean_name,
        "code": f"{target.get('code')}-{suffix}",
        "departmentId": target["_id"],
        "departmentName": target.get("name"),
        "description": body.get("description") or f"Subdepartment of {target.get('name')}",
        "memberCount": 0,
    }
    audit(user, "SUBDEPARTMENT_CREATED", "ORGANIZATION", "Subdepartment", new_sub["_id"], {
        "name": clean_name, "department": target.get("name"),
    })
    return JSONResponse({"success": True, "subdepartment": new_sub}, status_code=201)


# ------------------------------------------------------------- designations

@router.get("/designations")
async def list_designations(_: dict = Depends(require_auth)):
    employees = list(db_store.employees.values())
    return {
        "designations": [
            {**d, "memberCount": sum(1 for e in employees if e.get("designation") == d.get("title"))}
            for d in db_store.designations.values()
        ]
    }


@router.post("/designations")
async def create_designation(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    title = body.get("title")
    if not truthy(title):
        raise ApiError(400, "Designation title is required.")
    code, level, department = body.get("code"), body.get("level"), body.get("department")
    subdepartment = body.get("subdepartment")
    clean_title = js_str(title).strip()

    desig_id = f"desig_{now_ms()}"
    dept_text = js_str(department).strip() if department else "General Assignment"
    subdept_text = js_str(subdepartment).strip() if subdepartment else ""
    new_desig = {
        "_id": desig_id,
        "title": clean_title,
        "code": js_str(code).strip().upper() if code else clean_title[:4].upper(),
        "level": js_str(level).strip() if level else "L2",
        "departmentName": dept_text,
        "department": dept_text,
        "subdepartment": subdept_text,
        "description": body.get("description") or "",
        "status": "ACTIVE",
        "memberCount": 0,
        "createdAt": now_iso(),
    }
    db_store.designations[desig_id] = new_desig
    audit(user, "DESIGNATION_CREATED", "ORGANIZATION", "Designation", desig_id, {"title": clean_title, "code": new_desig["code"]})
    return JSONResponse({"success": True, "designation": new_desig}, status_code=201)


@router.post("/designations/{desig_id}/end")
async def end_designation(desig_id: str, request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    desig = db_store.designations.get(desig_id)
    if not desig:
        raise ApiError(404, "Designation record not found.")

    end_reason = body.get("endReason")
    desig["status"] = "ENDED"
    desig["endedAt"] = now_iso()
    desig["endedBy"] = f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})"
    desig["endReason"] = js_str(end_reason).strip() if end_reason else "Designation ended/retired by HR or Admin"

    audit(user, "DESIGNATION_ENDED", "ORGANIZATION", "Designation", desig_id, {
        "title": desig.get("title"),
        "endedAt": desig["endedAt"],
        "endedBy": desig["endedBy"],
        "endReason": desig["endReason"],
    })
    return {
        "success": True,
        "designation": desig,
        "message": f'Designation "{desig.get("title")}" ended and moved to historical records.',
    }


# ---------------------------------------------------------------- locations

@router.get("/locations")
async def list_locations(_: dict = Depends(require_auth)):
    return {"locations": list(db_store.locations.values())}


@router.post("/locations")
async def create_location(request: Request, _: dict = Depends(require_auth)):
    body = await read_body(request)
    if not truthy(body.get("name")):
        raise ApiError(400, "Location name is required.")
    loc_id = f"loc_{now_ms()}"
    is_hq = truthy(body.get("isHeadquarters"))
    new_loc = {
        "_id": loc_id,
        "name": body["name"],
        "street": body.get("street") or "",
        "city": body.get("city") or "Pune",
        "state": body.get("state") or "Maharashtra",
        "country": body.get("country") or "India",
        "zipCode": body.get("zipCode") or "411004",
        "departments": [js_str(d).strip() for d in (body.get("departments") or []) if truthy(d)],
        "subdepartments": [js_str(s).strip() for s in (body.get("subdepartments") or []) if truthy(s)],
        "isHeadquarters": is_hq,
    }
    if is_hq:
        for loc in db_store.locations.values():
            loc["isHeadquarters"] = False
    db_store.locations[loc_id] = new_loc
    return JSONResponse({"location": new_loc}, status_code=201)


# -------------------------------------------------------------- org chart

@router.get("/organization/hierarchy")
async def hierarchy(_: dict = Depends(require_auth)):
    employees = list(db_store.employees.values())
    ceo = next(
        (e for e in employees if not e.get("reportingManagerId") or "Chief Executive" in (e.get("designation") or "")),
        None,
    )

    def build(emp: dict, seen: frozenset) -> dict:
        seen = seen | {emp["_id"]}
        reports = [e for e in employees if e.get("reportingManagerId") == emp["_id"] and e["_id"] not in seen]
        first, last = emp.get("firstName") or "", emp.get("lastName") or ""
        return {
            "employeeId": emp["_id"],
            "employeeCode": emp.get("employeeCode"),
            "name": f"{emp.get('firstName')} {emp.get('lastName')}",
            "designation": emp.get("designation"),
            "department": emp.get("department"),
            "status": emp.get("status"),
            "avatarInitials": f"{first[:1] or 'undefined'}{last[:1] or 'undefined'}",
            "reports": [build(r, seen) for r in reports],
        }

    return {"hierarchy": build(ceo, frozenset()) if ceo else None}


# ------------------------------------------------------- organisation profile

@router.get("/organization/profile")
async def get_profile(user: dict = Depends(require_auth)):
    org = db_store.organizations.get(user.get("organizationId"))
    if not org:
        raise ApiError(404, "Organization not found.")
    return {"organization": org}


@router.put("/organization/profile")
async def update_profile(request: Request, user: dict = Depends(require_role("ADMIN"))):
    org = db_store.organizations.get(user.get("organizationId"))
    if not org:
        raise ApiError(404, "Organization not found.")
    body = await read_body(request)
    for key in ("name", "code", "domain", "contactEmail", "phone", "taxIdentificationNumber"):
        if truthy(body.get(key)):
            org[key] = js_str(body[key]).strip()
    address = body.get("address")
    if isinstance(address, dict):
        current = org.get("address") or {}
        org["address"] = {
            k: address.get(k) or current.get(k) or ""
            for k in ("street", "city", "state", "country", "zipCode")
        }
    return {"success": True, "organization": org}


@router.post("/organization/logo")
async def upload_logo(logo: Optional[UploadFile] = File(None), user: dict = Depends(require_role("ADMIN"))):
    org = db_store.organizations.get(user.get("organizationId"))
    if not org:
        raise ApiError(404, "Organization not found.")
    if logo is None or not logo.filename:
        raise ApiError(400, "No logo file uploaded.")
    try:
        saved = await save_upload(logo, LOGOS, 2 * 1024 * 1024)
    except ApiError:
        raise ApiError(400, "Logo file size cannot exceed 2MB.")

    logo_url = f"/uploads/logos/{saved['storedFileName']}"
    org["logoUrl"] = logo_url
    return {"success": True, "logoUrl": logo_url, "organization": org}


@router.post("/organization/complete-setup")
async def complete_setup(user: dict = Depends(require_role("ADMIN"))):
    user["orgSetupCompleted"] = True
    return {"success": True, "user": {**user, "orgSetupCompleted": True}}


@router.post("/organization/contact-manager")
async def contact_manager(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    manager_email = body.get("managerEmail")
    manager_name = body.get("managerName")
    message = body.get("message")
    if not truthy(manager_email) or not truthy(message):
        raise ApiError(400, "Manager email and message are required.")

    sender = f"{user.get('firstName')} {user.get('lastName')}"
    label = manager_name or "Manager"
    message_text = js_str(message)
    try:
        result = await send_mail({
            "to": manager_email,
            "subject": body.get("subject") or f"Inquiry regarding vetan.ai HRMS from {sender}",
            "html": f"""<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">
        <h2 style="color:#023b77;margin-top:0;">Message for {label}</h2>
        <p>{message_text.replace(chr(10), '<br/>')}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />
        <p style="font-size:12px;color:#64748b;">Sent via vetan.ai HRMS Enterprise Portal by {sender} ({user.get('email')})</p>
      </div>""",
            "text": f"Message for {label}:\n\n{message_text}\n\nSent by {sender} ({user.get('email')})",
        })
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to send email.", details=str(err))
    return {"success": True, "result": result, "message": f"Email successfully sent to {manager_name or manager_email}."}
