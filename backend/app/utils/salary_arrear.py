"""
Salary arrear engine — a port of "Salary Arrear Calculator.xlsx" (sheets Inputs, Arrear Calc).

Two arrear types:
- NEW_JOINER: joined after the previous month's payroll cut-off. Arrear runs from the date of
  joining to the last day of the month before payroll; old salary is ignored (factor 0).
- REVISION: back-dated salary revision. Arrear = (Revised − Old) for each month from the
  effective date up to the month before payroll.

Statutory logic (employer side):
- PF = rate × earned PF wage (components flagged as PF wage), capped at the PF wage ceiling
  when restricted. PF arrear = PF on revised earned wage − PF on old earned wage.
- ESIC applies when the full-month ESIC wage ≤ ceiling; contribution = rate × earned ESIC wage,
  rounded up to the next rupee. Continuity rule: an employee covered on the old salary stays
  covered until the end of the contribution period (Apr–Sep / Oct–Mar) in which the arrear starts.
- Up to 12 arrear months; amounts rounded to the nearest rupee per component per month.
"""

import calendar
import math
from datetime import date, datetime
from typing import Any, Optional

MAX_MONTHS = 12
MAX_COMPONENTS = 10


def default_inputs() -> dict:
    """The example from the workbook."""
    return {
        "employeeCode": "EMP1001",
        "employeeName": "Sample Employee",
        "arrearType": "REVISION",
        "payrollMonth": "2026-10-01",
        "cutoffDay": 20,
        "dateOfJoining": "2024-03-15",
        "effectiveDate": "2026-08-01",
        "payDaysBasis": "CALENDAR",
        "pfRate": 0.12,
        "pfWageCeiling": 25000,
        "restrictPfToCeiling": True,
        "esicRate": 0.0325,
        "esicWageCeiling": 21000,
        "components": [
            {"name": "Basic Salary", "old": 12000, "revised": 13000, "pfWage": True, "esicWage": True},
            {"name": "DA", "old": 3000, "revised": 3500, "pfWage": True, "esicWage": True},
            {"name": "HRA", "old": 4000, "revised": 4500, "pfWage": False, "esicWage": True},
            {"name": "Special Allowance", "old": 1000, "revised": 1500, "pfWage": True, "esicWage": True},
        ],
    }


# ------------------------------------------------------------------- helpers

def xround(x: float) -> int:
    """Excel ROUND(x, 0): halves away from zero."""
    return int(math.copysign(math.floor(abs(x) + 0.5 + 1e-9), x))


def xceiling(x: float) -> int:
    """Excel CEILING(x, 1) for the non-negative values used here (tolerant of float noise)."""
    return math.ceil(round(x, 9))


def _num(v: Any, default: float = 0) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    return n if math.isfinite(n) else default


def _date(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _bool(v: Any) -> bool:
    return v in (True, "true", "Yes", "YES", "yes", 1)


def _eomonth(d: date, months: int = 0) -> date:
    total = d.month - 1 + months
    y, m = d.year + total // 12, total % 12 + 1
    return date(y, m, calendar.monthrange(y, m)[1])


def _add_months(first_of_month: date, months: int) -> date:
    total = first_of_month.month - 1 + months
    return date(first_of_month.year + total // 12, total % 12 + 1, 1)


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None


def _fmt(d: date) -> str:
    return d.strftime("%d-%b-%y")


def normalize(data: dict) -> dict:
    base = default_inputs()
    data = data or {}
    out = dict(base)
    for key in ("employeeCode", "employeeName"):
        if data.get(key) is not None:
            out[key] = str(data[key])
    out["arrearType"] = "NEW_JOINER" if data.get("arrearType", base["arrearType"]) == "NEW_JOINER" else "REVISION"
    for key in ("payrollMonth", "dateOfJoining", "effectiveDate"):
        if key in data:
            out[key] = data[key] or None
    out["payDaysBasis"] = "FIXED_30" if data.get("payDaysBasis", base["payDaysBasis"]) == "FIXED_30" else "CALENDAR"
    for key in ("cutoffDay", "pfRate", "pfWageCeiling", "esicRate", "esicWageCeiling"):
        if key in data:
            out[key] = _num(data[key], base[key])
    if "restrictPfToCeiling" in data:
        out["restrictPfToCeiling"] = _bool(data["restrictPfToCeiling"])
    if isinstance(data.get("components"), list):
        comps = []
        for c in data["components"][:MAX_COMPONENTS]:
            if not isinstance(c, dict):
                continue
            comps.append({
                "name": str(c.get("name") or "").strip(),
                "old": _num(c.get("old")),
                "revised": _num(c.get("revised")),
                "pfWage": _bool(c.get("pfWage")),
                "esicWage": _bool(c.get("esicWage")),
            })
        out["components"] = comps
    return out


def _clean(v: float) -> float:
    if isinstance(v, float):
        v = round(v, 6)
        if v.is_integer():
            return int(v)
    return v


# ------------------------------------------------------------------- engine

def compute(data: dict) -> dict:
    inp = normalize(data)
    new_joiner = inp["arrearType"] == "NEW_JOINER"
    payroll = _date(inp["payrollMonth"])
    doj = _date(inp["dateOfJoining"])
    effective = _date(inp["effectiveDate"])
    cutoff = inp["cutoffDay"]
    comps = [c for c in inp["components"] if c["name"]]

    # ---- derived arrear period
    start = doj if new_joiner else effective
    end = _eomonth(payroll, -1) if payroll else None
    if not start or not end or end < start:
        months = 0
    else:
        months = (end.year - start.year) * 12 + end.month - start.month + 1

    if not payroll:
        status = "Enter Payroll Processing Month"
    elif months > MAX_MONTHS:
        status = "Arrear period exceeds 12 months – calculator covers first 12 only"
    elif new_joiner:
        if not doj:
            status = "Enter Date of Joining"
        elif doj >= payroll:
            status = "Joined in payroll month – pay in regular payroll, no arrear"
        elif _eomonth(doj) == _eomonth(payroll, -1) and doj.day > cutoff:
            status = "OK – joined after cut-off of previous month; arrear payable in this payroll"
        else:
            status = "Check – DOJ is on/before cut-off or earlier than previous month"
    else:
        if not effective:
            status = "Enter Revision Effective Date"
        elif effective >= payroll:
            status = "Effective date in/after payroll month – no arrear"
        else:
            status = f"OK – back-dated revision; arrear for {months} month(s)"
    ok = status.startswith("OK")

    old_factor = 0 if new_joiner else 1
    if start:
        if 4 <= start.month <= 9:
            esic_period_end = date(start.year, 9, 30)
        elif start.month >= 10:
            esic_period_end = date(start.year + 1, 3, 31)
        else:
            esic_period_end = date(start.year, 3, 31)
    else:
        esic_period_end = None

    # ---- monthly CTC structure (Inputs rows 41-47)
    pf_rate, pf_ceiling, restrict = inp["pfRate"], inp["pfWageCeiling"], inp["restrictPfToCeiling"]
    esic_rate, esic_ceiling = inp["esicRate"], inp["esicWageCeiling"]

    def pf_on(wage: float) -> int:
        return xround(pf_rate * (min(wage, pf_ceiling) if restrict else wage))

    gross_old = sum(c["old"] for c in comps)
    gross_rev = sum(c["revised"] for c in comps)
    pf_wage_old = sum(c["old"] for c in comps if c["pfWage"])
    pf_wage_rev = sum(c["revised"] for c in comps if c["pfWage"])
    esic_wage_old = sum(c["old"] for c in comps if c["esicWage"])
    esic_wage_rev = sum(c["revised"] for c in comps if c["esicWage"])
    old_covered = 0 < esic_wage_old <= esic_ceiling
    rev_covered = 0 < esic_wage_rev <= esic_ceiling
    esic_old_month = xceiling(esic_wage_old * esic_rate) if old_covered else 0
    esic_rev_month = (xceiling(esic_wage_rev * esic_rate)
                      if rev_covered or (old_factor == 1 and old_covered and payroll and esic_period_end and payroll <= esic_period_end)
                      else 0)
    pf_old_month, pf_rev_month = pf_on(pf_wage_old), pf_on(pf_wage_rev)

    def triple(old, rev):
        return {"old": _clean(old), "revised": _clean(rev), "difference": _clean(rev - old)}

    structure = {
        "components": [{**c, "difference": _clean(c["revised"] - c["old"])} for c in comps],
        "gross": triple(gross_old, gross_rev),
        "pfWage": triple(pf_wage_old, pf_wage_rev),
        "esicWage": triple(esic_wage_old, esic_wage_rev),
        "employerPf": triple(pf_old_month, pf_rev_month),
        "employerEsic": triple(esic_old_month, esic_rev_month),
        "contributions": triple(pf_old_month + esic_old_month, pf_rev_month + esic_rev_month),
        "fixedCtc": triple(gross_old + pf_old_month + esic_old_month, gross_rev + pf_rev_month + esic_rev_month),
    }

    # ---- month-wise arrear (Arrear Calc sheet)
    month_rows = []
    covered = min(months, MAX_MONTHS) if start else 0
    for i in range(covered):
        month_start = _add_months(date(start.year, start.month, 1), i)
        period_from = max(month_start, start)
        period_to = _eomonth(month_start)
        calendar_basis = inp["payDaysBasis"] == "CALENDAR"
        days = period_to.day if calendar_basis else 30
        if calendar_basis:
            paid = (period_to - period_from).days + 1
        else:
            paid = 30 if period_from == month_start else max(1, 30 - period_from.day + 1)
        factor = paid / days

        esic_rev_flag = rev_covered or (old_factor == 1 and old_covered and month_start <= esic_period_end)
        esic_old_flag = old_factor == 1 and old_covered

        earnings = [xround((c["revised"] - c["old"] * old_factor) * factor) for c in comps]
        pf_rev_wage = xround(pf_wage_rev * factor)
        pf_old_wage = xround(pf_wage_old * old_factor * factor)
        pf_rev, pf_old = pf_on(pf_rev_wage), pf_on(pf_old_wage)
        esic_rev_wage = xround(esic_wage_rev * factor)
        esic_old_wage = xround(esic_wage_old * old_factor * factor)
        esic_rev = xceiling(esic_rev_wage * esic_rate) if esic_rev_flag else 0
        esic_old = xceiling(esic_old_wage * esic_rate) if esic_old_flag else 0
        gross = sum(earnings)
        contributions = (pf_rev - pf_old) + (esic_rev - esic_old)
        month_rows.append({
            "month": i + 1,
            "monthStart": _iso(month_start),
            "periodFrom": _iso(period_from),
            "periodTo": _iso(period_to),
            "daysInMonth": days,
            "paidDays": paid,
            "prorationFactor": _clean(factor),
            "esicApplicableRevised": esic_rev_flag,
            "esicApplicableOld": esic_old_flag,
            "earnings": earnings,
            "grossArrear": gross,
            "pfWageRevised": pf_rev_wage, "pfWageOld": pf_old_wage,
            "pfRevised": pf_rev, "pfOld": pf_old, "pfArrear": pf_rev - pf_old,
            "esicWageRevised": esic_rev_wage, "esicWageOld": esic_old_wage,
            "esicRevised": esic_rev, "esicOld": esic_old, "esicArrear": esic_rev - esic_old,
            "contributionArrear": contributions,
            "totalArrear": gross + contributions,
        })

    def total(key: str) -> int:
        return sum(m[key] for m in month_rows)

    component_totals = [
        {"name": c["name"], "total": sum(m["earnings"][idx] for m in month_rows)} for idx, c in enumerate(comps)
    ]
    return {
        "inputs": inp,
        "period": {
            "start": _iso(start), "end": _iso(end), "months": months, "monthsCovered": covered,
            "label": f"{_fmt(start)} to {_fmt(end)}" if months and start and end else "No arrear period",
            "oldSalaryFactor": old_factor, "esicPeriodEnd": _iso(esic_period_end),
            "status": status, "ok": ok,
        },
        "structure": structure,
        "months": month_rows,
        "componentTotals": component_totals,
        "totals": {
            "paidDays": total("paidDays"),
            "grossArrear": total("grossArrear"),
            "pfArrear": total("pfArrear"),
            "esicArrear": total("esicArrear"),
            "contributionArrear": total("contributionArrear"),
            "totalArrear": total("totalArrear"),
        },
    }
