from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import clean_num, format_en_us, now_iso, now_ms, num, rand_base36, today_str, truthy
from app.utils.salary_structure import compute_salary_structure

router = APIRouter()


# ---------------------------------------------------------------- payroll

@router.get("/payroll/payslips")
async def payslips(month: Optional[str] = None, employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    slips = modules_store.get_payslips(user, month=month, employee_id=employeeId)
    summary = {
        "totalSlips": len(slips),
        "totalDisbursed": clean_num(sum(p.get("grossSalary") or 0 for p in slips)),
        "totalDeductions": clean_num(sum(p.get("totalDeductions") or 0 for p in slips)),
        "netPayout": clean_num(sum(p.get("netSalary") or 0 for p in slips)),
    }
    return {"payslips": slips, "summary": summary}


@router.post("/payroll/run")
async def run_payroll(request: Request, user: dict = Depends(require_role("ADMIN", "FINANCE"))):
    body = await read_body(request)
    month, month_name = body.get("month"), body.get("monthName")
    if not truthy(month) or not truthy(month_name):
        raise ApiError(400, "Month (YYYY-MM) and monthName are required.")
    generated = modules_store.run_monthly_payroll(month, month_name, f"{user.get('firstName') or 'Admin'} {user.get('lastName') or ''}")
    return {
        "success": True,
        "message": f"Payroll run completed for {month_name}. Generated {len(generated)} payslips.",
        "generatedCount": len(generated),
    }


@router.post("/payroll/bulk-revision")
async def bulk_revision(request: Request, user: dict = Depends(require_role("ADMIN", "FINANCE"))):
    body = await read_body(request)
    revisions = body.get("revisions")
    effective_date = body.get("effectiveDate")
    reason = body.get("reason")
    if not isinstance(revisions, list) or not revisions:
        raise ApiError(400, "Revisions array with target employee IDs and new salaries is required.")

    updated = []
    for rev in revisions:
        if not isinstance(rev, dict):
            continue
        emp = db_store.employees.get(rev.get("employeeId"))
        if not emp:
            continue
        old_salary = emp.get("annualSalary") or 0
        new_salary = num(rev.get("newAnnualSalary"))
        emp["annualSalary"] = new_salary

        db_store.lifecycleEvents.insert(0, {
            "_id": f"lc_{now_ms()}_{rand_base36(4)}",
            "employeeId": emp["_id"],
            "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
            "employeeCode": emp.get("employeeCode"),
            "department": emp.get("department"),
            "eventType": "SALARY_REVISION",
            "effectiveDate": effective_date or today_str(),
            "previousValue": f"₹{format_en_us(old_salary)}",
            "newValue": f"₹{format_en_us(new_salary) if new_salary is not None else 'NaN'}",
            "reason": reason or "Annual Bulk Salary Revision",
            "initiatedBy": user.get("email") or "Admin",
            "initiatedAt": now_iso(),
            "approvalStatus": "APPROVED",
        })
        updated.append({"id": emp["_id"], "name": f"{emp.get('firstName')} {emp.get('lastName')}", "oldSalary": old_salary, "newSalary": new_salary})

    details = {k: v for k, v in {"count": len(updated), "effectiveDate": effective_date, "reason": reason}.items() if v is not None}
    audit({**user, "role": "ADMIN"}, "BULK_SALARY_REVISION", "PAYROLL", "SalaryRevision", f"rev_{now_ms()}", details)
    return {
        "success": True,
        "message": f"Bulk salary revision executed successfully for {len(updated)} employees.",
        "updatedEmployees": updated,
    }


@router.get("/payroll/salary-structure")
async def salary_structure(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    """Salary structure (FY 2026-27) - CTC breakup shown on the Payroll page.
    Employees get their own CTC; ADMIN can pick any employee."""
    can_see_all = user.get("role") == "ADMIN"
    target = employeeId if can_see_all and employeeId else user.get("employeeId")
    emp = db_store.employees.get(target) if target else None
    if not emp:
        raise ApiError(404, "No employee record found for salary structure.")

    annual_ctc = emp.get("annualSalary") or 0
    payload = {
        "employee": {
            "_id": emp["_id"],
            "name": f"{emp.get('firstName')} {emp.get('lastName')}",
            "employeeCode": emp.get("employeeCode"),
            "designation": emp.get("designation"),
            "department": emp.get("department"),
        },
        "annualCtc": annual_ctc,
        "structure": compute_salary_structure(annual_ctc),
        "canEditCtc": can_see_all,
    }
    if can_see_all:
        payload["employees"] = [
            {
                "_id": e["_id"],
                "name": f"{e.get('firstName')} {e.get('lastName')}",
                "employeeCode": e.get("employeeCode"),
                "annualCtc": e.get("annualSalary") or 0,
            }
            for e in db_store.employees.values()
        ]
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


@router.get("/tax/form24q")
async def form24q(_: dict = Depends(require_auth)):
    return {"success": True, "data": modules_store.get_form24q_data()}


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
async def form24q_validate(_: dict = Depends(require_auth)):
    try:
        return {"success": True, "validation": modules_store.validate_form24q()}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to validate TDS Form 24Q", details=str(err))


@router.get("/tax/form24q/q1")
async def form24q_q1(_: dict = Depends(require_auth)):
    return {"success": True, "data": modules_store.get_form24q_data_q1()}


@router.get("/tax/cross-quarter-analysis")
async def cross_quarter(_: dict = Depends(require_auth)):
    try:
        return {"success": True, "analysis": modules_store.get_cross_quarter_analysis()}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to analyze cross-quarter TDS", details=str(err))


@router.get("/tax/employee/{pan}/history")
async def employee_tax_history(pan: str, _: dict = Depends(require_auth)):
    try:
        return {"success": True, "history": modules_store.get_employee_full_year_history(pan)}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to fetch employee TDS history", details=str(err))


@router.get("/tax/employee/{pan}/projection")
async def employee_tax_projection(pan: str, _: dict = Depends(require_auth)):
    try:
        return {"success": True, "projection": modules_store.calculate_employee_projection(pan)}
    except Exception as err:  # noqa: BLE001
        raise ApiError(500, "Failed to calculate TDS projection", details=str(err))
