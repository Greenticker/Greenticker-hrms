"""Income tax calculator (TY 2026-27) and salary arrear calculator endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils import income_tax, salary_arrear
from app.utils.jsutil import today_str
from app.utils.salary_structure import compute_salary_structure

router = APIRouter()

PAYROLL_ROLES = ("ADMIN", "SUPER_ADMIN", "ADMIN_1", "HR", "FINANCE", "ACCOUNTS")


def _target_employee(user: dict, employee_id: Optional[str]) -> dict:
    """Payroll roles may pick any employee; everyone else gets their own record."""
    target = employee_id if employee_id and user.get("role") in PAYROLL_ROLES else user.get("employeeId")
    emp = db_store.employees.get(target) if target else None
    if not emp:
        raise ApiError(404, "No employee record found.")
    return emp


def _employee_list(user: dict) -> Optional[list]:
    if user.get("role") not in PAYROLL_ROLES:
        return None
    return [
        {"_id": e["_id"], "name": f"{e.get('firstName')} {e.get('lastName')}", "employeeCode": e.get("employeeCode")}
        for e in db_store.employees.values()
    ]


def _annual(structure: dict, key: str) -> float:
    for line in structure["wages"] + structure["allowances"]:
        if line["key"] == key:
            return line["yearly"]
    return 0


# ------------------------------------------------------------- income tax

@router.get("/payroll/income-tax/options")
async def income_tax_options(user: dict = Depends(require_auth)):
    return {**income_tax.options(), "defaults": income_tax.default_inputs(), "employees": _employee_list(user)}


@router.get("/payroll/income-tax/prefill")
async def income_tax_prefill(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    """Calculator inputs built from the employee's CTC (Greenticker salary structure) and their
    saved tax declaration. Example-only values from the workbook are cleared."""
    emp = _target_employee(user, employeeId)
    inputs = income_tax.default_inputs()
    inputs["ctc"] = {k: 0 for k in inputs["ctc"]}
    inputs["otherIncome"] = {k: 0 for k in inputs["otherIncome"]}
    for key in inputs["exemptions"]:
        if isinstance(inputs["exemptions"][key], (int, float)) and not isinstance(inputs["exemptions"][key], bool):
            inputs["exemptions"][key] = 0
    inputs["exemptions"]["rentMonths"] = 12
    inputs["perquisites"]["telephoneBills"] = 0
    inputs["perquisites"]["meals"] = 0
    for key, value in inputs["deductions"].items():
        if isinstance(value, bool):
            inputs["deductions"][key] = False
        elif isinstance(value, (int, float)):
            inputs["deductions"][key] = 0

    statutory = emp.get("statutory") or {}
    inputs["employee"] = {
        "name": f"{emp.get('firstName')} {emp.get('lastName')}",
        "code": emp.get("employeeCode") or "",
        "pan": statutory.get("panNumber") or statutory.get("panMasked") or "",
    }
    location = (emp.get("location") or "").lower()
    inputs["city"] = next((c for c in income_tax.METRO_CITIES if c.lower() in location), "Other city")

    annual_ctc = float(emp.get("annualSalary") or 0)
    if annual_ctc > 0:
        s = compute_salary_structure(annual_ctc)
        ppf = _annual(s, "ppf")
        inputs["ctc"].update({
            "basic": _annual(s, "basic"),
            "hra": _annual(s, "hra"),
            "special": _annual(s, "special"),
            "lta": _annual(s, "lta"),
            "childrenEducation": _annual(s, "education"),
            "conveyance": _annual(s, "conveyance"),
            "otherTaxable": _annual(s, "bfaa"),
            "employerPf": ppf,
            "insurance": _annual(s, "medical"),
        })
        inputs["deductions"]["pfEmployee"] = ppf  # employee PF = 12% of Basic

    decl = modules_store.get_tax_declaration(emp["_id"])
    if decl:
        inputs["regime"] = "OLD" if decl.get("regime") == "OLD" else "NEW"
        c80 = decl.get("section80C") or {}
        inputs["deductions"].update({
            "ppf": c80.get("ppf") or 0,
            "elss": c80.get("elss") or 0,
            "lifeInsurance": c80.get("lifeInsurance") or 0,
            "taxSaverFd": c80.get("taxSaverFD") or 0,
            "nps80CCD1B": decl.get("section80CCD_1B") or 0,
            "homeLoan80EE": decl.get("homeLoanInterest80EE") or 0,
            "healthSelf": (decl.get("section80D") or {}).get("selfSpouseChildren") or 0,
            "healthParents": (decl.get("section80D") or {}).get("parents") or 0,
        })
        hra = decl.get("hraExemption") or {}
        inputs["exemptions"]["rentPaid"] = hra.get("annualRentPaid") or 0
    else:
        inputs["regime"] = "NEW"

    return {"inputs": inputs, "result": income_tax.compute(inputs), "hasDeclaration": bool(decl), "annualCtc": annual_ctc}


@router.post("/payroll/income-tax/calculate")
async def income_tax_calculate(request: Request, _: dict = Depends(require_auth)):
    body = await read_body(request)
    return income_tax.compute(body.get("inputs") if isinstance(body.get("inputs"), dict) else body)


# ---------------------------------------------------------------- arrears

@router.get("/payroll/arrears/options")
async def arrear_options(user: dict = Depends(require_role(*PAYROLL_ROLES))):
    return {"defaults": salary_arrear.default_inputs(), "employees": _employee_list(user),
            "maxMonths": salary_arrear.MAX_MONTHS, "maxComponents": salary_arrear.MAX_COMPONENTS}


@router.get("/payroll/arrears/prefill")
async def arrear_prefill(employeeId: Optional[str] = None, user: dict = Depends(require_role(*PAYROLL_ROLES))):
    """Current monthly components from the employee's CTC as the OLD salary; revised starts equal."""
    emp = _target_employee(user, employeeId)
    inputs = salary_arrear.default_inputs()
    inputs.update({
        "employeeCode": emp.get("employeeCode") or "",
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "dateOfJoining": emp.get("joiningDate") or None,
        "payrollMonth": today_str()[:8] + "01",
    })
    annual_ctc = float(emp.get("annualSalary") or 0)
    if annual_ctc > 0:
        s = compute_salary_structure(annual_ctc)
        # "PPF Allowance" is the employer PF itself; the engine computes employer PF separately.
        inputs["components"] = [
            {"name": line["label"], "old": line["monthly"], "revised": line["monthly"],
             "pfWage": line["key"] == "basic", "esicWage": True}
            for line in s["wages"] + s["allowances"]
            if line["key"] != "ppf"
        ]
    else:
        inputs["components"] = []
    return {"inputs": inputs, "result": salary_arrear.compute(inputs), "annualCtc": annual_ctc}


@router.post("/payroll/arrears/calculate")
async def arrear_calculate(request: Request, _: dict = Depends(require_role(*PAYROLL_ROLES))):
    body = await read_body(request)
    return salary_arrear.compute(body.get("inputs") if isinstance(body.get("inputs"), dict) else body)
