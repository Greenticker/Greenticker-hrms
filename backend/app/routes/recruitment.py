"""
Recruitment: requisitions -> budget approval -> published jobs -> candidates -> interviews
(with panels and calendar invites) -> offers (salary-band approval, revisions) -> hire into Core HR.

Who does what
- Raise a requisition: MANAGER and recruiters. Managers raise for their own team.
- Approve the requisition budget: FINANCE (and SUPER_ADMIN / ADMIN).
- Publish jobs, add / shortlist / interview / offer / reject candidates: recruiters
  (recruitment READ_WRITE roles: SUPER_ADMIN, ADMIN_1, ADMIN_2, HR, plus legacy ADMIN).
- Offers above the job's salary band: need FINANCE / SUPER_ADMIN / ADMIN approval.
- Panel members (any employee, typically the hiring manager) see and give feedback on the
  interviews they are on; feedback is locked once submitted.
- Managers only see candidates of their own requisitions or interviews they are on.
- Everyone can refer candidates and sees only their own referrals' status.
"""

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.auth.employee_access import MASTER_WRITE_ROLES
from app.auth.module_access import can_read, can_write
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import RESUMES, audit, issue_invite, read_body, read_fields_and_files, save_upload, stored_file_response
from app.services.mailer import build_interview_email, build_offer_email, build_rejection_email, send_mail, sender_address
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import date_ms, is_finite_number, js_str, now_iso, now_ms, num, rand_int, s, to_number, today_str, truthy

router = APIRouter()

_EMAIL_RE = re.compile(r"^\S+@\S+\.\S+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")
RESUME_EXTENSIONS = (".pdf", ".doc", ".docx")
MAX_RESUME_BYTES = 4 * 1024 * 1024
CONFIDENTIAL = "[Confidential - Visible only to HR and Admin]"
RETENTION_DAYS = 180  # rejected candidates are archived and kept this long (data retention policy)
IST = timezone(timedelta(hours=5, minutes=30))  # interview times are entered in India time

APPROVER_ROLES = ("ADMIN", "SUPER_ADMIN", "FINANCE")  # requisition budgets and above-band offers
INTERVIEW_STAGES = ("SHORTLISTED", "TECHNICAL_INTERVIEW", "HR_INTERVIEW")
CANDIDATE_STAGES = ("APPLIED", "SCREENING", "SHORTLISTED", "TECHNICAL_INTERVIEW", "HR_INTERVIEW", "OFFERED", "HIRED", "REJECTED")
PUBLISH_CHANNELS = ("CAREERS_PAGE", "LINKEDIN", "NAUKRI", "INDEED", "INTERNAL")
ACTIVE_OFFER = ("PENDING_APPROVAL", "SENT", "ACCEPTED")


# ------------------------------------------------------------------ helpers

def _email_status(result: dict) -> str:
    return "SENT" if result.get("delivered") and not result.get("simulated") else ("SIMULATED" if result.get("simulated") else "FAILED")


def _email_word(result: dict) -> str:
    return {"SENT": "sent", "SIMULATED": "simulated", "FAILED": "failed"}[_email_status(result)]


def _opt_trim(v) -> Optional[str]:
    return js_str(v).strip() if truthy(v) else None


def _name(user: dict) -> str:
    return f"{user.get('firstName') or ''} {user.get('lastName') or ''}".strip()


def _is_recruiter(user: dict) -> bool:
    return can_write(user, "recruitment")


def _can_read_pipeline(user: dict) -> bool:
    return can_read(user, "recruitment")


def _my_emp_id(user: dict) -> Optional[str]:
    if user.get("employeeId"):
        return user["employeeId"]
    emp = db_store.find_employee_by_user_id(user["_id"])
    return emp["_id"] if emp else None


def _digits(phone) -> str:
    d = re.sub(r"\D", "", js_str(phone or ""))
    return d[-10:] if len(d) >= 10 else d


def _emp_label(emp: Optional[dict]) -> Optional[str]:
    return f"{emp.get('firstName')} {emp.get('lastName')}" if emp else None


def _notify_user(user_id: Optional[str], title: str, message: str) -> None:
    if not user_id:
        return
    db_store.notifications.insert(0, {
        "_id": f"notif_{now_ms()}_{rand_int(100000)}",
        "recipientUserId": user_id,
        "title": title,
        "message": message,
        "type": "RECRUITMENT",
        "isRead": False,
        "createdAt": now_iso(),
    })


def _notify_roles(roles: tuple, title: str, message: str, exclude_user_id: Optional[str] = None) -> int:
    count = 0
    for u in db_store.users.values():
        if u.get("role") in roles and u.get("isActive", True) and u["_id"] != exclude_user_id:
            _notify_user(u["_id"], title, message)
            count += 1
    return count


def _notify_employee(emp_id: Optional[str], title: str, message: str) -> None:
    emp = db_store.employees.get(emp_id or "")
    if emp and emp.get("userId"):
        _notify_user(emp["userId"], title, message)


# ---------------------------------------------------------------- requisitions

def _normalize_requisition(r: dict) -> dict:
    """Older records used SUBMITTED for 'waiting for approval'."""
    out = dict(r)
    if out.get("status") == "SUBMITTED":
        out["status"] = "PENDING_APPROVAL"
    if out.get("status") == "APPROVED" and out.get("jobId"):
        out["status"] = "PUBLISHED"
    return out


def _requisition_visible(user: dict, r: dict) -> bool:
    if _is_recruiter(user) or user.get("role") in APPROVER_ROLES or user.get("role") == "AUDITORS":
        return True
    me = _my_emp_id(user)
    return r.get("requestedByUserId") == user["_id"] or (me and me in (r.get("requestedById"), r.get("hiringManagerId")))


def _requisition_or_404(req_id: str) -> dict:
    r = modules_store.requirements.get(req_id)
    if not r:
        raise ApiError(404, "Requisition not found.")
    return r


def _history(r: dict, action: str, user: dict, comment: Optional[str] = None) -> None:
    r.setdefault("history", []).append({k: v for k, v in {
        "action": action, "by": _name(user), "role": user.get("role"), "at": now_iso(), "comment": comment,
    }.items() if v is not None})


@router.get("/recruitment/requisitions")
@router.get("/recruitment/requirements")
async def list_requisitions(user: dict = Depends(require_auth)):
    if not (_is_recruiter(user) or user.get("role") in APPROVER_ROLES + ("MANAGER", "AUDITORS")):
        raise ApiError(403, "Access denied: job requisitions are only available to managers, HR and finance.")
    items = [_normalize_requisition(r) for r in modules_store.requirements.values() if _requisition_visible(user, r)]
    items.sort(key=lambda r: date_ms(r.get("createdAt")), reverse=True)
    return {"requisitions": items, "requirements": items}


@router.post("/recruitment/requisitions")
@router.post("/recruitment/requirements")
async def create_requisition(request: Request, user: dict = Depends(require_auth)):
    if not (_is_recruiter(user) or user.get("role") == "MANAGER"):
        raise ApiError(403, "Only managers and HR can raise a job requisition.")
    b = await read_body(request)
    errors = []
    title = s(b.get("title") or "").strip()
    description = s(b.get("description") or b.get("jobDescription") or "").strip()
    justification = s(b.get("justification") or "").strip()
    positions = num(b.get("positions"))
    budget_min, budget_max = num(b.get("budgetMin")), num(b.get("budgetMax"))
    my_emp = db_store.employees.get(_my_emp_id(user) or "")
    department = s(b.get("department") or (my_emp or {}).get("department") or "").strip()

    if not title:
        errors.append("Position / job title is required.")
    if not department:
        errors.append("Department is required.")
    if not is_finite_number(positions) or positions != int(positions) or positions < 1 or positions > 100:
        errors.append("Number of positions must be a whole number between 1 and 100.")
    if not is_finite_number(budget_min) or not is_finite_number(budget_max) or budget_min <= 0 or budget_max <= 0:
        errors.append("Budget (minimum and maximum annual CTC per position) is required.")
    elif budget_max < budget_min:
        errors.append("Maximum budget cannot be lower than the minimum.")
    if len(description) < 20:
        errors.append("Job description is required (at least 20 characters).")
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the highlighted fields.", errors=errors)

    # Hiring manager: a manager raises for themself; HR may raise on behalf of a manager
    hiring_manager = my_emp
    if _is_recruiter(user) and truthy(b.get("hiringManagerId")):
        hiring_manager = db_store.employees.get(js_str(b["hiringManagerId"]))
        if not hiring_manager:
            raise ApiError(400, "Selected hiring manager was not found.")

    raw_skills = b.get("skillsRequired")
    skills = raw_skills if isinstance(raw_skills, list) else s(raw_skills or "").split(",")
    req_id = f"req_{now_ms()}"
    r = {
        "_id": req_id,
        "requestedById": (my_emp or {}).get("_id") or "",
        "requestedByUserId": user["_id"],
        "requestedByName": _emp_label(my_emp) or user.get("email"),
        "hiringManagerId": (hiring_manager or {}).get("_id"),
        "hiringManagerName": _emp_label(hiring_manager),
        "title": title,
        "department": department,
        "positions": int(positions),
        "employmentType": b.get("employmentType") if b.get("employmentType") in ("FULL_TIME", "PART_TIME", "CONTRACT") else "FULL_TIME",
        "experienceRequired": s(b.get("experienceRequired") or "").strip() or "Not specified",
        "skillsRequired": [js_str(x).strip() for x in skills if js_str(x).strip()],
        "priority": b.get("priority") if b.get("priority") in ("LOW", "MEDIUM", "HIGH", "URGENT") else "MEDIUM",
        "expectedJoiningDate": js_str(b["expectedJoiningDate"]) if truthy(b.get("expectedJoiningDate")) else None,
        "budgetMin": budget_min,
        "budgetMax": budget_max,
        "budgetRange": f"₹{budget_min:,.0f} - ₹{budget_max:,.0f}",
        "location": _opt_trim(b.get("location")),
        "description": description,
        "justification": justification or None,
        "status": "PENDING_APPROVAL",
        "createdAt": now_iso(),
    }
    r = {k: v for k, v in r.items() if v is not None}
    _history(r, "SUBMITTED", user)
    modules_store.requirements[req_id] = r

    sent = _notify_roles(("FINANCE",), "Job requisition awaiting budget approval",
                         f"{r['requestedByName']} requested {r['positions']} x {title} ({department}), budget {r['budgetRange']}.",
                         exclude_user_id=user["_id"])
    audit(user, "REQUISITION_SUBMITTED", "RECRUITMENT", "Requisition", req_id, {
        "title": title, "department": department, "positions": r["positions"], "budget": r["budgetRange"], "approversNotified": sent,
    })
    return JSONResponse({"success": True, "requisition": _normalize_requisition(r), "requirement": r,
                         "message": f"Requisition submitted and sent to Finance for budget approval ({sent} approver(s) notified)."},
                        status_code=201)


@router.put("/recruitment/requisitions/{req_id}/review")
@router.put("/recruitment/requirements/{req_id}/review")
async def review_requisition(req_id: str, request: Request, user: dict = Depends(require_role(*APPROVER_ROLES))):
    body = await read_body(request)
    decision = s(body.get("decision") or "")
    comment = _opt_trim(body.get("comment") or body.get("note"))
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Please add a comment explaining why the requisition is rejected.")
    r = _requisition_or_404(req_id)
    me = _my_emp_id(user)
    if r.get("requestedByUserId") == user["_id"] or (me and me in (r.get("requestedById"), r.get("hiringManagerId"))):
        raise ApiError(403, "You raised this requisition (or are its hiring manager), so someone else must approve it.")
    if _normalize_requisition(r)["status"] != "PENDING_APPROVAL":
        raise ApiError(400, f"This requisition is already {_normalize_requisition(r)['status'].replace('_', ' ').lower()}.")

    r["status"] = decision
    r["reviewedBy"] = _name(user)
    r["reviewedAt"] = now_iso()
    if comment:
        r["reviewNote"] = comment
    _history(r, decision, user, comment)

    # Tell the requester (and the hiring manager, if different); approved ones also go to HR to publish
    msg = f'Your requisition "{r.get("title")}" was {decision.lower()} by {_name(user)}' + (f": {comment}" if comment else ".")
    _notify_user(r.get("requestedByUserId"), f"Requisition {decision.lower()}", msg)
    if not r.get("requestedByUserId"):
        _notify_employee(r.get("requestedById"), f"Requisition {decision.lower()}", msg)
    if r.get("hiringManagerId") and r.get("hiringManagerId") != r.get("requestedById"):
        _notify_employee(r["hiringManagerId"], f"Requisition {decision.lower()}", msg)
    if decision == "APPROVED":
        _notify_roles(("HR",), "Requisition approved - ready to publish", f'"{r.get("title")}" is budget-approved and can be published.')

    audit(user, f"REQUISITION_{decision}", "RECRUITMENT", "Requisition", req_id, {"title": r.get("title"), "comment": comment})
    return {"success": True, "requisition": _normalize_requisition(r), "requirement": r}


@router.post("/recruitment/requisitions/{req_id}/publish")
async def publish_requisition(req_id: str, request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can publish jobs.")
    body = await read_body(request)
    r = _requisition_or_404(req_id)
    status = _normalize_requisition(r)["status"]
    if status != "APPROVED":
        raise ApiError(400, "Only budget-approved requisitions can be published." if status == "PENDING_APPROVAL"
                       else f"This requisition cannot be published (status: {status.replace('_', ' ').lower()}).")
    channels = [c for c in (body.get("channels") or ["CAREERS_PAGE"]) if c in PUBLISH_CHANNELS] or ["CAREERS_PAGE"]

    job_id = f"job_{now_ms()}"
    job = {
        "_id": job_id,
        "requisitionId": req_id,
        "title": r.get("title"),
        "department": r.get("department"),
        "location": r.get("location") or "Head Office",
        "type": r.get("employmentType") or "FULL_TIME",
        "experienceRequired": r.get("experienceRequired"),
        "openingsCount": r.get("positions"),
        "description": r.get("description") or r.get("justification") or "",
        "skillsRequired": r.get("skillsRequired") or [],
        "hiringManagerId": r.get("hiringManagerId"),
        "hiringManagerName": r.get("hiringManagerName"),
        "salaryBandMin": r.get("budgetMin"),
        "salaryBandMax": r.get("budgetMax"),
        "status": "OPEN",
        "published": True,
        "publishedChannels": channels,
        "publishedAt": now_iso(),
        "publishedBy": _name(user),
        "postedDate": today_str(),
    }
    job = {k: v for k, v in job.items() if v is not None}
    modules_store.jobOpenings[job_id] = job
    r["status"] = "PUBLISHED"
    r["jobId"] = job_id
    _history(r, "PUBLISHED", user, ", ".join(channels))

    _notify_user(r.get("requestedByUserId"), "Job published", f'"{r.get("title")}" is now live on: {", ".join(channels)}.')
    audit(user, "JOB_PUBLISHED", "RECRUITMENT", "Job", job_id, {"title": job["title"], "requisitionId": req_id, "channels": channels})
    return {"success": True, "job": job, "requisition": _normalize_requisition(r)}


# --------------------------------------------------------------------- jobs

def _public_job(job: dict) -> dict:
    return {k: job.get(k) for k in ("_id", "title", "department", "location", "type", "experienceRequired",
                                    "openingsCount", "description", "skillsRequired", "postedDate") if job.get(k) is not None}


@router.get("/careers/jobs")
async def careers_jobs():
    """Public careers page feed: only published, open jobs (no internal budget or manager data)."""
    jobs = [j for j in modules_store.jobOpenings.values() if j.get("status") == "OPEN" and j.get("published") is not False]
    return {"jobs": [_public_job(j) for j in jobs]}


@router.get("/recruitment/jobs")
async def list_jobs(user: dict = Depends(require_auth)):
    jobs = list(modules_store.jobOpenings.values())
    if _can_read_pipeline(user):
        return {"jobs": jobs}
    me = _my_emp_id(user)
    out = []
    for j in jobs:
        if user.get("role") == "MANAGER" and me and j.get("hiringManagerId") == me:
            out.append(j)  # their own requisition's job, with its band
        elif j.get("status") == "OPEN":
            out.append(_public_job(j))  # open jobs, for referrals
    return {"jobs": out}


@router.post("/recruitment/jobs")
async def create_job(request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can create job openings.")
    body = await read_body(request)
    title, department = body.get("title"), body.get("department")
    if not truthy(title) or not truthy(department):
        raise ApiError(400, "Job title and department are required.")
    skills = body.get("skillsRequired") if body.get("skillsRequired") is not None else []
    mgr = db_store.employees.get(js_str(body.get("hiringManagerId") or ""))

    job_id = f"job_{now_ms()}"
    job = {
        "_id": job_id,
        "title": js_str(title).strip(),
        "department": js_str(department).strip(),
        "location": body.get("location") or "Head Office",
        "type": body.get("type") if body.get("type") is not None else "FULL_TIME",
        "experienceRequired": body.get("experienceRequired") or "2-4 years",
        "openingsCount": num(body.get("openingsCount") if body.get("openingsCount") is not None else 1),
        "status": "OPEN",
        "published": True,
        "postedDate": today_str(),
        "description": body.get("description") or "",
        "skillsRequired": skills if isinstance(skills, list) else [],
        "hiringManagerId": (mgr or {}).get("_id"),
        "hiringManagerName": _emp_label(mgr),
        "salaryBandMin": num(body.get("salaryBandMin")) if truthy(body.get("salaryBandMin")) else None,
        "salaryBandMax": num(body.get("salaryBandMax")) if truthy(body.get("salaryBandMax")) else None,
    }
    job = {k: v for k, v in job.items() if v is not None}
    modules_store.jobOpenings[job_id] = job
    audit(user, "JOB_CREATED", "RECRUITMENT", "Job", job_id, {"title": job["title"]})
    return JSONResponse({"success": True, "job": job}, status_code=201)


# --------------------------------------------------------------- candidates

def _candidate_or_404(cand_id: str) -> dict:
    cand = modules_store.jobCandidates.get(cand_id)
    if not cand:
        raise ApiError(404, "Candidate not found.")
    return cand


def _panel_ids(cand: dict) -> set:
    return {p.get("employeeId") for r in cand.get("interviewRounds") or [] for p in r.get("panel") or []}


def _manager_can_see(user: dict, cand: dict) -> bool:
    me = _my_emp_id(user)
    if not me:
        return False
    job = modules_store.jobOpenings.get(cand.get("jobId") or "") or {}
    return job.get("hiringManagerId") == me or me in _panel_ids(cand)


def _can_see_candidate(user: dict, cand: dict) -> bool:
    return _can_read_pipeline(user) or (user.get("role") == "MANAGER" and _manager_can_see(user, cand)) or (
        _my_emp_id(user) in _panel_ids(cand)
    )


def _present_candidate(user: dict, cand: dict) -> dict:
    c = dict(cand)
    c.pop("resumeStoredFileName", None)
    c["hasResume"] = bool(cand.get("resumeStoredFileName"))
    if _is_recruiter(user):
        return c

    # Comments and private notes stay with HR; others see the justification and rating only.
    def redact(fb: dict) -> dict:
        out = {**fb, "comments": CONFIDENTIAL}
        out.pop("notes", None)
        return out

    me = _my_emp_id(user)
    if c.get("interviewFeedbacks"):
        c["interviewFeedbacks"] = [redact(fb) for fb in c["interviewFeedbacks"]]
    rounds = []
    for r in c.get("interviewRounds") or []:
        r = dict(r)
        if r.get("feedback"):
            r["feedback"] = redact(r["feedback"])
        # A panel member sees their own panel feedback, not their colleagues'
        pf = r.get("panelFeedback") or {}
        r["panelFeedback"] = {k: v for k, v in pf.items() if k == me}
        rounds.append(r)
    if rounds:
        c["interviewRounds"] = rounds
    if user.get("role") not in APPROVER_ROLES:
        for key in ("offer", "offers"):
            c.pop(key, None)
    return c


@router.get("/recruitment/candidates")
async def list_candidates(jobId: Optional[str] = None, includeArchived: Optional[str] = None, user: dict = Depends(require_auth)):
    if not (_can_read_pipeline(user) or user.get("role") == "MANAGER"):
        raise ApiError(403, "Access denied: the recruitment pipeline is only available to HR, hiring managers and approvers.")
    candidates = modules_store.get_job_candidates(jobId)
    if includeArchived not in ("1", "true"):
        candidates = [c for c in candidates if not c.get("archived")]
    if not _can_read_pipeline(user):
        candidates = [c for c in candidates if _manager_can_see(user, c)]
    return {"candidates": [_present_candidate(user, c) for c in candidates]}


@router.get("/recruitment/candidates/{cand_id}")
async def get_candidate(cand_id: str, user: dict = Depends(require_auth)):
    cand = _candidate_or_404(cand_id)
    if not _can_see_candidate(user, cand):
        raise ApiError(403, "Access denied: this candidate belongs to another manager's requisition.")
    return {"candidate": _present_candidate(user, cand)}


def _find_duplicate(email: str, phone: str, exclude_id: Optional[str] = None) -> Optional[dict]:
    email_l, phone_d = email.strip().lower(), _digits(phone)
    for c in modules_store.jobCandidates.values():
        if c["_id"] == exclude_id:
            continue
        matched = []
        if email_l and (c.get("email") or "").strip().lower() == email_l:
            matched.append("email")
        if phone_d and len(phone_d) >= 10 and _digits(c.get("phone")) == phone_d:
            matched.append("mobile")
        if matched:
            return {"_id": c["_id"], "fullName": c.get("fullName"), "email": c.get("email"), "phone": c.get("phone"),
                    "jobTitle": c.get("jobTitle"), "stage": c.get("stage"), "archived": bool(c.get("archived")), "matchedOn": matched}
    return None


def _duplicate_error(dup: dict) -> ApiError:
    on = " and ".join(dup["matchedOn"])
    return ApiError(409, f"Duplicate candidate: {dup['fullName']} already exists with the same {on} "
                         f"({dup.get('jobTitle') or 'no job'}, stage {(dup.get('stage') or '').replace('_', ' ').lower()}).",
                    duplicate=dup)


async def _check_resume(upload) -> None:
    ext = ("." + upload.filename.rsplit(".", 1)[-1].lower()) if "." in (upload.filename or "") else ""
    if ext not in RESUME_EXTENSIONS:
        raise ApiError(400, "Resume must be a PDF, DOC or DOCX file.")
    if (upload.size or 0) > MAX_RESUME_BYTES:
        raise ApiError(400, "Resume must be 4 MB or smaller.")


@router.post("/recruitment/candidates")
async def add_candidate(request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can add candidates.")
    body, files = await read_fields_and_files(request)
    upload = (files.get("resume") or [None])[0]
    if upload is not None:
        await _check_resume(upload)

    errors = []
    job = modules_store.jobOpenings.get(js_str(body.get("jobId") or ""))
    full_name = s(body.get("fullName") or "").strip()
    email = s(body.get("email") or "").strip().lower()
    phone = s(body.get("phone") or "").strip()
    exp = num(body.get("experienceYears")) if truthy(body.get("experienceYears")) else 0
    if not job:
        errors.append("Select the job this candidate is applying for.")
    if not full_name:
        errors.append("Candidate name is required.")
    if not _EMAIL_RE.match(email):
        errors.append("A valid e-mail address is required.")
    if len(_digits(phone)) < 10:
        errors.append("A valid 10-digit mobile number is required.")
    if not is_finite_number(exp) or exp < 0 or exp > 60:
        errors.append("Years of experience must be between 0 and 60.")
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the highlighted fields.", errors=errors)

    dup = _find_duplicate(email, phone)
    if dup:
        raise _duplicate_error(dup)

    cand_id = f"cand_{now_ms()}_{rand_int(1000)}"
    cand = {
        "_id": cand_id,
        "jobId": job["_id"],
        "jobTitle": job.get("title"),
        "fullName": full_name,
        "email": email,
        "phone": phone,
        "experienceYears": exp,
        "currentCompany": _opt_trim(body.get("currentCompany")),
        "currentCtc": num(body.get("currentCtc")) if truthy(body.get("currentCtc")) else None,
        "noticePeriodDays": num(body.get("noticePeriodDays")) if truthy(body.get("noticePeriodDays")) else None,
        "notes": _opt_trim(body.get("notes")),
        "source": "RESUME_UPLOAD" if upload is not None else "MANUAL",
        "stage": "APPLIED",
        "rating": 0,
        "appliedDate": today_str(),
        "addedBy": _name(user),
    }
    if upload is not None:
        saved = await save_upload(upload, RESUMES, MAX_RESUME_BYTES, lower_ext=True)
        cand["resumeStoredFileName"] = saved["storedFileName"]
        cand["resumeFileName"] = upload.filename
    cand = {k: v for k, v in cand.items() if v is not None}
    modules_store.jobCandidates[cand_id] = cand
    audit(user, "CANDIDATE_ADDED", "RECRUITMENT", "Candidate", cand_id, {"candidate": full_name, "job": job.get("title"), "source": cand["source"]})
    return JSONResponse({"success": True, "candidate": _present_candidate(user, cand)}, status_code=201)


@router.put("/recruitment/candidates/{cand_id}")
async def update_candidate(cand_id: str, request: Request, user: dict = Depends(require_auth)):
    """HR corrects a candidate's details (e.g. a new e-mail address before re-sending an offer)."""
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can edit candidate details.")
    cand = _candidate_or_404(cand_id)
    b = await read_body(request)
    updates: dict = {}
    if "fullName" in b:
        if not s(b["fullName"]).strip():
            raise ApiError(400, "Candidate name cannot be empty.")
        updates["fullName"] = s(b["fullName"]).strip()
    if "email" in b:
        email = s(b["email"]).strip().lower()
        if not _EMAIL_RE.match(email):
            raise ApiError(400, "Please enter a valid e-mail address.")
        updates["email"] = email
    if "phone" in b:
        if len(_digits(b["phone"])) < 10:
            raise ApiError(400, "Please enter a valid 10-digit mobile number.")
        updates["phone"] = s(b["phone"]).strip()
    for key in ("currentCompany", "notes"):
        if key in b:
            updates[key] = s(b[key] or "").strip()
    if "experienceYears" in b:
        exp = num(b["experienceYears"])
        if not is_finite_number(exp) or exp < 0 or exp > 60:
            raise ApiError(400, "Years of experience must be between 0 and 60.")
        updates["experienceYears"] = exp

    dup = _find_duplicate(updates.get("email", ""), updates.get("phone", ""), exclude_id=cand_id) if ("email" in updates or "phone" in updates) else None
    if dup:
        raise _duplicate_error(dup)

    changes = [{"field": k, "oldValue": cand.get(k), "newValue": v} for k, v in updates.items() if cand.get(k) != v]
    cand.update(updates)
    if changes:
        audit(user, "CANDIDATE_UPDATED", "RECRUITMENT", "Candidate", cand_id, {"candidate": cand.get("fullName"), "changes": changes})
    return {"success": True, "candidate": _present_candidate(user, cand), "changes": changes}


@router.get("/recruitment/candidates/{cand_id}/resume")
async def candidate_resume(cand_id: str, user: dict = Depends(require_auth)):
    cand = _candidate_or_404(cand_id)
    if not _can_see_candidate(user, cand):
        raise ApiError(403, "Access denied.")
    if not cand.get("resumeStoredFileName"):
        raise ApiError(404, "No resume on file for this candidate.")
    response = await stored_file_response(RESUMES, cand["resumeStoredFileName"], cand.get("resumeFileName") or "resume.pdf")
    if not response:
        raise ApiError(404, "Resume file is missing on the server.")
    return response


@router.post("/recruitment/candidates/{cand_id}/shortlist")
async def shortlist_candidate(cand_id: str, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can shortlist candidates.")
    cand = _candidate_or_404(cand_id)
    if cand.get("stage") not in ("APPLIED", "SCREENING"):
        raise ApiError(400, f"Only new or screening candidates can be shortlisted (current stage: {cand.get('stage')}).")
    cand["stage"] = "SHORTLISTED"
    cand["shortlistedAt"] = now_iso()
    cand["shortlistedBy"] = _name(user)
    audit(user, "CANDIDATE_SHORTLISTED", "RECRUITMENT", "Candidate", cand_id, {"candidate": cand.get("fullName")})
    return {"success": True, "candidate": _present_candidate(user, cand)}


# ----------------------------------------------------------------- interviews

def _ics(cand: dict, rnd: dict, organizer: str, attendees: list) -> bytes:
    start = datetime.strptime(f"{rnd['date']} {rnd['time']}", "%Y-%m-%d %H:%M").replace(tzinfo=IST).astimezone(timezone.utc)
    end = start + timedelta(minutes=int(rnd.get("durationMinutes") or 45))
    fmt = "%Y%m%dT%H%M%SZ"

    def esc(v) -> str:
        return js_str(v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//vetan.ai//HRMS Recruitment//EN", "METHOD:REQUEST", "BEGIN:VEVENT",
        f"UID:{rnd['calendarUid']}",
        f"DTSTAMP:{datetime.now(timezone.utc).strftime(fmt)}",
        f"DTSTART:{start.strftime(fmt)}",
        f"DTEND:{end.strftime(fmt)}",
        f"SUMMARY:{esc(rnd.get('roundName'))} - {esc(cand.get('fullName'))} ({esc(cand.get('jobTitle'))})",
        f"LOCATION:{esc(rnd.get('locationOrLink'))}",
        f"DESCRIPTION:{esc('Interview for ' + js_str(cand.get('jobTitle')) + '. Panel: ' + ', '.join(p['name'] for p in rnd.get('panel') or []))}",
        f"ORGANIZER;CN={esc(organizer)}:mailto:{re.sub(r'^.*<|>$', '', sender_address())}",
    ]
    lines += [f"ATTENDEE;CN={esc(n)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:{e}" for n, e in attendees if e]
    lines += ["STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR"]
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


@router.post("/recruitment/candidates/{cand_id}/schedule-interview")
async def schedule_interview(cand_id: str, request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can schedule interviews.")
    cand = _candidate_or_404(cand_id)
    if cand.get("stage") in ("HIRED", "REJECTED") or cand.get("archived"):
        raise ApiError(400, f"Cannot schedule an interview for a candidate who is {cand['stage'].lower()}.")
    if cand.get("stage") in ("APPLIED", "SCREENING"):
        raise ApiError(400, "Shortlist the candidate before scheduling an interview.")
    if not _EMAIL_RE.match(cand.get("email") or ""):
        raise ApiError(400, "This candidate does not have a valid e-mail address.")

    b = await read_body(request)
    date_s, time_s = s(b.get("date") or ""), s(b.get("time") or "")
    mode = b.get("mode") if b.get("mode") in ("IN_PERSON", "VIDEO", "PHONE") else "VIDEO"
    location_or_link = s(b.get("locationOrLink") or "").strip()
    duration = to_number(b.get("durationMinutes"), 45)
    round_number = to_number(b.get("roundNumber")) or (len(cand.get("interviewRounds") or []) + 1)
    round_name = js_str(b.get("roundName") or f"Round {js_str(round_number)}: Interview").strip()

    panel = []
    for pid in b.get("panel") or []:
        emp = db_store.employees.get(js_str(pid))
        if not emp:
            raise ApiError(400, "A selected panel member was not found.")
        if emp["_id"] not in [p["employeeId"] for p in panel]:
            panel.append({"employeeId": emp["_id"], "name": _emp_label(emp), "email": emp.get("workEmail"), "userId": emp.get("userId")})

    if not _DATE_RE.match(date_s):
        raise ApiError(400, "Interview date is required.")
    if not _TIME_RE.match(time_s):
        raise ApiError(400, "Interview time is required (HH:MM).")
    start = datetime.strptime(f"{date_s} {time_s}", "%Y-%m-%d %H:%M").replace(tzinfo=IST)
    if start < datetime.now(timezone.utc) - timedelta(minutes=1):
        raise ApiError(400, "Interview date and time must be in the future.")
    if not panel:
        raise ApiError(400, "Select at least one interview panel member.")
    if not location_or_link:
        raise ApiError(400, {"IN_PERSON": "Venue is required.", "VIDEO": "Meeting link is required."}.get(mode, "Contact number is required."))

    hr_name = _name(user)
    notes = _opt_trim(b.get("notes"))
    interviewer = ", ".join(p["name"] for p in panel)
    rnd = {k: v for k, v in {
        "roundNumber": round_number, "roundName": round_name, "date": date_s, "time": time_s,
        "durationMinutes": duration, "mode": mode, "locationOrLink": location_or_link, "interviewer": interviewer,
        "panel": panel, "notes": notes, "status": "SCHEDULED", "scheduledBy": hr_name, "scheduledAt": now_iso(),
        "calendarUid": f"{uuid.uuid4()}@vetan.ai", "panelFeedback": {},
    }.items() if v is not None}

    attendees = [(cand.get("fullName"), cand.get("email"))] + [(p["name"], p.get("email")) for p in panel]
    ics = _ics(cand, rnd, hr_name, attendees)
    attachment = [{"filename": "interview.ics", "content": ics, "contentType": "text/calendar; method=REQUEST"}]
    mail = build_interview_email({
        "candidateName": cand.get("fullName"), "jobTitle": f"{cand.get('jobTitle')} ({round_name})", "date": date_s, "time": time_s,
        "durationMinutes": duration, "mode": mode, "locationOrLink": location_or_link, "interviewer": interviewer,
        "notes": notes, "hrName": hr_name,
    })
    cand_result = await send_mail({"to": cand["email"], **mail, "attachments": attachment})

    panel_results = []
    for p in panel:
        if p.get("email"):
            pm = {
                "subject": f"Interview panel: {cand.get('fullName')} - {cand.get('jobTitle')} ({round_name})",
                "html": f"<p>Hi {p['name']},</p><p>You are on the interview panel for <b>{cand.get('fullName')}</b> "
                        f"({cand.get('jobTitle')}), {round_name}, on {date_s} at {time_s} IST ({duration} min, {mode.replace('_', ' ').lower()}): "
                        f"{location_or_link}.</p><p>The calendar invite is attached. Please submit your feedback in the HRMS under "
                        f"Recruitment &rarr; My Interviews after the interview.</p><p>{hr_name}, HR</p>",
                "text": f"You are on the interview panel for {cand.get('fullName')} ({cand.get('jobTitle')}), {round_name}, "
                        f"{date_s} {time_s} IST. Submit feedback under Recruitment > My Interviews.",
                "attachments": attachment,
            }
            res = await send_mail({"to": p["email"], **pm})
            panel_results.append({"name": p["name"], "email": p["email"], "status": _email_status(res)})
        if p.get("userId"):
            _notify_user(p["userId"], "Interview panel assignment",
                         f"{cand.get('fullName')} ({cand.get('jobTitle')}) - {round_name} on {date_s} at {time_s}. Give feedback under Recruitment > My Interviews.")

    rnd["candidateEmailStatus"] = _email_status(cand_result)
    rnd["panelEmailStatus"] = panel_results
    cand.setdefault("interviewRounds", []).append(rnd)
    cand["stage"] = "TECHNICAL_INTERVIEW"
    cand["interview"] = {k: v for k, v in rnd.items() if k not in ("panelFeedback",)}
    cand["interview"]["emailSentAt"] = now_iso()
    cand["interview"]["emailStatus"] = rnd["candidateEmailStatus"]

    audit(user, "INTERVIEW_SCHEDULED", "RECRUITMENT", "Candidate", cand["_id"], {
        "candidate": cand.get("fullName"), "roundName": round_name, "date": date_s, "time": time_s,
        "panel": [p["name"] for p in panel], "candidateEmail": _email_word(cand_result),
    })
    return {
        "success": True,
        "candidate": _present_candidate(user, cand),
        "email": cand_result,
        "sentFrom": sender_address(),
        "panelEmails": panel_results,
        "message": f"{round_name} scheduled. Invite with calendar entry sent to {cand['email']} and {len(panel)} panel member(s)"
                   + (" (e-mail simulated: no mail provider configured)." if cand_result.get("simulated") else "."),
    }


@router.get("/recruitment/candidates/{cand_id}/rounds/{round_number}/calendar.ics")
async def round_calendar(cand_id: str, round_number: int, user: dict = Depends(require_auth)):
    cand = _candidate_or_404(cand_id)
    if not _can_see_candidate(user, cand):
        raise ApiError(403, "Access denied.")
    rnd = next((r for r in cand.get("interviewRounds") or [] if r.get("roundNumber") == round_number and r.get("calendarUid")), None)
    if not rnd:
        raise ApiError(404, "No calendar entry for this round.")
    attendees = [(cand.get("fullName"), cand.get("email"))] + [(p["name"], p.get("email")) for p in rnd.get("panel") or []]
    return Response(_ics(cand, rnd, rnd.get("scheduledBy") or "HR", attendees), media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="interview-round-{round_number}.ics"'})


@router.get("/recruitment/my-interviews")
async def my_interviews(user: dict = Depends(require_auth)):
    """Interviews the signed-in employee is on the panel of (their interview calendar)."""
    me = _my_emp_id(user)
    out = []
    for cand in modules_store.jobCandidates.values():
        for rnd in cand.get("interviewRounds") or []:
            if me and me in [p.get("employeeId") for p in rnd.get("panel") or []]:
                mine = (rnd.get("panelFeedback") or {}).get(me)
                out.append({
                    "candidateId": cand["_id"], "candidateName": cand.get("fullName"), "jobTitle": cand.get("jobTitle"),
                    "candidateStage": cand.get("stage"), "hasResume": bool(cand.get("resumeStoredFileName")),
                    "roundNumber": rnd.get("roundNumber"), "roundName": rnd.get("roundName"), "date": rnd.get("date"),
                    "time": rnd.get("time"), "durationMinutes": rnd.get("durationMinutes"), "mode": rnd.get("mode"),
                    "locationOrLink": rnd.get("locationOrLink"), "panel": [p.get("name") for p in rnd.get("panel") or []],
                    "myFeedback": mine, "feedbackLocked": bool(mine),
                })
    out.sort(key=lambda i: (i["date"] or "", i["time"] or ""), reverse=True)
    return {"interviews": out}


@router.post("/recruitment/candidates/{cand_id}/rounds/{round_number}/panel-feedback")
async def panel_feedback(cand_id: str, round_number: int, request: Request, user: dict = Depends(require_auth)):
    cand = _candidate_or_404(cand_id)
    me = _my_emp_id(user)
    rnd = next((r for r in cand.get("interviewRounds") or [] if r.get("roundNumber") == round_number), None)
    if not rnd:
        raise ApiError(404, "Interview round not found.")
    if not me or me not in [p.get("employeeId") for p in rnd.get("panel") or []]:
        raise ApiError(403, "Only members of this interview panel can give feedback.")
    if (rnd.get("panelFeedback") or {}).get(me):
        raise ApiError(409, "You have already submitted feedback for this interview. Submitted feedback is locked.")

    b = await read_body(request)
    rating = num(b.get("rating"))
    comments = s(b.get("comments") or "").strip()
    recommendation = b.get("recommendation") if b.get("recommendation") in ("STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE") else None
    if not is_finite_number(rating) or rating < 1 or rating > 5:
        raise ApiError(400, "Rating must be between 1 and 5.")
    if len(comments) < 10:
        raise ApiError(400, "Please write your feedback comments (at least 10 characters).")
    if not recommendation:
        raise ApiError(400, "Please choose a recommendation.")

    fb = {"rating": rating, "comments": comments, "recommendation": recommendation, "submittedAt": now_iso(),
          "submittedBy": _name(user), "employeeId": me, "locked": True}
    rnd.setdefault("panelFeedback", {})[me] = fb
    panel_ids = [p.get("employeeId") for p in rnd.get("panel") or []]
    if all(pid in rnd["panelFeedback"] for pid in panel_ids):
        rnd["status"] = "COMPLETED"
    _notify_roles(("HR",), "Interview feedback received",
                  f"{_name(user)} rated {cand.get('fullName')} {rating:g}/5 ({recommendation.replace('_', ' ').lower()}) for {rnd.get('roundName')}.")
    audit(user, "INTERVIEW_FEEDBACK_SUBMITTED", "RECRUITMENT", "Candidate", cand_id, {
        "candidate": cand.get("fullName"), "round": rnd.get("roundName"), "rating": rating, "recommendation": recommendation,
    })
    return {"success": True, "feedback": fb, "roundStatus": rnd.get("status"), "message": "Feedback saved and locked."}


@router.post("/recruitment/candidates/{cand_id}/feedback")
async def candidate_feedback(cand_id: str, request: Request, user: dict = Depends(require_auth)):
    """HR's decision after a round (next round / ready for offer / reject)."""
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can record the round decision.")
    cand = _candidate_or_404(cand_id)

    b = await read_body(request)
    justification = s(b.get("justification") or "").strip()
    comments = s(b.get("comments") or "").strip()
    notes = s(b.get("notes") or "").strip()
    rec = b.get("recommendation")
    recommendation = "REJECT" if rec == "REJECT" else ("READY_FOR_OFFER" if rec == "READY_FOR_OFFER" else "NEXT_ROUND")
    if not justification and not comments:
        raise ApiError(400, "Justification and interview feedback comments are required.")

    hr_name = _name(user)
    feedback = {k: v for k, v in {
        "round": js_str(b.get("round") or "Round 1: Technical Interview").strip(),
        "roundNumber": to_number(b.get("roundNumber"), 1),
        "rating": to_number(b.get("rating"), 4),
        "justification": justification or comments,
        "comments": comments or justification,
        "notes": notes or None,
        "recommendation": recommendation,
        "submittedAt": now_iso(),
        "submittedBy": hr_name,
    }.items() if v is not None}

    if recommendation == "REJECT":
        return await _reject(cand, user, justification or comments, notify=True)
    updated = modules_store.add_candidate_feedback(cand["_id"], feedback)
    if recommendation == "READY_FOR_OFFER" and not (cand.get("offer") or {}).get("status") in ACTIVE_OFFER:
        cand["stage"] = "HR_INTERVIEW"  # cleared; the offer has not gone out yet
    return {"success": True, "candidate": _present_candidate(user, updated), "email": None}


# --------------------------------------------------------------------- offers

def _band(job: Optional[dict]) -> tuple:
    job = job or {}
    lo, hi = job.get("salaryBandMin"), job.get("salaryBandMax")
    if hi is None and job.get("requisitionId"):
        r = modules_store.requirements.get(job["requisitionId"]) or {}
        lo, hi = r.get("budgetMin"), r.get("budgetMax")
    return lo, hi


async def _send_offer_mail(cand: dict, offer: dict, job: Optional[dict], sender_name: str) -> dict:
    mail = build_offer_email({
        "candidateName": cand.get("fullName"), "jobTitle": offer["designation"], "department": (job or {}).get("department") or "General",
        "annualCtc": offer["annualCtc"], "joiningDate": offer["joiningDate"], "validTill": offer["validTill"],
        "location": offer["location"], "reportingTo": offer.get("reportingTo"), "notes": offer.get("notes"), "hrName": sender_name,
    })
    if offer.get("version", 1) > 1:
        mail["subject"] = f"Revised offer (v{offer['version']}) - " + mail["subject"]
    result = await send_mail({"to": cand["email"], **mail})
    offer.update({"status": "SENT", "sentAt": now_iso(), "sentTo": cand["email"], "sentFrom": sender_address(),
                  "emailStatus": _email_status(result)})
    return result


@router.post("/recruitment/candidates/{cand_id}/extend-offer")
async def extend_offer(cand_id: str, request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can generate offers.")
    cand = _candidate_or_404(cand_id)
    if cand.get("stage") not in ("SHORTLISTED", "TECHNICAL_INTERVIEW", "HR_INTERVIEW", "OFFERED"):
        raise ApiError(400, "An offer can only be generated for a candidate who has reached the interview stage.")
    if not _EMAIL_RE.match(cand.get("email") or ""):
        raise ApiError(400, "This candidate does not have a valid e-mail address. Update it first.")

    b = await read_body(request)
    annual_ctc = num(b.get("annualCtc"))
    joining_date, valid_till = s(b.get("joiningDate") or ""), s(b.get("validTill") or "")
    designation = js_str(b.get("designation") or cand.get("jobTitle")).strip()
    job = modules_store.jobOpenings.get(cand.get("jobId"))
    location = js_str(b.get("location") or (job or {}).get("location") or "Head Office").strip()

    if not is_finite_number(annual_ctc) or annual_ctc < 100000 or annual_ctc > 100000000:
        raise ApiError(400, "Enter the annual CTC in rupees (between 1,00,000 and 10,00,00,000).")
    if not _DATE_RE.match(joining_date):
        raise ApiError(400, "Date of joining is required.")
    if not _DATE_RE.match(valid_till):
        raise ApiError(400, "Offer validity date is required.")
    if valid_till >= joining_date:
        raise ApiError(400, "Offer must expire before the date of joining.")
    if not designation:
        raise ApiError(400, "Designation is required.")

    offers = cand.setdefault("offers", [])
    if not offers and cand.get("offer"):  # an older single offer becomes version 1 of the history
        offers.append({**cand["offer"], "version": 1, "status": cand["offer"].get("status") or "SENT"})
    active = next((o for o in reversed(offers) if o.get("status") in ACTIVE_OFFER), None)
    revision_reason = _opt_trim(b.get("revisionReason"))
    if active and not revision_reason:
        raise ApiError(400, "This candidate already has an offer. Enter the reason for the revision.")

    lo, hi = _band(job)
    above_band = hi is not None and annual_ctc > hi
    hr_name = _name(user)
    offer = {k: v for k, v in {
        "version": len(offers) + 1, "annualCtc": annual_ctc, "designation": designation, "joiningDate": joining_date,
        "validTill": valid_till, "location": location, "reportingTo": _opt_trim(b.get("reportingTo")) or (job or {}).get("hiringManagerName"),
        "notes": _opt_trim(b.get("notes")), "salaryBandMin": lo, "salaryBandMax": hi, "aboveBand": above_band,
        "revisionReason": revision_reason, "createdAt": now_iso(), "extendedBy": hr_name, "extendedByUserId": user["_id"],
        "status": "PENDING_APPROVAL" if above_band else "SENT",
    }.items() if v is not None}
    if active:
        active["status"] = "SUPERSEDED"
        active["supersededAt"] = now_iso()

    result = None
    if above_band:
        _notify_roles(APPROVER_ROLES, "Offer above salary band needs approval",
                      f"{cand.get('fullName')} - {designation}: CTC ₹{annual_ctc:,.0f} exceeds the band maximum ₹{hi:,.0f}.",
                      exclude_user_id=user["_id"])
        message = (f"CTC ₹{annual_ctc:,.0f} is above the salary band (max ₹{hi:,.0f}). The offer was sent to Finance / "
                   f"Super Admin for approval and will be e-mailed once approved.")
    else:
        result = await _send_offer_mail(cand, offer, job, hr_name)
        message = (f"Offer v{offer['version']} e-mailed from {offer['sentFrom']} to {cand['email']}"
                   + (" (simulated: no mail provider configured)." if result.get("simulated") else "."))
    offers.append(offer)
    cand["offer"] = offer
    if not above_band:
        cand["stage"] = "OFFERED"

    audit(user, "OFFER_REVISED" if active else "OFFER_GENERATED", "RECRUITMENT", "Candidate", cand["_id"], {
        "candidate": cand.get("fullName"), "version": offer["version"], "annualCtc": annual_ctc, "band": [lo, hi],
        "status": offer["status"], "revisionReason": revision_reason,
    })
    return {"success": True, "candidate": _present_candidate(user, cand), "offer": offer, "email": result, "message": message,
            "requiresApproval": above_band}


@router.post("/recruitment/candidates/{cand_id}/offer/approve")
async def approve_offer(cand_id: str, request: Request, user: dict = Depends(require_role(*APPROVER_ROLES))):
    cand = _candidate_or_404(cand_id)
    offer = cand.get("offer") or {}
    if offer.get("status") != "PENDING_APPROVAL":
        raise ApiError(400, "There is no offer waiting for approval for this candidate.")
    if offer.get("extendedByUserId") == user["_id"]:
        raise ApiError(403, "You generated this offer, so a different Finance / management approver must approve it.")
    b = await read_body(request)
    decision = b.get("decision")
    comment = _opt_trim(b.get("comment"))
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Please add a comment explaining the rejection.")
    offer["approval"] = {k: v for k, v in {"decision": decision, "by": _name(user), "role": user.get("role"), "at": now_iso(), "comment": comment}.items() if v is not None}

    result = None
    if decision == "APPROVED":
        result = await _send_offer_mail(cand, offer, modules_store.jobOpenings.get(cand.get("jobId")), offer.get("extendedBy") or _name(user))
        cand["stage"] = "OFFERED"
    else:
        offer["status"] = "APPROVAL_REJECTED"
    _notify_roles(("HR",), f"Above-band offer {decision.lower()}",
                  f"{cand.get('fullName')}: offer v{offer.get('version')} was {decision.lower()} by {_name(user)}" + (f": {comment}" if comment else "."))
    audit(user, f"OFFER_{decision}", "RECRUITMENT", "Candidate", cand_id, {"candidate": cand.get("fullName"), "version": offer.get("version"), "comment": comment})
    return {"success": True, "candidate": _present_candidate(user, cand), "offer": offer, "email": result}


@router.post("/recruitment/candidates/{cand_id}/offer/respond")
async def offer_response(cand_id: str, request: Request, user: dict = Depends(require_auth)):
    """HR records the candidate's answer to the offer."""
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can record the candidate's response.")
    cand = _candidate_or_404(cand_id)
    offer = cand.get("offer") or {}
    if offer.get("status") != "SENT":
        raise ApiError(400, "There is no sent offer to accept or decline.")
    b = await read_body(request)
    response = b.get("response")
    if response not in ("ACCEPTED", "DECLINED"):
        raise ApiError(400, "Response must be ACCEPTED or DECLINED.")
    offer["status"] = response
    offer["respondedAt"] = now_iso()
    if _opt_trim(b.get("comment")):
        offer["responseComment"] = _opt_trim(b.get("comment"))
    audit(user, f"OFFER_{response}", "RECRUITMENT", "Candidate", cand_id, {"candidate": cand.get("fullName"), "version": offer.get("version")})
    return {"success": True, "candidate": _present_candidate(user, cand)}


# ---------------------------------------------------- hire into Core HR

@router.post("/recruitment/candidates/{cand_id}/convert-to-employee")
async def convert_to_employee(cand_id: str, request: Request, user: dict = Depends(require_role(*MASTER_WRITE_ROLES))):
    from app.routes.employees import _create_records, _identity_index, _validate_new  # avoids a circular import

    cand = _candidate_or_404(cand_id)
    if cand.get("employeeId"):
        raise ApiError(400, "This candidate has already been converted to an employee.")
    offer = cand.get("offer") or {}
    if offer.get("status") != "ACCEPTED":
        raise ApiError(400, "Mark the offer as accepted before converting the candidate to an employee.")
    job = modules_store.jobOpenings.get(cand.get("jobId")) or {}
    b = await read_body(request)

    parts = (cand.get("fullName") or "").strip().split()
    first, last = (parts[0], " ".join(parts[1:])) if len(parts) > 1 else ((parts[0] if parts else ""), "-")
    locs = {(loc.get("name") or "").lower() for loc in db_store.locations.values()}
    payload = {
        "firstName": b.get("firstName") or first,
        "lastName": b.get("lastName") or last,
        "workEmail": b.get("workEmail"),
        "personalEmail": cand.get("email"),
        "phone": b.get("phone") or cand.get("phone"),
        "department": b.get("department") or job.get("department"),
        "designation": b.get("designation") or offer.get("designation") or cand.get("jobTitle"),
        "joiningDate": b.get("joiningDate") or offer.get("joiningDate"),
        "employmentType": job.get("type") or "FULL_TIME",
        "annualSalary": offer.get("annualCtc"),
        "reportingManagerId": b.get("reportingManagerId") or job.get("hiringManagerId"),
        "location": b.get("location") or (offer.get("location") if (offer.get("location") or "").lower() in locs else None),
        "panNumber": b.get("panNumber"),
        "aadhaarNumber": b.get("aadhaarNumber"),
        "grade": b.get("grade"),
    }
    payload = {k: v for k, v in payload.items() if v not in (None, "")}
    clean, errors = _validate_new(payload, _identity_index())
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the highlighted fields.", errors=errors)

    new_user, new_emp, _ = _create_records(user, clean)
    cand.update({"stage": "HIRED", "employeeId": new_emp["_id"], "employeeCode": new_emp["employeeCode"], "hiredAt": now_iso()})
    offer["status"] = "JOINED"
    for ref in modules_store.referrals.values():
        if ref.get("candidateId") == cand_id:
            ref["status"] = "HIRED"
            _notify_employee(ref.get("referredById"), "Your referral was hired", f"{cand.get('fullName')} has joined. Thank you!")
    audit(user, "CANDIDATE_HIRED", "RECRUITMENT", "Candidate", cand_id, {
        "candidate": cand.get("fullName"), "employeeCode": new_emp["employeeCode"], "employeeId": new_emp["_id"],
    })
    invite = await issue_invite(request, new_user, new_emp, user, False)
    return {"success": True, "candidate": _present_candidate(user, cand), "employee": new_emp, "invite": invite,
            "message": f"{cand.get('fullName')} is now employee {new_emp['employeeCode']}. Onboarding invite sent to {invite.get('sentTo')}."}


# ------------------------------------------------------------ reject / archive

async def _reject(cand: dict, user: dict, reason: str, notify: bool) -> dict:
    if cand.get("stage") == "HIRED":
        raise ApiError(400, "Cannot reject a candidate who has already been hired.")
    email_result = None
    if notify and _EMAIL_RE.match(cand.get("email") or ""):
        try:
            mail = build_rejection_email({"candidateName": cand.get("fullName"), "jobTitle": cand.get("jobTitle") or "Open Position", "hrName": _name(user)})
            email_result = await send_mail({"to": cand["email"], **mail})
        except Exception as err:  # noqa: BLE001
            print("[Recruitment] Rejection email error:", err)

    previous = cand.get("stage")
    cand.update({
        "stage": "REJECTED", "rejectionReason": reason, "rejectedBy": _name(user), "rejectedAt": now_iso(),
        "archived": True, "archivedAt": now_iso(), "retainUntil": (date.today() + timedelta(days=RETENTION_DAYS)).isoformat(),
        "candidateNotified": bool(email_result and (email_result.get("delivered") or email_result.get("simulated"))),
    })
    if (cand.get("offer") or {}).get("status") in ACTIVE_OFFER:
        cand["offer"]["status"] = "WITHDRAWN"
    for ref in modules_store.referrals.values():
        if ref.get("candidateId") == cand["_id"]:
            ref["status"] = "NOT_SELECTED"
    audit(user, "CANDIDATE_REJECTED", "RECRUITMENT", "Candidate", cand["_id"], {
        "candidate": cand.get("fullName"), "reason": reason, "previousStage": previous, "candidateNotified": cand["candidateNotified"],
        "archivedUntil": cand["retainUntil"],
    })
    msg = f"{cand.get('fullName')} rejected and archived (kept until {cand['retainUntil']})." + (
        " Rejection e-mail sent." if cand["candidateNotified"] else " Candidate was not e-mailed.")
    return {"success": True, "candidate": _present_candidate(user, cand), "email": email_result, "message": msg}


@router.post("/recruitment/candidates/{cand_id}/reject")
async def reject_candidate(cand_id: str, request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can reject candidates.")
    cand = _candidate_or_404(cand_id)
    b = await read_body(request)
    reason = s(b.get("reason") or "").strip()
    if len(reason) < 5:
        raise ApiError(400, "Please enter the reason for rejection.")
    return await _reject(cand, user, reason, notify=b.get("notifyCandidate") is not False)


@router.put("/recruitment/candidates/{cand_id}/stage")
async def update_candidate_stage(cand_id: str, request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can move candidates between stages.")
    body = await read_body(request)
    if body.get("stage") not in CANDIDATE_STAGES or body.get("stage") in ("HIRED", "REJECTED"):
        raise ApiError(400, "Invalid stage. Use reject / convert to employee for those steps.")
    updated = modules_store.update_candidate_stage(cand_id, body.get("stage"))
    if not updated:
        raise ApiError(404, "Candidate not found.")
    return {"success": True, "candidate": _present_candidate(user, updated)}


# --------------------------------------------------------------- referrals

def _referral_view(user: dict, r: dict) -> dict:
    item = dict(r)
    item["isMine"] = True if not _is_recruiter(user) else r.get("referredById") in (user.get("employeeId"), user["_id"])
    item["canViewPrivate"] = True
    item["hasResume"] = bool(r.get("storedFileName"))
    item.pop("storedFileName", None)
    if not _is_recruiter(user):
        # The referrer sees the status of their referral only, never the interview details
        item.pop("candidateId", None)
    return item


@router.get("/recruitment/referrals")
async def list_referrals(user: dict = Depends(require_auth)):
    mine = (user.get("employeeId"), user["_id"])
    items = [r for r in modules_store.referrals.values() if _is_recruiter(user) or r.get("referredById") in mine]
    items.sort(key=lambda r: date_ms(r.get("createdAt")), reverse=True)
    return {"referrals": [_referral_view(user, r) for r in items]}


@router.post("/recruitment/referrals")
async def create_referral(request: Request, user: dict = Depends(require_auth)):
    body, files = await read_fields_and_files(request)
    upload = (files.get("resume") or [None])[0]
    if upload is not None:
        await _check_resume(upload)

    full_name = s(body.get("fullName") or "").strip()
    email = s(body.get("email") or "").strip().lower()
    city = s(body.get("city") or "").strip()
    experience_years = num(body.get("experienceYears"))

    if not full_name or not city or not email:
        raise ApiError(400, "Name, email and city are required.")
    if not _EMAIL_RE.match(email):
        raise ApiError(400, "Please enter a valid email address.")
    if not is_finite_number(experience_years) or experience_years < 0 or experience_years > 60:
        raise ApiError(400, "Years of experience must be a number between 0 and 60.")
    if upload is None:
        raise ApiError(400, "Please attach the candidate's resume.")
    phone = _opt_trim(body.get("phone"))
    if any((r.get("email") or "").lower() == email or (phone and _digits(r.get("phone")) == _digits(phone) and len(_digits(phone)) >= 10)
           for r in modules_store.referrals.values()) or _find_duplicate(email, phone or ""):
        raise ApiError(409, "This person has already been referred or is already in our candidate pipeline.")

    saved = await save_upload(upload, RESUMES, lower_ext=True)
    job = modules_store.jobOpenings.get(js_str(body["jobId"])) if truthy(body.get("jobId")) else None

    referral = modules_store.create_referral(user, {
        "fullName": full_name, "email": email, "phone": phone, "city": city, "experienceYears": experience_years,
        "jobId": (job or {}).get("_id"), "jobTitle": (job or {}).get("title"), "relationship": _opt_trim(body.get("relationship")),
        "notes": _opt_trim(body.get("notes")), "resumeFileName": upload.filename, "storedFileName": saved["storedFileName"],
    })
    audit(user, "REFERRAL_SUBMITTED", "RECRUITMENT", "Referral", referral["_id"], {
        "candidate": full_name, "city": city, "experienceYears": experience_years, "job": (job or {}).get("title") or "General",
    })
    return JSONResponse({"success": True, "referral": {"_id": referral["_id"]}}, status_code=201)


@router.get("/recruitment/referrals/{ref_id}/resume")
async def referral_resume(ref_id: str, user: dict = Depends(require_auth)):
    r = modules_store.referrals.get(ref_id)
    if not r or not r.get("storedFileName"):
        raise ApiError(404, "Resume not found.")
    if not (_is_recruiter(user) or r.get("referredById") in (user.get("employeeId"), user["_id"])):
        raise ApiError(403, "Only HR or the referrer can view this resume.")
    response = await stored_file_response(RESUMES, r["storedFileName"], r.get("resumeFileName") or "resume.pdf")
    if not response:
        raise ApiError(404, "Resume file is missing on the server.")
    return response


@router.put("/recruitment/referrals/{ref_id}/status")
async def referral_status(ref_id: str, request: Request, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can update referral status.")
    body = await read_body(request)
    status = body.get("status")
    if status not in ("SUBMITTED", "IN_REVIEW", "SHORTLISTED", "HIRED", "NOT_SELECTED"):
        raise ApiError(400, "Invalid referral status.")
    if not modules_store.update_referral_status(ref_id, status):
        raise ApiError(404, "Referral not found.")
    r = modules_store.referrals[ref_id]
    _notify_employee(r.get("referredById"), "Referral status updated", f"{r.get('fullName')}: {status.replace('_', ' ').lower()}.")
    return {"success": True}


@router.post("/recruitment/referrals/{ref_id}/convert")
async def convert_referral(ref_id: str, user: dict = Depends(require_auth)):
    if not _is_recruiter(user):
        raise ApiError(403, "Only HR can move referrals into the pipeline.")
    ref = modules_store.referrals.get(ref_id)
    if not ref:
        raise ApiError(404, "Referral not found.")
    if ref.get("candidateId") and ref["candidateId"] in modules_store.jobCandidates:
        raise ApiError(409, "This referral is already in the candidate pipeline.")
    dup = _find_duplicate(ref.get("email") or "", ref.get("phone") or "")
    if dup:
        raise _duplicate_error(dup)
    candidate = modules_store.convert_to_candidate(ref_id)
    candidate.update({"source": "REFERRAL", "referralId": ref_id})
    if ref.get("storedFileName"):
        candidate["resumeStoredFileName"] = ref["storedFileName"]
        candidate["resumeFileName"] = ref.get("resumeFileName")
    ref["candidateId"] = candidate["_id"]
    _notify_employee(ref.get("referredById"), "Referral status updated", f"{ref.get('fullName')} has been shortlisted for review.")
    audit(user, "REFERRAL_CONVERTED", "RECRUITMENT", "Candidate", candidate["_id"], {"candidate": ref.get("fullName")})
    return {"success": True, "candidate": _present_candidate(user, candidate)}
