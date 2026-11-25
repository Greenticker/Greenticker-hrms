import asyncio
import csv
import io
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.auth.employee_access import (
    MASTER_WRITE_ROLES,
    can_view_all,
    can_write_master,
    creates_reporting_cycle,
    directory_entry,
    mask_for_log,
    mask_pan,
    mask_tail,
    own_employee_id,
    present_employee,
    relation_to,
    reportee_ids,
)
from app.auth.module_access import can_write
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import EMAIL_RE, audit, issue_invite, read_body, read_fields_and_files, unusable_password_hash
from app.routes.onboarding import ensure_onboarding_submission
from app.stores.db_store import db_store
from app.utils.jsutil import add_months_date, is_finite_number, js_str, now_iso, num, today_str, truthy

router = APIRouter()

require_master_write = require_role(*MASTER_WRITE_ROLES)

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
AADHAAR_RE = re.compile(r"^[2-9][0-9]{11}$")
EMPLOYMENT_TYPES = ("FULL_TIME", "PART_TIME", "CONTRACT", "INTERN")
CREATE_STATUSES = ("PROBATION", "ACTIVE", "PERMANENT", "TEMPORARY")
INACTIVE_STATUSES = ("TERMINATED", "EXITED", "INACTIVE")

REQUIRED_FIELDS = {
    "firstName": "First name",
    "lastName": "Last name",
    "workEmail": "Work email",
    "phone": "Mobile number",
    "department": "Department",
    "designation": "Designation",
    "joiningDate": "Date of joining",
    "panNumber": "PAN",
    "aadhaarNumber": "Aadhaar",
}

# Bulk import template columns (in order)
IMPORT_COLUMNS = [
    "firstName", "lastName", "workEmail", "personalEmail", "phone", "gender", "dob",
    "department", "subdepartment", "designation", "grade", "reportingManagerCode",
    "joiningDate", "employmentType", "location", "annualSalary", "panNumber", "aadhaarNumber",
]
MAX_IMPORT_ROWS = 500

SELF_EDITABLE_FIELDS = ("personalEmail", "phone", "alternatePhone", "bio", "currentAddress", "emergencyContact")

# Fields HR / admins may change through PUT /employees/{id}. Login e-mail, employee code and
# status have their own flows (status: PATCH /status, exits: F&F).
MASTER_EDITABLE_FIELDS = SELF_EDITABLE_FIELDS + (
    "firstName", "middleName", "lastName", "gender", "dob", "bloodGroup", "permanentAddress",
    "department", "subdepartment", "designation", "grade", "reportingManagerId", "joiningDate",
    "employmentType", "probationMonths", "probationEndDate", "shift", "location", "annualSalary",
    "extension", "panNumber", "aadhaarNumber", "uanNumber", "esiNumber",
)
# Bank details are not edited directly by anyone: they change through a request that another
# person (HR) verifies before payroll uses it (POST /employees/{id}/bank-change).
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
SELF_CHANGE_DENIED = ("You cannot change your own employment, pay or statutory details. "
                      "Another HR / admin user has to make this change.")
STATUTORY_KEYS = ("panNumber", "aadhaarNumber", "uanNumber", "esiNumber")


# ------------------------------------------------------------------ helpers

def _text(value) -> str:
    return js_str(value).strip() if value is not None else ""


def _valid_date(value: str) -> Optional[date]:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _phone_ok(value: str) -> bool:
    digits = re.sub(r"[\s\-()+]", "", value)
    return digits.isdigit() and 10 <= len(digits) <= 13


def _norm_pan(value) -> str:
    return re.sub(r"\s+", "", _text(value)).upper()


def _norm_aadhaar(value) -> str:
    return re.sub(r"[\s\-]", "", _text(value))


def _find_by_name(items, value: str, key: str = "name") -> Optional[dict]:
    wanted = value.strip().lower()
    return next((x for x in items if (x.get(key) or "").strip().lower() == wanted), None)


def _identity_index(exclude_emp_id: Optional[str] = None) -> dict:
    """Existing e-mails / PANs / Aadhaars, for duplicate checks."""
    emails, pans, aadhaars = set(), set(), set()
    for u in db_store.users.values():
        if u.get("email"):
            emails.add(u["email"].strip().lower())
    for e in db_store.employees.values():
        if e["_id"] == exclude_emp_id:
            continue
        if e.get("workEmail"):
            emails.add(e["workEmail"].strip().lower())
        st = e.get("statutory") or {}
        if st.get("panNumber"):
            pans.add(_norm_pan(st["panNumber"]))
        if st.get("aadhaarNumber"):
            aadhaars.add(_norm_aadhaar(st["aadhaarNumber"]))
    return {"emails": emails, "pans": pans, "aadhaars": aadhaars}


def _resolve_manager(value: str) -> Optional[dict]:
    if not value:
        return None
    emp = db_store.get_employee_by_id(value)
    if emp:
        return emp
    code = value.strip().upper()
    return next((e for e in db_store.employees.values() if (e.get("employeeCode") or "").upper() == code), None)


def _next_employee_code() -> str:
    used = {(e.get("employeeCode") or "").upper() for e in db_store.employees.values()}
    highest = 0
    for code in used:
        m = re.match(r"^[A-Z]+-(\d+)$", code)
        if m:
            highest = max(highest, int(m.group(1)))
    n = highest + 1
    while f"RHA-{n:03d}" in used:
        n += 1
    return f"RHA-{n:03d}"


def _default_location() -> str:
    locs = list(db_store.locations.values())
    hq = next((loc for loc in locs if loc.get("isHeadquarters")), None) or (locs[0] if locs else None)
    return hq.get("name") if hq else "Head Office"


def _validate_common(body: dict, errors: list, clean: dict) -> None:
    """Checks shared by create and update for whichever of these fields are present."""
    if "personalEmail" in body and _text(body["personalEmail"]):
        v = _text(body["personalEmail"]).lower()
        if not EMAIL_RE.match(v):
            errors.append("Personal email is not a valid e-mail address.")
        clean["personalEmail"] = v
    for key, label in (("phone", "Mobile number"), ("alternatePhone", "Alternate phone")):
        if key in body and _text(body[key]):
            v = _text(body[key])
            if not _phone_ok(v):
                errors.append(f"{label} must have 10 to 13 digits.")
            clean[key] = v
    for key, label in (("dob", "Date of birth"), ("joiningDate", "Date of joining"), ("probationEndDate", "Probation end date")):
        if key in body and _text(body[key]):
            v = _text(body[key])
            if not _valid_date(v):
                errors.append(f"{label} must be a date in YYYY-MM-DD format.")
            clean[key] = v
    if clean.get("dob") and _valid_date(clean["dob"]) and _valid_date(clean["dob"]) >= date.today():
        errors.append("Date of birth must be in the past.")
    if "department" in body and _text(body["department"]):
        v = _text(body["department"])
        depts = list(db_store.departments.values())
        match = _find_by_name(depts, v)
        if depts and not match:
            errors.append(f'Department "{v}" does not exist. Create it under Departments & Org first.')
        clean["department"] = match["name"] if match else v
    if "location" in body and _text(body["location"]):
        v = _text(body["location"])
        locs = list(db_store.locations.values())
        match = _find_by_name(locs, v)
        if locs and not match:
            errors.append(f'Location "{v}" does not exist.')
        clean["location"] = match["name"] if match else v
    if "grade" in body and _text(body["grade"]):
        v = _text(body["grade"])
        grades = list(db_store.grades.values())
        match = _find_by_name(grades, v, "code") or _find_by_name(grades, v, "name")
        if grades and not match:
            errors.append(f'Grade "{v}" does not exist.')
        clean["grade"] = match["code"] if match else v.upper()
    if "employmentType" in body and _text(body["employmentType"]):
        v = _text(body["employmentType"]).upper().replace(" ", "_").replace("-", "_")
        if v not in EMPLOYMENT_TYPES:
            errors.append(f"Employment type must be one of {', '.join(EMPLOYMENT_TYPES)}.")
        clean["employmentType"] = v
    if "annualSalary" in body and body["annualSalary"] not in (None, ""):
        v = num(body["annualSalary"])
        if not is_finite_number(v) or v < 0:
            errors.append("Annual salary must be a positive number.")
        else:
            clean["annualSalary"] = v
    if "panNumber" in body and _text(body["panNumber"]):
        v = _norm_pan(body["panNumber"])
        if not PAN_RE.match(v):
            errors.append("PAN must be 10 characters in the format ABCDE1234F.")
        clean["panNumber"] = v
    if "aadhaarNumber" in body and _text(body["aadhaarNumber"]):
        v = _norm_aadhaar(body["aadhaarNumber"])
        if not AADHAAR_RE.match(v):
            errors.append("Aadhaar must be a 12-digit number (cannot start with 0 or 1).")
        clean["aadhaarNumber"] = v
    for key in ("firstName", "lastName", "middleName", "designation", "subdepartment", "gender",
                "bloodGroup", "extension", "shift", "bio", "uanNumber", "esiNumber"):
        if key in body and body[key] is not None and not isinstance(body[key], (dict, list)):
            clean[key] = _text(body[key])


def _validate_new(body: dict, index: dict) -> tuple:
    """(clean fields, [error messages]) for a new employee. Adds accepted identities to `index`
    so later rows of a bulk import cannot reuse them."""
    errors: list = []
    clean: dict = {}
    for key, label in REQUIRED_FIELDS.items():
        if not _text(body.get(key)):
            errors.append(f"{label} is required.")

    work_email = _text(body.get("workEmail")).lower()
    if work_email:
        if not EMAIL_RE.match(work_email):
            errors.append("Work email is not a valid e-mail address.")
        elif work_email in index["emails"]:
            errors.append(f"An employee or login with e-mail {work_email} already exists.")
    clean["workEmail"] = work_email

    _validate_common(body, errors, clean)

    if clean.get("panNumber") and clean["panNumber"] in index["pans"]:
        errors.append(f"PAN {mask_pan(clean['panNumber'])} is already registered to another employee.")
    if clean.get("aadhaarNumber") and clean["aadhaarNumber"] in index["aadhaars"]:
        errors.append(f"Aadhaar {mask_tail(clean['aadhaarNumber'])} is already registered to another employee.")

    manager_ref = _text(body.get("reportingManagerId") or body.get("reportingManagerCode"))
    if manager_ref:
        mgr = _resolve_manager(manager_ref)
        if not mgr:
            errors.append(f'Reporting manager "{manager_ref}" was not found.')
        elif mgr.get("status") in INACTIVE_STATUSES:
            errors.append(f"Reporting manager {mgr.get('firstName')} {mgr.get('lastName')} is no longer active.")
        else:
            clean["reportingManagerId"] = mgr["_id"]

    status = _text(body.get("status")).upper() or "PROBATION"
    if status not in CREATE_STATUSES:
        errors.append(f"Status must be one of {', '.join(CREATE_STATUSES)}.")
    clean["status"] = status

    if body.get("probationMonths") not in (None, ""):
        months = num(body["probationMonths"])
        if not is_finite_number(months) or months < 0 or months > 24:
            errors.append("Probation months must be between 0 and 24.")
        else:
            clean["probationMonths"] = int(months)

    if not errors:
        index["emails"].add(work_email)
        if clean.get("panNumber"):
            index["pans"].add(clean["panNumber"])
        if clean.get("aadhaarNumber"):
            index["aadhaars"].add(clean["aadhaarNumber"])
    return clean, errors


def _manager_label(mgr: Optional[dict]) -> Optional[str]:
    if not mgr:
        return None
    return f"{mgr.get('firstName')} {mgr.get('lastName')} ({mgr.get('designation')})"


def _create_records(actor: dict, clean: dict) -> tuple:
    """Creates the login, employee record and onboarding submission. Returns (user, employee, submission)."""
    new_user = db_store.create_user({
        "email": clean["workEmail"],
        "passwordHash": unusable_password_hash(),
        "passwordPending": True,
        "firstName": clean["firstName"],
        "lastName": clean["lastName"],
        "role": "EMPLOYEE",
        "organizationId": actor.get("organizationId"),
        "onboardingCompleted": False,
        "onboardingStep": 1,
        "isActive": True,
    })

    joining_date = clean.get("joiningDate") or today_str()
    probation_months = clean.get("probationMonths", 6)
    mgr = db_store.get_employee_by_id(clean.get("reportingManagerId"))
    statutory = {
        "panNumber": clean["panNumber"],
        "panMasked": mask_pan(clean["panNumber"]),
        "aadhaarNumber": clean["aadhaarNumber"],
        "aadhaarMasked": mask_tail(clean["aadhaarNumber"]),
    }

    record = {
        "userId": new_user["_id"],
        "organizationId": actor.get("organizationId"),
        "createdByUserId": actor["_id"],
        "createdByName": f"{actor.get('firstName')} {actor.get('lastName')} ({actor.get('role')})",
        "createdAt": now_iso(),
        "employeeCode": _next_employee_code(),
        "firstName": clean["firstName"],
        "middleName": clean.get("middleName") or None,
        "lastName": clean["lastName"],
        "gender": clean.get("gender") or "Unspecified",
        "dob": clean.get("dob") or None,
        "bloodGroup": clean.get("bloodGroup") or None,
        "personalEmail": clean.get("personalEmail") or clean["workEmail"],
        "workEmail": clean["workEmail"],
        "phone": clean["phone"],
        "extension": clean.get("extension") or None,
        "department": clean["department"],
        "subdepartment": clean.get("subdepartment") or None,
        "designation": clean["designation"],
        "grade": clean.get("grade") or None,
        "reportingManagerId": mgr["_id"] if mgr else None,
        "reportingManagerName": _manager_label(mgr),
        "joiningDate": joining_date,
        "employmentType": clean.get("employmentType") or "FULL_TIME",
        "status": clean.get("status") or "PROBATION",
        "probationMonths": probation_months,
        "probationEndDate": clean.get("probationEndDate") or add_months_date(joining_date, probation_months or 0),
        "shift": clean.get("shift") or "Standard General (09:00 - 18:00)",
        "location": clean.get("location") or _default_location(),
        "annualSalary": clean.get("annualSalary"),
        "statutory": statutory,
    }
    new_emp = db_store.create_employee(record)  # None values are dropped by the store
    db_store.update_user(new_user["_id"], {"employeeId": new_emp["_id"]})

    sub = ensure_onboarding_submission(new_user, new_emp)
    db_store.update_onboarding_submission(sub["_id"], {
        "status": "IN_PROGRESS",
        "sectionsData": {
            **(sub.get("sectionsData") or {}),
            "employmentDetails": {
                "employeeCode": new_emp["employeeCode"],
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
    return new_user, new_emp, sub


# ------------------------------------------------------------------ reading

@router.get("/employees")
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    raw = db_store.get_employees_for_user(user, search=search, department=department, status=status)
    if can_view_all(user):
        scope = "ALL"
        employees = [present_employee(user, e) for e in raw]
    elif user.get("role") == "MANAGER":
        scope = "TEAM"
        team = reportee_ids(own_employee_id(user))
        employees = [{**present_employee(user, e, "TEAM"), "teamRelation": team.get(e["_id"])} for e in raw]
    else:
        scope = "SELF"
        employees = [present_employee(user, e, "SELF") for e in raw]
    return {"total": len(employees), "employees": employees, "userRole": user.get("role"), "scope": scope}


@router.get("/employees/directory")
async def employee_directory(search: Optional[str] = None, department: Optional[str] = None, _: dict = Depends(require_auth)):
    """Company directory for everyone: public contact details only (no DOB, address, pay, IDs or bank)."""
    items = [e for e in db_store.employees.values() if e.get("status") not in INACTIVE_STATUSES]
    if department and department != "ALL":
        items = [e for e in items if (e.get("department") or "").lower() == department.lower()]
    if search:
        q = search.lower()
        items = [
            e for e in items
            if q in f"{e.get('firstName') or ''} {e.get('lastName') or ''}".lower()
            or q in (e.get("department") or "").lower()
            or q in (e.get("designation") or "").lower()
            or q in (e.get("workEmail") or "").lower()
        ]
    items.sort(key=lambda e: f"{e.get('firstName') or ''} {e.get('lastName') or ''}".lower())
    return {"total": len(items), "employees": [directory_entry(e) for e in items]}


@router.get("/employees/import-template")
async def import_template(_: dict = Depends(require_master_write)):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(IMPORT_COLUMNS)
    example = {
        "firstName": "#Asha", "lastName": "Rao", "workEmail": "asha.rao@company.com",
        "personalEmail": "asha@gmail.com", "phone": "9876543210", "gender": "Female", "dob": "1994-05-21",
        "department": next((d.get("name") for d in db_store.departments.values()), "Engineering & Technology"),
        "subdepartment": "", "designation": "Software Engineer", "grade": "",
        "reportingManagerCode": "RHA-012", "joiningDate": today_str(), "employmentType": "FULL_TIME",
        "location": _default_location(), "annualSalary": "900000", "panNumber": "ABCDE1234F",
        "aadhaarNumber": "234567890123",
    }
    writer.writerow([example[c] for c in IMPORT_COLUMNS])
    body = (
        "# Lines starting with # are ignored. Delete the example row, add one employee per row.\n"
        "# Required: firstName, lastName, workEmail, phone, department, designation, joiningDate (YYYY-MM-DD), panNumber, aadhaarNumber\n"
        + out.getvalue()
    )
    return Response(
        body.encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="employee_import_template.csv"'},
    )


@router.get("/employees/{emp_id}")
async def get_employee(emp_id: str, user: dict = Depends(require_auth)):
    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee record not found.")
    relation = relation_to(user, emp)
    if not relation:
        raise ApiError(403, "Access denied: you can only view your own profile" + (" and your team's." if user.get("role") == "MANAGER" else "."))
    master_other = can_write_master(user) and relation != "SELF"
    pending = emp.get("pendingBankChange") or {}
    return {
        "employee": present_employee(user, emp, relation),
        "accessLevel": relation,
        "canEdit": relation == "SELF" or master_other,
        "canEditMaster": master_other,
        "canEditSalary": False,  # salary changes go through Payroll > salary revisions
        "canRequestBankChange": relation == "SELF" or master_other,
        # maker-checker: the person who raised the bank change cannot verify it
        "canReviewBankChange": bool(pending) and pending.get("status") == "PENDING" and master_other
        and pending.get("requestedByUserId") != user["_id"],
    }


# ------------------------------------------------------------------ writing

@router.post("/employees")
async def create_employee(request: Request, actor: dict = Depends(require_master_write)):
    body = await read_body(request)
    clean, errors = _validate_new(body, _identity_index())
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the highlighted fields.", errors=errors)

    new_user, new_emp, sub = _create_records(actor, clean)
    audit(actor, "EMPLOYEE_CREATED", "EMPLOYEE", "Employee", new_emp["_id"], {
        "employeeCode": new_emp["employeeCode"],
        "name": f"{new_user['firstName']} {new_user['lastName']}",
        "department": new_emp.get("department"),
        "designation": new_emp.get("designation"),
    })
    # New joiners are enrolled in the group insurance policies they are eligible for
    from app.routes.benefits import auto_enroll
    auto_enroll(new_emp)
    invite = await issue_invite(request, new_user, new_emp, actor, False)
    return JSONResponse(
        {
            "success": True,
            "message": "Employee record created and onboarding invite link sent.",
            "employee": present_employee(actor, new_emp),
            "submissionId": sub["_id"],
            "loginEmail": clean["workEmail"],
            "invite": invite,
        },
        status_code=201,
    )


def _parse_import_file(raw: bytes) -> list:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        raise ApiError(400, "The file has no rows.")
    reader = csv.DictReader(lines)
    by_lower = {c.lower(): c for c in IMPORT_COLUMNS}
    headers = [h.strip() for h in (reader.fieldnames or [])]
    unknown = [h for h in headers if h and h.lower() not in by_lower]
    missing = [c for c in REQUIRED_FIELDS if c.lower() not in {h.lower() for h in headers}]
    if missing:
        raise ApiError(400, f"Missing column(s): {', '.join(missing)}. Please use the downloaded template.", unknownColumns=unknown)
    rows = []
    for row in reader:
        rows.append({by_lower[k.strip().lower()]: (v or "").strip() for k, v in row.items() if k and k.strip().lower() in by_lower})
    return rows


@router.post("/employees/bulk-import")
async def bulk_import(request: Request, actor: dict = Depends(require_master_write)):
    """CSV import. Every row is fully validated first; only valid rows are created and invalid
    rows are reported back row by row (nothing partial is ever saved for a bad row)."""
    fields, files = await read_fields_and_files(request)
    upload = (files.get("file") or [None])[0]
    if not upload:
        raise ApiError(400, "Please choose a CSV file to import.")
    if not (upload.filename or "").lower().endswith(".csv"):
        raise ApiError(400, "Only .csv files are supported. In Excel use File → Save As → CSV.")
    raw = await upload.read()
    if len(raw) > 2 * 1024 * 1024:
        raise ApiError(400, "The import file is larger than 2 MB.")

    rows = _parse_import_file(raw)
    if len(rows) > MAX_IMPORT_ROWS:
        raise ApiError(400, f"At most {MAX_IMPORT_ROWS} employees can be imported at once (file has {len(rows)}).")
    dry_run = _text(fields.get("dryRun")).lower() in ("1", "true", "yes")
    send_invites = _text(fields.get("sendInvites") or "true").lower() in ("1", "true", "yes")

    index = _identity_index()
    results, valid = [], []
    for i, row in enumerate(rows):
        row_no = i + 2  # row 1 is the header
        clean, errors = _validate_new(row, index)
        name = f"{row.get('firstName', '')} {row.get('lastName', '')}".strip()
        if errors:
            results.append({"row": row_no, "name": name, "workEmail": row.get("workEmail"), "status": "FAILED", "errors": errors})
        else:
            valid.append((row_no, name, clean))

    created = []
    if not dry_run:
        for row_no, name, clean in valid:
            new_user, new_emp, _ = _create_records(actor, clean)
            created.append((new_user, new_emp))
            results.append({"row": row_no, "name": name, "workEmail": clean["workEmail"], "status": "IMPORTED",
                            "employeeCode": new_emp["employeeCode"], "employeeId": new_emp["_id"]})
        if created and send_invites:
            await asyncio.gather(*(issue_invite(request, u, e, actor, False) for u, e in created))
    else:
        results.extend({"row": r, "name": n, "workEmail": c["workEmail"], "status": "VALID"} for r, n, c in valid)

    results.sort(key=lambda r: r["row"])
    summary = {"totalRows": len(rows), "imported": len(created), "valid": len(valid), "failed": len(rows) - len(valid), "dryRun": dry_run}
    if not dry_run:
        audit(actor, "EMPLOYEES_BULK_IMPORTED", "EMPLOYEE", "EmployeeImport", f"import_{len(rows)}_{today_str()}", {
            **summary, "fileName": upload.filename, "employeeCodes": [e["employeeCode"] for _, e in created],
        })
    return {"success": True, "summary": summary, "results": results}


def _flat_changes(field: str, old, new) -> list:
    if isinstance(old, dict) or isinstance(new, dict):
        old, new = old if isinstance(old, dict) else {}, new if isinstance(new, dict) else {}
        out = []
        for k in sorted(set(old) | set(new)):
            if old.get(k) != new.get(k):
                out.append({"field": f"{field}.{k}", "oldValue": mask_for_log(k, old.get(k)), "newValue": mask_for_log(k, new.get(k))})
        return out
    if old == new:
        return []
    return [{"field": field, "oldValue": mask_for_log(field, old), "newValue": mask_for_log(field, new)}]


@router.put("/employees/{emp_id}")
async def update_employee(emp_id: str, request: Request, user: dict = Depends(require_auth)):
    updates = await read_body(request)
    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")

    is_self = relation_to(user, emp) == "SELF"
    # HR / admins edit other people's master data; on their own record they are like any employee
    is_master = can_write_master(user) and not is_self
    if not is_master and not is_self:
        raise ApiError(403, "You are not allowed to modify this employee's record.")

    editable = MASTER_EDITABLE_FIELDS if is_master else SELF_EDITABLE_FIELDS
    rejected = [k for k in updates if k not in editable and k not in ("_id", "userId", "sensitiveAccess")]
    if "bankInfo" in rejected:
        raise ApiError(403, "Bank details are changed through a bank change request that HR verifies.")
    if rejected and is_self and can_write_master(user):
        raise ApiError(403, SELF_CHANGE_DENIED)
    if rejected and not is_master:
        raise ApiError(403, f"These fields can only be changed by HR: {', '.join(rejected)}.")

    incoming = {k: v for k, v in updates.items() if k in editable}
    # Salary is never edited directly: HR proposes a salary revision with an effective date and
    # Finance approves it (Payroll > Salary revisions); payroll applies it from that date.
    if "annualSalary" in incoming and incoming["annualSalary"] not in (None, "") and num(incoming["annualSalary"]) != emp.get("annualSalary"):
        raise ApiError(403, "Salary changes go through a salary revision: HR proposes it in Payroll and Finance approves it.")
    if not is_master:
        incoming = {k: v for k, v in incoming.items() if truthy(v)}

    errors: list = []
    clean: dict = {}
    for key in ("firstName", "lastName", "department", "designation", "joiningDate", "phone"):
        if key in incoming and not _text(incoming[key]):
            errors.append(f"{REQUIRED_FIELDS.get(key, key)} cannot be empty.")
    _validate_common(incoming, errors, clean)
    for key in ("currentAddress", "permanentAddress", "emergencyContact", "bankInfo"):
        if key in incoming:
            if incoming[key] is not None and not isinstance(incoming[key], dict):
                errors.append(f"{key} must be an object.")
            else:
                clean[key] = incoming[key]
    if "probationMonths" in incoming and incoming["probationMonths"] not in (None, ""):
        months = num(incoming["probationMonths"])
        if not is_finite_number(months) or months < 0 or months > 24:
            errors.append("Probation months must be between 0 and 24.")
        else:
            clean["probationMonths"] = int(months)

    # Unique identifiers (PAN / Aadhaar) must stay unique
    index = _identity_index(exclude_emp_id=emp_id)
    if clean.get("panNumber") and clean["panNumber"] in index["pans"]:
        errors.append("This PAN is already registered to another employee.")
    if clean.get("aadhaarNumber") and clean["aadhaarNumber"] in index["aadhaars"]:
        errors.append("This Aadhaar is already registered to another employee.")

    # Reporting manager: must exist and must not create a circular reporting line
    if "reportingManagerId" in incoming:
        mgr_id = _text(incoming["reportingManagerId"])
        if mgr_id:
            mgr = _resolve_manager(mgr_id)
            if not mgr:
                errors.append("Selected reporting manager was not found.")
            elif creates_reporting_cycle(emp_id, mgr["_id"]):
                errors.append(
                    "Circular reporting is not allowed: "
                    + ("an employee cannot report to themself." if mgr["_id"] == emp_id
                       else f"{mgr.get('firstName')} {mgr.get('lastName')} already reports (directly or indirectly) to {emp.get('firstName')} {emp.get('lastName')}.")
                )
            else:
                clean["reportingManagerId"] = mgr["_id"]
                clean["reportingManagerName"] = _manager_label(mgr)
        else:
            clean["reportingManagerId"] = None
            clean["reportingManagerName"] = None

    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the highlighted fields.", errors=errors)

    # Statutory identifiers live under employee.statutory
    statutory_updates = {k: clean.pop(k) for k in STATUTORY_KEYS if k in clean}
    if statutory_updates:
        st = dict(emp.get("statutory") or {})
        st.update(statutory_updates)
        if "panNumber" in statutory_updates:
            st["panMasked"] = mask_pan(statutory_updates["panNumber"])
        if "aadhaarNumber" in statutory_updates:
            st["aadhaarMasked"] = mask_tail(statutory_updates["aadhaarNumber"])
        clean["statutory"] = st

    changes: list = []
    for field, new in clean.items():
        if field == "reportingManagerName":
            continue
        changes.extend(_flat_changes(field, emp.get(field), new))
    applied = {k: v for k, v in clean.items() if emp.get(k) != v}

    if not applied:
        return {"success": True, "employee": present_employee(user, emp), "changes": []}

    before = dict(emp)
    updated = db_store.update_employee(emp_id, applied)
    if emp.get("userId") and ("firstName" in applied or "lastName" in applied):
        db_store.update_user(emp["userId"], {k: applied[k] for k in ("firstName", "lastName") if k in applied})

    # Organisational moves made through the edit form keep their history like lifecycle actions
    actor_label = f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})"
    history = (
        ("department", "TRANSFER"), ("designation", "DESIGNATION_CHANGE"), ("reportingManagerName", "MANAGER_CHANGE"),
    )
    for field, event_type in history:
        if field in applied and before.get(field) != applied.get(field):
            db_store.create_lifecycle_event({
                "employeeId": emp_id,
                "employeeName": f"{updated.get('firstName')} {updated.get('lastName')}",
                "employeeCode": updated.get("employeeCode"),
                "department": updated.get("department"),
                "eventType": event_type,
                "effectiveDate": today_str(),
                "previousValue": before.get(field) or "—",
                "newValue": applied.get(field) or "—",
                "reason": "Updated from the employee record",
                "initiatedBy": actor_label,
                "approvalStatus": "APPROVED",
            })

    audit(user, "EMPLOYEE_UPDATED", "EMPLOYEE", "Employee", emp_id, {
        "employeeCode": emp.get("employeeCode"),
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "updatedFields": sorted({c["field"].split(".")[0] for c in changes}),
        "changes": changes,
    })
    return {"success": True, "employee": present_employee(user, updated), "changes": changes}


@router.patch("/employees/{emp_id}/status")
async def update_employee_status(emp_id: str, request: Request, admin: dict = Depends(require_master_write)):
    body = await read_body(request)
    status = body.get("status")
    is_active = body.get("isActive")

    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    if emp["_id"] == admin.get("employeeId"):
        raise ApiError(403, SELF_CHANGE_DENIED)

    old_status = emp.get("status")
    user_before = db_store.find_user_by_id(emp.get("userId")) if emp.get("userId") else None
    updated = db_store.update_employee(emp_id, {"status": status or old_status})
    if isinstance(is_active, bool) and emp.get("userId"):
        db_store.update_user(emp["userId"], {"isActive": is_active})

    changes = _flat_changes("status", old_status, updated.get("status"))
    if isinstance(is_active, bool) and user_before is not None:
        changes += _flat_changes("loginActive", user_before.get("isActive"), is_active)
    audit(admin, "EMPLOYEE_DEACTIVATED" if is_active is False else "EMPLOYEE_STATUS_CHANGED", "EMPLOYEE", "Employee", emp_id, {
        "employeeCode": emp.get("employeeCode"),
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "changes": changes,
    })
    return {"success": True, "employee": present_employee(admin, updated)}


@router.patch("/employees/{emp_id}/probation")
async def update_probation(emp_id: str, request: Request, admin: dict = Depends(require_master_write)):
    body = await read_body(request)
    probation_months = body.get("probationMonths")
    probation_end_date = body.get("probationEndDate")
    status = body.get("status")

    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    if emp["_id"] == admin.get("employeeId"):
        raise ApiError(403, SELF_CHANGE_DENIED)

    updates: dict = {}
    if is_finite_number(probation_months):
        updates["probationMonths"] = max(1, probation_months)
        if not probation_end_date and emp.get("joiningDate"):
            updates["probationEndDate"] = add_months_date(emp["joiningDate"], updates["probationMonths"])
    if probation_end_date:
        updates["probationEndDate"] = probation_end_date
    if status:
        updates["status"] = status

    changes = [c for k, v in updates.items() for c in _flat_changes(k, emp.get(k), v)]
    updated = db_store.update_employee(emp_id, updates)
    audit(admin, "EMPLOYEE_PROBATION_ADJUSTED", "EMPLOYEE", "Employee", emp_id, {
        "employeeCode": emp.get("employeeCode"),
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "changes": changes,
    })
    return {"success": True, "employee": present_employee(admin, updated)}


# --------------------------------------------------------- bank change (maker-checker)

def _hr_user_ids(exclude: tuple = ()) -> list:
    return [u["_id"] for u in db_store.users.values()
            if u.get("role") in MASTER_WRITE_ROLES and u.get("isActive", True) and u["_id"] not in exclude]


def _notify(user_ids, title: str, message: str) -> None:
    for i, uid in enumerate(user_ids):
        db_store.notifications.insert(0, {
            "_id": f"notif_bank_{now_iso()}_{i}_{uid}", "recipientUserId": uid, "title": title,
            "message": message, "type": "EMPLOYEE", "isRead": False, "createdAt": now_iso(),
        })


@router.post("/employees/{emp_id}/bank-change")
async def request_bank_change(emp_id: str, request: Request, user: dict = Depends(require_auth)):
    """An employee (or HR on their behalf) asks to change the salary bank account. Nothing changes
    for payroll until a different HR / admin user verifies it."""
    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    is_self = relation_to(user, emp) == "SELF"
    if not is_self and not can_write_master(user):
        raise ApiError(403, "You can only request a bank change for your own account.")
    if (emp.get("pendingBankChange") or {}).get("status") == "PENDING":
        raise ApiError(409, "A bank change request is already waiting for HR verification.")

    b = await read_body(request)
    errors = []
    bank_name, holder = _text(b.get("bankName")), _text(b.get("accountHolder"))
    account = re.sub(r"\s+", "", _text(b.get("accountNumber")))
    confirm = re.sub(r"\s+", "", _text(b.get("confirmAccountNumber")))
    ifsc = _text(b.get("ifsc")).upper()
    if not bank_name:
        errors.append("Bank name is required.")
    if not holder:
        errors.append("Account holder name is required.")
    if not re.fullmatch(r"\d{9,18}", account):
        errors.append("Account number must be 9 to 18 digits.")
    elif confirm and confirm != account:
        errors.append("The account numbers do not match.")
    if not IFSC_RE.match(ifsc):
        errors.append("IFSC must be 11 characters, e.g. HDFC0001234.")
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the highlighted fields.", errors=errors)

    pending = {
        "bankName": bank_name, "accountHolder": holder, "accountNumber": account, "ifsc": ifsc,
        "branch": _text(b.get("branch")) or None, "reason": _text(b.get("reason")) or None,
        "status": "PENDING", "requestedByUserId": user["_id"],
        "requestedByName": f"{user.get('firstName')} {user.get('lastName')}", "requestedAt": now_iso(),
    }
    db_store.update_employee(emp_id, {"pendingBankChange": {k: v for k, v in pending.items() if v is not None}})
    _notify(_hr_user_ids(exclude=(user["_id"], emp.get("userId"))), "Bank change awaiting verification",
            f"{emp.get('firstName')} {emp.get('lastName')} ({emp.get('employeeCode')}) requested a salary account change.")
    audit(user, "BANK_CHANGE_REQUESTED", "EMPLOYEE", "Employee", emp_id, {
        "employeeCode": emp.get("employeeCode"),
        "changes": _flat_changes("bankInfo", emp.get("bankInfo") or {},
                                 {k: pending[k] for k in ("bankName", "accountHolder", "accountNumber", "ifsc")}),
    })
    return {"success": True, "message": "Bank change submitted. Payroll keeps using the current account until HR verifies it.",
            "employee": present_employee(user, db_store.get_employee_by_id(emp_id))}


@router.post("/employees/{emp_id}/bank-change/review")
async def review_bank_change(emp_id: str, request: Request, user: dict = Depends(require_master_write)):
    emp = db_store.get_employee_by_id(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    pending = emp.get("pendingBankChange") or {}
    if pending.get("status") != "PENDING":
        raise ApiError(400, "There is no bank change waiting for verification.")
    if relation_to(user, emp) == "SELF" or pending.get("requestedByUserId") == user["_id"]:
        raise ApiError(403, "Maker-checker: a bank change must be verified by someone other than the employee "
                            "and the person who raised it.")

    b = await read_body(request)
    decision, comment = b.get("decision"), _text(b.get("comment")) or None
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Please give a reason for rejecting the bank change.")

    reviewed = {**pending, "status": decision, "reviewedByUserId": user["_id"],
                "reviewedByName": f"{user.get('firstName')} {user.get('lastName')}", "reviewedAt": now_iso()}
    if comment:
        reviewed["reviewComment"] = comment
    history = list(emp.get("bankChangeHistory") or [])
    history.append({**{k: v for k, v in reviewed.items() if k != "accountNumber"},
                    "accountNumberMasked": mask_tail(pending.get("accountNumber"))})
    updates = {"pendingBankChange": None, "bankChangeHistory": history}
    changes = []
    if decision == "APPROVED":
        new_bank = {k: pending.get(k) for k in ("bankName", "accountHolder", "accountNumber", "ifsc", "branch") if pending.get(k)}
        new_bank["accountNumberMasked"] = mask_tail(new_bank["accountNumber"])
        new_bank["verifiedBy"] = reviewed["reviewedByName"]
        new_bank["verifiedAt"] = reviewed["reviewedAt"]
        changes = _flat_changes("bankInfo", emp.get("bankInfo") or {}, new_bank)
        updates["bankInfo"] = new_bank
    db_store.update_employee(emp_id, updates)

    if emp.get("userId"):
        _notify([emp["userId"]], f"Bank change {decision.lower()}",
                "Your new salary account is verified and will be used from the next payroll." if decision == "APPROVED"
                else f"Your bank change request was rejected: {comment}")
    audit(user, f"BANK_CHANGE_{decision}", "EMPLOYEE", "Employee", emp_id, {
        "employeeCode": emp.get("employeeCode"), "requestedBy": pending.get("requestedByName"), "comment": comment,
        "changes": changes,
    })
    return {"success": True, "employee": present_employee(user, db_store.get_employee_by_id(emp_id))}
