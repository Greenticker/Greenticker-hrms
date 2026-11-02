"""
In-memory HRMS modules store (leave, expenses, payroll, tax, policies, POSH, holidays,
announcements, performance, recruitment, referrals, assets, HR desk, F&F, letters,
Form 24Q, insurance).
"""

from typing import Any, Optional

from app.stores.db_store import db_store, merge, set_or_drop
from app.stores.seed import fallback_assets, seed_container
from app.utils.jsutil import (
    clean_num,
    date_ms,
    format_en_in,
    js_round,
    js_str,
    letter_date,
    now_iso,
    now_ms,
    num,
    r2,
    rand_base36,
    rand_int,
    to_number,
    today_str,
    truthy,
)
from app.utils.salary_structure import compute_salary_structure, professional_tax_for_month


def _default_leave_balance() -> dict:
    return {
        "casual": {"total": 12, "used": 0, "remaining": 12},
        "sick": {"total": 10, "used": 0, "remaining": 10},
        "earned": {"total": 15, "used": 0, "remaining": 15},
        "maternity": {"total": 180, "used": 0, "remaining": 180},
        "paternity": {"total": 15, "used": 0, "remaining": 15},
        "unpaid": {"used": 0},
    }


def create_policy_doc(data: dict, created_by: Optional[dict] = None) -> dict:
    now = now_iso()
    created_by = created_by or {}
    policy = {
        "_id": f"policy_{now_ms()}_{rand_base36(6)}",
        "title": str(data.get("title") or "").strip(),
        "category": data.get("category"),
        "version": str(data.get("version") or "").strip() or "1.0",
        "summary": str(data.get("summary") or "").strip(),
        "content": str(data.get("content") or "").strip(),
        "mandatory": bool(data.get("mandatory")),
        "effectiveDate": data.get("effectiveDate"),
        "lastUpdated": now,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": created_by.get("id") or None,
        "createdByName": created_by.get("name") or None,
        "status": "ACTIVE",
    }
    return {k: v for k, v in policy.items() if v is not None}


class ModulesStore:
    def __init__(self) -> None:
        names = [
            "leaveBalances", "leaveRequests", "expenseClaims", "payslips", "taxDeclarations",
            "policies", "policyAcknowledgements", "poshCases", "holidays", "announcements",
            "performanceReviews", "jobOpenings", "jobCandidates", "requirements", "referrals",
            "assets", "hrRequests", "fullFinalSettlements", "letterTemplates", "insurancePolicy",
            "insuranceEnrollments", "insuranceClaims", "form24QData", "form24QDataQ1",
        ]
        for name in names:
            setattr(self, name, seed_container("modules", name))

    # ------------------------------------------------------------------ leave

    def get_leave_balance(self, employee_id: str) -> dict:
        if employee_id not in self.leaveBalances:
            self.leaveBalances[employee_id] = _default_leave_balance()
        return self.leaveBalances[employee_id]

    def get_leave_requests(self, user: dict, status: Optional[str] = None, employee_id: Optional[str] = None) -> list:
        items = list(self.leaveRequests.values())
        if user.get("role") == "EMPLOYEE":
            items = [r for r in items if r.get("employeeId") == user.get("employeeId")]
        if status and status != "ALL":
            items = [r for r in items if r.get("status") == status]
        if employee_id:
            items = [r for r in items if r.get("employeeId") == employee_id]
        return sorted(items, key=lambda r: date_ms(r.get("appliedAt")), reverse=True)

    def create_leave_request(self, data: dict) -> dict:
        leave_id = f"leave_{now_ms()}"
        doc = merge({}, data)
        doc.update({"_id": leave_id, "status": "PENDING", "appliedAt": now_iso()})
        self.leaveRequests[leave_id] = doc
        return doc

    def update_leave_status(self, leave_id: str, status: str, reviewer_name: str, rejection_reason: Optional[str] = None) -> Optional[dict]:
        leave = self.leaveRequests.get(leave_id)
        if not leave:
            return None
        leave["status"] = status
        leave["reviewedBy"] = reviewer_name
        leave["reviewedAt"] = now_iso()
        if rejection_reason:
            leave["rejectionReason"] = rejection_reason

        # If approved, deduct from balance
        if status == "APPROVED":
            bal = self.get_leave_balance(leave["employeeId"])
            days = leave.get("daysCount") or 0
            key = {"CASUAL": "casual", "SICK": "sick", "EARNED": "earned"}.get(leave.get("leaveType"))
            if key:
                bal[key]["used"] = clean_num(bal[key]["used"] + days)
                bal[key]["remaining"] = clean_num(max(0, bal[key]["total"] - bal[key]["used"]))
            elif leave.get("leaveType") == "UNPAID":
                bal["unpaid"]["used"] = clean_num(bal["unpaid"]["used"] + days)
        return leave

    # --------------------------------------------------------------- expenses

    def get_expenses(self, user: dict, status: Optional[str] = None, category: Optional[str] = None, employee_id: Optional[str] = None) -> list:
        items = list(self.expenseClaims.values())
        if user.get("role") == "EMPLOYEE":
            items = [e for e in items if e.get("employeeId") == user.get("employeeId")]
        if status and status != "ALL":
            items = [e for e in items if e.get("status") == status]
        if category and category != "ALL":
            items = [e for e in items if e.get("category") == category]
        if employee_id:
            items = [e for e in items if e.get("employeeId") == employee_id]
        return sorted(items, key=lambda e: date_ms(e.get("submittedAt")), reverse=True)

    def create_expense(self, data: dict) -> dict:
        exp_id = f"exp_{now_ms()}"
        doc = merge({}, data)
        doc.update({"_id": exp_id, "status": "SUBMITTED", "submittedAt": now_iso()})
        self.expenseClaims[exp_id] = doc
        return doc

    def update_expense_status(self, exp_id: str, status: str, reviewer_name: str, rejection_reason: Optional[str] = None, payment_reference: Optional[str] = None) -> Optional[dict]:
        exp = self.expenseClaims.get(exp_id)
        if not exp:
            return None
        exp["status"] = status
        exp["reviewedBy"] = reviewer_name
        exp["reviewedAt"] = now_iso()
        if rejection_reason:
            exp["rejectionReason"] = rejection_reason
        if status == "REIMBURSED":
            exp["reimbursedAt"] = now_iso()
            exp["paymentReference"] = payment_reference or f"ACH-ZEN-EXP-{10000 + rand_int(90000)}"
        return exp

    # ---------------------------------------------------------------- payroll

    def get_payslips(self, user: dict, month: Optional[str] = None, employee_id: Optional[str] = None) -> list:
        items = list(self.payslips.values())
        if user.get("role") == "EMPLOYEE":
            items = [p for p in items if p.get("employeeId") == user.get("employeeId")]
        if month:
            items = [p for p in items if p.get("month") == month]
        if employee_id and user.get("role") in ("ADMIN", "FINANCE"):
            items = [p for p in items if p.get("employeeId") == employee_id]
        return sorted(items, key=lambda p: p.get("month") or "", reverse=True)

    def build_payslip(self, emp: dict, month_str: str, month_name: str, overrides: Optional[dict] = None) -> Optional[dict]:
        """Builds one monthly payslip from the Greenticker salary structure (FY 2026-27).
        Returns None when the employee has no usable CTC."""
        annual_ctc = to_number(emp.get("annualSalary"))
        if annual_ctc <= 0:
            print(f"[payroll] {emp.get('employeeCode')}: skipped - no annual CTC on file.")
            return None
        structure = compute_salary_structure(annual_ctc)

        def monthly_of(key: str) -> float:
            for line in structure["wages"] + structure["allowances"]:
                if line["key"] == key:
                    return line["monthly"]
            return 0

        # A negative balancing amount means the CTC is too low for this structure.
        if monthly_of("special") < 0 or monthly_of("conveyance") < 0:
            print(f"[payroll] {emp.get('employeeCode')}: skipped - CTC {js_str(annual_ctc)} is too low for the salary structure.")
            return None

        monthly_gross = structure["netPay"]["monthlyGross"]
        pf = structure["netPay"]["pfEmployee"]
        pt = professional_tax_for_month(month_str)
        tds = 0
        total_deductions = clean_num(r2(pf + pt + tds))

        statutory = emp.get("statutory") or {}
        bank = emp.get("bankInfo") or {}
        if bank.get("accountNumberMasked"):
            bank_account = bank["accountNumberMasked"]
        elif bank.get("accountNumber"):
            bank_account = f"•••• •••• {bank['accountNumber'][-4:]}"
        else:
            bank_account = "•••• •••• 1234"

        payslip = {
            "_id": f"pay_{emp['_id']}_{month_str.replace('-', '_', 1)}",
            "employeeId": emp["_id"],
            "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
            "employeeCode": emp.get("employeeCode"),
            "designation": emp.get("designation"),
            "department": emp.get("department"),
            "panNumber": statutory.get("panNumber") or statutory.get("panMasked") or "ABCDE1234F",
            "pfUan": statutory.get("uanNumber") or statutory.get("uanMasked") or "100984728912",
            "bankName": bank.get("bankName") or "State Bank of India",
            "bankAccountNumber": bank_account,
            "month": month_str,
            "monthName": month_name,
            "payDate": today_str(),
            "workedDays": 22,
            "lopDays": 0,
            "basicSalary": monthly_of("basic"),
            "hra": monthly_of("hra"),
            "specialAllowance": monthly_of("special"),
            "conveyanceAllowance": monthly_of("conveyance"),
            "medicalAllowance": 0,  # Medical Insurance is an annual one-time payment, not monthly
            "performanceBonus": 0,
            "annualCtc": annual_ctc,
            "educationAllowance": monthly_of("education"),
            "lta": monthly_of("lta"),
            "grossSalary": monthly_gross,
            "providentFund": pf,
            "professionalTax": pt,
            "tds": tds,
            "otherDeductions": 0,
            "totalDeductions": total_deductions,
            "netSalary": clean_num(r2(monthly_gross - total_deductions)),
            "status": "PAID",
            "paymentMode": "DIRECT_DEPOSIT",
            "transactionId": f"TXN-RHA-PAY-{month_str}-{emp.get('employeeCode')}",
        }
        payslip.update(overrides or {})
        return payslip

    def run_monthly_payroll(self, month_str: str, month_name: str, processed_by: str) -> list:
        generated = []
        active = [e for e in db_store.employees.values() if e.get("status") in ("ACTIVE", "PROBATION")]
        for emp in active:
            existing_key = f"pay_{emp['_id']}_{month_str.replace('-', '_', 1)}"
            if existing_key in self.payslips:
                continue
            payslip = self.build_payslip(emp, month_str, month_name, {"_id": existing_key, "payDate": today_str()})
            if not payslip:
                continue
            self.payslips[existing_key] = payslip
            generated.append(payslip)
        return generated

    # -------------------------------------------------------------------- tax

    def get_tax_declaration(self, employee_id: str) -> Optional[dict]:
        return self.taxDeclarations.get(employee_id)

    def save_tax_declaration(self, employee_id: str, data: dict) -> dict:
        existing = self.taxDeclarations.get(employee_id)
        updated = {
            "_id": (existing or {}).get("_id") or f"tax_{employee_id}_{now_ms()}",
            "employeeId": employee_id,
            "financialYear": data.get("financialYear") or "2026-2027",
            "regime": data.get("regime") or "NEW",
            "section80C": data.get("section80C") or {
                "epf": 9360, "ppf": 0, "elss": 0, "lifeInsurance": 0, "taxSaverFD": 0, "total": 9360, "maxLimit": 150000,
            },
            "section80D": data.get("section80D") or {"selfSpouseChildren": 0, "parents": 0, "total": 0},
            "hraExemption": data.get("hraExemption") or {"annualRentPaid": 0, "cityType": "METRO", "calculatedExemption": 0},
            "section80CCD_1B": data.get("section80CCD_1B") or 0,
            "homeLoanInterest80EE": data.get("homeLoanInterest80EE") or 0,
            "totalDeductionsDeclared": data.get("totalDeductionsDeclared") or 9360,
            "estimatedTaxPayable": data.get("estimatedTaxPayable") or 15000,
            "submittedAt": now_iso(),
            "status": "SUBMITTED",
        }
        self.taxDeclarations[employee_id] = updated
        return updated

    # --------------------------------------------------------------- policies

    def get_policies(self) -> list:
        return list(self.policies.values())

    def get_policy_acknowledgements(self, employee_id: Optional[str] = None) -> list:
        if employee_id:
            return [a for a in self.policyAcknowledgements if a.get("employeeId") == employee_id]
        return self.policyAcknowledgements

    def acknowledge_policy(self, policy_id: str, employee_id: str, employee_name: str, signature: str, ip: str) -> dict:
        ack = {
            "_id": f"ack_{now_ms()}",
            "policyId": policy_id,
            "employeeId": employee_id,
            "employeeName": employee_name,
            "acknowledgedAt": now_iso(),
            "ipAddress": ip,
            "digitalSignature": signature,
        }
        self.policyAcknowledgements.append(ack)
        return ack

    # ------------------------------------------------------------------- POSH

    def get_posh_cases(self) -> list:
        return list(self.poshCases.values())

    def create_posh_case(self, data: dict) -> dict:
        case_id = f"posh_case_{now_ms()}"
        doc = merge({}, data)
        doc.update({
            "_id": case_id,
            "reportedDate": today_str(),
            "stage": "PRELIMINARY_REVIEW",
            "status": "ACTIVE",
            "isConfidential": True,
        })
        self.poshCases[case_id] = doc
        return doc

    def update_posh_stage(self, case_id: str, stage: str, notes: Optional[str] = None, status: Optional[str] = None) -> Optional[dict]:
        item = self.poshCases.get(case_id)
        if not item:
            return None
        item["stage"] = stage
        if notes:
            item["actionTakenNotes"] = notes
        if status:
            item["status"] = status
        if status == "RESOLVED":
            item["resolutionDate"] = today_str()
        return item

    # ------------------------------------------------- holidays & announcements

    def get_holidays(self) -> list:
        return sorted(self.holidays.values(), key=lambda h: h.get("date") or "")

    def create_holiday(self, data: dict) -> dict:
        hol_id = f"hol_{now_ms()}"
        hol = {**data, "_id": hol_id}
        self.holidays[hol_id] = hol
        return hol

    def update_holiday(self, holiday_id: str, data: dict) -> Optional[dict]:
        hol = self.holidays.get(holiday_id)
        if not hol:
            return None
        hol.update(data)
        return hol

    def delete_holiday(self, holiday_id: str) -> Optional[dict]:
        return self.holidays.pop(holiday_id, None)

    def get_announcements(self) -> list:
        return sorted(self.announcements.values(), key=lambda a: 1 if a.get("pinned") else 0, reverse=True)

    def create_announcement(self, data: dict) -> dict:
        ann_id = f"ann_{now_ms()}"
        ann = merge({}, data)
        ann.update({"_id": ann_id, "publishedAt": now_iso()})
        self.announcements[ann_id] = ann
        return ann

    def vote_poll(self, announcement_id: str, option_id: str, user_id: str) -> Optional[dict]:
        ann = self.announcements.get(announcement_id)
        if not ann or not ann.get("poll"):
            return None
        poll = ann["poll"]

        previous_option_id = None
        for opt in poll.get("options", []):
            if not opt.get("votedUserIds"):
                opt["votedUserIds"] = []
            if user_id in opt["votedUserIds"]:
                previous_option_id = opt.get("id")
                break

        if previous_option_id is not None and previous_option_id == option_id:
            return ann

        if previous_option_id is not None:
            prev = next((o for o in poll["options"] if o.get("id") == previous_option_id), None)
            if prev:
                prev["votes"] = max(0, (prev.get("votes") or 0) - 1)
                prev["votedUserIds"] = [i for i in (prev.get("votedUserIds") or []) if i != user_id]
        else:
            poll["totalVotes"] = (poll.get("totalVotes") or 0) + 1

        new_opt = next((o for o in poll["options"] if o.get("id") == option_id), None)
        if new_opt:
            new_opt["votes"] = (new_opt.get("votes") or 0) + 1
            if not new_opt.get("votedUserIds"):
                new_opt["votedUserIds"] = []
            if user_id not in new_opt["votedUserIds"]:
                new_opt["votedUserIds"].append(user_id)
        return ann

    # ------------------------------------------------------------ performance

    def get_performance_reviews(self, user: dict, employee_id: Optional[str] = None) -> list:
        items = list(self.performanceReviews.values())
        if user.get("role") == "EMPLOYEE":
            items = [r for r in items if r.get("employeeId") == user.get("employeeId")]
        elif employee_id:
            items = [r for r in items if r.get("employeeId") == employee_id]
        return items

    # ------------------------------------------------------------ recruitment

    def get_job_openings(self) -> list:
        return list(self.jobOpenings.values())

    def get_job_candidates(self, job_id: Optional[str] = None) -> list:
        items = list(self.jobCandidates.values())
        if job_id:
            items = [c for c in items if c.get("jobId") == job_id]
        return items

    def update_candidate_stage(self, cand_id: str, stage: str) -> Optional[dict]:
        c = self.jobCandidates.get(cand_id)
        if not c:
            return None
        c["stage"] = stage
        return c

    # --------------------------------------------------------- HR service desk

    def get_hr_requests(self, user: dict, status: Optional[str] = None) -> list:
        items = list(self.hrRequests.values())
        if user.get("role") == "EMPLOYEE":
            items = [r for r in items if r.get("employeeId") == user.get("employeeId")]
        if status and status != "ALL":
            items = [r for r in items if r.get("status") == status]
        return sorted(items, key=lambda r: date_ms(r.get("createdAt")), reverse=True)

    def create_hr_request(self, data: dict) -> dict:
        number = 1000 + rand_int(9000)
        req_id = f"req_{now_ms()}"
        doc = merge({}, data)
        doc.update({"_id": req_id, "ticketNumber": f"HR-REQ-{number}", "status": "OPEN", "createdAt": now_iso()})
        self.hrRequests[req_id] = doc
        return doc

    def resolve_hr_request(self, req_id: str, remarks: str) -> Optional[dict]:
        item = self.hrRequests.get(req_id)
        if not item:
            return None
        item["status"] = "RESOLVED"
        item["resolvedAt"] = now_iso()
        set_or_drop(item, "resolutionRemarks", remarks)
        return item

    # ------------------------------------------------------- full & final

    def get_full_final_settlements(self) -> list:
        return list(self.fullFinalSettlements.values())

    # ------------------------------------------------- requirements & hiring

    def get_requirements(self, user: dict) -> list:
        return sorted(self.requirements.values(), key=lambda r: date_ms(r.get("createdAt")), reverse=True)

    def create_requirement(self, user: dict, data: dict) -> dict:
        req_id = f"req_{now_ms()}"
        emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
        doc = {
            "_id": req_id,
            "requestedById": user.get("employeeId") or "",
            "requestedByName": f"{emp.get('firstName')} {emp.get('lastName')}" if emp else user.get("email"),
            "title": data.get("title"),
            "department": data.get("department"),
            "positions": data.get("positions"),
            "employmentType": data.get("employmentType"),
            "experienceRequired": data.get("experienceRequired"),
            "skillsRequired": data.get("skillsRequired"),
            "priority": data.get("priority"),
            "expectedJoiningDate": data.get("expectedJoiningDate"),
            "budgetRange": data.get("budgetRange"),
            "location": data.get("location"),
            "justification": data.get("justification"),
            "status": "SUBMITTED",
            "createdAt": now_iso(),
        }
        doc = {k: v for k, v in doc.items() if v is not None}
        self.requirements[req_id] = doc
        return doc

    def review_requirement(self, req_id: str, decision: str, reviewer_name: str, note: Optional[str] = None) -> Optional[dict]:
        req = self.requirements.get(req_id)
        if not req:
            return None
        req["status"] = decision
        req["reviewedBy"] = reviewer_name
        req["reviewedAt"] = now_iso()
        set_or_drop(req, "reviewNote", note)

        job = None
        if decision == "APPROVED":
            job_id = f"job_{now_ms()}"
            job = {
                "_id": job_id,
                "title": req.get("title"),
                "department": req.get("department"),
                "location": req.get("location") or "Head Office",
                "type": req.get("employmentType"),
                "experienceRequired": req.get("experienceRequired"),
                "openingsCount": req.get("positions"),
                "description": req.get("justification"),
                "skillsRequired": req.get("skillsRequired"),
                "status": "OPEN",
                "postedDate": today_str(),
            }
            job = {k: v for k, v in job.items() if v is not None}
            self.jobOpenings[job_id] = job
            req["jobId"] = job_id
        result = {"requirement": req}
        if job is not None:
            result["job"] = job
        return result

    def set_candidate_interview(self, cand_id: str, data: dict) -> Optional[dict]:
        cand = self.jobCandidates.get(cand_id)
        if not cand:
            return None
        cand["stage"] = "TECHNICAL_INTERVIEW"
        cand["interview"] = data
        if not cand.get("interviewRounds"):
            cand["interviewRounds"] = []

        round_num = to_number(data.get("roundNumber")) or (len(cand["interviewRounds"]) + 1)
        round_name = data.get("roundName") or f"Round {js_str(round_num)}: Interview"

        cand["interviewRounds"].append({k: v for k, v in {
            "roundNumber": round_num,
            "roundName": round_name,
            "date": data.get("date"),
            "time": data.get("time"),
            "durationMinutes": data.get("durationMinutes") or 45,
            "mode": data.get("mode") or "VIDEO",
            "locationOrLink": data.get("locationOrLink"),
            "interviewer": data.get("interviewer"),
            "notes": data.get("notes"),
            "status": "SCHEDULED",
            "scheduledBy": data.get("scheduledBy"),
            "scheduledAt": now_iso(),
        }.items() if v is not None})
        return cand

    def add_candidate_feedback(self, cand_id: str, feedback: dict) -> Optional[dict]:
        cand = self.jobCandidates.get(cand_id)
        if not cand:
            return None
        if not cand.get("interviewFeedbacks"):
            cand["interviewFeedbacks"] = []
        cand["interviewFeedbacks"].append(feedback)

        rounds = cand.get("interviewRounds") or []
        if rounds:
            if truthy(feedback.get("roundNumber")):
                target = next((r for r in rounds if r.get("roundNumber") == feedback.get("roundNumber")), None)
            else:
                target = rounds[-1]
            if target:
                target["status"] = "COMPLETED"
                target["feedback"] = {k: v for k, v in {
                    "rating": feedback.get("rating"),
                    "justification": feedback.get("justification"),
                    "comments": feedback.get("comments"),
                    "notes": feedback.get("notes"),
                    "recommendation": feedback.get("recommendation"),
                    "submittedAt": feedback.get("submittedAt"),
                    "submittedBy": feedback.get("submittedBy"),
                }.items() if v is not None}

        rec = feedback.get("recommendation")
        if rec in ("READY_FOR_OFFER", "OFFER"):
            cand["stage"] = "OFFERED"
        elif rec == "NEXT_ROUND":
            cand["stage"] = "TECHNICAL_INTERVIEW"
        elif rec == "REJECT":
            cand["stage"] = "REJECTED"
        return cand

    def set_candidate_offer(self, cand_id: str, data: dict) -> Optional[dict]:
        cand = self.jobCandidates.get(cand_id)
        if not cand:
            return None
        cand["stage"] = "OFFERED"
        cand["offer"] = data
        return cand

    # --------------------------------------------------------------- referrals

    def get_referrals(self, user: dict) -> list:
        is_hr_or_admin = user.get("role") == "ADMIN"
        out = []
        for r in self.referrals.values():
            is_mine = r.get("referredById") == user.get("employeeId")
            can_view_private = is_hr_or_admin or is_mine
            item = dict(r)
            item["isMine"] = is_mine
            item["canViewPrivate"] = can_view_private
            item["email"] = r.get("email") if can_view_private else "••••••••@••••.com"
            set_or_drop(item, "phone", r.get("phone") if can_view_private else None)
            set_or_drop(item, "notes", r.get("notes") if can_view_private else None)
            item["hasResume"] = bool(r.get("storedFileName"))
            item.pop("storedFileName", None)
            out.append(item)
        return sorted(out, key=lambda r: date_ms(r.get("createdAt")), reverse=True)

    def create_referral(self, user: dict, data: dict) -> dict:
        ref_id = f"ref_{now_ms()}"
        emp = db_store.employees.get(user.get("employeeId")) if user.get("employeeId") else None
        doc = {
            "_id": ref_id,
            "fullName": data.get("fullName"),
            "email": data.get("email"),
            "phone": data.get("phone"),
            "city": data.get("city"),
            "experienceYears": data.get("experienceYears"),
            "jobId": data.get("jobId"),
            "jobTitle": data.get("jobTitle"),
            "relationship": data.get("relationship"),
            "notes": data.get("notes"),
            "resumeFileName": data.get("resumeFileName"),
            "storedFileName": data.get("storedFileName"),
            "status": "SUBMITTED",
            "referredById": user.get("employeeId") or user["_id"],
            "referredByName": f"{emp.get('firstName')} {emp.get('lastName')}" if emp else user.get("email"),
            "referredByRole": user.get("role"),
            "createdAt": now_iso(),
        }
        doc = {k: v for k, v in doc.items() if v is not None}
        self.referrals[ref_id] = doc
        return doc

    def update_referral_status(self, ref_id: str, status: Any) -> Optional[dict]:
        r = self.referrals.get(ref_id)
        if not r:
            return None
        set_or_drop(r, "status", status)
        return r

    def convert_to_candidate(self, referral_id: str) -> Optional[dict]:
        ref = self.referrals.get(referral_id)
        if not ref:
            return None
        ref["status"] = "SHORTLISTED"
        target_job_id = ref.get("jobId")
        if not target_job_id or target_job_id not in self.jobOpenings:
            first_job = next(iter(self.jobOpenings.values()), None)
            target_job_id = first_job["_id"] if first_job else "job_eng_01"
        job = self.jobOpenings.get(target_job_id)
        cand_id = f"cand_ref_{now_ms()}"
        cand = {
            "_id": cand_id,
            "jobId": target_job_id,
            "jobTitle": (job or {}).get("title") or "Open Position",
            "fullName": ref.get("fullName"),
            "email": ref.get("email"),
            "phone": ref.get("phone") or "",
            "experienceYears": ref.get("experienceYears"),
            "currentCompany": "Referred Candidate",
            "stage": "SCREENING",
            "rating": 4,
            "notes": f"Referred by {ref.get('referredByName')} ({ref.get('relationship') or 'Referral'}). {ref.get('notes') or ''}",
            "appliedDate": today_str(),
        }
        cand = {k: v for k, v in cand.items() if v is not None}
        self.jobCandidates[cand_id] = cand
        return cand

    # ------------------------------------------------------------------ assets

    def get_assets(self, user: dict, employee_id: Optional[str] = None) -> dict:
        if not self.assets:
            for a in fallback_assets():
                self.assets[a["_id"]] = a
        can_manage = user.get("role") == "ADMIN"
        items = list(self.assets.values())
        if employee_id:
            items = [a for a in items if a.get("employeeId") == employee_id]

        enriched = []
        for a in items:
            if not a.get("history"):
                hist = [{
                    "action": "ALLOCATED",
                    "date": a.get("issuedDate") or "2026-01-01",
                    "employeeName": a.get("employeeName"),
                    "employeeCode": a.get("employeeCode"),
                    "performedBy": a.get("allocatedBy") or "HR Admin",
                    "notes": a.get("notes") or "Initial allocation",
                }]
                if a.get("status") == "RETURNED":
                    hist.append({
                        "action": "RETURNED",
                        "date": a.get("returnedDate") or a.get("issuedDate") or "2026-01-01",
                        "employeeName": a.get("employeeName"),
                        "employeeCode": a.get("employeeCode"),
                        "performedBy": "HR Admin",
                        "notes": "Returned by employee",
                    })
                enriched.append({**a, "history": hist})
            else:
                enriched.append(a)
        return {
            "assets": sorted(enriched, key=lambda a: date_ms(a.get("issuedDate")), reverse=True),
            "canManage": can_manage,
        }

    def allocate_asset(self, data: dict) -> dict:
        asset_id = f"ast_{now_ms()}"
        emp = db_store.employees.get(data.get("employeeId"))
        employee_name = f"{emp.get('firstName')} {emp.get('lastName')}" if emp else "Employee"
        employee_code = emp.get("employeeCode") if emp else "EMP"
        a_type = data.get("type")
        if data.get("category"):
            category = data["category"]
        elif a_type in ("CAR", "BIKE"):
            category = "VEHICLES"
        elif a_type in ("SOFTWARE_LICENSE", "SUBSCRIPTION"):
            category = "SOFTWARE_LICENSES"
        elif a_type in ("CHAIR", "DESK", "CABINET"):
            category = "FURNITURE"
        else:
            category = "ELECTRONICS"
        history = [{k: v for k, v in {
            "action": "ALLOCATED",
            "date": data.get("issuedDate"),
            "employeeName": employee_name,
            "employeeCode": employee_code,
            "performedBy": data.get("allocatedBy") or "HR Admin",
            "notes": data.get("notes") or "Asset allocation",
        }.items() if v is not None}]
        doc = {
            "_id": asset_id,
            "employeeId": data.get("employeeId"),
            "employeeName": employee_name,
            "employeeCode": employee_code,
            "department": emp.get("department") if emp else "General",
            "designation": emp.get("designation") if emp else "Staff",
            "category": category,
            "type": a_type,
            "name": data.get("name"),
            "assetTag": data.get("assetTag"),
            "serialNumber": data.get("serialNumber"),
            "issuedDate": data.get("issuedDate"),
            "status": "ALLOCATED",
            "notes": data.get("notes"),
            "allocatedBy": data.get("allocatedBy"),
            "history": history,
        }
        doc = {k: v for k, v in doc.items() if v is not None}
        self.assets[asset_id] = doc
        return doc

    def return_asset(self, asset_id: str) -> Optional[dict]:
        a = self.assets.get(asset_id)
        if not a:
            return None
        a["status"] = "RETURNED"
        ret_date = today_str()
        a["returnedDate"] = ret_date
        if not a.get("history"):
            a["history"] = []
        a["history"].append({
            "action": "RETURNED",
            "date": ret_date,
            "employeeName": a.get("employeeName"),
            "employeeCode": a.get("employeeCode"),
            "performedBy": "HR Admin",
            "notes": "Asset marked as returned",
        })
        return a

    # --------------------------------------------------------- letter templates

    def get_letter_templates(self, org_id: Optional[str]) -> list:
        return [t for t in self.letterTemplates.values() if t.get("organizationId") == org_id or not t.get("organizationId")]

    def create_letter_template(self, data: dict) -> dict:
        tmpl_id = f"tmpl_{now_ms()}_{rand_base36(4)}"
        now = now_iso()
        tmpl = merge({}, data)
        tmpl.update({"_id": tmpl_id, "createdAt": now, "updatedAt": now})
        self.letterTemplates[tmpl_id] = tmpl
        return tmpl

    def update_letter_template(self, tmpl_id: str, data: dict) -> Optional[dict]:
        tmpl = self.letterTemplates.get(tmpl_id)
        if not tmpl:
            return None
        for key in ("title", "category", "subject", "content"):
            if data.get(key) is not None:
                tmpl[key] = data[key]
        tmpl["updatedAt"] = now_iso()
        return tmpl

    def delete_letter_template(self, tmpl_id: str) -> bool:
        return self.letterTemplates.pop(tmpl_id, None) is not None

    def preview_letter_template(self, template_id: str, employee_id: Optional[str] = None, org_id: Optional[str] = None, viewer: Optional[dict] = None) -> Optional[dict]:
        tmpl = self.letterTemplates.get(template_id)
        if not tmpl:
            return None
        return {"title": tmpl.get("title"), "content": self.merge_letter_tokens(tmpl.get("content") or "", employee_id, org_id, viewer)}

    def merge_letter_tokens(self, content: str, employee_id: Optional[str] = None, org_id: Optional[str] = None, viewer: Optional[dict] = None) -> str:
        """Replaces {{token}} merge fields with employee / organisation data. Without an
        employeeId the first employee of the organisation is used as sample data.
        Salary is only merged for admins and the employee themself."""
        if employee_id:
            emp = db_store.employees.get(employee_id)
            if emp and org_id and emp.get("organizationId") != org_id:
                emp = None
        else:
            emp = next((e for e in db_store.employees.values() if not org_id or e.get("organizationId") == org_id), None)

        if org_id:
            org = db_store.organizations.get(org_id)
        else:
            org = next(iter(db_store.organizations.values()), None)

        can_see_salary = not viewer or viewer.get("role") == "ADMIN" or (bool(emp) and emp.get("userId") == viewer.get("_id"))
        if emp:
            salary_value = emp.get("annualSalary") if emp.get("annualSalary") is not None else (emp.get("salary") if emp.get("salary") is not None else 1200000)
        else:
            salary_value = 1200000
        addr = (emp or {}).get("currentAddress") or (emp or {}).get("permanentAddress")

        if addr:
            parts = [addr.get("line"), addr.get("city"), addr.get("state"), addr.get("postalCode"), addr.get("country")]
            address_text = ", ".join(js_str(p) for p in parts if truthy(p))
        else:
            address_text = "[employee address]"

        org_address = org.get("address") if org else None
        salary_number = num(salary_value)

        tokens = {
            "{{employee_name}}": f"{emp.get('firstName')} {emp.get('lastName')}" if emp else "John Doe",
            "{{employee_first_name}}": emp.get("firstName") if emp else "John",
            "{{employee_code}}": emp.get("employeeCode") if emp else "EMP-001",
            "{{department}}": emp.get("department") if emp else "Engineering",
            "{{designation}}": emp.get("designation") if emp else "Software Engineer",
            "{{joining_date}}": emp.get("joiningDate") if emp else today_str(),
            "{{location}}": (emp or {}).get("location") or "Head Office",
            "{{reporting_manager}}": (emp or {}).get("reportingManagerName") or "[reporting manager]",
            "{{probation_end_date}}": (emp or {}).get("probationEndDate") or "[probation end date]",
            "{{employee_address}}": address_text,
            "{{letter_date}}": letter_date(),
            "{{company_name}}": org.get("name") if org else "vetan.ai",
            "{{company_address}}": (
                f"{org_address.get('street')}, {org_address.get('city')}, {org_address.get('state')} {org_address.get('zipCode')}"
                if org and org_address else "Global HQ"
            ),
            "{{salary}}": (f"₹{format_en_in(salary_number)}" if salary_number is not None else "₹NaN") if can_see_salary else "[confidential]",
        }
        for token, val in tokens.items():
            content = content.replace(token, js_str(val) if val is not None else "undefined")
        return content

    # ---------------------------------------------------------------- Form 24Q

    def get_form24q_data(self) -> dict:
        return self.form24QData

    def update_form24q_status(self, status: str, acknowledgement_number: Optional[str] = None) -> dict:
        summary = self.form24QData["filingSummary"]
        summary["status"] = status
        if acknowledgement_number is not None:
            summary["acknowledgementNumber"] = acknowledgement_number
        if status == "Filed" and not summary.get("filedDate"):
            summary["filedDate"] = today_str()
        return self.form24QData

    def update_form24q_summary(self, summary: dict) -> dict:
        self.form24QData["filingSummary"] = merge(self.form24QData["filingSummary"], summary)
        return self.form24QData

    def validate_form24q(self) -> dict:
        data = self.form24QData
        total_employee_tds = clean_num(sum(e.get("tdsDeducted") or 0 for e in data["employees"]))
        target_tax = data["filingSummary"].get("totalTaxDeposited")
        total_deductees = data["filingSummary"].get("totalDeductees")
        challan_count = len(data["challans"])
        discrepancy = clean_num(abs(total_employee_tds - (target_tax or 0)))
        is_valid = discrepancy == 0

        if is_valid:
            messages = [f"Employee-level TDS deductions perfectly match total tax deposited in challans (₹{js_str(target_tax)})."]
        else:
            messages = [
                f"Discrepancy detected: Employee total TDS (₹{js_str(total_employee_tds)}) differs from deposited tax "
                f"(₹{js_str(target_tax)}) by ₹{js_str(discrepancy)}."
            ]
        return {
            "isValid": is_valid,
            "totalEmployeeTds": total_employee_tds,
            "totalChallanDeposited": target_tax,
            "totalDeductees": total_deductees,
            "challanCount": challan_count,
            "discrepancy": discrepancy,
            "messages": messages,
        }

    def get_form24q_data_q1(self) -> dict:
        return self.form24QDataQ1

    def get_cross_quarter_analysis(self) -> dict:
        q4 = self.form24QData["employees"]
        q1 = self.form24QDataQ1["employees"]
        q4_pans = {e["PAN"].upper().strip() for e in q4}
        new_employees = [e for e in q1 if e["PAN"].upper().strip() not in q4_pans]

        anomalies = []
        q4_map = {e["PAN"].upper(): e for e in q4}
        for q1_emp in q1:
            pan = q1_emp["PAN"].upper()
            q4_emp = q4_map.get(pan)
            if q4_emp:
                q4_monthly = q4_emp["salaryPaid"] / 3
                q1_monthly = q1_emp["salaryPaid"] / 3
                if q1_monthly > q4_monthly * 1.35 or q1_emp["tdsDeducted"] > q4_emp["tdsDeducted"] * 1.5:
                    anomalies.append({
                        "pan": pan,
                        "name": q1_emp["name"],
                        "type": "TDS_SPIKE_OR_BONUS",
                        "description": f"Significant increase in TDS/salary for {q1_emp['name']} in Q1.",
                    })
        return {
            "newEmployees": new_employees,
            "anomalies": anomalies,
            "q4TotalTds": self.form24QData["filingSummary"].get("totalTaxDeposited"),
            "q1TotalTds": self.form24QDataQ1["filingSummary"].get("totalTaxDeposited"),
        }

    def get_employee_full_year_history(self, pan: str) -> dict:
        clean_pan = pan.upper().strip()
        q4_emp = next((e for e in self.form24QData["employees"] if e["PAN"].upper() == clean_pan), None)
        q1_emp = next((e for e in self.form24QDataQ1["employees"] if e["PAN"].upper() == clean_pan), None)
        q4s = (q4_emp or {}).get("salaryPaid") or 0
        q4t = (q4_emp or {}).get("tdsDeducted") or 0
        q1s = (q1_emp or {}).get("salaryPaid") or 0
        q1t = (q1_emp or {}).get("tdsDeducted") or 0
        return {
            "pan": clean_pan,
            "name": (q1_emp or {}).get("name") or (q4_emp or {}).get("name") or "Unknown",
            "records": [
                {"quarter": "Q4 FY 2025-26", "salaryPaid": q4s, "tdsDeducted": q4t},
                {"quarter": "Q1 FY 2026-27", "salaryPaid": q1s, "tdsDeducted": q1t},
            ],
            "totalSalaryYtd": q4s + q1s,
            "totalTdsYtd": q4t + q1t,
        }

    def calculate_employee_projection(self, pan: str) -> dict:
        clean_pan = pan.upper().strip()
        history = self.get_employee_full_year_history(clean_pan)
        ytd_salary = history["totalSalaryYtd"]
        ytd_tds = history["totalTdsYtd"]
        months_completed = 6
        months_remaining = 6
        monthly_run_rate = ytd_salary / months_completed if months_completed > 0 else 380000
        annualized_salary = ytd_salary + monthly_run_rate * months_remaining
        standard_deduction = 75000
        taxable_income = max(0, annualized_salary - standard_deduction - 150000)

        tax = 0.0
        if taxable_income > 700000:
            if taxable_income <= 1000000:
                tax = (taxable_income - 700000) * 0.10 + 20000
            elif taxable_income <= 1200000:
                tax = (taxable_income - 1000000) * 0.15 + 50000
            elif taxable_income <= 1500000:
                tax = (taxable_income - 1200000) * 0.20 + 80000
            else:
                tax = (taxable_income - 1500000) * 0.30 + 140000
        projected_annual_tax = js_round(tax * 1.04)
        remaining_tds = max(0, projected_annual_tax - ytd_tds)
        monthly_recommended = js_round(remaining_tds / months_remaining)

        return {
            "pan": clean_pan,
            "name": history["name"],
            "annualizedSalary": js_round(annualized_salary),
            "taxableIncome": js_round(taxable_income),
            "projectedAnnualTax": projected_annual_tax,
            "tdsAlreadyDeducted": ytd_tds,
            "remainingTdsToBeDeducted": remaining_tds,
            "monthsRemaining": months_remaining,
            "monthlyTdsRecommended": monthly_recommended,
        }

    # --------------------------------------------------------------- insurance

    def get_insurance_policy(self) -> dict:
        return self.insurancePolicy

    def get_insurance_enrollment(self, employee_id: str) -> Optional[dict]:
        return self.insuranceEnrollments.get(employee_id)

    def update_insurance_enrollment(self, employee_id: str, data: dict) -> dict:
        enr = self.insuranceEnrollments.get(employee_id)
        emp = db_store.employees.get(employee_id)
        if not enr:
            enr = {
                "_id": f"ins_enr_{now_ms()}",
                "employeeId": employee_id,
                "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}" if emp else "Employee",
                "employeeCode": emp.get("employeeCode") if emp else "EMP-000",
                "grade": "Staff",
                "sumInsured": 500000,
                "premiumAnnual": 6000,
                "monthlyPayrollDeduction": 500,
                "dependents": [],
                "eCardNumber": f"MA-GMC-2025-{100000 + rand_int(900000)}",
                "status": "ACTIVE",
            }
        for key in ("sumInsured", "dependents", "status"):
            if data.get(key) is not None:
                enr[key] = data[key]
        self.insuranceEnrollments[employee_id] = enr
        return enr

    def get_insurance_claims(self, user: dict, status: Optional[str] = None, employee_id: Optional[str] = None) -> list:
        claims = list(self.insuranceClaims.values())
        if user.get("role") != "ADMIN":
            claims = [c for c in claims if c.get("employeeId") == user.get("employeeId")]
        elif employee_id:
            claims = [c for c in claims if c.get("employeeId") == employee_id]
        if status:
            claims = [c for c in claims if c.get("status") == status]
        return sorted(claims, key=lambda c: date_ms(c.get("submittedAt")), reverse=True)

    def submit_insurance_claim(self, employee_id: str, data: dict) -> dict:
        emp = db_store.employees.get(employee_id)
        claim = {
            "_id": f"ins_clm_{now_ms()}",
            "employeeId": employee_id,
            "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}" if emp else (data.get("employeeName") or "Employee"),
            "employeeCode": emp.get("employeeCode") if emp else (data.get("employeeCode") or "EMP-000"),
            "patientName": data.get("patientName") or "Patient",
            "relation": data.get("relation") or "Self",
            "hospitalName": data.get("hospitalName") or "Hospital",
            "admissionDate": data.get("admissionDate") or today_str(),
            "dischargeDate": data.get("dischargeDate"),
            "claimType": data.get("claimType") or "REIMBURSEMENT",
            "amountRequested": data.get("amountRequested") or 0,
            "status": "SUBMITTED",
            "diagnosis": data.get("diagnosis") or "General Treatment",
            "submittedAt": now_iso(),
            "documents": data.get("documents") or [],
        }
        if claim["dischargeDate"] is None:
            del claim["dischargeDate"]
        self.insuranceClaims[claim["_id"]] = claim
        return claim

    def update_insurance_claim_status(self, claim_id: str, status: str, tpa_remarks: Optional[str] = None, amount_approved: Any = None) -> Optional[dict]:
        claim = self.insuranceClaims.get(claim_id)
        if not claim:
            return None
        claim["status"] = status
        if tpa_remarks is not None:
            claim["tpaRemarks"] = tpa_remarks
        if amount_approved is not None:
            claim["amountApproved"] = amount_approved
        return claim


modules_store = ModulesStore()
