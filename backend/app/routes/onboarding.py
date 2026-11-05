from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.module_access import require_read, require_write
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import (
    EMAIL_RE,
    audit,
    get_app_base_url,
    issue_invite,
    read_body,
    unusable_password_hash,
)
from app.services.mailer import build_onboarding_revision_email, send_mail
from app.stores.db_store import db_store, merge
from app.stores.invite_store import invite_store
from app.utils.jsutil import date_ms, js_str, now_iso, now_ms, rand_int, s, truthy

router = APIRouter()

ONBOARDING_TOTAL_STEPS = 8

ONBOARDING_STEP_KEYS = {
    1: "core",
    2: "emergencyDetails",
    4: "banking",
    5: "pfEsi",
    6: "incomeTax",
    7: "insuranceNominee",
}

ONBOARDING_REQUIRED_KEYS = ["core", "emergencyDetails", "banking", "pfEsi", "incomeTax", "insuranceNominee"]

# Onboarding document categories -> Document Management categories
ONBOARDING_DOC_CATEGORY_MAP = {
    "IDENTITY": "IDENTITY",
    "TAX": "TAX",
    "EDUCATION": "EDUCATION",
    "EMPLOYMENT": "EMPLOYMENT",
    "BANKING": "EMPLOYMENT",
    "SIGNATURE": "LEGAL",
}

ALL_ONBOARDING_SECTIONS = [
    "core",
    "emergencyDetails",
    "employmentDetails",
    "banking",
    "pfEsi",
    "incomeTax",
    "insuranceNominee",
    "documents",
]

ONBOARDING_SECTION_LABELS = {
    "core": "1. Core Profile",
    "emergencyDetails": "2. Emergency Details",
    "employmentDetails": "3. Employment Details",
    "banking": "4. Banking & Statutory Identifiers",
    "pfEsi": "5. Provident Fund (PF)",
    "incomeTax": "6. Income Tax Declaration",
    "insuranceNominee": "7. Insurance and Nominee",
    "documents": "8. Documents Upload",
}


# ---------------------------------------------------------------- helpers

def sync_onboarding_docs_to_repository(sub: dict, status: str, reason: Optional[str] = None, verified_by: Optional[str] = None) -> None:
    """Mirrors the documents of an onboarding submission into the Document Management
    repository so their status and the dashboard counters stay in sync with the queue."""
    emp = db_store.get_employee_by_id(sub.get("employeeId")) if sub and sub.get("employeeId") else None
    if not emp:
        return
    now = now_iso()
    sub_docs = sub.get("documents") if isinstance(sub.get("documents"), list) else []

    for d in sub_docs:
        repo_id = f"onb_{js_str(d.get('id'))}"
        mapped = "REVISION_REQUESTED" if status == "REJECTED" else status
        status_patch = {
            "status": mapped,
            "rejectionReason": reason if mapped in ("REJECTED", "REVISION_REQUESTED") else None,
            "verifiedBy": None if mapped == "PENDING" else verified_by,
            "verifiedAt": None if mapped == "PENDING" else now,
        }
        if db_store.documents.get(repo_id):
            db_store.update_document(repo_id, status_patch)
        else:
            file_name = d.get("fileName") or "document"
            doc = {
                "_id": repo_id,
                "employeeId": emp["_id"],
                "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
                "employeeCode": emp.get("employeeCode"),
                "department": emp.get("department"),
                "category": ONBOARDING_DOC_CATEGORY_MAP.get(d.get("category")) or "EMPLOYMENT",
                "title": d.get("documentName") or "Onboarding Document",
                "fileName": file_name,
                "fileType": d.get("fileType") or "",
                "fileSize": d.get("fileSize") or "",
                "fileUrl": f"/api/documents/demo/{file_name}",
                "uploadedBy": f"{sub.get('employeeName') or emp.get('firstName')} (Onboarding)",
                "uploadedAt": d.get("uploadedAt") or now,
                "onboardingDocId": d.get("id"),
            }
            db_store.documents[repo_id] = merge(doc, status_patch)


def find_onboarding_submission_by_user(user_id: str) -> Optional[dict]:
    return next((s_ for s_ in db_store.get_onboarding_submissions() if s_.get("userId") == user_id), None)


def ensure_onboarding_submission(user: dict, emp: Optional[dict] = None) -> dict:
    sub = find_onboarding_submission_by_user(user["_id"])
    if not sub:
        now = now_iso()
        sub_id = f"sub_{now_ms()}_{rand_int(1000)}"
        emp = emp or {}
        sub = {
            "_id": sub_id,
            "userId": user["_id"],
            "employeeId": emp.get("_id") if emp.get("_id") is not None else "",
            "employeeCode": emp.get("employeeCode") if emp.get("employeeCode") is not None else "",
            "employeeName": f"{user.get('firstName')} {user.get('lastName')}",
            "department": emp.get("department") if emp.get("department") is not None else "",
            "designation": emp.get("designation") if emp.get("designation") is not None else "",
            "workEmail": user.get("email"),
            "personalEmail": emp.get("personalEmail") if emp.get("personalEmail") is not None else "",
            "phone": emp.get("phone") if emp.get("phone") is not None else "",
            "currentStep": 1,
            "totalSteps": ONBOARDING_TOTAL_STEPS,
            "status": "IN_PROGRESS",
            "sectionsData": {},
            "documents": [],
            "policyAcknowledgements": [],
            "createdAt": now,
            "updatedAt": now,
        }
        db_store.onboardingSubmissions[sub_id] = sub
    return sub


def _push_notification(recipient: Any, title: str, message: str, now: str) -> None:
    db_store.notifications.insert(0, {
        "_id": f"notif_{now_ms()}",
        "recipientUserId": recipient,
        "title": title,
        "message": message,
        "type": "ONBOARDING",
        "isRead": False,
        "createdAt": now,
    })


def _reviewer_name(user: dict) -> str:
    return f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})"


def _trim(v: Any) -> str:
    return s(v).strip()


# ---------------------------------------------------------------- employee side

@router.get("/onboarding/me")
async def onboarding_me(user: dict = Depends(require_auth)):
    employee = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
    sub = find_onboarding_submission_by_user(user["_id"])

    manager_name = (employee or {}).get("reportingManagerName")
    if not manager_name and (employee or {}).get("reportingManagerId"):
        mgr = db_store.get_employee_by_id(employee["reportingManagerId"])
        if mgr:
            manager_name = f"{mgr.get('firstName')} {mgr.get('lastName')}"

    current_step = min(ONBOARDING_TOTAL_STEPS, max(1, user.get("onboardingStep") or 1))

    payload = {
        "userId": user["_id"],
        "onboardingCompleted": user.get("onboardingCompleted"),
        "currentStep": current_step,
        "totalSteps": ONBOARDING_TOTAL_STEPS,
        "employee": employee,
        "employment": {
            "employeeCode": employee.get("employeeCode"),
            "joiningDate": employee.get("joiningDate"),
            "employmentType": employee.get("employmentType"),
            "department": employee.get("department"),
            "designation": employee.get("designation"),
            "location": employee.get("location"),
            "reportingManagerName": manager_name or "",
        } if employee else None,
        "submissionStatus": (sub or {}).get("status"),
        "rejectionRemarks": (sub or {}).get("rejectionRemarks"),
        "sectionReviews": (sub or {}).get("sectionReviews") if (sub or {}).get("sectionReviews") is not None else {},
        "draft": (sub or {}).get("sectionsData") if (sub or {}).get("sectionsData") is not None else {},
        "sections": [
            {"id": 1, "title": "Core Profile", "completed": current_step > 1},
            {"id": 2, "title": "Emergency Details", "completed": current_step > 2},
            {"id": 3, "title": "Employment Details", "completed": current_step > 3},
            {"id": 4, "title": "Banking Details", "completed": current_step > 4},
            {"id": 5, "title": "PF / ESI", "completed": current_step > 5},
            {"id": 6, "title": "Income Tax Declaration", "completed": current_step > 6},
            {"id": 7, "title": "Insurance and Nominee", "completed": current_step > 7},
            {"id": 8, "title": "Documents Upload", "completed": user.get("onboardingCompleted")},
        ],
    }
    for key in ("employee", "submissionStatus", "rejectionRemarks"):
        if payload[key] is None:
            del payload[key]
    return payload


@router.post("/onboarding/step")
async def onboarding_step(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    step = body.get("step")
    data = body.get("data")

    if isinstance(step, float) and step.is_integer():
        step = int(step)
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > ONBOARDING_TOTAL_STEPS:
        raise ApiError(400, f"Step must be a whole number between 1 and {ONBOARDING_TOTAL_STEPS}.")

    emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
    sub = ensure_onboarding_submission(user, emp)
    key = ONBOARDING_STEP_KEYS.get(step)

    next_step = min(ONBOARDING_TOTAL_STEPS, max(user.get("onboardingStep") or 0, step + 1))
    patch: dict = {"currentStep": next_step, "totalSteps": ONBOARDING_TOTAL_STEPS}

    if key and isinstance(data, (dict, list)):
        patch["sectionsData"] = {**(sub.get("sectionsData") or {}), key: data}

        if emp and isinstance(data, dict):
            if step == 1:
                db_store.update_employee(emp["_id"], {
                    "firstName": data.get("firstName"),
                    "lastName": data.get("lastName"),
                    "dob": data.get("dob"),
                    "gender": data.get("gender"),
                    "phone": data.get("phone"),
                    "alternatePhone": data.get("alternatePhone") or None,
                    "personalEmail": data.get("personalEmail"),
                    "currentAddress": data.get("currentAddress"),
                    "permanentAddress": data.get("permanentAddress"),
                })
                patch["personalEmail"] = data.get("personalEmail")
                patch["phone"] = data.get("phone")
                patch["employeeName"] = f"{js_str(data.get('firstName')) if data.get('firstName') is not None else 'undefined'} {js_str(data.get('lastName')) if data.get('lastName') is not None else 'undefined'}"
            if step == 2:
                db_store.update_employee(emp["_id"], {
                    "emergencyContact": {k: v for k, v in {
                        "name": data.get("name"),
                        "relationship": data.get("relation"),
                        "phone": data.get("phone"),
                    }.items() if v is not None},
                })

    db_store.update_onboarding_submission(sub["_id"], patch)
    db_store.update_user(user["_id"], {"onboardingStep": next_step})
    return {"success": True, "stepSaved": step, "nextStep": next_step}


@router.post("/onboarding/complete")
async def onboarding_complete(request: Request, user: dict = Depends(require_auth)):
    emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
    sub = ensure_onboarding_submission(user, emp)

    sections = sub.get("sectionsData") or {}
    missing = [k for k in ONBOARDING_REQUIRED_KEYS if not truthy(sections.get(k))]
    if missing:
        raise ApiError(400, "Please complete all sections before submitting.", missing=missing)

    body = await read_body(request)
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    documents = data.get("documents") if data.get("documents") is not None else []
    is_fresher = data.get("isFresher") if data.get("isFresher") is not None else False
    now = now_iso()

    docs = [
        {
            "id": f"doc_{sub['_id']}_{i + 1}",
            "category": js_str(d.get("category") or "GENERAL"),
            "documentName": js_str(d.get("documentName") or "Document"),
            "fileName": js_str(d.get("fileName") or ""),
            "fileSize": js_str(d.get("fileSize") or ""),
            "fileType": js_str(d.get("fileType") or ""),
            "uploadedAt": now,
            "status": "PENDING",
        }
        for i, d in enumerate(documents if isinstance(documents, list) else [])
        if isinstance(d, dict)
    ]

    db_store.update_onboarding_submission(sub["_id"], {
        "status": "SUBMITTED",
        "submittedAt": now,
        "rejectionRemarks": None,
        "currentStep": ONBOARDING_TOTAL_STEPS,
        "totalSteps": ONBOARDING_TOTAL_STEPS,
        "documents": docs,
        "sectionsData": {**sections, "documentsMeta": {"isFresher": truthy(is_fresher)}},
    })

    # Show the uploaded documents in Document Management as Pending
    sync_onboarding_docs_to_repository({**sub, "documents": docs}, "PENDING")

    db_store.update_user(user["_id"], {"onboardingCompleted": True, "onboardingStep": ONBOARDING_TOTAL_STEPS})
    audit(user, "ONBOARDING_SUBMITTED", "ONBOARDING", "OnboardingSubmission", sub["_id"], {"submittedAt": now, "documentCount": len(docs)})

    return {
        "success": True,
        "message": "Onboarding submitted for HR verification. Welcome to vetan.ai HRMS!",
        "onboardingCompleted": True,
    }


# ---------------------------------------------------------------- HR side

@router.post("/onboarding/employees")
async def onboarding_create_employee(request: Request, actor: dict = Depends(require_write("self_onboarding"))):
    body = await read_body(request)
    first_name = body.get("firstName")
    last_name = body.get("lastName")
    work_email = body.get("workEmail")
    personal_email = body.get("personalEmail")
    phone = body.get("phone")
    employee_code = body.get("employeeCode")
    joining_date = body.get("joiningDate")
    employment_type = body.get("employmentType")
    department = body.get("department")
    designation = body.get("designation")
    location = body.get("location")
    reporting_manager_id = body.get("reportingManagerId")

    missing = []
    if not _trim(first_name):
        missing.append("firstName")
    if not _trim(last_name):
        missing.append("lastName")
    if not _trim(work_email):
        missing.append("workEmail")
    if not _trim(employee_code):
        missing.append("employeeCode")
    if not truthy(joining_date):
        missing.append("joiningDate")
    if not _trim(department):
        missing.append("department")
    if not _trim(designation):
        missing.append("designation")
    if not _trim(location):
        missing.append("location")
    if missing:
        raise ApiError(400, f"Required fields missing: {', '.join(missing)}.")

    if employment_type not in ("INTERN", "FULL_TIME", "CONTRACT", "PART_TIME"):
        raise ApiError(400, "Employee type must be FULL_TIME, INTERN, PART_TIME or CONTRACT.")

    email = js_str(work_email).strip().lower()
    if db_store.find_user_by_email(email):
        raise ApiError(409, "An account with this work email already exists.")

    code = js_str(employee_code).strip().upper()
    if any((e.get("employeeCode") or "").upper() == code for e in db_store.employees.values()):
        raise ApiError(409, f"Employee ID {code} is already in use.")

    reporting_manager_name = "General Assignment"
    if reporting_manager_id:
        mgr = db_store.get_employee_by_id(reporting_manager_id)
        if mgr:
            reporting_manager_name = f"{mgr.get('firstName')} {mgr.get('lastName')} ({mgr.get('designation')})"

    clean_personal = js_str(personal_email).strip().lower() if personal_email else ""
    clean_phone = js_str(phone).strip() if phone else ""

    new_user = db_store.create_user({
        "email": email,
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

    new_emp = db_store.create_employee({
        "userId": new_user["_id"],
        "organizationId": actor.get("organizationId"),
        "employeeCode": code,
        "firstName": new_user["firstName"],
        "lastName": new_user["lastName"],
        "gender": "",
        "dob": "",
        "bloodGroup": "",
        "personalEmail": clean_personal,
        "workEmail": email,
        "phone": clean_phone,
        "department": js_str(department).strip(),
        "designation": js_str(designation).strip(),
        "reportingManagerId": reporting_manager_id or None,
        "reportingManagerName": reporting_manager_name,
        "joiningDate": joining_date,
        "employmentType": employment_type,
        "status": "PROBATION",
        "shift": "Standard General (09:00 - 18:00)",
        "location": js_str(location).strip(),
    })

    db_store.update_user(new_user["_id"], {"employeeId": new_emp["_id"]})

    sub = ensure_onboarding_submission(new_user, new_emp)
    sections = sub.get("sectionsData") or {}
    db_store.update_onboarding_submission(sub["_id"], {
        "status": "IN_PROGRESS",
        "personalEmail": clean_personal,
        "phone": clean_phone,
        "sectionsData": {
            **sections,
            "core": {
                **(sections.get("core") or {}),
                "firstName": new_user["firstName"],
                "lastName": new_user["lastName"],
                "personalEmail": clean_personal,
                "phone": clean_phone,
            },
            "employmentDetails": {
                "employeeCode": code,
                "joiningDate": joining_date,
                "employmentType": employment_type,
                "department": new_emp["department"],
                "designation": new_emp["designation"],
                "location": new_emp["location"],
                "reportingManagerName": new_emp.get("reportingManagerName"),
                "filledBy": _reviewer_name(actor),
            },
        },
    })

    audit(actor, "ONBOARDING_EMPLOYEE_CREATED", "ONBOARDING", "Employee", new_emp["_id"], {
        "employeeCode": code,
        "name": f"{new_user['firstName']} {new_user['lastName']}",
        "department": new_emp["department"],
    })

    invite = await issue_invite(request, new_user, new_emp, actor, False)
    return JSONResponse(
        {"success": True, "employee": new_emp, "submissionId": sub["_id"], "loginEmail": email, "invite": invite},
        status_code=201,
    )


@router.post("/onboarding/employees/{employee_id}/resend-invite")
async def resend_invite(employee_id: str, request: Request, actor: dict = Depends(require_write("self_onboarding"))):
    emp = db_store.get_employee_by_id(employee_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    user = db_store.find_user_by_id(emp.get("userId"))
    if not user:
        raise ApiError(404, "User account not found.")
    if not user.get("passwordPending"):
        raise ApiError(400, "This employee has already set a password. No invite is needed.")
    invite = await issue_invite(request, user, emp, actor, True)
    return {"success": True, "invite": invite}


@router.get("/onboarding/queue")
async def onboarding_queue(_: dict = Depends(require_read("self_onboarding"))):
    submissions = []
    for sub in db_store.get_onboarding_submissions():
        u = db_store.users.get(sub.get("userId"))
        invite_pending = (u or {}).get("passwordPending") is True
        tok = invite_store.get_pending_setup_token_for_user(sub.get("userId")) if invite_pending else None
        item = {**sub, "invitePending": invite_pending}
        if tok and tok.get("expiresAt") is not None:
            item["inviteExpiresAt"] = tok["expiresAt"]
        item["inviteExpired"] = invite_pending and (not tok or date_ms(tok.get("expiresAt")) <= now_ms())
        submissions.append(item)

    stats = {
        "total": len(submissions),
        "submitted": sum(1 for x in submissions if x.get("status") == "SUBMITTED"),
        "inProgress": sum(1 for x in submissions if x.get("status") == "IN_PROGRESS"),
        "verified": sum(1 for x in submissions if x.get("status") == "VERIFIED"),
        "needsCorrection": sum(1 for x in submissions if x.get("status") == "NEEDS_CORRECTION"),
    }
    return {"submissions": submissions, "stats": stats}


@router.get("/onboarding/submissions/{sub_id}")
async def onboarding_submission(sub_id: str, _: dict = Depends(require_read("self_onboarding"))):
    sub = db_store.get_onboarding_submission_by_id(sub_id)
    if not sub:
        raise ApiError(404, "Onboarding submission not found.")
    return {"submission": sub}


@router.post("/onboarding/submissions/{sub_id}/verify")
async def verify_submission(sub_id: str, user: dict = Depends(require_write("self_onboarding"))):
    sub = db_store.get_onboarding_submission_by_id(sub_id)
    if not sub:
        raise ApiError(404, "Submission not found.")

    reviewer = _reviewer_name(user)
    now = now_iso()
    reviews = dict(sub.get("sectionReviews") or {})
    for key in ALL_ONBOARDING_SECTIONS:
        reviews[key] = {"status": "VERIFIED", "reviewedAt": now, "reviewedBy": reviewer}

    updated = db_store.update_onboarding_submission(sub_id, {
        "status": "VERIFIED",
        "verifiedAt": now,
        "verifiedBy": reviewer,
        "rejectionRemarks": None,
        "sectionReviews": reviews,
    })

    sync_onboarding_docs_to_repository(sub, "VERIFIED", verified_by=reviewer)

    if sub.get("userId"):
        db_store.update_user(sub["userId"], {"onboardingCompleted": True, "onboardingStep": ONBOARDING_TOTAL_STEPS})

    if sub.get("employeeId"):
        emp = db_store.get_employee_by_id(sub["employeeId"])
        if emp and emp.get("status") == "PROBATION":
            db_store.update_employee(sub["employeeId"], {"status": "ACTIVE"})

    _push_notification(
        sub.get("userId"),
        "Onboarding Approved & Verified",
        "All 8 sections of your onboarding dossier have been approved and verified by HR. Welcome aboard!",
        now,
    )
    audit(user, "ONBOARDING_VERIFIED", "ONBOARDING", "OnboardingSubmission", sub_id, {
        "candidate": sub.get("employeeName"),
        "employeeCode": sub.get("employeeCode"),
        "allSectionsApproved": True,
    })
    return {"success": True, "submission": updated}


@router.post("/onboarding/submissions/{sub_id}/section-review")
async def section_review(sub_id: str, request: Request, user: dict = Depends(require_write("self_onboarding"))):
    body = await read_body(request)
    section_key = body.get("sectionKey")
    status = body.get("status")
    remarks = body.get("remarks")

    if not section_key or section_key not in ALL_ONBOARDING_SECTIONS:
        shown = js_str(section_key) if section_key is not None else "undefined"
        raise ApiError(400, f"Invalid section key: {shown}. Allowed: {', '.join(ALL_ONBOARDING_SECTIONS)}")
    if status not in ("VERIFIED", "NEEDS_CORRECTION"):
        raise ApiError(400, "Status must be VERIFIED or NEEDS_CORRECTION.")
    if status == "NEEDS_CORRECTION" and not _trim(remarks):
        raise ApiError(400, "Remarks explaining what needs correction are required.")

    sub = db_store.get_onboarding_submission_by_id(sub_id)
    if not sub:
        raise ApiError(404, "Submission not found.")

    reviewer = _reviewer_name(user)
    now = now_iso()
    label = ONBOARDING_SECTION_LABELS.get(section_key) or section_key

    reviews = dict(sub.get("sectionReviews") or {})
    review = {"status": status, "reviewedAt": now, "reviewedBy": reviewer}
    if status == "NEEDS_CORRECTION":
        review = {"status": status, "remarks": _trim(remarks), "reviewedAt": now, "reviewedBy": reviewer}
    reviews[section_key] = review

    patch = {"sectionReviews": reviews, "updatedAt": now}
    all_cleared = all((reviews.get(k) or {}).get("status") == "VERIFIED" for k in ALL_ONBOARDING_SECTIONS)

    if status == "NEEDS_CORRECTION":
        if section_key == "documents":
            sync_onboarding_docs_to_repository(sub, "REVISION_REQUESTED", reason=_trim(remarks), verified_by=reviewer)
        audit(user, "ONBOARDING_SECTION_REVISION_RECORDED", "ONBOARDING", "OnboardingSubmission", sub_id, {
            "sectionKey": section_key, "sectionLabel": label, "remarks": _trim(remarks),
        })
    else:
        if section_key == "documents":
            sync_onboarding_docs_to_repository(sub, "VERIFIED", verified_by=reviewer)
        audit(user, "ONBOARDING_SECTION_VERIFIED", "ONBOARDING", "OnboardingSubmission", sub_id, {
            "sectionKey": section_key, "sectionLabel": label,
        })

    updated = db_store.update_onboarding_submission(sub_id, patch)
    return {"success": True, "submission": updated, "allCleared": all_cleared, "sectionKey": section_key}


@router.post("/onboarding/submissions/{sub_id}/send-revisions")
async def send_revisions(sub_id: str, request: Request, user: dict = Depends(require_write("self_onboarding"))):
    body = await read_body(request)
    override = body.get("revisions")
    general_note = body.get("generalNote")

    sub = db_store.get_onboarding_submission_by_id(sub_id)
    if not sub:
        raise ApiError(404, "Submission not found.")

    reviewer = _reviewer_name(user)
    now = now_iso()
    reviews = dict(sub.get("sectionReviews") or {})

    if isinstance(override, list) and override:
        for rev in override:
            if isinstance(rev, dict) and rev.get("sectionKey") and _trim(rev.get("remarks")):
                reviews[rev["sectionKey"]] = {
                    "status": "NEEDS_CORRECTION",
                    "remarks": _trim(rev["remarks"]),
                    "reviewedAt": now,
                    "reviewedBy": reviewer,
                }

    collected = []
    for key in ALL_ONBOARDING_SECTIONS:
        sec = reviews.get(key)
        if sec and sec.get("status") == "NEEDS_CORRECTION" and _trim(sec.get("remarks")):
            collected.append({
                "sectionKey": key,
                "sectionTitle": ONBOARDING_SECTION_LABELS.get(key) or key,
                "remarks": _trim(sec["remarks"]),
            })

    if not collected:
        raise ApiError(400, "No review points found. Please add revision remarks to at least one section before sending.")

    compiled = "\n\n".join(f"{i + 1}. [{r['sectionTitle']}]: {r['remarks']}" for i, r in enumerate(collected))
    if general_note:
        compiled += f"\n\nGeneral Instructions: {_trim(general_note)}"

    updated = db_store.update_onboarding_submission(sub_id, {
        "status": "NEEDS_CORRECTION",
        "rejectionRemarks": compiled,
        "sectionReviews": reviews,
        "updatedAt": now,
    })

    if sub.get("userId"):
        db_store.update_user(sub["userId"], {"onboardingCompleted": False})

    doc_review = reviews.get("documents") or {}
    if doc_review.get("status") == "NEEDS_CORRECTION":
        sync_onboarding_docs_to_repository(
            sub, "REVISION_REQUESTED", reason=doc_review.get("remarks") or "Document revisions required", verified_by=reviewer
        )

    recipient = s(sub.get("personalEmail") or sub.get("workEmail") or "").strip()
    email_sent = False
    email_status = "NO_EMAIL"
    if recipient and EMAIL_RE.match(recipient):
        try:
            mail = build_onboarding_revision_email({
                "candidateName": sub.get("employeeName"),
                "candidateEmail": recipient,
                "revisions": collected,
                "hrName": reviewer,
                "loginUrl": get_app_base_url(request),
            })
            mail_res = await send_mail({"to": recipient, **mail})
            email_sent = bool(mail_res.get("delivered") or mail_res.get("simulated"))
            email_status = "DELIVERED" if mail_res.get("delivered") else ("SIMULATED" if mail_res.get("simulated") else "FAILED")
        except Exception as err:  # noqa: BLE001
            print("[mailer] Failed to send consolidated onboarding revision email:", err)
            email_status = "ERROR"

    _push_notification(
        sub.get("userId"),
        "Action Required: Onboarding Corrections Needed",
        f"HR reviewed your submission and requested adjustments in {len(collected)} section(s). "
        "Check your email or review your onboarding form to update.",
        now,
    )
    audit(user, "ONBOARDING_CONSOLIDATED_REVISION_SENT", "ONBOARDING", "OnboardingSubmission", sub_id, {
        "candidate": sub.get("employeeName"),
        "recipientEmail": recipient,
        "revisionsCount": len(collected),
        "sections": [r["sectionKey"] for r in collected],
        "emailStatus": email_status,
    })
    return {
        "success": True,
        "submission": updated,
        "revisionsCount": len(collected),
        "recipientEmail": recipient,
        "emailSent": email_sent,
        "emailStatus": email_status,
    }


@router.post("/onboarding/submissions/{sub_id}/request-changes")
async def request_changes(sub_id: str, request: Request, user: dict = Depends(require_write("self_onboarding"))):
    body = await read_body(request)
    remarks = body.get("remarks")
    if not truthy(remarks):
        raise ApiError(400, "Remarks explaining what needs correction are required.")

    sub = db_store.get_onboarding_submission_by_id(sub_id)
    if not sub:
        raise ApiError(404, "Submission not found.")

    reviewer = _reviewer_name(user)
    now = now_iso()
    updated = db_store.update_onboarding_submission(sub_id, {
        "status": "NEEDS_CORRECTION",
        "rejectionRemarks": remarks,
        "updatedAt": now,
    })

    if sub.get("userId"):
        db_store.update_user(sub["userId"], {"onboardingCompleted": False})

    sync_onboarding_docs_to_repository(sub, "REVISION_REQUESTED", reason=remarks, verified_by=reviewer)

    recipient = s(sub.get("personalEmail") or sub.get("workEmail") or "").strip()
    if recipient and EMAIL_RE.match(recipient):
        try:
            mail = build_onboarding_revision_email({
                "candidateName": sub.get("employeeName"),
                "candidateEmail": recipient,
                "revisions": [{"sectionKey": "general", "sectionTitle": "Onboarding Dossier Review", "remarks": _trim(remarks)}],
                "hrName": reviewer,
                "loginUrl": get_app_base_url(request),
            })
            await send_mail({"to": recipient, **mail})
        except Exception as err:  # noqa: BLE001
            print("[mailer] Error sending revision mail:", err)

    _push_notification(
        sub.get("userId"),
        "Action Required: Onboarding Corrections Needed",
        f"HR reviewed your submission and requested adjustments: {js_str(remarks)}",
        now,
    )
    audit(user, "ONBOARDING_CORRECTION_REQUESTED", "ONBOARDING", "OnboardingSubmission", sub_id, {"remarks": remarks})
    return {"success": True, "submission": updated}
