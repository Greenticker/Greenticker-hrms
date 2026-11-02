"""
Salary structure calculator (FY 2026-27)
Mirrors the Greenticker "Salary Structure" sheet (and frontend/src/shared/salaryStructure.ts):

WAGES (must be >= 50% of CTC)
  Basic                  = 23.9% of CTC
  Education Allowance    = fixed Rs. 1,000 / month
  PPF Allowance          = 12% of Basic
  Medical Insurance      = fixed Rs. 1,000 / month
  BFAA                   = 6% of CTC
  Special Allowance      = balancing amount (Total Wages - all of the above)
  Total Wages            = 50% of CTC

ALLOWANCES (not forming part of wages)
  HRA                    = 50% of Basic
  LTA                    = 40% of Basic
  Conveyance Allowance   = balancing amount (CTC - Total Wages - HRA - LTA)

Deductions: Professional Tax Rs. 200 / month (Rs. 2,500 / year), PF (employee) = PPF allowance
Annual one-time payments: PPF Allowance, PPF-Employee, Medical Insurance, BFAA
"""

import re
from typing import Any

from app.utils.jsutil import clean_num, r2, to_number

EDUCATION_ALLOWANCE_MONTHLY = 1000
MEDICAL_INSURANCE_MONTHLY = 1000
PROFESSIONAL_TAX_MONTHLY = 200
PROFESSIONAL_TAX_YEARLY = 2500  # 11 x 200 + 300 (Maharashtra, Feb)
PROFESSIONAL_TAX_FEBRUARY = 300


def professional_tax_for_month(month_str: str) -> int:
    """Professional Tax for a payroll month ('YYYY-MM'): Rs. 200, except Rs. 300 in February."""
    return PROFESSIONAL_TAX_FEBRUARY if re.search(r"-0?2$", month_str or "") else PROFESSIONAL_TAX_MONTHLY


def compute_salary_structure(annual_ctc_input: Any) -> dict:
    ctc = r2(max(0, to_number(annual_ctc_input)))

    def pct(v: float) -> float:
        return r2((v / ctc) * 100) if ctc > 0 else 0

    def line(key: str, label: str, yearly: float, rule: str) -> dict:
        return {
            "key": key,
            "label": label,
            "yearly": clean_num(r2(yearly)),
            "monthly": clean_num(r2(yearly / 12)),
            "rule": rule,
            "percentOfCtc": clean_num(pct(yearly)),
        }

    # ---- Wages ----
    basic_y = r2(ctc * 0.239)
    education_y = EDUCATION_ALLOWANCE_MONTHLY * 12
    ppf_y = r2(basic_y * 0.12)
    medical_y = MEDICAL_INSURANCE_MONTHLY * 12
    bfaa_y = r2(ctc * 0.06)
    total_wages_y = r2(ctc * 0.5)
    special_y = r2(total_wages_y - (basic_y + education_y + ppf_y + medical_y + bfaa_y))

    wages = [
        line("basic", "Basic", basic_y, "23.9% of CTC"),
        line("education", "Education Allowance", education_y, "Fixed Rs. 1,000 / month"),
        line("ppf", "PPF Allowance", ppf_y, "12% of Basic"),
        line("medical", "Medical Insurance", medical_y, "Fixed Rs. 1,000 / month"),
        line("bfaa", "BFAA", bfaa_y, "6% of CTC"),
        line("special", "Special Allowance / Other Allowance", special_y, "Balancing amount (Total Wages less others)"),
    ]
    total_wages = line("totalWages", "TOTAL WAGES", total_wages_y, "This should be minimum 50% of total gross salary")

    # ---- Allowances ----
    hra_y = r2(basic_y * 0.5)
    lta_y = r2(basic_y * 0.4)
    total_allowances_y = r2(ctc - total_wages_y)
    conveyance_y = r2(total_allowances_y - hra_y - lta_y)

    allowances = [
        line("hra", "H.R.A", hra_y, "50% of Basic"),
        line("lta", "LTA", lta_y, "40% of Basic"),
        line("conveyance", "Conveyance Allowance", conveyance_y, "Balancing amount (Total CTC less Total Wages less HRA less LTA)"),
    ]
    total_allowances = line("totalAllowances", "TOTAL ALLOWANCES", total_allowances_y, "")
    total_gross = line("totalGross", "TOTAL GROSS SALARY", r2(total_wages_y + total_allowances_y), "")
    total_ctc = line("totalCtc", "TOTAL CTC", ctc, "")

    # ---- Deductions ----
    pt_y = PROFESSIONAL_TAX_YEARLY if ctc > 0 else 0
    pt_monthly = PROFESSIONAL_TAX_MONTHLY if ctc > 0 else 0
    deductions = [
        {"key": "pt", "label": "PT", "monthly": pt_monthly, "yearly": pt_y, "rule": "Professional Tax", "percentOfCtc": clean_num(pct(pt_y))},
    ]
    total_deduction = {
        "key": "totalDeduction",
        "label": "TOTAL DEDUCTION",
        "monthly": pt_monthly,
        "yearly": pt_y,
        "rule": "",
        "percentOfCtc": clean_num(pct(pt_y)),
    }

    # ---- Net pay per month ----
    # Monthly gross excludes the items that are paid once a year (PPF allowance, Medical Insurance, BFAA)
    monthly_gross = r2(total_gross["monthly"] - wages[2]["monthly"] - wages[3]["monthly"] - wages[4]["monthly"])
    pf_employee = wages[2]["monthly"]  # PF (employee) = 12% of Basic
    net_pay_per_month = r2(monthly_gross - pt_monthly - pf_employee)

    # ---- Annual (one-time) payments ----
    annual_payments = {
        "ppfAllowance": clean_num(ppf_y),
        "ppfEmployee": clean_num(ppf_y),
        "medicalInsurance": medical_y,
        "bfaa": clean_num(bfaa_y),
        "total": clean_num(r2(ppf_y + ppf_y + medical_y + bfaa_y)),
    }

    return {
        "annualCtc": clean_num(ctc),
        "wages": wages,
        "totalWages": total_wages,
        "allowances": allowances,
        "totalAllowances": total_allowances,
        "totalGross": total_gross,
        "totalCtc": total_ctc,
        "deductions": deductions,
        "totalDeduction": total_deduction,
        "netPay": {
            "monthlyGross": clean_num(monthly_gross),
            "professionalTax": pt_monthly,
            "pfEmployee": pf_employee,
            "netPayPerMonth": clean_num(net_pay_per_month),
        },
        "annualPayments": annual_payments,
        "wagesMeetMinimum": total_wages_y >= r2(total_gross["yearly"] * 0.5) - 0.01,
    }
