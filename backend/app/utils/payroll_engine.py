"""
Payroll calculation for one employee and one month.

Salary structure
- Default: the company's standard structure (utils/salary_structure.py) so existing pay is unchanged.
- HR can define structures with components: basis PCT_CTC / PCT_BASIC / FIXED / BALANCE
  (monthly amounts), assigned to grades or to individual employees (employee wins over grade).
Statutory (settings, editable by HR): PF (rate, wage ceiling cap on/off), ESIC (gross limit),
Professional Tax by state slab, Labour Welfare Fund by state and month, TDS by regime using
the employee's investment declaration.
Month inputs come from utils/workflow payroll inputs (LOP days, overtime, encashment, arrears,
variable pay, reimbursements, loan EMIs, recoveries, insurance premium).
Mid-month joiners / leavers are prorated on calendar days.
"""

import calendar
import math
from datetime import date
from typing import Optional

from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.income_tax import PARAMETERS as TAX
from app.utils.salary_structure import compute_salary_structure
from app.utils.salary_revisions import salary_for_month
from app.utils.workflow import PAYROLL_INPUT_KINDS, payroll_inputs_for

DEFAULT_STRUCTURE_ID = "struct_standard"

DEFAULT_STATUTORY = {
    "pf": {"enabled": True, "eeRate": 12.0, "erRate": 12.0, "wageCeiling": 15000, "capAtCeiling": False, "epsRate": 8.33},
    "esic": {"enabled": True, "eeRate": 0.75, "erRate": 3.25, "grossLimit": 21000},
    # (gross up to, monthly tax); None = above the last limit
    "pt": {
        "MAHARASHTRA": {"slabs": [[7500, 0], [10000, 175], [None, 200]], "februaryTop": 300, "femaleExemptUpTo": 25000},
        "KARNATAKA": {"slabs": [[24999, 0], [None, 200]]},
        "TELANGANA": {"slabs": [[15000, 0], [20000, 150], [None, 200]]},
        "WEST BENGAL": {"slabs": [[10000, 0], [15000, 110], [25000, 130], [40000, 150], [None, 200]]},
        "GUJARAT": {"slabs": [[11999, 0], [None, 200]]},
    },
    "lwf": {
        "MAHARASHTRA": {"months": [6, 12], "ee": 25, "er": 75},
        "KARNATAKA": {"months": [1], "ee": 50, "er": 100},
        "TELANGANA": {"months": [1], "ee": 2, "er": 5},
        "GUJARAT": {"months": [6, 12], "ee": 6, "er": 12},
    },
    "defaultState": "MAHARASHTRA",
    "minimumMonthlyWage": 0,
}

CITY_STATE = {"pune": "MAHARASHTRA", "mumbai": "MAHARASHTRA", "bengaluru": "KARNATAKA", "bangalore": "KARNATAKA",
              "hyderabad": "TELANGANA", "delhi": "DELHI", "gurgaon": "HARYANA", "noida": "UTTAR PRADESH",
              "kolkata": "WEST BENGAL", "ahmedabad": "GUJARAT", "chennai": "TAMIL NADU"}


# ------------------------------------------------------------------ settings / structures

def payroll_settings() -> dict:
    if "settings" not in modules_store.payrollSettings:
        import copy
        modules_store.payrollSettings["settings"] = {"_id": "settings", "statutory": copy.deepcopy(DEFAULT_STATUTORY),
                                                     "declarationWindow": {"open": True, "until": None},
                                                     "proofWindow": {"open": False, "until": None},
                                                     "variancePct": 20}
    return modules_store.payrollSettings["settings"]


def structure_for(emp: dict) -> Optional[dict]:
    """HR-defined structure assigned to the employee, else to their grade, else None (default)."""
    sid = emp.get("salaryStructureId")
    if sid and sid in modules_store.salaryStructures:
        return modules_store.salaryStructures[sid]
    grade = (emp.get("grade") or "").upper()
    if grade:
        for s in modules_store.salaryStructures.values():
            if s.get("active", True) and grade in [g.upper() for g in s.get("grades") or []]:
                return s
    return None


def state_of(emp: dict) -> str:
    st = payroll_settings()["statutory"]
    loc_name = (emp.get("location") or "").strip().lower()
    for loc in db_store.locations.values():
        if (loc.get("name") or "").strip().lower() == loc_name and loc.get("state"):
            return loc["state"].strip().upper()
    for city, state in CITY_STATE.items():
        if city in loc_name:
            return state
    return st.get("defaultState") or "MAHARASHTRA"


def monthly_components(emp: dict, annual_ctc: float) -> dict:
    """{'earnings': [(code, name, monthly)], 'basic': x, 'structure': name, 'employerPf': y}."""
    struct = structure_for(emp)
    pf = payroll_settings()["statutory"]["pf"]
    if not struct:
        s = compute_salary_structure(annual_ctc)
        lines = {l["key"]: l for l in s["wages"] + s["allowances"]}
        earnings = [(k.upper(), lines[k]["label"], lines[k]["monthly"]) for k in ("basic", "hra", "special", "conveyance", "lta", "education")]
        return {"earnings": earnings, "basic": lines["basic"]["monthly"], "structure": "Standard structure"}
    monthly_ctc = annual_ctc / 12
    comps = struct.get("components") or []
    values: dict = {}
    for c in comps:
        if c["basis"] == "PCT_CTC":
            values[c["code"]] = monthly_ctc * c["value"] / 100
        elif c["basis"] == "FIXED":
            values[c["code"]] = float(c["value"])
    basic = values.get("BASIC", 0)
    for c in comps:
        if c["basis"] == "PCT_BASIC":
            values[c["code"]] = basic * c["value"] / 100
    # Employer PF sits inside CTC, so the balancing component is what is left after it
    pf_wage = min(basic, pf["wageCeiling"]) if pf.get("capAtCeiling") else basic
    employer_pf = pf_wage * pf["erRate"] / 100 if pf.get("enabled") and struct.get("employerPfInCtc", True) else 0
    for c in comps:
        if c["basis"] == "BALANCE":
            values[c["code"]] = monthly_ctc - sum(v for k, v in values.items() if k != c["code"]) - employer_pf
    earnings = [(c["code"], c["name"], round(values.get(c["code"], 0), 2)) for c in comps]
    return {"earnings": earnings, "basic": basic, "structure": struct.get("name")}


def validate_structure(components: list) -> list:
    errors = []
    codes = [c.get("code") for c in components]
    if "BASIC" not in codes:
        errors.append("A structure needs a BASIC component.")
    if len(set(codes)) != len(codes):
        errors.append("Component codes must be unique.")
    if sum(1 for c in components if c.get("basis") == "BALANCE") > 1:
        errors.append("Only one component can be the balancing amount.")
    for c in components:
        if c.get("basis") not in ("PCT_CTC", "PCT_BASIC", "FIXED", "BALANCE"):
            errors.append(f"{c.get('code')}: basis must be PCT_CTC, PCT_BASIC, FIXED or BALANCE.")
        if c.get("basis") != "BALANCE" and (not isinstance(c.get("value"), (int, float)) or c["value"] < 0):
            errors.append(f"{c.get('code')}: value must be a positive number.")
        if c.get("code") == "BASIC" and c.get("basis") == "PCT_BASIC":
            errors.append("BASIC cannot be a percentage of itself.")
    return errors


# ------------------------------------------------------------------ statutory

def _pt(emp: dict, gross: float, month: str) -> float:
    state = state_of(emp)
    rule = (payroll_settings()["statutory"].get("pt") or {}).get(state)
    if not rule:
        return 0.0
    if rule.get("femaleExemptUpTo") and (emp.get("gender") or "").upper() == "FEMALE" and gross <= rule["femaleExemptUpTo"]:
        return 0.0
    amount = 0.0
    for upto, tax in rule["slabs"]:
        if upto is None or gross <= upto:
            amount = float(tax)
            break
    if amount and rule.get("februaryTop") and month.endswith("-02") and amount == rule["slabs"][-1][1]:
        amount = float(rule["februaryTop"])
    return amount


def _lwf(emp: dict, month: str) -> tuple:
    rule = (payroll_settings()["statutory"].get("lwf") or {}).get(state_of(emp))
    if not rule or int(month[5:7]) not in rule.get("months", []):
        return 0.0, 0.0
    return float(rule["ee"]), float(rule["er"])


def fy_of(month: str) -> str:
    y, m = int(month[:4]), int(month[5:7])
    start = y if m >= 4 else y - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _fy_months(month: str) -> list:
    start = int(fy_of(month)[:4])
    return [f"{start + (1 if m < 4 else 0)}-{m:02d}" for m in list(range(4, 13)) + [1, 2, 3]]


def _slab_tax(income: float, slabs: list) -> float:
    return sum(max(0.0, income - start) * rate for start, rate in slabs if income > start)


def annual_tax(taxable: float, regime: str) -> float:
    if regime == "OLD":
        tax = _slab_tax(taxable, [(250000 if s is None else s, r) for s, r in TAX["oldSlabs"]])
        if taxable <= TAX["rebateOldIncomeLimit"]:
            tax = max(0.0, tax - TAX["rebateOldMax"])
    else:
        tax = _slab_tax(taxable, TAX["newSlabs"])
        if taxable <= TAX["rebateNewIncomeLimit"]:
            tax = 0.0
        else:  # marginal relief just above the rebate limit
            tax = min(tax, taxable - TAX["rebateNewIncomeLimit"])
    return round(tax * (1 + TAX["cessRate"]), 2)


def tds_for_month(emp: dict, month: str, month_gross: float, full_monthly_gross: float, month_pf: float) -> dict:
    from app.routes.tax_declarations import deduction_total, declaration_for  # local: avoids a cycle
    fy = fy_of(month)
    decl = declaration_for(emp["_id"], fy)
    regime = decl.get("regime") or "NEW"
    months = _fy_months(month)
    idx = months.index(month)
    paid = [p for p in modules_store.payslips.values()
            if p.get("employeeId") == emp["_id"] and p.get("month") in months[:idx] and p.get("status") in ("APPROVED", "PAID")]
    gross_so_far = sum(p.get("grossSalary") or 0 for p in paid)
    tds_so_far = sum(p.get("tds") or 0 for p in paid)
    pf_so_far = sum(p.get("providentFund") or 0 for p in paid)
    remaining = len(months) - idx - 1
    projected_gross = gross_so_far + month_gross + full_monthly_gross * remaining
    projected_pf = pf_so_far + month_pf * (remaining + 1)
    std = TAX["stdDeductionOld"] if regime == "OLD" else TAX["stdDeductionNew"]
    deductions = deduction_total(decl, regime, projected_pf)
    taxable = max(0.0, projected_gross - std - deductions)
    tax = annual_tax(taxable, regime)
    this_month = max(0.0, (tax - tds_so_far) / (remaining + 1))
    return {"tds": round(this_month), "regime": regime, "projectedTaxable": round(taxable), "annualTax": round(tax),
            "deductionsConsidered": round(deductions)}


# ------------------------------------------------------------------ one payslip

def employment_window(emp: dict, month: str) -> tuple:
    y, m = int(month[:4]), int(month[5:7])
    first, last = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    start, end = first, last
    try:
        joined = date.fromisoformat((emp.get("joiningDate") or "")[:10])
        start = max(start, joined)
    except ValueError:
        pass
    for key in ("exitedOn", "lastWorkingDay"):
        try:
            left = date.fromisoformat((emp.get(key) or "")[:10])
            end = min(end, left)
        except ValueError:
            pass
    days_in_month = (last - first).days + 1
    employed = max(0, (end - start).days + 1)
    return days_in_month, employed, start.isoformat(), end.isoformat()


def compute_payslip(emp: dict, month: str, month_name: str, annual_override: Optional[float] = None) -> Optional[dict]:
    annual = annual_override if annual_override is not None else salary_for_month(emp, month)
    if not annual or annual <= 0:
        return None
    st = payroll_settings()["statutory"]
    comp = monthly_components(emp, float(annual))
    days_in_month, employed, period_from, period_to = employment_window(emp, month)
    if employed <= 0:
        return None
    inputs = payroll_inputs_for(emp["_id"], month)
    lop = min(float(employed), sum(i.get("days") or 0 for i in inputs if i["kind"] == "LOP_DAYS"))
    paid_days = round(employed - lop, 2)
    ratio = paid_days / days_in_month

    earnings = [{"code": c, "name": n, "full": round(v, 2), "amount": round(v * ratio, 2)} for c, n, v in comp["earnings"]]
    for i in inputs:
        if i["kind"] != "LOP_DAYS" and PAYROLL_INPUT_KINDS[i["kind"]][1]:
            earnings.append({"code": i["kind"], "name": i.get("label") or PAYROLL_INPUT_KINDS[i["kind"]][0], "amount": round(i.get("amount") or 0, 2),
                             "inputId": i["_id"]})
    gross = round(sum(e["amount"] for e in earnings), 2)
    full_gross = round(sum(v for _, _, v in comp["earnings"]), 2)
    basic_earned = round(comp["basic"] * ratio, 2)
    arrear_basic = sum(i.get("basicPart") or 0 for i in inputs if i["kind"] == "ARREARS")

    deductions, employer = [], []
    pf_ee = 0.0
    if st["pf"].get("enabled") and not emp.get("pfOptOut"):
        wage = basic_earned + arrear_basic
        pf_wage = min(wage, st["pf"]["wageCeiling"]) if st["pf"].get("capAtCeiling") else wage
        pf_ee = round(pf_wage * st["pf"]["eeRate"] / 100)
        pf_er = round(pf_wage * st["pf"]["erRate"] / 100)
        eps = round(min(wage, st["pf"]["wageCeiling"]) * st["pf"]["epsRate"] / 100)
        deductions.append({"code": "PF", "name": "Provident Fund (employee)", "amount": pf_ee, "wage": round(pf_wage, 2)})
        employer.append({"code": "PF_ER", "name": "Provident Fund (employer)", "amount": pf_er, "eps": eps, "epf": pf_er - eps,
                         "epsWage": round(min(wage, st["pf"]["wageCeiling"]), 2)})
    if st["esic"].get("enabled") and full_gross <= st["esic"]["grossLimit"]:
        deductions.append({"code": "ESIC", "name": "ESIC (employee)", "amount": math.ceil(gross * st["esic"]["eeRate"] / 100), "wage": gross})
        employer.append({"code": "ESIC_ER", "name": "ESIC (employer)", "amount": math.ceil(gross * st["esic"]["erRate"] / 100)})
    pt = _pt(emp, gross, month)
    if pt:
        deductions.append({"code": "PT", "name": f"Professional Tax ({state_of(emp).title()})", "amount": pt})
    lwf_ee, lwf_er = _lwf(emp, month)
    if lwf_ee:
        deductions.append({"code": "LWF", "name": "Labour Welfare Fund", "amount": lwf_ee})
        employer.append({"code": "LWF_ER", "name": "Labour Welfare Fund (employer)", "amount": lwf_er})
    tax = tds_for_month(emp, month, gross, full_gross, pf_ee)
    if tax["tds"]:
        deductions.append({"code": "TDS", "name": f"Income tax (TDS, {tax['regime'].lower()} regime)", "amount": tax["tds"]})
    for i in inputs:
        if i["kind"] != "LOP_DAYS" and not PAYROLL_INPUT_KINDS[i["kind"]][1]:
            deductions.append({"code": i["kind"], "name": i.get("label") or PAYROLL_INPUT_KINDS[i["kind"]][0], "amount": round(i.get("amount") or 0, 2),
                               "inputId": i["_id"]})
    total_ded = round(sum(d["amount"] for d in deductions), 2)
    net = round(gross - total_ded, 2)

    statutory = emp.get("statutory") or {}
    bank = emp.get("bankInfo") or {}
    amt = lambda code, rows: round(sum(r["amount"] for r in rows if r["code"] == code), 2)  # noqa: E731
    earned = lambda code: round(sum(e["amount"] for e in earnings if e["code"] == code), 2)  # noqa: E731
    return {
        "_id": f"pay_{emp['_id']}_{month.replace('-', '_', 1)}",
        "employeeId": emp["_id"], "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}", "employeeCode": emp.get("employeeCode"),
        "designation": emp.get("designation"), "department": emp.get("department"), "location": emp.get("location"),
        "state": state_of(emp), "panNumber": statutory.get("panNumber") or statutory.get("panMasked") or "",
        "pfUan": statutory.get("uanNumber") or statutory.get("uanMasked") or "", "esicNumber": statutory.get("esiNumber") or "",
        "bankName": bank.get("bankName") or "", "bankAccountNumber": bank.get("accountNumber") or bank.get("accountNumberMasked") or "",
        "bankIfsc": bank.get("ifsc") or "",
        "month": month, "monthName": month_name, "structure": comp["structure"], "annualCtc": float(annual),
        "daysInMonth": days_in_month, "employedDays": employed, "periodFrom": period_from, "periodTo": period_to,
        "workedDays": paid_days, "lopDays": lop,
        "earnings": earnings, "deductions": deductions, "employerContributions": employer,
        "basicSalary": earned("BASIC"), "hra": earned("HRA"), "specialAllowance": earned("SPECIAL"), "conveyanceAllowance": earned("CONVEYANCE"),
        "lta": earned("LTA"), "educationAllowance": earned("EDUCATION"), "medicalAllowance": 0,
        "performanceBonus": earned("VARIABLE_PAY"), "grossSalary": gross,
        "providentFund": amt("PF", deductions), "esic": amt("ESIC", deductions), "professionalTax": amt("PT", deductions),
        "lwf": amt("LWF", deductions), "tds": amt("TDS", deductions),
        "otherDeductions": round(total_ded - amt("PF", deductions) - amt("PT", deductions) - amt("TDS", deductions), 2),
        "totalDeductions": total_ded, "netSalary": net, "taxComputation": tax,
        "inputIds": [i["_id"] for i in inputs], "paymentMode": "BANK_TRANSFER",
    }
