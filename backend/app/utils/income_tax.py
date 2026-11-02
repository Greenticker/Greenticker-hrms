"""
Income tax engine — Tax Year 2026-27 (FY 2026-27 / AY 2027-28), Old vs New regime.

A line-by-line port of "Payroll_Income_Tax_Calculator_TY2026-27.xlsx" (sheets Parameters,
Inputs, Exemptions_Sec10, Perquisites_17(2), Deductions_ChVIA, Tax_Computation). Both
regimes are always computed; the selected regime only decides the APPLIED column.

Every statutory limit lives in PARAMETERS so it can be updated when the Finance Act or
Rules change. Inputs are plain dicts; `default_inputs()` returns the workbook's example.
"""

import copy
import math
from typing import Any

# ----------------------------------------------------------------- parameters

PARAMETERS = {
    "stdDeductionOld": 50000,
    "stdDeductionNew": 75000,
    "rebateOldIncomeLimit": 500000,
    "rebateOldMax": 12500,
    "rebateNewIncomeLimit": 1200000,
    "rebateNewMax": 60000,
    "cessRate": 0.04,
    "hraMetroPct": 0.5,
    "hraOtherPct": 0.4,
    "hraRentExcessPct": 0.1,
    "ceaPerChildMonth": 3000,
    "hostelPerChildMonth": 9000,
    "maxChildren": 2,
    "divyangTransportMetro": 15000,
    "divyangTransportOther": 8000,
    "runningAllowanceCap": 25000,
    "runningAllowancePct": 0.7,
    "gratuityCeiling": 2000000,
    "leaveEncashmentCeiling": 2500000,
    "entertainmentCap": 5000,
    "entertainmentPctBasic": 0.2,
    "employerPfExemptPct": 0.12,
    "mealPerMeal": 200,
    "giftLimit": 15000,
    "carSmallEmployerExp": 5000,
    "carLargeEmployerExp": 7000,
    "carSmallEmployeeExp": 2000,
    "carLargeEmployeeExp": 3000,
    "chauffeur": 3000,
    "carDepreciationPct": 0.1,
    "loanExemptLimit": 200000,
    "educationPerChildMonth": 3000,
    "rfaAbove40L": 0.1,
    "rfa15To40L": 0.075,
    "rfaOther": 0.05,
    "leasedCapPct": 0.1,
    "furniturePct": 0.1,
    "retirementContribCap": 750000,
    "limit80C": 150000,
    "pct80CCD1": 0.1,
    "limit80CCD1B": 50000,
    "pct80CCD2OldNonGovt": 0.1,
    "pct80CCD2Govt": 0.14,
    "pct80CCD2New": 0.14,
    "limit80DSelf": 25000,
    "limit80DSelfSenior": 50000,
    "limit80DParents": 25000,
    "limit80DParentsSenior": 50000,
    "limit80DCheckup": 5000,
    "disability": 75000,
    "disabilitySevere": 125000,
    "limit80DDB": 40000,
    "limit80DDBSenior": 100000,
    "limit80EE": 50000,
    "limit80EEA": 150000,
    "limit80EEB": 150000,
    "pct80G": 0.1,
    "limit80GGMonth": 5000,
    "pct80GG": 0.25,
    "limit80TTA": 10000,
    "limit80TTB": 50000,
    "homeLoanInterestCap": 200000,
    "housePropertyLossCap": 200000,
    # Slabs: (slab starts at, incremental rate) — tax = Σ max(0, income − start) × rate
    "oldSlabs": [(None, 0.05), (500000, 0.15), (1000000, 0.10)],  # None = basic exemption by age
    "newSlabs": [(400000, 0.05), (800000, 0.05), (1200000, 0.05), (1600000, 0.05), (2000000, 0.05), (2400000, 0.05)],
    # Surcharge: (income above, old rate, new rate)
    "surcharge": [(0, 0, 0), (5000000, 0.10, 0.10), (10000000, 0.15, 0.15), (20000000, 0.25, 0.25), (50000000, 0.37, 0.25)],
}

METRO_CITIES = ["Mumbai", "Delhi", "Kolkata", "Chennai", "Bengaluru", "Hyderabad", "Pune", "Ahmedabad"]
CITY_OPTIONS = METRO_CITIES + ["Other city"]

BASIC_EXEMPTION_OLD = {"BELOW_60": 250000, "SENIOR": 300000, "SUPER_SENIOR": 500000}

# CTC components in workbook order (Inputs rows 27-59): key, label, tax treatment
CTC_COMPONENTS = [
    ("basic", "Basic salary", "Taxable – Salary"),
    ("da", "Dearness allowance (forming part of retirement benefits)", "Taxable – Salary"),
    ("hra", "House rent allowance", "Exemption (Old only)"),
    ("special", "Special allowance", "Taxable – Salary"),
    ("lta", "Leave travel allowance", "Exemption (Old only)"),
    ("childrenEducation", "Children education allowance", "Exemption (Old only)"),
    ("hostel", "Hostel expenditure allowance", "Exemption (Old only)"),
    ("telephone", "Telephone / mobile / internet reimbursement", "Perquisite – nil value vs bills (both)"),
    ("carAllowance", "Car allowance (fixed, cash)", "Taxable – Salary"),
    ("carRunning", "Car running & maintenance reimbursement", "Perquisite (both)"),
    ("driver", "Driver salary reimbursement", "Perquisite (both)"),
    ("conveyance", "Conveyance allowance (official duties)", "Exemption (both) – actual spend"),
    ("travel", "Travel / tour / transfer allowance", "Exemption (both) – actual spend"),
    ("dailyAllowance", "Daily allowance on tour", "Exemption (both) – actual spend"),
    ("books", "Books & periodicals allowance", "Exemption (Old only) – actual spend"),
    ("uniform", "Uniform allowance", "Exemption (Old only) – actual spend"),
    ("helper", "Helper allowance", "Exemption (Old only) – actual spend"),
    ("academic", "Academic / research allowance", "Exemption (Old only) – actual spend"),
    ("transportDivyang", "Transport allowance (Divyang employee)", "Exemption (both)"),
    ("runningAllowance", "Running allowance – transport-system employee", "Exemption (Old only)"),
    ("otherPrescribed", "Other prescribed allowance (tribal/border/underground/high-altitude etc.)", "Exemption (Old only)"),
    ("entertainment", "Entertainment allowance (Govt employees)", "Taxable; Sec 16(ii) deduction (Old only)"),
    ("meal", "Meal vouchers / food card", "Perquisite – ₹200/meal nil (both)"),
    ("gift", "Gift vouchers / non-cash gifts", "Perquisite – nil up to ₹15,000 (both)"),
    ("bonus", "Performance bonus / incentive", "Taxable – Salary"),
    ("otherTaxable", "Other fully taxable allowances", "Taxable – Salary"),
    ("employerNps", "Employer contribution to NPS", "In salary 17(1)(viii) + deduction 80CCD(2) (both)"),
    ("agniveer", "Govt contribution to Agniveer Corpus Fund", "In salary + deduction 80CCH(2) (both)"),
    ("employerPf", "Employer contribution to PF", "Not taxable up to 12% of Basic+DA"),
    ("superannuation", "Employer contribution to approved superannuation fund", "Not taxable (within ₹7.5L cap)"),
    ("gratuityProvision", "Gratuity (CTC provision)", "Not part of gross salary until paid"),
    ("insurance", "Group medical / term / accident insurance premium", "Not taxable"),
    ("statutory", "Employer ESIC / LWF / statutory contributions", "Not taxable"),
]

# Components that form "salary" (17(1) cash part) — Inputs C27..C33, C35, C38..C48, C51, C52
SALARY_KEYS = [
    "basic", "da", "hra", "special", "lta", "childrenEducation", "hostel", "carAllowance",
    "conveyance", "travel", "dailyAllowance", "books", "uniform", "helper", "academic",
    "transportDivyang", "runningAllowance", "otherPrescribed", "entertainment", "bonus", "otherTaxable",
]

SEC80C_KEYS = [
    ("pfEmployee", "Employee PF contribution (statutory)"),
    ("vpf", "Voluntary PF"),
    ("ppf", "Public Provident Fund"),
    ("lifeInsurance", "Life insurance premium"),
    ("elss", "ELSS mutual funds"),
    ("nsc", "NSC (incl. accrued interest)"),
    ("tuitionFees", "Children tuition fees (max 2)"),
    ("housingPrincipal", "Housing loan principal repayment"),
    ("sukanya", "Sukanya Samriddhi Yojana"),
    ("taxSaverFd", "5-year tax-saver bank / post office FD"),
    ("stampDuty", "Stamp duty & registration (house)"),
    ("ulip", "ULIP / other notified"),
    ("scss", "Senior Citizens Savings Scheme / other Sch XV items"),
]


def default_inputs() -> dict:
    """The example employee from the workbook (Rahul Sharma, EMP001)."""
    ctc = {key: 0 for key, _, _ in CTC_COMPONENTS}
    ctc.update({
        "basic": 900000, "hra": 360000, "special": 431600, "lta": 50000, "childrenEducation": 72000,
        "telephone": 24000, "books": 12000, "meal": 105600, "gift": 10000, "bonus": 100000,
        "employerNps": 90000, "employerPf": 108000, "gratuityProvision": 43290, "insurance": 15000,
    })
    sec80c = {key: 0 for key, _ in SEC80C_KEYS}
    sec80c.update({"pfEmployee": 108000, "ppf": 50000, "lifeInsurance": 20000})
    return {
        "employee": {"name": "Rahul Sharma", "code": "EMP001", "pan": "ABCDE1234F"},
        "regime": "OLD",
        "ageCategory": "BELOW_60",
        "employerType": "NON_GOVT",
        "city": "Pune",
        "monthsEmployed": 12,
        "monthsRemaining": 6,
        "tdsDeducted": 0,
        "professionalTax": 2500,
        "otherIncome": {"savingsInterest": 8000, "depositInterest": 0, "otherSources": 0, "houseProperty": 0, "previousEmployerSalary": 0},
        "ctc": ctc,
        "retirement": {"gratuityReceived": 0, "gratuityExemptFormula": 0, "leaveEncashment": 0, "leaveEncashmentExemptFormula": 0, "profitsInLieu": 0},
        "exemptions": {
            "rentPaid": 300000, "rentMonths": 12, "ltaFare": 40000, "ceaChildren": 2, "hostelChildren": 0,
            "isDivyang": False, "transportDailyAllowance": False, "otherPrescribedMonthlyLimit": 0,
            "spendConveyance": 0, "spendTravel": 0, "spendDailyAllowance": 0, "spendBooks": 12000,
            "spendUniform": 0, "spendHelper": 0, "spendAcademic": 0,
        },
        "perquisites": {
            "accommodation": "NONE", "cityPopulation": "ABOVE_40L", "leaseRent": 0, "accommodationMonths": 12,
            "furnitureCost": 0, "furnitureHire": 0, "rentRecovered": 0,
            "carProvidedBy": "NONE", "carEngine": "SMALL", "carUsage": "MIXED", "carRunningBorneBy": "EMPLOYER",
            "chauffeur": False, "carMonths": 12, "carCost": 0, "carRunningExpense": 0, "carRecovered": 0,
            "telephoneBills": 24000, "meals": 528,
            "loanAmount": 0, "loanAvgOutstanding": 0, "loanSbiRate": 0.09, "loanChargedRate": 0, "loanMedical": False, "loanMonths": 12,
            "educationCostPerChild": 0, "educationChildren": 0, "educationMonths": 12,
            "esopShares": 0, "esopFmv": 0, "esopExercisePrice": 0,
            "club": 0, "creditCard": 0, "servants": 0, "assets": 0, "medicalAbroad": 0, "otherPerquisite": 0,
        },
        "deductions": {
            **sec80c,
            "pension80CCC": 0, "nps80CCD1": 0, "nps80CCD1B": 50000, "agniveerOwn": 0,
            "selfSenior": False, "healthSelf": 20000, "checkupSelf": 0,
            "parentsSenior": True, "healthParents": 35000, "checkupParents": 0,
            "disabledDependant": "NONE", "ddbAmount": 0, "ddbReimbursed": 0, "ddbSenior": False, "selfDisability": "NONE",
            "educationLoanInterest": 0, "homeLoan80EE": 0, "homeLoan80EEA": 0, "evLoan": 0, "politicalDonation": 0,
            "rentNoHra": 0, "donation100": 0, "donation50": 0, "donation100Limited": 0, "donation50Limited": 0,
            "homeLoanInterest24b": 0,
        },
    }


# ------------------------------------------------------------------- helpers

def xround(x: float, digits: int = 0) -> float:
    """Excel ROUND: halves away from zero."""
    factor = 10 ** digits
    v = abs(x) * factor
    r = math.floor(v + 0.5 + 1e-9) / factor
    r = math.copysign(r, x)
    return int(r) if digits == 0 else r


def _n(v: Any) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if math.isfinite(n) else 0.0


def _clean(v: float) -> float:
    if isinstance(v, float):
        v = round(v, 6)
        if v.is_integer():
            return int(v)
    return v


def merge_inputs(data: dict) -> dict:
    """Overlay user-supplied values on the defaults (unknown keys are ignored)."""
    base = default_inputs()

    def overlay(dst: dict, src: dict) -> None:
        for k, v in (src or {}).items():
            if k not in dst:
                continue
            if isinstance(dst[k], dict) and isinstance(v, dict):
                overlay(dst[k], v)
            elif isinstance(dst[k], bool):
                dst[k] = v in (True, "true", "Yes", "YES", 1)
            elif isinstance(dst[k], (int, float)) and not isinstance(dst[k], bool):
                dst[k] = _n(v)
            elif isinstance(dst[k], str):
                dst[k] = str(v) if v is not None else dst[k]

    overlay(base, copy.deepcopy(data or {}))
    return base


def _slab_tax(income: float, slabs: list) -> float:
    return sum(max(0.0, income - start) * rate for start, rate in slabs if income > start)


# ------------------------------------------------------------------- engine

def compute(data: dict) -> dict:
    inp = merge_inputs(data)
    p = PARAMETERS
    c = inp["ctc"]
    ex = inp["exemptions"]
    pq = inp["perquisites"]
    dd = inp["deductions"]
    oi = inp["otherIncome"]
    rt = inp["retirement"]

    is_new = inp["regime"] == "NEW"
    is_govt = inp["employerType"] == "GOVT"
    age = inp["ageCategory"] if inp["ageCategory"] in BASIC_EXEMPTION_OLD else "BELOW_60"
    below_60 = age == "BELOW_60"
    metro = inp["city"] in METRO_CITIES
    months = inp["monthsEmployed"] or 12
    basic_da = c["basic"] + c["da"]

    def row(key, label, act1961, act2025, amount, old, allowed_new, new=None, logic=""):
        new_val = old if new is None else new
        new_val = new_val if allowed_new else 0
        return {
            "key": key, "label": label, "act1961": act1961, "act2025": act2025,
            "amount": _clean(amount), "old": _clean(old), "allowedInNew": allowed_new, "new": _clean(new_val),
            "applied": _clean(new_val if is_new else old),
            "status": "Inactive – New regime" if is_new and not allowed_new else "Active",
            "logic": logic,
        }

    # ---------------------------------------------------- Exemptions u/s 10
    rent_months = ex["rentMonths"]
    salary_for_hra = basic_da * rent_months / months
    hra_old = max(0.0, min(
        c["hra"] * rent_months / months,
        ex["rentPaid"] - p["hraRentExcessPct"] * salary_for_hra,
        (p["hraMetroPct"] if metro else p["hraOtherPct"]) * salary_for_hra,
    ))
    gratuity_exempt = rt["gratuityReceived"] if is_govt else min(rt["gratuityReceived"], rt["gratuityExemptFormula"], p["gratuityCeiling"])
    leave_exempt = rt["leaveEncashment"] if is_govt else min(rt["leaveEncashment"], rt["leaveEncashmentExemptFormula"], p["leaveEncashmentCeiling"])
    divyang_cap = (p["divyangTransportMetro"] if metro else p["divyangTransportOther"]) * months

    exemptions = [
        row("hra", "House rent allowance", "Sec 10(13A) r/w Rule 2A", "Sch III (Sl.11) r/w Rule 279", c["hra"], hra_old, False,
            logic="Least of: HRA received; rent − 10% of (Basic+DA); 50% (8 metros) / 40% of (Basic+DA)"),
        row("lta", "Leave travel allowance / concession", "Sec 10(5) r/w Rule 2B", "Sch III r/w Rule 278", c["lta"], min(c["lta"], ex["ltaFare"]), False,
            logic="Lower of LTA received and eligible fare; 2 journeys in a 4-yr block (2026-29)"),
        row("childrenEducation", "Children education allowance", "Sec 10(14)(ii) r/w Rule 2BB", "Sch III r/w IT Rules 2026", c["childrenEducation"],
            min(c["childrenEducation"], min(ex["ceaChildren"], p["maxChildren"]) * p["ceaPerChildMonth"] * months), False,
            logic="₹3,000 p.m. per child, max 2 children"),
        row("hostel", "Hostel expenditure allowance", "Sec 10(14)(ii) r/w Rule 2BB", "Sch III r/w IT Rules 2026", c["hostel"],
            min(c["hostel"], min(ex["hostelChildren"], p["maxChildren"]) * p["hostelPerChildMonth"] * months), False,
            logic="₹9,000 p.m. per child, max 2 children"),
        row("transportDivyang", "Transport allowance – Divyang employee", "Sec 10(14)(ii) r/w Rule 2BB", "Sch III r/w Rule 15(1)", c["transportDivyang"],
            min(c["transportDivyang"], divyang_cap) if ex["isDivyang"] else 0, True,
            logic="₹15,000 p.m. (8 metros) / ₹8,000 p.m. (others)"),
        row("runningAllowance", "Running allowance – transport-system employee", "Sec 10(14)(ii) r/w Rule 2BB", "Sch III r/w IT Rules 2026", c["runningAllowance"],
            0 if ex["transportDailyAllowance"] else min(p["runningAllowancePct"] * c["runningAllowance"], p["runningAllowanceCap"] * months), False,
            logic="70% of allowance, max ₹25,000 p.m.; nil if daily allowance received"),
        row("conveyance", "Conveyance allowance – official duties", "Sec 10(14)(i) r/w Rule 2BB(1)", "Sch III r/w IT Rules 2026", c["conveyance"],
            min(c["conveyance"], ex["spendConveyance"]), True, logic="Actual spend for official duty – allowed in New regime (prescribed)"),
        row("travel", "Travel / tour / transfer allowance", "Sec 10(14)(i) r/w Rule 2BB(1)", "Sch III r/w IT Rules 2026", c["travel"],
            min(c["travel"], ex["spendTravel"]), True, logic="Actual spend – allowed in New regime (prescribed)"),
        row("dailyAllowance", "Daily allowance on tour", "Sec 10(14)(i) r/w Rule 2BB(1)", "Sch III r/w IT Rules 2026", c["dailyAllowance"],
            min(c["dailyAllowance"], ex["spendDailyAllowance"]), True, logic="Actual spend – allowed in New regime (prescribed)"),
        row("books", "Books & periodicals allowance", "Sec 10(14)(i)", "Sch III r/w IT Rules 2026", c["books"],
            min(c["books"], ex["spendBooks"]), False, logic="Actual spend for official purpose"),
        row("uniform", "Uniform allowance", "Sec 10(14)(i) r/w Rule 2BB(1)", "Sch III r/w IT Rules 2026", c["uniform"],
            min(c["uniform"], ex["spendUniform"]), False, logic="Actual spend"),
        row("helper", "Helper allowance", "Sec 10(14)(i) r/w Rule 2BB(1)", "Sch III r/w IT Rules 2026", c["helper"],
            min(c["helper"], ex["spendHelper"]), False, logic="Actual spend"),
        row("academic", "Academic / research allowance", "Sec 10(14)(i) r/w Rule 2BB(1)", "Sch III r/w IT Rules 2026", c["academic"],
            min(c["academic"], ex["spendAcademic"]), False, logic="Actual spend"),
        row("otherPrescribed", "Other prescribed 10(14)(ii) allowance", "Sec 10(14)(ii) r/w Rule 2BB(2)", "Sch III r/w IT Rules 2026", c["otherPrescribed"],
            min(c["otherPrescribed"], ex["otherPrescribedMonthlyLimit"] * months), False, logic="Prescribed monthly limit × months"),
        row("gratuity", "Gratuity on retirement / resignation", "Sec 10(10)", "Sec 19", rt["gratuityReceived"], gratuity_exempt, True,
            logic="Govt: fully exempt; others: least of actual, formula, ₹20 lakh"),
        row("leaveEncashment", "Leave encashment on retirement", "Sec 10(10AA)", "Sec 19", rt["leaveEncashment"], leave_exempt, True,
            logic="Govt: fully exempt; others: least of actual, formula, ₹25 lakh"),
    ]
    ex_total_old = sum(r["old"] for r in exemptions)
    ex_total_new = sum(r["new"] for r in exemptions)
    ex_allowances_old = ex_total_old - exemptions[-2]["old"] - exemptions[-1]["old"]
    ex_allowances_new = ex_total_new - exemptions[-2]["new"] - exemptions[-1]["new"]

    # ---------------------------------------------------- Perquisites u/s 17(2)
    salary_base = sum(c[k] for k in SALARY_KEYS)

    def rfa(allowance_exemptions: float) -> float:
        if pq["accommodation"] == "NONE":
            return 0
        m = pq["accommodationMonths"]
        base = salary_base - allowance_exemptions
        if pq["accommodation"] == "OWNED":
            rate = {"ABOVE_40L": p["rfaAbove40L"], "15_TO_40L": p["rfa15To40L"]}.get(pq["cityPopulation"], p["rfaOther"])
            value = rate * base * m / 12
        else:
            value = min(pq["leaseRent"], p["leasedCapPct"] * base * m / 12)
        furniture = p["furniturePct"] * pq["furnitureCost"] * m / 12 + pq["furnitureHire"]
        return max(0.0, value + furniture - pq["rentRecovered"])

    small_car = pq["carEngine"] == "SMALL"
    chauffeur = p["chauffeur"] if pq["chauffeur"] else 0
    reimbursed_car = c["carRunning"] + c["driver"]
    if pq["carProvidedBy"] == "NONE" or pq["carUsage"] == "OFFICIAL":
        car = 0.0
    elif pq["carProvidedBy"] == "EMPLOYER":
        if pq["carUsage"] == "PERSONAL":
            car = max(0.0, pq["carRunningExpense"] + p["carDepreciationPct"] * pq["carCost"] * pq["carMonths"] / 12 - pq["carRecovered"])
        else:
            if small_car:
                rate = p["carSmallEmployerExp"] if pq["carRunningBorneBy"] == "EMPLOYER" else p["carSmallEmployeeExp"]
            else:
                rate = p["carLargeEmployerExp"] if pq["carRunningBorneBy"] == "EMPLOYER" else p["carLargeEmployeeExp"]
            car = max(0.0, (rate + chauffeur) * pq["carMonths"] - pq["carRecovered"])
    else:  # employee-owned car
        if pq["carUsage"] == "PERSONAL":
            car = reimbursed_car
        else:
            car = max(0.0, reimbursed_car - ((p["carSmallEmployerExp"] if small_car else p["carLargeEmployerExp"]) + chauffeur) * pq["carMonths"])

    loan = 0.0
    if not (pq["loanMedical"] or pq["loanAmount"] <= p["loanExemptLimit"]):
        loan = max(0.0, pq["loanAvgOutstanding"] * (pq["loanSbiRate"] - pq["loanChargedRate"]) * pq["loanMonths"] / 12)

    def perq(key, label, a1961, a2025, old, new=None, logic=""):
        new_val = old if new is None else new
        return {"key": key, "label": label, "act1961": a1961, "act2025": a2025, "old": _clean(old), "new": _clean(new_val),
                "applied": _clean(new_val if is_new else old), "logic": logic}

    perquisites = [
        perq("accommodation", "Rent-free / concessional accommodation", "Sec 17(2)(i)/(ii) r/w Rule 3(1)", "Sec 17 r/w Rule 15(1)",
             rfa(ex_allowances_old), rfa(ex_allowances_new),
             "Owned: 10% / 7.5% / 5% of salary; Leased: lower of rent or 10% of salary; + furniture 10% of cost; − recovery"),
        perq("car", "Motor car & chauffeur", "Sec 17(2)(iii) r/w Rule 3(2)", "Sec 17 r/w Rule 15(2)", car,
             logic="Mixed use: ₹5,000/₹7,000 (employer exp.) or ₹2,000/₹3,000 (employee exp.) + ₹3,000 driver p.m."),
        perq("carReimbursement", "Car / driver reimbursement where no car facility declared", "Sec 17(1)/(2)", "Sec 16/17",
             reimbursed_car if pq["carProvidedBy"] == "NONE" else 0, logic="Reimbursement without qualifying car = fully taxable"),
        perq("telephone", "Telephone / mobile / internet", "Sec 17(2) r/w Rule 3(7)(ix)", "Sec 17 r/w Rule 15",
             max(0.0, c["telephone"] - pq["telephoneBills"]), logic="Nil perquisite against bills; unsupported reimbursement taxable"),
        perq("meals", "Meals / food vouchers", "Rule 3(7)(iii)", "Rule 15",
             max(0.0, c["meal"] - p["mealPerMeal"] * pq["meals"]), logic="₹200 per meal tax-free (BOTH regimes from TY 2026-27)"),
        perq("gifts", "Gifts / vouchers / tokens", "Rule 3(7)(iv)", "Rule 15",
             0 if c["gift"] <= p["giftLimit"] else c["gift"], logic="Nil if aggregate ≤ ₹15,000; else full value"),
        perq("loan", "Interest-free / concessional loan", "Sec 17(2)(viii) r/w Rule 3(7)(i)", "Sec 17 r/w Rule 15", loan,
             logic="Nil if aggregate ≤ ₹2 lakh or medical; else (SBI rate − rate charged) × outstanding"),
        perq("education", "Free / concessional education", "Rule 3(5)", "Rule 15",
             max(0.0, pq["educationCostPerChild"] - p["educationPerChildMonth"]) * pq["educationChildren"] * pq["educationMonths"],
             logic="Cost in excess of ₹3,000 per child p.m."),
        perq("esop", "ESOP / sweat equity", "Sec 17(2)(vi)", "Sec 17",
             max(0.0, pq["esopFmv"] - pq["esopExercisePrice"]) * pq["esopShares"], logic="(FMV on exercise − exercise price) × shares"),
        perq("retirementContrib", "Employer PF + NPS + superannuation above ₹7.5 lakh", "Sec 17(2)(vii)", "Sec 17",
             max(0.0, min(c["employerPf"], p["employerPfExemptPct"] * basic_da) + c["employerNps"] + c["superannuation"] - p["retirementContribCap"]),
             logic="Aggregate employer contribution − ₹7,50,000"),
        perq("other", "Other perquisites (club, credit card, servants, assets, medical abroad, others)", "Sec 17(2)(iv)/(v)/(viii)", "Sec 17 r/w Rule 15",
             pq["club"] + pq["creditCard"] + pq["servants"] + pq["assets"] + pq["medicalAbroad"] + pq["otherPerquisite"], logic="As entered"),
    ]
    perq_old = sum(r["old"] for r in perquisites)
    perq_new = sum(r["new"] for r in perquisites)

    # ---------------------------------------------------- Salary & other heads
    excess_pf = max(0.0, c["employerPf"] - p["employerPfExemptPct"] * basic_da)
    salary_17_1 = (salary_base + c["employerNps"] + c["agniveer"] + excess_pf
                   + rt["gratuityReceived"] + rt["leaveEncashment"] + oi["previousEmployerSalary"])
    gross_old = salary_17_1 + perq_old + rt["profitsInLieu"]
    gross_new = salary_17_1 + perq_new + rt["profitsInLieu"]
    after_ex_old = gross_old - ex_total_old
    after_ex_new = gross_new - ex_total_new
    std_old = min(p["stdDeductionOld"], after_ex_old)
    std_new = min(p["stdDeductionNew"], after_ex_new)
    ent_old = min(c["entertainment"], p["entertainmentCap"], p["entertainmentPctBasic"] * c["basic"]) if is_govt else 0
    pt_old = inp["professionalTax"]
    salary_income_old = max(0.0, after_ex_old - std_old - ent_old - pt_old)
    salary_income_new = max(0.0, after_ex_new - std_new)

    interest_24b = min(dd["homeLoanInterest24b"], p["homeLoanInterestCap"])
    house_old = max(-p["housePropertyLossCap"], oi["houseProperty"] - interest_24b)
    house_new = max(0.0, oi["houseProperty"])
    other_sources = oi["savingsInterest"] + oi["depositInterest"] + oi["otherSources"]
    gti_old = max(0.0, salary_income_old + house_old + other_sources)
    gti_new = max(0.0, salary_income_new + house_new + other_sources)

    # ---------------------------------------------------- Chapter VI-A
    sec80c_sum = sum(dd[k] for k, _ in SEC80C_KEYS)
    ccd1 = min(dd["nps80CCD1"], p["pct80CCD1"] * basic_da)
    self_cap = p["limit80DSelfSenior"] if (dd["selfSenior"] or not below_60) else p["limit80DSelf"]
    parents_cap = p["limit80DParentsSenior"] if dd["parentsSenior"] else p["limit80DParents"]
    checkup_self = min(dd["checkupSelf"], p["limit80DCheckup"])
    d80 = (min(dd["healthSelf"] + checkup_self, self_cap)
           + min(dd["healthParents"] + min(dd["checkupParents"], p["limit80DCheckup"] - checkup_self), parents_cap))

    def disability(cat: str) -> float:
        return {"DISABILITY": p["disability"], "SEVERE": p["disabilitySevere"]}.get(cat, 0)

    deductions = [
        row("80C", "80C + 80CCC + 80CCD(1) (restricted u/s 80CCE)", "Sec 80C/80CCC/80CCD(1)/80CCE", "Sec 123 r/w Sch XV",
            sec80c_sum + dd["pension80CCC"] + dd["nps80CCD1"], min(sec80c_sum + dd["pension80CCC"] + ccd1, p["limit80C"]), False,
            logic="₹1,50,000 combined; 80CCD(1) max 10% of Basic+DA"),
        row("80CCD1B", "Additional own NPS contribution", "Sec 80CCD(1B)", "Sec 124", dd["nps80CCD1B"],
            min(dd["nps80CCD1B"], p["limit80CCD1B"]), False, logic="₹50,000 over and above ₹1.5 lakh"),
        row("80CCD2", "Employer contribution to NPS", "Sec 80CCD(2)", "Sec 124", c["employerNps"],
            min(c["employerNps"], (p["pct80CCD2Govt"] if is_govt else p["pct80CCD2OldNonGovt"]) * basic_da), True,
            new=min(c["employerNps"], p["pct80CCD2New"] * basic_da), logic="Old: 10% (14% Govt) of Basic+DA; New: 14% for all employers"),
        row("80CCH1", "Agniveer – own contribution to Corpus Fund", "Sec 80CCH(1)", "Sec 125", dd["agniveerOwn"], dd["agniveerOwn"], False,
            logic="Full amount (Old regime only)"),
        row("80CCH2", "Agniveer – Govt contribution to Corpus Fund", "Sec 80CCH(2)", "Sec 125", c["agniveer"], c["agniveer"], True,
            logic="Full amount – allowed in New regime"),
        row("80D", "Health insurance & check-up", "Sec 80D", "Sec 126",
            dd["healthSelf"] + dd["checkupSelf"] + dd["healthParents"] + dd["checkupParents"], d80, False,
            logic="Self ₹25k (₹50k senior) + Parents ₹25k (₹50k senior); check-up ₹5k within"),
        row("80DD", "Maintenance / treatment of disabled dependant", "Sec 80DD", "Sec 127", 0, disability(dd["disabledDependant"]), False,
            logic="Fixed ₹75,000 / ₹1,25,000"),
        row("80DDB", "Specified disease treatment", "Sec 80DDB", "Sec 128", dd["ddbAmount"] - dd["ddbReimbursed"],
            max(0.0, min(dd["ddbAmount"] - dd["ddbReimbursed"], p["limit80DDBSenior"] if dd["ddbSenior"] else p["limit80DDB"])), False,
            logic="₹40,000 / ₹1,00,000 (senior)"),
        row("80U", "Person with disability (self)", "Sec 80U", "Sec 154", 0, disability(dd["selfDisability"]), False,
            logic="Fixed ₹75,000 / ₹1,25,000"),
        row("80E", "Interest on education loan", "Sec 80E", "Sec 129", dd["educationLoanInterest"], dd["educationLoanInterest"], False,
            logic="Actual interest, 8 years"),
        row("80EE", "Interest on home loan – first-time buyer", "Sec 80EE", "Sec 130", dd["homeLoan80EE"],
            min(dd["homeLoan80EE"], p["limit80EE"]), False, logic="₹50,000"),
        row("80EEA", "Interest on home loan – affordable housing", "Sec 80EEA", "Sec 131", dd["homeLoan80EEA"],
            min(dd["homeLoan80EEA"], p["limit80EEA"]), False, logic="₹1,50,000 (cannot combine with 80EE)"),
        row("80EEB", "Interest on electric vehicle loan", "Sec 80EEB", "Sec 132", dd["evLoan"], min(dd["evLoan"], p["limit80EEB"]), False,
            logic="₹1,50,000"),
        row("80TTA", "Savings bank interest", "Sec 80TTA", "Sec 153", oi["savingsInterest"],
            min(oi["savingsInterest"], p["limit80TTA"]) if below_60 else 0, False, logic="₹10,000 (below 60)"),
        row("80TTB", "Deposit interest – senior citizens", "Sec 80TTB", "Sec 153", oi["savingsInterest"] + oi["depositInterest"],
            0 if below_60 else min(oi["savingsInterest"] + oi["depositInterest"], p["limit80TTB"]), False, logic="₹50,000 (60+)"),
        row("80GGC", "Contribution to political party / electoral trust (non-cash)", "Sec 80GGC", "Sec 137",
            dd["politicalDonation"], dd["politicalDonation"], False, logic="100%"),
    ]
    sub_old = sum(r["old"] for r in deductions)
    sub_new = sum(r["new"] for r in deductions)

    adjusted = gti_old - sub_old
    gg = 0.0 if c["hra"] > 0 else max(0.0, min(
        p["limit80GGMonth"] * months, p["pct80GG"] * adjusted, dd["rentNoHra"] - p["hraRentExcessPct"] * adjusted))
    qualifying = p["pct80G"] * max(0.0, gti_old - sub_old - gg)
    d100l = min(dd["donation100Limited"], qualifying)
    g80 = dd["donation100"] + 0.5 * dd["donation50"] + d100l + 0.5 * min(dd["donation50Limited"], max(0.0, qualifying - d100l))
    deductions += [
        row("80GG", "Rent paid – no HRA received (Form 10BA)", "Sec 80GG", "Sec 134", dd["rentNoHra"], gg, False,
            logic="Least of ₹5,000 p.m.; 25% of ATI; rent − 10% of ATI (only if HRA = 0)"),
        row("80G", "Donations", "Sec 80G", "Sec 133",
            dd["donation100"] + dd["donation50"] + dd["donation100Limited"] + dd["donation50Limited"], g80, False,
            logic="Qualifying limit 10% of adjusted GTI"),
    ]
    via_old = sub_old + gg + g80
    via_new = sub_new

    # ---------------------------------------------------- Tax
    def tax_for(regime: str, gti: float, via: float) -> dict:
        new = regime == "NEW"
        deduction = min(gti, via)
        total_income = xround((gti - deduction) / 10) * 10
        if new:
            slabs = p["newSlabs"]
            basic_exemption = p["newSlabs"][0][0]
        else:
            basic_exemption = BASIC_EXEMPTION_OLD[age]
            slabs = [(basic_exemption if s is None else s, r) for s, r in p["oldSlabs"]]
        slab_tax = _slab_tax(total_income, slabs)
        if new:
            rebate = (min(slab_tax, p["rebateNewMax"]) if total_income <= p["rebateNewIncomeLimit"]
                      else max(0.0, slab_tax - (total_income - p["rebateNewIncomeLimit"])))
        else:
            rebate = min(slab_tax, p["rebateOldMax"]) if total_income <= p["rebateOldIncomeLimit"] else 0
        after_rebate = slab_tax - rebate

        col = 2 if new else 1
        bands = p["surcharge"]
        band = max((b for b in bands if b[0] <= total_income), key=lambda b: b[0])
        rate, threshold = band[col], band[0]
        rate_below = 0 if threshold == 0 else max((b for b in bands if b[0] <= threshold - 1), key=lambda b: b[0])[col]
        tax_at_threshold = _slab_tax(threshold, slabs)
        surcharge_gross = after_rebate * rate
        relief = 0.0 if threshold == 0 else min(surcharge_gross, max(0.0, (after_rebate + surcharge_gross) - (tax_at_threshold * (1 + rate_below) + (total_income - threshold))))
        surcharge = surcharge_gross - relief
        cess = (after_rebate + surcharge) * p["cessRate"]
        total_tax = xround((after_rebate + surcharge + cess) / 10) * 10
        balance = max(0, total_tax - inp["tdsDeducted"])
        return {
            "deductions": deduction, "totalIncome": total_income, "basicExemption": basic_exemption,
            "slabTax": slab_tax, "rebate": rebate, "taxAfterRebate": after_rebate, "surchargeRate": rate,
            "surchargeThreshold": threshold, "surchargeBeforeRelief": surcharge_gross, "marginalRelief": relief,
            "surcharge": surcharge, "cess": cess, "totalTax": total_tax, "tdsDeducted": inp["tdsDeducted"],
            "balanceTax": balance, "monthlyTds": xround(balance / max(1, inp["monthsRemaining"])),
        }

    t_old = tax_for("OLD", gti_old, via_old)
    t_new = tax_for("NEW", gti_new, via_new)

    def line(key, label, act1961, act2025, old, new):
        return {"key": key, "label": label, "act1961": act1961, "act2025": act2025,
                "old": _clean(old), "new": _clean(new), "selected": _clean(new if is_new else old)}

    computation = [
        line("salary17_1", "Salary u/s 17(1) — basic, allowances, bonus, employer NPS, excess PF, gratuity, leave encashment, prev. employer", "Sec 17(1)", "Sec 16/17", salary_17_1, salary_17_1),
        line("perquisites", "Value of perquisites u/s 17(2)", "Sec 17(2)", "Sec 17 r/w Rule 15", perq_old, perq_new),
        line("profitsInLieu", "Profits in lieu of salary u/s 17(3)", "Sec 17(3)", "Sec 18", rt["profitsInLieu"], rt["profitsInLieu"]),
        line("grossSalary", "GROSS SALARY", "Sec 17", "Sec 16-18", gross_old, gross_new),
        line("exemptions", "Less: Exemptions u/s 10", "Sec 10", "Sec 11 / Sch II-III / Sec 19", ex_total_old, ex_total_new),
        line("afterExemptions", "Salary after exemptions", "", "", after_ex_old, after_ex_new),
        line("standardDeduction", "Less: Standard deduction", "Sec 16(ia)", "Sec 19 (Table S.No.2)", std_old, std_new),
        line("entertainment", "Less: Entertainment allowance (Govt employees)", "Sec 16(ii)", "Sec 19", ent_old, 0),
        line("professionalTax", "Less: Professional tax", "Sec 16(iii)", "Sec 19 (Table S.No.1)", pt_old, 0),
        line("salaryIncome", "INCOME CHARGEABLE UNDER 'SALARIES'", "", "", salary_income_old, salary_income_new),
        line("houseProperty", "Income / (loss) from house property", "Sec 22-27", "Sec 20-25", house_old, house_new),
        line("otherSources", "Income from other sources (interest etc.)", "Sec 56", "Sec 92", other_sources, other_sources),
        line("gti", "GROSS TOTAL INCOME", "", "", gti_old, gti_new),
        line("chapterVIA", "Less: Deductions under Chapter VI-A", "Sec 80C-80U", "Sec 122-154", t_old["deductions"], t_new["deductions"]),
        line("totalIncome", "TOTAL INCOME (rounded to nearest ₹10)", "Sec 288A", "Corresponding provision", t_old["totalIncome"], t_new["totalIncome"]),
        line("basicExemption", "Basic exemption limit applied", "First Schedule", "Finance Act 2026", t_old["basicExemption"], t_new["basicExemption"]),
        line("slabTax", "Tax on total income (slab rates)", "First Schedule", "Sec 202 / Finance Act 2026", t_old["slabTax"], t_new["slabTax"]),
        line("rebate", "Less: Rebate (with marginal relief in New regime)", "Sec 87A", "Sec 156", t_old["rebate"], t_new["rebate"]),
        line("taxAfterRebate", "Tax after rebate", "", "", t_old["taxAfterRebate"], t_new["taxAfterRebate"]),
        line("surchargeRate", "Surcharge rate applicable", "Finance Act", "Finance Act 2026", t_old["surchargeRate"], t_new["surchargeRate"]),
        line("surchargeBeforeRelief", "Surcharge (before marginal relief)", "", "", t_old["surchargeBeforeRelief"], t_new["surchargeBeforeRelief"]),
        line("marginalRelief", "Less: Marginal relief on surcharge", "", "", t_old["marginalRelief"], t_new["marginalRelief"]),
        line("surcharge", "Surcharge payable", "", "", t_old["surcharge"], t_new["surcharge"]),
        line("cess", "Health & Education Cess @ 4%", "Finance Act", "Finance Act 2026", t_old["cess"], t_new["cess"]),
        line("totalTax", "TOTAL TAX LIABILITY (rounded to ₹10)", "", "", t_old["totalTax"], t_new["totalTax"]),
        line("effectiveRate", "Effective tax rate on gross salary", "", "",
             t_old["totalTax"] / gross_old if gross_old else 0, t_new["totalTax"] / gross_new if gross_new else 0),
        line("tdsDeducted", "Less: TDS already deducted", "Sec 192", "Sec 392", t_old["tdsDeducted"], t_new["tdsDeducted"]),
        line("balanceTax", "Balance tax to be deducted", "", "", t_old["balanceTax"], t_new["balanceTax"]),
        line("monthlyTds", "MONTHLY TDS for remaining months", "Sec 192", "Sec 392", t_old["monthlyTds"], t_new["monthlyTds"]),
    ]

    total_ctc = sum(c[k] for k, _, _ in CTC_COMPONENTS)
    selected = t_new if is_new else t_old
    take_home = ((total_ctc - c["employerPf"] - c["employerNps"] - c["agniveer"] - c["superannuation"] - c["gratuityProvision"]
                  - c["insurance"] - c["statutory"] - c["meal"] - c["gift"] - dd["pfEmployee"] - inp["professionalTax"]) / 12
                 - selected["monthlyTds"])
    if t_old["totalTax"] < t_new["totalTax"]:
        beneficial = "OLD"
    elif t_old["totalTax"] > t_new["totalTax"]:
        beneficial = "NEW"
    else:
        beneficial = "EQUAL"

    return {
        "inputs": inp,
        "metroCity": metro,
        "totalCtc": _clean(total_ctc),
        "exemptions": {"rows": exemptions, "totalAmount": _clean(sum(r["amount"] for r in exemptions)),
                       "totalOld": _clean(ex_total_old), "totalNew": _clean(ex_total_new),
                       "allowanceOld": _clean(ex_allowances_old), "allowanceNew": _clean(ex_allowances_new)},
        "perquisites": {"rows": perquisites, "totalOld": _clean(perq_old), "totalNew": _clean(perq_new)},
        "deductions": {"rows": deductions, "totalOld": _clean(via_old), "totalNew": _clean(via_new),
                       "interest24b": _clean(interest_24b)},
        "computation": computation,
        "summary": {
            "regime": inp["regime"],
            "oldTax": t_old["totalTax"], "newTax": t_new["totalTax"],
            "selectedTax": selected["totalTax"], "selectedMonthlyTds": selected["monthlyTds"],
            "savingWithNew": _clean(t_old["totalTax"] - t_new["totalTax"]),
            "beneficialRegime": beneficial,
            "selectedIsBeneficial": beneficial in ("EQUAL", inp["regime"]),
            "monthlyTakeHome": _clean(round(take_home, 2)),
        },
    }


def options() -> dict:
    """Static metadata for building the form."""
    return {
        "ctcComponents": [{"key": k, "label": l, "treatment": t} for k, l, t in CTC_COMPONENTS],
        "sec80cItems": [{"key": k, "label": l} for k, l in SEC80C_KEYS],
        "cities": CITY_OPTIONS,
        "metroCities": METRO_CITIES,
        "parameters": {k: v for k, v in PARAMETERS.items() if not isinstance(v, list)},
    }
