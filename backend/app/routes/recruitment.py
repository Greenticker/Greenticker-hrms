import re
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import RESUMES_DIR, audit, read_body, read_fields_and_files, save_upload
from app.services.mailer import build_interview_email, build_offer_email, build_rejection_email, send_mail
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import date_ms, is_finite_number, js_str, now_iso, now_ms, num, s, to_number, today_str, truthy

router = APIRouter()

_EMAIL_RE = re.compile(r"^\S+@\S+\.\S+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")
RESUME_EXTENSIONS = (".pdf", ".doc", ".docx")
CONFIDENTIAL = "[Confidential - Visible only to HR and Admin]"


def _email_status(result: dict) -> str:
    return "SENT" if result.get("delivered") else ("SIMULATED" if result.get("simulated") else "FAILED")


def _email_word(result: dict) -> str:
    return "sent" if result.get("delivered") else ("simulated" if result.get("simulated") else "failed")


def _opt_trim(v) -> Optional[str]:
    return js_str(v).strip() if truthy(v) else None


# -------------------------------------------------------------------- jobs

@router.get("/recruitment/jobs")
async def list_jobs(_: dict = Depends(require_auth)):
    return {"jobs": modules_store.get_job_openings()}


@router.post("/recruitment/jobs")
async def create_job(request: Request, _: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    title, department = body.get("title"), body.get("department")
    if not truthy(title) or not truthy(department):
        raise ApiError(400, "Job title and department are required.")
    skills = body.get("skillsRequired") if body.get("skillsRequired") is not None else []

    job_id = f"job_{now_ms()}"
    job = {
        "_id": job_id,
        "title": js_str(title).strip(),
        "department": js_str(department).strip(),
        "location": body.get("location") or "San Francisco HQ",
        "type": body.get("type") if body.get("type") is not None else "FULL_TIME",
        "experienceRequired": body.get("experienceRequired") or "2-4 years",
        "openingsCount": num(body.get("openingsCount") if body.get("openingsCount") is not None else 1),
        "status": "OPEN",
        "postedDate": today_str(),
        "description": body.get("description") or "",
        "skillsRequired": skills if isinstance(skills, list) else [],
    }
    modules_store.jobOpenings[job_id] = job
    return JSONResponse({"success": True, "job": job}, status_code=201)


@router.get("/recruitment/candidates")
async def list_candidates(jobId: Optional[str] = None, user: dict = Depends(require_role("ADMIN", "HR", "MANAGER", "FINANCE"))):
    candidates = modules_store.get_job_candidates(jobId)
    if user.get("role") in ("ADMIN", "HR"):
        return {"candidates": candidates}

    # Justification is visible to everyone; comments and notes only to HR & Admin.
    def redact(fb: dict) -> dict:
        out = {**fb, "comments": CONFIDENTIAL}
        out.pop("notes", None)
        return out

    sanitized = []
    for cand in candidates:
        c = dict(cand)
        if c.get("interviewFeedbacks"):
            c["interviewFeedbacks"] = [redact(fb) for fb in c["interviewFeedbacks"]]
        if c.get("interviewRounds"):
            c["interviewRounds"] = [{**r, "feedback": redact(r["feedback"])} if r.get("feedback") else r for r in c["interviewRounds"]]
        sanitized.append(c)
    return {"candidates": sanitized}


# ------------------------------------------------------------ requirements

@router.get("/recruitment/requirements")
async def list_requirements(user: dict = Depends(require_role("ADMIN"))):
    return {"requirements": modules_store.get_requirements(user)}


@router.post("/recruitment/requirements")
async def create_requirement(request: Request, user: dict = Depends(require_role("ADMIN"))):
    b = await read_body(request)
    title = s(b.get("title") or "").strip()
    justification = s(b.get("justification") or "").strip()
    positions = num(b.get("positions"))
    my_emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
    department = s(b.get("department") or (my_emp or {}).get("department") or "").strip()

    if not title:
        raise ApiError(400, "Role / position title is required.")
    if not department:
        raise ApiError(400, "Department is required.")
    if not isinstance(positions, int) or isinstance(positions, bool) or positions < 1 or positions > 100:
        raise ApiError(400, "Number of positions must be a whole number between 1 and 100.")
    if not justification:
        raise ApiError(400, "Please describe your requirement / justification.")

    raw_skills = b.get("skillsRequired")
    skills = raw_skills if isinstance(raw_skills, list) else s(raw_skills or "").split(",")

    requirement = modules_store.create_requirement(user, {
        "title": title,
        "department": department,
        "positions": positions,
        "employmentType": b.get("employmentType") if b.get("employmentType") in ("FULL_TIME", "PART_TIME", "CONTRACT") else "FULL_TIME",
        "experienceRequired": s(b.get("experienceRequired") or "").strip() or "Not specified",
        "skillsRequired": [js_str(x).strip() for x in skills if js_str(x).strip()],
        "priority": b.get("priority") if b.get("priority") in ("LOW", "MEDIUM", "HIGH", "URGENT") else "MEDIUM",
        "expectedJoiningDate": js_str(b["expectedJoiningDate"]) if truthy(b.get("expectedJoiningDate")) else None,
        "budgetRange": _opt_trim(b.get("budgetRange")),
        "location": _opt_trim(b.get("location")),
        "justification": justification,
    })

    audit(user, "REQUIREMENT_SUBMITTED", "RECRUITMENT", "Requirement", requirement["_id"], {
        "title": title, "department": department, "positions": positions, "priority": requirement.get("priority"),
    })
    return JSONResponse({"success": True, "requirement": requirement}, status_code=201)


@router.put("/recruitment/requirements/{req_id}/review")
async def review_requirement(req_id: str, request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    decision = s(body.get("decision") or "")
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    result = modules_store.review_requirement(
        req_id, decision, f"{user.get('firstName')} {user.get('lastName')}".strip(), _opt_trim(body.get("note"))
    )
    if not result:
        raise ApiError(404, "Requirement not found.")

    job = result.get("job")
    details = {"title": result["requirement"].get("title")}
    if job:
        details["jobCreated"] = job["_id"]
    audit(user, f"REQUIREMENT_{decision}", "RECRUITMENT", "Requirement", result["requirement"]["_id"], details)

    payload = {"success": True, "requirement": result["requirement"]}
    if job:
        payload["job"] = job
    return payload


# ---------------------------------------------------- candidate pipeline

@router.post("/recruitment/candidates/{cand_id}/schedule-interview")
async def schedule_interview(cand_id: str, request: Request, user: dict = Depends(require_role("ADMIN", "HR"))):
    cand = modules_store.jobCandidates.get(cand_id)
    if not cand:
        raise ApiError(404, "Candidate not found.")
    if cand.get("stage") in ("HIRED", "REJECTED"):
        raise ApiError(400, f"Cannot schedule an interview for a candidate who is {cand['stage'].lower()}.")
    if not _EMAIL_RE.match(cand.get("email") or ""):
        raise ApiError(400, "This candidate does not have a valid e-mail address.")

    b = await read_body(request)
    date = s(b.get("date") or "")
    time = s(b.get("time") or "")
    interviewer = s(b.get("interviewer") or "").strip()
    mode = b.get("mode") if b.get("mode") in ("IN_PERSON", "VIDEO", "PHONE") else "VIDEO"
    location_or_link = s(b.get("locationOrLink") or "").strip()
    duration = to_number(b.get("durationMinutes"), 45)
    rounds_count = len(cand.get("interviewRounds") or [])
    round_number = to_number(b.get("roundNumber")) or (rounds_count + 1)
    round_name = js_str(b.get("roundName") or f"Round {js_str(round_number)}: Interview").strip()

    if not _DATE_RE.match(date):
        raise ApiError(400, "Interview date is required.")
    if not _TIME_RE.match(time):
        raise ApiError(400, "Interview time is required.")
    if date_ms(f"{date}T{time}:00") < now_ms() - 60 * 1000:
        raise ApiError(400, "Interview date and time must be in the future.")
    if not interviewer:
        raise ApiError(400, "Interviewer name is required.")
    if not location_or_link:
        raise ApiError(400, {"IN_PERSON": "Venue is required.", "VIDEO": "Meeting link is required."}.get(mode, "Contact number is required."))

    hr_name = f"{user.get('firstName')} {user.get('lastName')}".strip()
    notes = _opt_trim(b.get("notes"))
    mail = build_interview_email({
        "candidateName": cand.get("fullName"),
        "jobTitle": f"{cand.get('jobTitle')} ({round_name})",
        "date": date,
        "time": time,
        "durationMinutes": duration,
        "mode": mode,
        "locationOrLink": location_or_link,
        "interviewer": interviewer,
        "notes": notes,
        "hrName": hr_name,
    })
    result = await send_mail({"to": cand["email"], **mail})

    interview = {
        "date": date,
        "time": time,
        "durationMinutes": duration,
        "mode": mode,
        "locationOrLink": location_or_link,
        "interviewer": interviewer,
        "roundName": round_name,
        "roundNumber": round_number,
        "notes": notes,
        "emailSentAt": now_iso(),
        "emailStatus": _email_status(result),
        "scheduledBy": hr_name,
    }
    updated = modules_store.set_candidate_interview(cand["_id"], {k: v for k, v in interview.items() if v is not None})

    audit(user, "INTERVIEW_SCHEDULED", "RECRUITMENT", "Candidate", cand["_id"], {
        "candidate": cand.get("fullName"),
        "roundName": round_name,
        "roundNumber": round_number,
        "date": date,
        "time": time,
        "mode": mode,
        "email": _email_word(result),
    })
    ok = result.get("delivered") or result.get("simulated")
    return {
        "success": True,
        "candidate": updated,
        "email": result,
        "message": f"{round_name} scheduled and invitation e-mailed to {cand['email']}."
        if ok else f"{round_name} scheduled, but the e-mail could not be sent: {result.get('error')}",
    }


@router.post("/recruitment/candidates/{cand_id}/feedback")
async def candidate_feedback(cand_id: str, request: Request, user: dict = Depends(require_role("ADMIN", "HR"))):
    cand = modules_store.jobCandidates.get(cand_id)
    if not cand:
        raise ApiError(404, "Candidate not found.")

    b = await read_body(request)
    justification = s(b.get("justification") or "").strip()
    comments = s(b.get("comments") or "").strip()
    notes = s(b.get("notes") or "").strip()
    rec = b.get("recommendation")
    recommendation = "REJECT" if rec == "REJECT" else ("READY_FOR_OFFER" if rec == "READY_FOR_OFFER" else "NEXT_ROUND")
    if not justification and not comments:
        raise ApiError(400, "Justification and interview feedback comments are required.")

    hr_name = f"{user.get('firstName')} {user.get('lastName')}".strip()
    feedback = {
        "round": js_str(b.get("round") or "Round 1: Technical Interview").strip(),
        "roundNumber": to_number(b.get("roundNumber"), 1),
        "rating": to_number(b.get("rating"), 4),
        "justification": justification or comments,
        "comments": comments or justification,
        "notes": notes or None,
        "recommendation": recommendation,
        "submittedAt": now_iso(),
        "submittedBy": hr_name,
    }
    feedback = {k: v for k, v in feedback.items() if v is not None}

    email_result = None
    if recommendation == "REJECT" and _EMAIL_RE.match(cand.get("email") or ""):
        try:
            mail = build_rejection_email({"candidateName": cand.get("fullName"), "jobTitle": cand.get("jobTitle") or "Open Position", "hrName": hr_name})
            email_result = await send_mail({"to": cand["email"], **mail})
        except Exception as err:  # noqa: BLE001
            print("[Recruitment] Rejection email error:", err)

    updated = modules_store.add_candidate_feedback(cand["_id"], feedback)
    return {"success": True, "candidate": updated, "email": email_result}


@router.post("/recruitment/candidates/{cand_id}/extend-offer")
async def extend_offer(cand_id: str, request: Request, user: dict = Depends(require_role("ADMIN", "HR"))):
    cand = modules_store.jobCandidates.get(cand_id)
    if not cand:
        raise ApiError(404, "Candidate not found.")
    if cand.get("stage") not in ("TECHNICAL_INTERVIEW", "HR_INTERVIEW", "OFFERED"):
        raise ApiError(400, "An offer can only be extended to a candidate who has reached the interview stage.")
    if not _EMAIL_RE.match(cand.get("email") or ""):
        raise ApiError(400, "This candidate does not have a valid e-mail address.")

    b = await read_body(request)
    annual_ctc = num(b.get("annualCtc"))
    joining_date = s(b.get("joiningDate") or "")
    valid_till = s(b.get("validTill") or "")
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

    hr_name = f"{user.get('firstName')} {user.get('lastName')}".strip()
    reporting_to = _opt_trim(b.get("reportingTo"))
    notes = _opt_trim(b.get("notes"))
    mail = build_offer_email({
        "candidateName": cand.get("fullName"),
        "jobTitle": designation,
        "department": (job or {}).get("department") or "General",
        "annualCtc": annual_ctc,
        "joiningDate": joining_date,
        "validTill": valid_till,
        "location": location,
        "reportingTo": reporting_to,
        "notes": notes,
        "hrName": hr_name,
    })
    result = await send_mail({"to": cand["email"], **mail})

    offer = {
        "annualCtc": annual_ctc,
        "designation": designation,
        "joiningDate": joining_date,
        "validTill": valid_till,
        "location": location,
        "reportingTo": reporting_to,
        "notes": notes,
        "emailSentAt": now_iso(),
        "emailStatus": _email_status(result),
        "extendedBy": hr_name,
    }
    updated = modules_store.set_candidate_offer(cand["_id"], {k: v for k, v in offer.items() if v is not None})

    audit(user, "OFFER_EXTENDED", "RECRUITMENT", "Candidate", cand["_id"], {
        "candidate": cand.get("fullName"), "designation": designation, "joiningDate": joining_date, "email": _email_word(result),
    })
    ok = result.get("delivered") or result.get("simulated")
    return {
        "success": True,
        "candidate": updated,
        "email": result,
        "message": f"Offer letter e-mailed to {cand['email']}." if ok else f"Offer recorded, but the e-mail could not be sent: {result.get('error')}",
    }


@router.post("/recruitment/candidates/{cand_id}/reject")
async def reject_candidate(cand_id: str, user: dict = Depends(require_role("ADMIN", "HR"))):
    cand = modules_store.jobCandidates.get(cand_id) or next(
        (c for c in modules_store.jobCandidates.values() if c.get("_id") == cand_id), None
    )
    if not cand:
        raise ApiError(404, "Candidate not found.")
    if cand.get("stage") == "HIRED":
        raise ApiError(400, "Cannot reject a candidate who has already been hired.")

    hr_name = f"{user.get('firstName')} {user.get('lastName')}".strip()
    email_result = None
    try:
        if _EMAIL_RE.match(cand.get("email") or ""):
            mail = build_rejection_email({"candidateName": cand.get("fullName"), "jobTitle": cand.get("jobTitle") or "Open Position", "hrName": hr_name})
            email_result = await send_mail({"to": cand["email"], **mail})
    except Exception as err:  # noqa: BLE001
        print("[Recruitment] Rejection email error:", err)

    updated = modules_store.update_candidate_stage(cand["_id"], "REJECTED")
    details = {"candidate": cand.get("fullName")}
    if email_result is not None:
        details["emailDelivered"] = email_result.get("delivered")
    audit(user, "CANDIDATE_REJECTED", "RECRUITMENT", "Candidate", cand["_id"], details)
    return {"success": True, "candidate": updated, "email": email_result}


@router.put("/recruitment/candidates/{cand_id}/stage")
async def update_candidate_stage(cand_id: str, request: Request, _: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    updated = modules_store.update_candidate_stage(cand_id, body.get("stage"))
    if not updated:
        raise ApiError(404, "Candidate not found.")
    return {"success": True, "candidate": updated}


# --------------------------------------------------------------- referrals

@router.get("/recruitment/referrals")
async def list_referrals(user: dict = Depends(require_auth)):
    return {"referrals": modules_store.get_referrals(user)}


@router.post("/recruitment/referrals")
async def create_referral(request: Request, user: dict = Depends(require_auth)):
    body, files = await read_fields_and_files(request)
    upload = (files.get("resume") or [None])[0]
    if upload is not None:
        ext = ("." + upload.filename.rsplit(".", 1)[-1].lower()) if "." in upload.filename else ""
        if ext not in RESUME_EXTENSIONS:
            raise ApiError(400, "Resume must be a PDF, DOC or DOCX file.")
        if (upload.size or 0) > 5 * 1024 * 1024:
            raise ApiError(400, "Resume must be 5 MB or smaller.")

    full_name = s(body.get("fullName") or "").strip()
    email = s(body.get("email") or "").strip()
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

    saved = await save_upload(upload, RESUMES_DIR, 5 * 1024 * 1024, lower_ext=True)
    job = modules_store.jobOpenings.get(js_str(body["jobId"])) if truthy(body.get("jobId")) else None

    referral = modules_store.create_referral(user, {
        "fullName": full_name,
        "email": email,
        "phone": _opt_trim(body.get("phone")),
        "city": city,
        "experienceYears": experience_years,
        "jobId": (job or {}).get("_id"),
        "jobTitle": (job or {}).get("title"),
        "relationship": _opt_trim(body.get("relationship")),
        "notes": _opt_trim(body.get("notes")),
        "resumeFileName": upload.filename,
        "storedFileName": saved["storedFileName"],
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
    if not (user.get("role") == "ADMIN" or r.get("referredById") == user["_id"]):
        raise ApiError(403, "Only HR or the referrer can view this resume.")
    physical = RESUMES_DIR / r["storedFileName"]
    if not physical.is_file():
        raise ApiError(404, "Resume file is missing on the server.")
    return FileResponse(physical, filename=r.get("resumeFileName") or "resume.pdf")


@router.put("/recruitment/referrals/{ref_id}/status")
async def referral_status(ref_id: str, request: Request, _: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    status = body.get("status")
    if status not in ("SUBMITTED", "IN_REVIEW", "SHORTLISTED", "HIRED", "NOT_SELECTED"):
        raise ApiError(400, "Invalid referral status.")
    if not modules_store.update_referral_status(ref_id, status):
        raise ApiError(404, "Referral not found.")
    return {"success": True}


@router.post("/recruitment/referrals/{ref_id}/convert")
async def convert_referral(ref_id: str, _: dict = Depends(require_role("ADMIN"))):
    candidate = modules_store.convert_to_candidate(ref_id)
    if not candidate:
        raise ApiError(404, "Referral not found.")
    return {"success": True, "candidate": candidate}
