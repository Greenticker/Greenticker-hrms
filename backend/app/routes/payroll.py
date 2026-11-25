"""
Payroll process (maker-checker)

  HR (maker)      : statutory settings, salary structures, salary revisions (proposal), monthly
                    inputs, preview with exceptions / variance, prepare the run.
  Finance (checker): approve (locks the month) or reject, salary-revision approval, bank advice,
                    payment release. Never the person who prepared the run, never for an
                    employee they created.
  Accounts        : department summary only.   Auditors: read-only everything.
  Admin / Super Admin: no salary data.
Unlocking an approved month needs a request (HR) and a different approver (Finance) and is
logged; once payment is released corrections go into a later month.
"""

import csv
import io
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.auth.employee_access import creator_user_id
from app.auth.module_access import can_read
from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import clean_num, js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.payroll_engine import (
    DEFAULT_STATUTORY, compute_payslip, employment_window, fy_of, payroll_settings, state_of, validate_structure,
)
from app.utils.salary_revisions import apply_due_revisions, salary_for_month
from app.utils.salary_structure import compute_salary_structure
from app.utils.workflow import (
    PAYROLL_INPUT_KINDS, actor_name, add_payroll_input, employee_name, my_employee_id, notify_employee, notify_roles,
    payroll_inputs_for, payroll_month_locked,
)

router = APIRouter()

MAKER = ("HR",)
CHECKER = ("FINANCE",)
READ_ALL = MAKER + CHECKER + ("AUDITORS",)
MANUAL_INPUT_KINDS = ("ARREARS", "VARIABLE_PAY", "REIMBURSEMENT", "LOAN_EMI", "OTHER_DEDUCTION", "RECOVERY")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _month(value) -> str:
    m = js_str(value or "")[:7]
    try:
        date.fromisoformat(m + "-01")
    except ValueError:
        raise ApiError(400, "Month must be YYYY-MM.")
    return m


def _month_name(month: str) -> str:
    return f"{MONTHS[int(month[5:7]) - 1]} {month[:4]}"


def _run(month: str) -> dict:
    return modules_store.payrollRuns.get(month) or {"_id": month, "status": "NONE"}


def _payslip_view(user: dict, slip: dict) -> dict:
    return slip


# ------------------------------------------------------------------ payslips

@router.get("/payroll/payslips")
async def payslips(month: Optional[str] = None, employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    """HR / Finance / Auditors see every payslip; everyone else only their own approved ones."""
    slips = list(modules_store.payslips.values())
    if user.get("role") in READ_ALL:
        if employeeId:
            slips = [p for p in slips if p.get("employeeId") == employeeId]
    else:
        if employeeId and employeeId != my_employee_id(user):
            raise ApiError(403, "Access denied: you can only view your own payslips.")
        slips = [p for p in slips if p.get("employeeId") == my_employee_id(user) and p.get("status") in ("APPROVED", "PAID")]
    if month:
        slips = [p for p in slips if p.get("month") == month]
    slips.sort(key=lambda p: p.get("month") or "", reverse=True)
    summary = {
        "totalSlips": len(slips),
        "totalDisbursed": clean_num(sum(p.get("grossSalary") or 0 for p in slips)),
        "totalDeductions": clean_num(sum(p.get("totalDeductions") or 0 for p in slips)),
        "netPayout": clean_num(sum(p.get("netSalary") or 0 for p in slips)),
    }
    return {"payslips": slips, "summary": summary}


@router.get("/payroll/payslips/{slip_id}")
async def payslip(slip_id: str, user: dict = Depends(require_auth)):
    slip = modules_store.payslips.get(slip_id)
    if not slip:
        raise ApiError(404, "Payslip not found.")
    if user.get("role") not in READ_ALL and (slip.get("employeeId") != my_employee_id(user) or slip.get("status") not in ("APPROVED", "PAID")):
        raise ApiError(403, "Access denied: you can only view your own payslips.")
    emp = db_store.employees.get(slip["employeeId"]) or {}
    # PDF password = first 4 letters of PAN + date of birth (DDMM); employee code if no PAN
    pan = ((emp.get("statutory") or {}).get("panNumber") or "").upper()
    dob = (emp.get("dob") or "")[:10]
    hint = "First 4 letters of your PAN (capitals) followed by your date of birth as DDMM" if pan else "Your employee code followed by your date of birth as DDMM"
    password = (pan[:4] if pan else (emp.get("employeeCode") or "").replace("-", "")) + (dob[8:10] + dob[5:7] if len(dob) == 10 else "")
    out = {"payslip": slip, "pdfPasswordHint": hint}
    if slip.get("employeeId") == my_employee_id(user):
        out["pdfPassword"] = password
    return out


# ------------------------------------------------------------------ settings & structures

@router.get("/payroll/settings")
async def get_settings(user: dict = Depends(require_auth)):
    if user.get("role") not in READ_ALL + ("ACCOUNTS",):
        raise ApiError(403, "Access denied.")
    return {"settings": payroll_settings(), "defaults": DEFAULT_STATUTORY}


@router.put("/payroll/settings")
async def save_settings(request: Request, user: dict = Depends(require_role(*MAKER))):
    b = await read_body(request)
    s = payroll_settings()
    st = s["statutory"]
    old = {"pf": dict(st["pf"]), "esic": dict(st["esic"]), "defaultState": st.get("defaultState"), "minimumMonthlyWage": st.get("minimumMonthlyWage")}
    new_st = b.get("statutory") or {}
    for section, fields in (("pf", ("enabled", "eeRate", "erRate", "wageCeiling", "capAtCeiling", "epsRate")),
                            ("esic", ("enabled", "eeRate", "erRate", "grossLimit"))):
        for f in fields:
            if f in (new_st.get(section) or {}):
                v = new_st[section][f]
                if isinstance(st[section].get(f), bool):
                    st[section][f] = bool(v)
                else:
                    try:
                        v = float(v)
                    except (TypeError, ValueError):
                        raise ApiError(400, f"{section}.{f} must be a number.")
                    if v < 0 or (f.endswith("Rate") and v > 50):
                        raise ApiError(400, f"{section}.{f} is out of range.")
                    st[section][f] = v
    for key in ("pt", "lwf"):
        if isinstance(new_st.get(key), dict):
            st[key] = new_st[key]
    if new_st.get("defaultState"):
        st["defaultState"] = js_str(new_st["defaultState"]).upper()
    if "minimumMonthlyWage" in new_st:
        st["minimumMonthlyWage"] = float(new_st["minimumMonthlyWage"] or 0)
    if "variancePct" in b:
        s["variancePct"] = float(b["variancePct"] or 20)
    new = {"pf": st["pf"], "esic": st["esic"], "defaultState": st.get("defaultState"), "minimumMonthlyWage": st.get("minimumMonthlyWage")}
    audit(user, "PAYROLL_STATUTORY_UPDATED", "PAYROLL", "PayrollSettings", "settings",
          {"changes": [{"field": k, "oldValue": old[k], "newValue": new[k]} for k in old if old[k] != new[k]]})
    return {"settings": s}


@router.get("/payroll/structures")
async def list_structures(user: dict = Depends(require_role(*READ_ALL))):
    return {"structures": list(modules_store.salaryStructures.values())}


@router.post("/payroll/structures")
@router.put("/payroll/structures/{structure_id}")
async def save_structure(request: Request, structure_id: Optional[str] = None, user: dict = Depends(require_role(*MAKER))):
    b = await read_body(request)
    existing = modules_store.salaryStructures.get(structure_id) if structure_id else None
    if structure_id and not existing:
        raise ApiError(404, "Structure not found.")
    name = js_str(b.get("name") or "").strip()
    if not name:
        raise ApiError(400, "Structure name is required.")
    comps = []
    for c in b.get("components") or []:
        try:
            value = float(c.get("value") or 0)
        except (TypeError, ValueError):
            value = -1
        comps.append({"code": js_str(c.get("code") or "").strip().upper(), "name": js_str(c.get("name") or "").strip(),
                      "basis": c.get("basis"), "value": value})
    errors = validate_structure(comps)
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the structure.", errors=errors)
    sid = structure_id or f"struct_{now_ms()}_{rand_base36(4)}"
    doc = {"_id": sid, "name": name, "components": comps, "grades": [g.strip().upper() for g in b.get("grades") or [] if g.strip()],
           "employerPfInCtc": b.get("employerPfInCtc", True) is not False, "active": b.get("active", True) is not False,
           "updatedBy": actor_name(user), "updatedAt": now_iso()}
    modules_store.salaryStructures[sid] = doc
    audit(user, "SALARY_STRUCTURE_UPDATED" if existing else "SALARY_STRUCTURE_CREATED", "PAYROLL", "SalaryStructure", sid,
          {"name": name, "grades": doc["grades"],
           "changes": [{"field": "components", "oldValue": (existing or {}).get("components"), "newValue": comps}] if existing else []})
    return {"structure": doc}


@router.put("/payroll/structures/{structure_id}/assign")
async def assign_structure(structure_id: str, request: Request, user: dict = Depends(require_role(*MAKER))):
    if structure_id not in modules_store.salaryStructures:
        raise ApiError(404, "Structure not found.")
    b = await read_body(request)
    me = my_employee_id(user)
    ids = [i for i in b.get("employeeIds") or [] if i in db_store.employees]
    if me in ids:
        raise ApiError(403, "You cannot change your own salary structure.")
    for i in ids:
        db_store.employees[i]["salaryStructureId"] = structure_id
    if "grades" in b:
        modules_store.salaryStructures[structure_id]["grades"] = [g.strip().upper() for g in b["grades"] if g.strip()]
    audit(user, "SALARY_STRUCTURE_ASSIGNED", "PAYROLL", "SalaryStructure", structure_id, {"employees": ids, "grades": b.get("grades")})
    return {"structure": modules_store.salaryStructures[structure_id], "assigned": len(ids)}


@router.get("/payroll/structures/preview")
async def preview_structure(ctc: float, structureId: Optional[str] = None, employeeId: Optional[str] = None,
                            user: dict = Depends(require_role(*READ_ALL))):
    emp = dict(db_store.employees.get(employeeId or "") or {"_id": "preview", "firstName": "Sample", "lastName": "Employee",
                                                          "joiningDate": "2020-01-01", "location": ""})
    emp["salaryStructureId"] = structureId
    emp["_id"] = "preview"
    month = today_str()[:7]
    slip = compute_payslip(emp, month, _month_name(month), annual_override=ctc)
    return {"payslip": slip}


# ------------------------------------------------------------------ salary revisions (HR proposes, Finance approves)

def _revision_rows(status: Optional[str] = None) -> list:
    rows = []
    for emp in db_store.employees.values():
        for rev in emp.get("salaryRevisions") or []:
            if status and rev.get("status") != status:
                continue
            rows.append({**rev, "employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "employeeCode": emp.get("employeeCode")})
    return sorted(rows, key=lambda r: r.get("proposedAt") or r.get("approvedOn") or "", reverse=True)


@router.get("/payroll/salary-revisions")
async def list_revisions(status: Optional[str] = None, user: dict = Depends(require_role(*READ_ALL))):
    me = user["_id"]
    rows = _revision_rows(status)
    for r in rows:
        r["canDecide"] = r.get("status") == "PENDING_APPROVAL" and user.get("role") in CHECKER and r.get("proposedByUserId") != me \
            and r["employeeId"] != my_employee_id(user)
    return {"revisions": rows}


def _propose(user: dict, emp_id: str, new_salary, effective, reason: str) -> dict:
    emp = db_store.employees.get(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    if emp_id == my_employee_id(user):
        raise ApiError(403, "You cannot revise your own salary.")
    try:
        new_salary = float(new_salary)
        effective = date.fromisoformat(js_str(effective)[:10]).isoformat()
    except (TypeError, ValueError):
        raise ApiError(400, "Give the new annual CTC and the effective date (YYYY-MM-DD).")
    if new_salary <= 0:
        raise ApiError(400, "The new annual CTC must be above zero.")
    if not reason:
        raise ApiError(400, "Give the reason for the revision.")
    if any(r.get("status") == "PENDING_APPROVAL" for r in emp.get("salaryRevisions") or []):
        raise ApiError(409, f"{employee_name(emp_id)} already has a revision waiting for approval.")
    rev = {"_id": f"rev_{now_ms()}_{rand_base36(4)}", "effectiveFrom": effective, "oldSalary": salary_for_month(emp, effective[:7]),
           "newSalary": new_salary, "status": "PENDING_APPROVAL", "source": "PAYROLL", "reason": reason,
           "proposedBy": actor_name(user), "proposedByUserId": user["_id"], "proposedAt": now_iso()}
    emp.setdefault("salaryRevisions", []).append(rev)
    audit(user, "SALARY_REVISION_PROPOSED", "PAYROLL", "Employee", emp_id,
          {"employeeCode": emp.get("employeeCode"), "effectiveFrom": effective, "reason": reason,
           "changes": [{"field": "annualSalary", "oldValue": rev["oldSalary"], "newValue": new_salary}]})
    return rev


@router.post("/payroll/salary-revisions")
async def propose_revision(request: Request, user: dict = Depends(require_role(*MAKER))):
    b = await read_body(request)
    rev = _propose(user, b.get("employeeId"), b.get("newAnnualSalary"), b.get("effectiveFrom"), js_str(b.get("reason") or "").strip())
    notify_roles(CHECKER, "Salary revision awaiting approval", f"{employee_name(b.get('employeeId'))}: CTC revision effective {rev['effectiveFrom']}.", "PAYROLL")
    return {"revision": rev}


@router.post("/payroll/bulk-revision")
async def bulk_revision(request: Request, user: dict = Depends(require_role(*MAKER))):
    b = await read_body(request)
    revisions = b.get("revisions")
    if not isinstance(revisions, list) or not revisions:
        raise ApiError(400, "Revisions array with target employee IDs and new salaries is required.")
    if any(isinstance(r, dict) and r.get("employeeId") == my_employee_id(user) for r in revisions):
        raise ApiError(403, "You cannot revise your own salary. Remove yourself from the list; another approver must do it.")
    effective = b.get("effectiveDate") or today_str()
    reason = js_str(b.get("reason") or "Bulk salary revision").strip()
    created, skipped = [], []
    for r in revisions:
        try:
            created.append({"employeeId": r["employeeId"], **_propose(user, r["employeeId"], r.get("newAnnualSalary"), effective, reason)})
        except ApiError as err:
            skipped.append({"employeeId": r.get("employeeId"), "reason": err.body.get("error")})
    if created:
        notify_roles(CHECKER, "Salary revisions awaiting approval", f"{len(created)} salary revision(s) effective {effective} need approval.", "PAYROLL")
    return {"success": True, "message": f"{len(created)} revision(s) sent to Finance for approval.", "created": created, "skipped": skipped}


@router.post("/payroll/salary-revisions/{employee_id}/{revision_id}/decide")
async def decide_revision(employee_id: str, revision_id: str, request: Request, user: dict = Depends(require_role(*CHECKER))):
    emp = db_store.employees.get(employee_id)
    rev = next((r for r in (emp or {}).get("salaryRevisions") or [] if r.get("_id") == revision_id), None)
    if not rev:
        raise ApiError(404, "Revision not found.")
    if rev.get("status") != "PENDING_APPROVAL":
        raise ApiError(400, "This revision is not waiting for approval.")
    if rev.get("proposedByUserId") == user["_id"] or employee_id == my_employee_id(user):
        raise ApiError(403, "Maker-checker: you cannot approve a revision you proposed or your own salary.")
    b = await read_body(request)
    decision = b.get("decision")
    comment = js_str(b.get("comment") or "").strip()
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Give the reason for rejecting.")
    rev.update({"status": decision, "approvedBy": actor_name(user), "approvedOn": now_iso(), "decisionComment": comment or None})
    apply_due_revisions()
    notify_employee(employee_id, f"Salary revision {decision.lower()}", f"Revision effective {rev['effectiveFrom']} was {decision.lower()}.", "PAYROLL")
    audit(user, f"SALARY_REVISION_{decision}", "PAYROLL", "Employee", employee_id, {
        "effectiveFrom": rev["effectiveFrom"], "comment": comment,
        "changes": [{"field": "annualSalary", "oldValue": rev["oldSalary"], "newValue": rev["newSalary"]}] if decision == "APPROVED" else [],
    })
    return {"revision": rev}


# ------------------------------------------------------------------ inputs

@router.get("/payroll/inputs")
async def list_inputs(month: str, user: dict = Depends(require_role(*READ_ALL))):
    month = _month(month)
    rows = [{**r, "employeeName": employee_name(r["employeeId"])} for r in modules_store.payrollInputs.values()
            if r.get("month") == month and r.get("status") != "CANCELLED"]
    return {"month": month, "locked": payroll_month_locked(month), "inputs": sorted(rows, key=lambda r: (r["employeeName"], r["kind"])),
            "kinds": {k: {"label": v[0], "earning": v[1]} for k, v in PAYROLL_INPUT_KINDS.items()}, "manualKinds": MANUAL_INPUT_KINDS}


@router.post("/payroll/inputs")
async def add_input(request: Request, user: dict = Depends(require_role(*MAKER))):
    b = await read_body(request)
    month = _month(b.get("month"))
    emp_id = b.get("employeeId")
    if emp_id not in db_store.employees:
        raise ApiError(404, "Employee not found.")
    if emp_id == my_employee_id(user):
        raise ApiError(403, "You cannot add pay inputs for yourself.")
    kind = b.get("kind")
    if kind not in MANUAL_INPUT_KINDS:
        raise ApiError(400, f"Manual inputs can be {', '.join(MANUAL_INPUT_KINDS)}.")
    try:
        amount = float(b.get("amount"))
    except (TypeError, ValueError):
        raise ApiError(400, "Amount must be a number.")
    if amount <= 0:
        raise ApiError(400, "Amount must be above zero.")
    label = js_str(b.get("label") or "").strip() or PAYROLL_INPUT_KINDS[kind][0]
    row = add_payroll_input(emp_id, month, kind, amount=amount, source="MANUAL", source_id=f"manual_{now_ms()}_{rand_base36(4)}", label=label, by=user)
    audit(user, "PAYROLL_INPUT_ADDED", "PAYROLL", "PayrollInput", row["_id"], {"employeeId": emp_id, "month": month, "kind": kind, "amount": amount})
    return {"input": row}


@router.delete("/payroll/inputs/{input_id}")
async def remove_input(input_id: str, user: dict = Depends(require_role(*MAKER))):
    row = modules_store.payrollInputs.get(input_id)
    if not row or row.get("status") == "CANCELLED":
        raise ApiError(404, "Input not found.")
    if payroll_month_locked(row["month"]):
        raise ApiError(423, f"Payroll for {row['month']} is locked.")
    if row.get("source") != "MANUAL":
        raise ApiError(400, "Only manual inputs can be removed here; change the source record (leave, attendance, ...) instead.")
    row["status"] = "CANCELLED"
    audit(user, "PAYROLL_INPUT_REMOVED", "PAYROLL", "PayrollInput", input_id, {"employeeId": row["employeeId"], "month": row["month"], "kind": row["kind"]})
    return {"success": True}


# ------------------------------------------------------------------ arrears, preview, run

def _arrears(emp: dict, month: str, user: dict) -> None:
    """Approved revisions backdated into months already paid: pay the difference now as arrears
    (gross difference; the basic part attracts PF in this month's payslip)."""
    first = month + "-01"
    for rev in emp.get("salaryRevisions") or []:
        if rev.get("status") != "APPROVED" or rev["effectiveFrom"] >= first or rev.get("arrearsMonth") not in (None, month):
            continue
        gross_diff = basic_diff = 0.0
        months = []
        d = date.fromisoformat(rev["effectiveFrom"][:7] + "-01")
        while d.isoformat() < first:
            m = d.isoformat()[:7]
            paid = modules_store.payslips.get(f"pay_{emp['_id']}_{m.replace('-', '_', 1)}")
            if paid and paid.get("status") in ("APPROVED", "PAID") and paid.get("annualCtc") != rev["newSalary"]:
                new = compute_payslip(emp, m, _month_name(m), annual_override=rev["newSalary"]) or {}
                factor = 1.0
                if rev["effectiveFrom"][:7] == m:
                    dim, _, _, _ = employment_window(emp, m)
                    factor = (dim - int(rev["effectiveFrom"][8:10]) + 1) / dim
                base_gross = sum(e["amount"] for e in paid.get("earnings") or [] if "inputId" not in e) or paid.get("grossSalary") or 0
                new_gross = sum(e["amount"] for e in new.get("earnings") or [] if "inputId" not in e)
                gross_diff += (new_gross - base_gross) * factor
                basic_diff += ((new.get("basicSalary") or 0) - (paid.get("basicSalary") or 0)) * factor
                months.append(m)
            d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        if months and abs(gross_diff) >= 1:
            row = add_payroll_input(emp["_id"], month, "ARREARS", amount=round(gross_diff, 2), source="SALARY_REVISION",
                                    source_id=f"arrears:{rev['_id']}", label=f"Arrears {months[0]} to {months[-1]} (revision from {rev['effectiveFrom']})", by=user)
            row["basicPart"] = round(basic_diff, 2)
            rev["arrearsMonth"] = month
            rev["arrearsMonths"] = months


def _eligible(emp: dict, month: str) -> bool:
    if emp.get("status") in ("INACTIVE",):
        return False
    _, employed, _, _ = employment_window(emp, month)
    return employed > 0 and not (emp.get("status") in ("TERMINATED", "EXITED") and not emp.get("exitedOn"))


def _build(month: str, user: dict) -> tuple:
    apply_due_revisions()
    settings = payroll_settings()
    prev = f"{int(month[:4]) - (month[5:7] == '01')}-{12 if month[5:7] == '01' else int(month[5:7]) - 1:02d}"
    rows, exceptions = [], []
    for emp in db_store.employees.values():
        if not _eligible(emp, month):
            continue
        _arrears(emp, month, user)
        slip = compute_payslip(emp, month, _month_name(month))
        if not slip:
            exceptions.append({"employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "type": "ZERO_PAY",
                               "blocking": False, "message": "No CTC on record (or no days employed); no payslip."})
            continue
        rows.append(slip)
        add = lambda t, msg, blocking=False: exceptions.append({"employeeId": emp["_id"], "employeeName": slip["employeeName"],  # noqa: E731
                                                                 "type": t, "blocking": blocking, "message": msg})
        if slip["netSalary"] < 0:
            add("NEGATIVE_NET", f"Net pay is negative (₹{slip['netSalary']:,.0f}).", True)
        elif slip["netSalary"] == 0:
            add("ZERO_NET", "Net pay is zero.")
        if not (emp.get("bankInfo") or {}).get("accountNumber"):
            add("MISSING_BANK", "No verified bank account; salary cannot be paid by transfer.")
        if not (emp.get("statutory") or {}).get("panNumber"):
            add("MISSING_PAN", "No PAN on record; TDS has to be at 20% under section 206AA.")
        if settings["statutory"]["pf"].get("enabled") and not (emp.get("statutory") or {}).get("uanNumber"):
            add("MISSING_UAN", "No UAN; the PF ECR line cannot be filed.")
        if settings["statutory"].get("minimumMonthlyWage") and sum(e.get("full", 0) for e in slip["earnings"]) < settings["statutory"]["minimumMonthlyWage"]:
            add("BELOW_MINIMUM_WAGE", "Monthly gross is below the configured minimum wage.", True)
        last = modules_store.payslips.get(f"pay_{emp['_id']}_{prev.replace('-', '_', 1)}")
        if last and last.get("netSalary"):
            change = (slip["netSalary"] - last["netSalary"]) / last["netSalary"] * 100
            slip["variancePct"] = round(change, 1)
            slip["previousNet"] = last["netSalary"]
            if abs(change) > float(settings.get("variancePct") or 20):
                add("VARIANCE", f"Net pay changed {change:+.1f}% vs {prev} (₹{last['netSalary']:,.0f} → ₹{slip['netSalary']:,.0f}).")
        elif not last:
            add("NEW_IN_PAYROLL", "No payslip last month (new joiner or first run).")
        if slip["employedDays"] < slip["daysInMonth"]:
            add("PRORATED", f"Paid for {slip['employedDays']} of {slip['daysInMonth']} days ({slip['periodFrom']} to {slip['periodTo']}).")
    totals = {k: round(sum(r[k] for r in rows), 2) for k in ("grossSalary", "totalDeductions", "netSalary", "providentFund", "esic",
                                                               "professionalTax", "lwf", "tds")}
    totals["employerCost"] = round(sum(sum(c["amount"] for c in r["employerContributions"]) for r in rows), 2)
    totals["headcount"] = len(rows)
    return rows, exceptions, totals


@router.post("/payroll/preview")
async def preview(request: Request, user: dict = Depends(require_role(*MAKER, *CHECKER))):
    month = _month((await read_body(request)).get("month"))
    rows, exceptions, totals = _build(month, user)
    return {"month": month, "monthName": _month_name(month), "rows": rows, "exceptions": exceptions, "totals": totals,
            "run": _run(month), "locked": payroll_month_locked(month)}


@router.post("/payroll/run")
async def run_payroll(request: Request, user: dict = Depends(require_role(*MAKER))):
    """Maker step: saves the month's payslips as drafts waiting for Finance approval."""
    month = _month((await read_body(request)).get("month"))
    if payroll_month_locked(month):
        raise ApiError(423, f"Payroll for {month} is approved and locked. Request an unlock first.")
    run = _run(month)
    if run.get("status") == "PAID":
        raise ApiError(409, "Salary for this month has already been released.")
    rows, exceptions, totals = _build(month, user)
    blocking = [e for e in exceptions if e["blocking"]]
    if blocking:
        raise ApiError(400, "Fix the blocking exceptions before preparing the payroll.", exceptions=blocking)
    for key in [k for k, p in modules_store.payslips.items() if p.get("month") == month and p.get("status") in ("PENDING_APPROVAL", "REJECTED", "DRAFT")]:
        modules_store.payslips.pop(key)
    for slip in rows:
        slip.update({"status": "PENDING_APPROVAL", "processedBy": actor_name(user), "processedByUserId": user["_id"], "processedAt": now_iso()})
        modules_store.payslips[slip["_id"]] = slip
    modules_store.payrollRuns[month] = {"_id": month, "monthName": _month_name(month), "status": "PENDING_APPROVAL", "totals": totals,
                                        "exceptions": len(exceptions), "preparedBy": actor_name(user), "preparedByUserId": user["_id"],
                                        "preparedAt": now_iso(), "history": run.get("history", []) + [{"action": "PREPARED", "by": actor_name(user), "at": now_iso()}]}
    notify_roles(CHECKER, "Payroll waiting for approval", f"{_month_name(month)} payroll ({len(rows)} employees, net ₹{totals['netSalary']:,.0f}) is ready.", "PAYROLL")
    audit(user, "PAYROLL_RUN_PREPARED", "PAYROLL", "PayrollRun", month, {"payslips": len(rows), "net": totals["netSalary"], "exceptions": len(exceptions)})
    return {"success": True, "generatedCount": len(rows), "totals": totals, "exceptions": exceptions,
            "message": f"Payroll for {_month_name(month)} prepared: {len(rows)} payslips waiting for Finance approval."}


@router.get("/payroll/runs")
async def list_runs(user: dict = Depends(require_auth)):
    if user.get("role") not in READ_ALL + ("ACCOUNTS",):
        raise ApiError(403, "Access denied.")
    out = []
    for run in sorted(modules_store.payrollRuns.values(), key=lambda r: r["_id"], reverse=True):
        conflicts = []
        if user.get("role") in CHECKER:
            for p in modules_store.payslips.values():
                emp = db_store.employees.get(p.get("employeeId") or "")
                if p.get("month") == run["_id"] and emp and creator_user_id(emp) == user["_id"]:
                    conflicts.append(p.get("employeeName"))
        lock = modules_store.payrollLocks.get(run["_id"]) or {}
        out.append({**run, "locked": bool(lock.get("locked")), "unlockRequest": lock.get("unlockRequest"), "conflicts": conflicts,
                    "canApprove": user.get("role") in CHECKER and run.get("status") == "PENDING_APPROVAL"
                    and run.get("preparedByUserId") != user["_id"] and not conflicts})
    return {"runs": out}


@router.post("/payroll/approve")
async def approve_payroll(request: Request, user: dict = Depends(require_role(*CHECKER))):
    """Checker step: approve and lock. Never the preparer, never for an employee you created."""
    b = await read_body(request)
    month = _month(b.get("month"))
    run = _run(month)
    pending = [p for p in modules_store.payslips.values() if p.get("month") == month and p.get("status") == "PENDING_APPROVAL"]
    if run.get("status") != "PENDING_APPROVAL" or not pending:
        raise ApiError(400, "There is no payroll waiting for approval for this month.")
    if run.get("preparedByUserId") == user["_id"] or any(p.get("processedByUserId") == user["_id"] for p in pending):
        raise ApiError(403, "Maker-checker: you prepared this payroll run, so another payroll approver must approve it.")
    conflicts = []
    for p in pending:
        emp = db_store.employees.get(p["employeeId"]) or {}
        if creator_user_id(emp) == user["_id"]:
            conflicts.append(f"{p.get('employeeName')} ({p.get('employeeCode')}): you created this employee record")
    if conflicts:
        raise ApiError(403, "Maker-checker: you cannot approve payroll that includes these records. Another approver must approve it.",
                       conflicts=conflicts)
    for p in pending:
        p.update({"status": "APPROVED", "approvedBy": actor_name(user), "approvedByUserId": user["_id"], "approvedAt": now_iso()})
        for iid in p.get("inputIds") or []:
            if iid in modules_store.payrollInputs:
                modules_store.payrollInputs[iid]["status"] = "PROCESSED"
    run.update({"status": "APPROVED", "approvedBy": actor_name(user), "approvedAt": now_iso()})
    run.setdefault("history", []).append({"action": "APPROVED_AND_LOCKED", "by": actor_name(user), "at": now_iso()})
    lock = modules_store.payrollLocks.setdefault(month, {"_id": month, "history": []})
    lock.update({"locked": True, "lockedBy": actor_name(user), "lockedAt": now_iso(), "unlockRequest": None})
    lock["history"].append({"action": "LOCKED", "by": actor_name(user), "at": now_iso()})
    modules_store.payrollRuns[month] = run
    audit(user, "PAYROLL_APPROVED", "PAYROLL", "PayrollRun", month, {"payslips": len(pending), "preparedBy": run.get("preparedBy"), "locked": True})
    return {"success": True, "approvedCount": len(pending),
            "message": f"Payroll for {_month_name(month)} approved and locked: {len(pending)} payslips."}


@router.post("/payroll/reject")
async def reject_payroll(request: Request, user: dict = Depends(require_role(*CHECKER))):
    b = await read_body(request)
    month = _month(b.get("month"))
    comment = js_str(b.get("comment") or "").strip()
    run = _run(month)
    if run.get("status") != "PENDING_APPROVAL":
        raise ApiError(400, "There is no payroll waiting for approval for this month.")
    if not comment:
        raise ApiError(400, "Say what has to be corrected.")
    for p in modules_store.payslips.values():
        if p.get("month") == month and p.get("status") == "PENDING_APPROVAL":
            p["status"] = "REJECTED"
    run.update({"status": "REJECTED", "rejectedBy": actor_name(user), "rejectionComment": comment})
    run.setdefault("history", []).append({"action": "REJECTED", "by": actor_name(user), "at": now_iso(), "comment": comment})
    notify_roles(MAKER, "Payroll sent back", f"{_month_name(month)} payroll was sent back by {actor_name(user)}: {comment}", "PAYROLL")
    audit(user, "PAYROLL_REJECTED", "PAYROLL", "PayrollRun", month, {"comment": comment})
    return {"success": True}


@router.post("/payroll/unlock-request")
async def request_unlock(request: Request, user: dict = Depends(require_role(*MAKER))):
    b = await read_body(request)
    month = _month(b.get("month"))
    reason = js_str(b.get("reason") or "").strip()
    if not payroll_month_locked(month):
        raise ApiError(400, f"Payroll for {month} is not locked.")
    if _run(month).get("status") == "PAID":
        raise ApiError(409, "Salary for this month has been released. Make corrections in a later month (arrears / recovery).")
    if not reason:
        raise ApiError(400, "Give the reason for unlocking.")
    lock = modules_store.payrollLocks[month]
    lock["unlockRequest"] = {"reason": reason, "by": actor_name(user), "byUserId": user["_id"], "at": now_iso()}
    lock["history"].append({"action": "UNLOCK_REQUESTED", "by": actor_name(user), "at": now_iso(), "reason": reason})
    notify_roles(CHECKER, "Payroll unlock needs approval", f"{actor_name(user)} asked to unlock {month}: {reason}", "PAYROLL")
    audit(user, "PAYROLL_UNLOCK_REQUESTED", "PAYROLL", "PayrollRun", month, {"reason": reason})
    return {"lock": lock}


@router.post("/payroll/unlock/{month}/approve")
async def approve_unlock(month: str, user: dict = Depends(require_role(*CHECKER))):
    lock = modules_store.payrollLocks.get(month) or {}
    req = lock.get("unlockRequest")
    if not req:
        raise ApiError(400, "There is no unlock request for this month.")
    if req["byUserId"] == user["_id"]:
        raise ApiError(403, "Maker-checker: someone other than the requester must approve the unlock.")
    lock.update({"locked": False, "unlockedBy": actor_name(user), "unlockedAt": now_iso(), "unlockRequest": None})
    lock["history"].append({"action": "UNLOCKED", "by": actor_name(user), "at": now_iso(), "requestedBy": req["by"], "reason": req["reason"]})
    run = _run(month)
    run["status"] = "REOPENED"
    run.setdefault("history", []).append({"action": "UNLOCKED", "by": actor_name(user), "at": now_iso(), "reason": req["reason"]})
    modules_store.payrollRuns[month] = run
    for p in modules_store.payslips.values():
        if p.get("month") == month and p.get("status") == "APPROVED":
            p["status"] = "REJECTED"
    audit(user, "PAYROLL_UNLOCKED", "PAYROLL", "PayrollRun", month, {"requestedBy": req["by"], "reason": req["reason"]})
    return {"lock": lock}


# ------------------------------------------------------------------ register, bank advice, release, statutory files

def _approved(month: str) -> list:
    return sorted([p for p in modules_store.payslips.values() if p.get("month") == month and p.get("status") in ("APPROVED", "PAID")],
                  key=lambda p: p.get("employeeCode") or "")


@router.get("/payroll/register")
async def register(month: str, user: dict = Depends(require_auth)):
    month = _month(month)
    slips = [p for p in modules_store.payslips.values() if p.get("month") == month]
    if user.get("role") == "ACCOUNTS":
        # Accounts: totals per department only, no individual salaries
        by_dept: dict = {}
        for p in slips:
            if p.get("status") not in ("APPROVED", "PAID"):
                continue
            d = by_dept.setdefault(p.get("department") or "Unassigned", {"department": p.get("department") or "Unassigned", "headcount": 0,
                                                                         "gross": 0.0, "deductions": 0.0, "net": 0.0, "employerCost": 0.0})
            d["headcount"] += 1
            d["gross"] += p.get("grossSalary") or 0
            d["deductions"] += p.get("totalDeductions") or 0
            d["net"] += p.get("netSalary") or 0
            d["employerCost"] += sum(c["amount"] for c in p.get("employerContributions") or [])
        return {"month": month, "summaryOnly": True, "departments": list(by_dept.values())}
    if user.get("role") not in READ_ALL:
        raise ApiError(403, "Access denied: the payroll register is for HR, Finance and Auditors.")
    return {"month": month, "run": _run(month), "rows": sorted(slips, key=lambda p: p.get("employeeCode") or ""),
            "totals": {k: round(sum(p.get(k) or 0 for p in slips), 2) for k in ("grossSalary", "totalDeductions", "netSalary", "tds", "providentFund")}}


@router.get("/payroll/bank-advice")
async def bank_advice(month: str, user: dict = Depends(require_role(*CHECKER))):
    month = _month(month)
    if _run(month).get("status") not in ("APPROVED", "PAID"):
        raise ApiError(400, "The bank advice can only be generated after the payroll is approved.")
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Sr No", "Employee Code", "Beneficiary Name", "Account Number", "IFSC", "Amount", "Payment Mode", "Narration"])
    total, held, n, skipped = 0.0, 0.0, 0, []
    payroll_net = 0.0
    for p in _approved(month):
        payroll_net += max(0.0, p["netSalary"])
        emp = db_store.employees.get(p["employeeId"]) or {}
        bank = emp.get("bankInfo") or {}
        if not bank.get("accountNumber") or not bank.get("ifsc") or p["netSalary"] <= 0:
            # no verified bank account on file: the salary is held, not sent to an unknown account
            skipped.append(p.get("employeeCode"))
            held += max(0.0, p["netSalary"])
            continue
        n += 1
        total += p["netSalary"]
        w.writerow([n, p.get("employeeCode"), bank.get("accountHolder") or p.get("employeeName"), bank["accountNumber"], bank["ifsc"],
                    f"{p['netSalary']:.2f}", "NEFT", f"SALARY {_month_name(month).upper()}"])
    w.writerow([])
    w.writerow(["TOTAL", "", "", "", "", f"{total:.2f}", f"{n} transfers", ""])
    if skipped:
        w.writerow(["HELD - no verified bank account", "", "", "", "", f"{held:.2f}", f"{len(skipped)} employees", " ".join(s for s in skipped if s)])
    w.writerow(["PAYROLL NET (transfers + held)", "", "", "", "", f"{total + held:.2f}", "", "matches payroll register" if abs(total + held - payroll_net) < 0.01 else "MISMATCH"])
    audit(user, "PAYROLL_BANK_ADVICE_GENERATED", "PAYROLL", "PayrollRun", month,
          {"transfers": n, "total": round(total, 2), "held": round(held, 2), "skipped": skipped})
    return Response(out.getvalue().encode("utf-8"), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="salary_bank_advice_{month}.csv"'})


@router.post("/payroll/release")
async def release_payment(request: Request, user: dict = Depends(require_role(*CHECKER))):
    b = await read_body(request)
    month = _month(b.get("month"))
    run = _run(month)
    if run.get("status") != "APPROVED":
        raise ApiError(400, "Only an approved payroll can be released.")
    reference = js_str(b.get("reference") or "").strip()
    if not reference:
        raise ApiError(400, "Give the bank batch / UTR reference.")
    for p in _approved(month):
        p.update({"status": "PAID", "payDate": today_str(), "transactionId": reference, "releasedBy": actor_name(user)})
        notify_employee(p["employeeId"], "Salary credited", f"Your salary for {_month_name(month)} has been released.", "PAYROLL")
    run.update({"status": "PAID", "releasedBy": actor_name(user), "releasedAt": now_iso(), "paymentReference": reference})
    run.setdefault("history", []).append({"action": "PAYMENT_RELEASED", "by": actor_name(user), "at": now_iso(), "reference": reference})
    audit(user, "PAYROLL_PAYMENT_RELEASED", "PAYROLL", "PayrollRun", month, {"reference": reference})
    return {"success": True, "run": run}


@router.get("/payroll/statutory/{kind}")
async def statutory_file(kind: str, month: str, user: dict = Depends(require_role(*READ_ALL))):
    month = _month(month)
    slips = _approved(month)
    if not slips:
        raise ApiError(400, "No approved payroll for this month.")
    out = io.StringIO()
    if kind == "pf-ecr":
        # EPFO ECR text format: UAN#~#Name#~#Gross#~#EPF wages#~#EPS wages#~#EDLI wages#~#EE share#~#EPS#~#ER (EPF-EPS) diff#~#NCP days#~#Refund
        for p in slips:
            pf = next((d for d in p.get("deductions") or [] if d["code"] == "PF"), None)
            er = next((c for c in p.get("employerContributions") or [] if c["code"] == "PF_ER"), None)
            if not pf or not er:
                continue
            out.write("#~#".join(str(x) for x in [p.get("pfUan") or "", p.get("employeeName"), round(p["grossSalary"]), round(pf["wage"]),
                                                  round(er["epsWage"]), round(er["epsWage"]), round(pf["amount"]), er["eps"], er["epf"],
                                                  round(p.get("lopDays") or 0), 0]) + "\n")
        name, mime = f"PF_ECR_{month}.txt", "text/plain"
    else:
        w = csv.writer(out)
        if kind == "esic":
            w.writerow(["IP Number", "Name", "Days paid", "Wages", "Employee contribution", "Employer contribution"])
            for p in slips:
                ee = next((d for d in p.get("deductions") or [] if d["code"] == "ESIC"), None)
                if ee:
                    er = next((c for c in p.get("employerContributions") or [] if c["code"] == "ESIC_ER"), {"amount": 0})
                    w.writerow([p.get("esicNumber") or "", p.get("employeeName"), p.get("workedDays"), round(ee["wage"], 2), ee["amount"], er["amount"]])
        elif kind == "pt":
            w.writerow(["State", "Employee Code", "Name", "Gross", "Professional Tax"])
            for p in slips:
                w.writerow([p.get("state"), p.get("employeeCode"), p.get("employeeName"), round(p["grossSalary"], 2), p.get("professionalTax") or 0])
        elif kind == "lwf":
            w.writerow(["State", "Employee Code", "Name", "Employee LWF", "Employer LWF"])
            for p in slips:
                if p.get("lwf"):
                    er = next((c for c in p.get("employerContributions") or [] if c["code"] == "LWF_ER"), {"amount": 0})
                    w.writerow([p.get("state"), p.get("employeeCode"), p.get("employeeName"), p["lwf"], er["amount"]])
        else:
            raise ApiError(400, "File type must be pf-ecr, esic, pt or lwf.")
        name, mime = f"{kind.upper()}_{month}.csv", "text/csv"
    audit(user, "PAYROLL_STATUTORY_FILE", "PAYROLL", "PayrollRun", month, {"file": kind})
    return Response(out.getvalue().encode("utf-8"), media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/payroll/form16")
async def form16(fy: Optional[str] = None, employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    from app.routes.tax_declarations import declaration_for, deduction_total
    from app.utils.payroll_engine import annual_tax
    target = employeeId or my_employee_id(user)
    if target != my_employee_id(user) and user.get("role") not in READ_ALL:
        raise ApiError(403, "Access denied: you can only view your own Form 16.")
    emp = db_store.employees.get(target or "")
    if not emp:
        raise ApiError(404, "Employee not found.")
    fy = fy or fy_of(today_str())
    start = int(fy[:4])
    months = [f"{start + (1 if m < 4 else 0)}-{m:02d}" for m in list(range(4, 13)) + [1, 2, 3]]
    slips = [p for p in modules_store.payslips.values() if p.get("employeeId") == target and p.get("month") in months and p.get("status") in ("APPROVED", "PAID")]
    gross = sum(p.get("grossSalary") or 0 for p in slips)
    pf = sum(p.get("providentFund") or 0 for p in slips)
    pt = sum(p.get("professionalTax") or 0 for p in slips)
    tds = sum(p.get("tds") or 0 for p in slips)
    decl = declaration_for(target, fy)
    regime = decl.get("regime") or "NEW"
    from app.utils.income_tax import PARAMETERS as TAXP
    std = TAXP["stdDeductionOld"] if regime == "OLD" else TAXP["stdDeductionNew"]
    chapter6 = deduction_total(decl, regime, pf)
    taxable = max(0.0, gross - std - (pt if regime == "OLD" else 0) - chapter6)
    quarters = []
    for q, ms in (("Q1 (Apr-Jun)", months[0:3]), ("Q2 (Jul-Sep)", months[3:6]), ("Q3 (Oct-Dec)", months[6:9]), ("Q4 (Jan-Mar)", months[9:12])):
        qs = [p for p in slips if p["month"] in ms]
        quarters.append({"quarter": q, "gross": round(sum(p["grossSalary"] for p in qs), 2), "tds": round(sum(p.get("tds") or 0 for p in qs), 2)})
    return {"fy": fy, "employee": {"name": employee_name(target), "employeeCode": emp.get("employeeCode"),
                                   "pan": (emp.get("statutory") or {}).get("panNumber") or (emp.get("statutory") or {}).get("panMasked"),
                                   "designation": emp.get("designation")},
            "months": len(slips), "partA": {"quarters": quarters, "totalTds": round(tds, 2)},
            "partB": {"grossSalary": round(gross, 2), "standardDeduction": std, "professionalTax": round(pt, 2), "regime": regime,
                      "chapterVIA": round(chapter6, 2), "taxableIncome": round(taxable), "taxOnIncome": annual_tax(taxable, regime),
                      "tdsDeducted": round(tds, 2), "providentFund": round(pf, 2)}}


@router.get("/payroll/salary-structure")
async def salary_structure(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    """CTC breakup shown on the Payroll page. Employees get their own; HR / Finance / Auditors may pick anyone."""
    can_see_all = user.get("role") in READ_ALL
    target = employeeId if can_see_all and employeeId else user.get("employeeId")
    emp = db_store.employees.get(target) if target else None
    if not emp:
        raise ApiError(404, "No employee record found for salary structure.")
    annual_ctc = emp.get("annualSalary") or 0
    payload = {
        "employee": {"_id": emp["_id"], "name": f"{emp.get('firstName')} {emp.get('lastName')}", "employeeCode": emp.get("employeeCode"),
                     "designation": emp.get("designation"), "department": emp.get("department")},
        "annualCtc": annual_ctc,
        "structure": compute_salary_structure(annual_ctc),
        "canEditCtc": False,  # salary changes go through a salary revision (HR proposes, Finance approves)
    }
    if can_see_all:
        payload["employees"] = [{"_id": e["_id"], "name": f"{e.get('firstName')} {e.get('lastName')}", "employeeCode": e.get("employeeCode"),
                                 "annualCtc": e.get("annualSalary") or 0} for e in db_store.employees.values()]
    return payload


# -------------------------------------------------------------------- tax

@router.get("/tax/declaration")
async def get_tax_declaration(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    target = employeeId if user.get("role") == "ADMIN" and employeeId else (user.get("employeeId") or "emp_admin_01")
    return {"declaration": modules_store.get_tax_declaration(target)}


@router.post("/tax/declaration")
async def save_tax_declaration(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    declaration = modules_store.save_tax_declaration(user.get("employeeId") or "emp_admin_01", body)
    return {"success": True, "declaration": declaration}


def _require_finance_admin(user: dict, message: str) -> None:
    if user.get("role") not in ("ADMIN", "FINANCE"):
        raise ApiError(403, message)


def _own_rows(user: dict, data: dict) -> dict:
    emp = db_store.employees.get(user.get("employeeId") or "") or {}
    pan = ((emp.get("statutory") or {}).get("panNumber") or "").upper()
    full = f"{emp.get('firstName') or ''} {emp.get('lastName') or ''}".strip().lower()
    rows = [e for e in data.get("employees") or []
            if (pan and (e.get("PAN") or "").upper() == pan) or (full and (e.get("name") or "").strip().lower() == full)]
    return {**data, "employees": rows}


def _require_payroll_read(user: dict) -> None:
    if not can_read(user, "payroll"):
        raise ApiError(403, "Access denied: company tax filings are only available to payroll roles.")


@router.get("/tax/form24q")
async def form24q(user: dict = Depends(require_auth)):
    data = modules_store.get_form24q_data()
    return {"success": True, "data": data if can_read(user, "payroll") else _own_rows(user, data)}


@router.put("/tax/form24q/status")
async def form24q_status(request: Request, user: dict = Depends(require_auth)):
    _require_finance_admin(user, "Unauthorized to modify TDS filing status")
    body = await read_body(request)
    status = body.get("status")
    if status not in ("Draft", "Filed", "Acknowledged"):
        raise ApiError(400, "Invalid status. Must be Draft, Filed, or Acknowledged.")
    return {"success": True, "form24q": modules_store.update_form24q_status(status, body.get("acknowledgementNumber"))}


@router.put("/tax/form24q/summary")
async def form24q_summary(request: Request, user: dict = Depends(require_auth)):
    _require_finance_admin(user, "Unauthorized to update TDS filing summary")
    body = await read_body(request)
    return {"success": True, "form24q": modules_store.update_form24q_summary(body)}


@router.post("/tax/form24q/validate")
async def form24q_validate(user: dict = Depends(require_auth)):
    _require_payroll_read(user)
    try:
        return {"success": True, "validation": modules_store.validate_form24q()}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to validate TDS Form 24Q", details=str(err))


@router.get("/tax/form24q/q1")
async def form24q_q1(user: dict = Depends(require_auth)):
    data = modules_store.get_form24q_data_q1()
    return {"success": True, "data": data if can_read(user, "payroll") else _own_rows(user, data)}


@router.get("/tax/cross-quarter-analysis")
async def cross_quarter(user: dict = Depends(require_auth)):
    _require_payroll_read(user)
    try:
        return {"success": True, "analysis": modules_store.get_cross_quarter_analysis()}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to analyze cross-quarter TDS", details=str(err))


def _require_own_pan_or_payroll(user: dict, pan: str) -> None:
    if can_read(user, "payroll"):
        return
    if not _own_rows(user, {"employees": [{"PAN": pan, "name": ""}]})["employees"]:
        raise ApiError(403, "Access denied: you can only view your own tax history.")


@router.get("/tax/employee/{pan}/history")
async def employee_tax_history(pan: str, user: dict = Depends(require_auth)):
    _require_own_pan_or_payroll(user, pan)
    try:
        return {"success": True, "history": modules_store.get_employee_full_year_history(pan)}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to fetch employee TDS history", details=str(err))


@router.get("/tax/employee/{pan}/projection")
async def employee_tax_projection(pan: str, user: dict = Depends(require_auth)):
    _require_own_pan_or_payroll(user, pan)
    try:
        return {"success": True, "projection": modules_store.calculate_employee_projection(pan)}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to calculate TDS projection", details=str(err))
