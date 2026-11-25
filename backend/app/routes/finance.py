"""Finance & Accounting: GL mapping (maker-checker), payroll journal (JV) with cost-centre split,
provisions, period close, salary bank reconciliation, Tally export, expense claims with payment
batches, and employee loans / advances recovered through payroll.

Roles (checklist matrix): Accounts posts / reconciles, Finance approves / releases, Auditors read,
employees see their own claims and loans, managers approve their team's claims."""

import csv
import io
from datetime import date
from typing import Optional
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import DOCUMENTS, audit, read_body, read_fields_and_files, save_upload
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.workflow import (
    actor_name, add_payroll_input, employee_name, is_in_team, manager_of, my_employee_id,
    notify_employee, notify_roles, payroll_month_locked,
)

router = APIRouter()

ACCOUNTS = ("ACCOUNTS",)
FINANCE = ("FINANCE",)
FIN_READ = ("FINANCE", "ACCOUNTS", "AUDITORS")
CONFIG = ("ADMIN", "SUPER_ADMIN", "FINANCE")

DEFAULT_LIMITS = {"TRAVEL": 50000, "FOOD": 5000, "ACCOMMODATION": 40000, "LEARNING": 30000, "MEDICAL": 15000,
                  "INTERNET": 2000, "TELEPHONE": 2000, "OFFICE_SUPPLIES": 10000, "OTHER": 10000}

# component -> (GL code, GL name, side). side: DR = expense, CR = liability
DEFAULT_GL = {
    "BASIC": ("5101", "Salaries - Basic", "DR"), "HRA": ("5102", "Salaries - HRA", "DR"),
    "SPECIAL": ("5103", "Salaries - Special allowance", "DR"), "CONVEYANCE": ("5104", "Salaries - Conveyance", "DR"),
    "LTA": ("5105", "Salaries - LTA", "DR"), "EDUCATION": ("5106", "Salaries - Children education", "DR"),
    "ARREARS": ("5107", "Salary arrears", "DR"), "VARIABLE_PAY": ("5108", "Bonus / variable pay", "DR"),
    "OVERTIME": ("5109", "Overtime wages", "DR"), "LEAVE_ENCASHMENT": ("5110", "Leave encashment", "DR"),
    "REIMBURSEMENT": ("5111", "Employee reimbursements", "DR"),
    "PF_ER": ("5201", "Employer PF contribution", "DR"), "ESIC_ER": ("5202", "Employer ESIC contribution", "DR"),
    "LWF_ER": ("5203", "Employer LWF contribution", "DR"),
    "PF": ("2101", "PF payable", "CR"), "ESIC": ("2102", "ESIC payable", "CR"), "PT": ("2103", "Professional tax payable", "CR"),
    "LWF": ("2104", "LWF payable", "CR"), "TDS": ("2105", "TDS on salary payable", "CR"),
    "LOAN_EMI": ("1301", "Employee loans & advances", "CR"), "RECOVERY": ("4901", "Recoveries from employees", "CR"),
    "INSURANCE_PREMIUM": ("2106", "Insurance premium payable", "CR"), "OTHER_DEDUCTION": ("2107", "Other deductions payable", "CR"),
    "NET_PAY": ("2201", "Net salary payable", "CR"),
}
PROVISION_GL = {
    "BONUS": (("5301", "Bonus expense"), ("2301", "Provision for bonus")),
    "GRATUITY": (("5302", "Gratuity expense"), ("2302", "Provision for gratuity")),
    "LEAVE_ENCASHMENT": (("5303", "Leave encashment expense"), ("2303", "Provision for leave encashment")),
}


def _id(prefix: str) -> str:
    return f"{prefix}_{now_ms()}_{rand_base36(4)}"


def _month(value) -> str:
    m = js_str(value or "")[:7]
    try:
        date.fromisoformat(m + "-01")
    except ValueError:
        raise ApiError(400, "Month must be YYYY-MM.")
    return m


def settings() -> dict:
    s = modules_store.financeSettings.setdefault("settings", {"_id": "settings"})
    s.setdefault("claimLimits", dict(DEFAULT_LIMITS))
    s.setdefault("claimPaymentDefault", "PAYROLL")
    return s


def gl_mappings() -> dict:
    if not modules_store.glMappings:
        for code, (gl, name, side) in DEFAULT_GL.items():
            modules_store.glMappings[code] = {"_id": code, "component": code, "glCode": gl, "glName": name, "side": side,
                                              "approvedBy": "System default", "approvedAt": now_iso()}
    return modules_store.glMappings


def period_closed(month: str) -> bool:
    return (modules_store.accountingPeriods.get(month) or {}).get("status") == "CLOSED"


# ------------------------------------------------------------------ settings

@router.get("/finance/settings")
async def get_settings(user: dict = Depends(require_auth)):
    return {"settings": settings()}


@router.put("/finance/settings")
async def save_settings(request: Request, user: dict = Depends(require_role(*CONFIG))):
    b = await read_body(request)
    s = settings()
    old = dict(s["claimLimits"])
    for cat, v in (b.get("claimLimits") or {}).items():
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise ApiError(400, f"Limit for {cat} must be a number.")
        if v < 0:
            raise ApiError(400, f"Limit for {cat} cannot be negative.")
        s["claimLimits"][js_str(cat).upper()] = v
    if b.get("claimPaymentDefault") in ("PAYROLL", "BANK"):
        s["claimPaymentDefault"] = b["claimPaymentDefault"]
    audit(user, "FINANCE_SETTINGS_UPDATED", "FINANCE", "FinanceSettings", "settings",
          {"changes": [{"field": f"claimLimits.{k}", "oldValue": old.get(k), "newValue": v} for k, v in s["claimLimits"].items() if old.get(k) != v]})
    return {"settings": s}


# ------------------------------------------------------------------ GL mapping (maker-checker)

@router.get("/finance/gl-mappings")
async def list_mappings(user: dict = Depends(require_role(*FIN_READ))):
    changes = sorted(modules_store.glMappingChanges.values(), key=lambda c: c["requestedAt"], reverse=True)
    for c in changes:
        c["canApprove"] = c["status"] == "PENDING" and user.get("role") in FINANCE and c["requestedByUserId"] != user["_id"]
    return {"mappings": sorted(gl_mappings().values(), key=lambda m: m["glCode"]), "changes": changes}


@router.post("/finance/gl-mappings/changes")
async def propose_mapping(request: Request, user: dict = Depends(require_role("ACCOUNTS", "FINANCE"))):
    b = await read_body(request)
    comp = js_str(b.get("component") or "").strip().upper()
    gl = js_str(b.get("glCode") or "").strip()
    name = js_str(b.get("glName") or "").strip()
    side = b.get("side") if b.get("side") in ("DR", "CR") else (gl_mappings().get(comp) or {}).get("side", "DR")
    if not comp or not gl or not name:
        raise ApiError(400, "Component, GL code and GL name are required.")
    if any(c["component"] == comp and c["status"] == "PENDING" for c in modules_store.glMappingChanges.values()):
        raise ApiError(409, f"A change to {comp} is already waiting for approval.")
    cid = _id("glchg")
    old = gl_mappings().get(comp)
    doc = {"_id": cid, "component": comp, "glCode": gl, "glName": name, "side": side, "status": "PENDING",
           "old": {k: (old or {}).get(k) for k in ("glCode", "glName", "side")} if old else None,
           "requestedBy": actor_name(user), "requestedByUserId": user["_id"], "requestedAt": now_iso()}
    modules_store.glMappingChanges[cid] = doc
    notify_roles(FINANCE, "GL mapping change to approve", f"{comp} → {gl} {name}", "FINANCE", exclude_user_id=user["_id"])
    audit(user, "GL_MAPPING_CHANGE_REQUESTED", "FINANCE", "GlMapping", comp, {"changes": [{"field": comp, "oldValue": doc["old"], "newValue": {"glCode": gl, "glName": name}}]})
    return JSONResponse({"change": doc}, status_code=201)


@router.post("/finance/gl-mappings/changes/{change_id}/decide")
async def decide_mapping(change_id: str, request: Request, user: dict = Depends(require_role(*FINANCE))):
    c = modules_store.glMappingChanges.get(change_id)
    if not c:
        raise ApiError(404, "Change not found.")
    if c["status"] != "PENDING":
        raise ApiError(409, "This change has already been decided.")
    if c["requestedByUserId"] == user["_id"]:
        raise ApiError(403, "Maker-checker: you cannot approve a GL mapping change you requested.")
    b = await read_body(request)
    decision = b.get("decision")
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    c.update({"status": decision, "decidedBy": actor_name(user), "decidedAt": now_iso(), "comment": js_str(b.get("comment") or "")})
    if decision == "APPROVED":
        gl_mappings()[c["component"]] = {"_id": c["component"], "component": c["component"], "glCode": c["glCode"], "glName": c["glName"],
                                         "side": c["side"], "approvedBy": actor_name(user), "approvedAt": now_iso(), "requestedBy": c["requestedBy"]}
    audit(user, f"GL_MAPPING_CHANGE_{decision}", "FINANCE", "GlMapping", c["component"], {"changeId": change_id})
    return {"change": c}


# ------------------------------------------------------------------ journals

def _slip_lines(p: dict) -> tuple:
    """(earnings, deductions, employer) for a payslip, including older payslips without line arrays."""
    if p.get("earnings"):
        return p["earnings"], p.get("deductions") or [], p.get("employerContributions") or []
    earn = [{"code": c, "amount": p.get(f) or 0} for c, f in (("BASIC", "basicSalary"), ("HRA", "hra"), ("SPECIAL", "specialAllowance"),
                                                             ("CONVEYANCE", "conveyanceAllowance")) if p.get(f)]
    ded = [{"code": c, "amount": p.get(f) or 0} for c, f in (("PF", "providentFund"), ("PT", "professionalTax"), ("TDS", "tds"),
                                                            ("OTHER_DEDUCTION", "otherDeductions")) if p.get(f)]
    diff = round((p.get("grossSalary") or 0) - sum(e["amount"] for e in earn), 2)
    if diff > 0.5:
        earn.append({"code": "SPECIAL", "amount": diff})
    return earn, ded, []


def _balanced(lines: list) -> tuple:
    dr = round(sum(l.get("debit") or 0 for l in lines), 2)
    cr = round(sum(l.get("credit") or 0 for l in lines), 2)
    return dr, cr


def _journal_view(j: dict, user: dict) -> dict:
    return {**j, "canApprove": j["status"] == "DRAFT" and user.get("role") in FINANCE and j["createdByUserId"] != user["_id"]
            and not period_closed(j["month"])}


@router.post("/finance/journals/payroll")
async def payroll_journal(request: Request, user: dict = Depends(require_role(*ACCOUNTS))):
    month = _month((await read_body(request)).get("month"))
    slips = [p for p in modules_store.payslips.values() if p.get("month") == month]
    if not slips or any(p.get("status") not in ("APPROVED", "PAID") for p in slips):
        raise ApiError(400, "The payroll journal can be generated only after the month's payroll is approved and locked.")
    if period_closed(month):
        raise ApiError(423, f"Accounting period {month} is closed.")
    if any(j["month"] == month and j["type"] == "PAYROLL" and j["status"] in ("DRAFT", "POSTED") for j in modules_store.journals.values()):
        raise ApiError(409, f"A payroll journal for {month} already exists.")
    maps = gl_mappings()
    agg: dict = {}
    unmapped = set()
    by_cc: dict = {}

    def add(code: str, cc: str, amount: float, side: Optional[str] = None):
        if not amount:
            return
        m = maps.get(code)
        if not m:
            unmapped.add(code)
            return
        sd = side or m["side"]
        key = (m["glCode"], cc, sd)
        row = agg.setdefault(key, {"glCode": m["glCode"], "glName": m["glName"], "costCenter": cc, "debit": 0.0, "credit": 0.0})
        row["debit" if sd == "DR" else "credit"] += amount

    for p in slips:
        cc = p.get("department") or "Unassigned"
        earn, ded, er = _slip_lines(p)
        for e in earn:
            add(e["code"], cc, e["amount"])
        for d in ded:
            add(d["code"], cc, d["amount"])
        for e in er:
            add(e["code"], cc, e["amount"])          # employer expense (DR)
            add({"PF_ER": "PF", "ESIC_ER": "ESIC", "LWF_ER": "LWF"}.get(e["code"], "OTHER_DEDUCTION"), cc, e["amount"], "CR")  # payable
        add("NET_PAY", cc, max(0.0, p.get("netSalary") or 0))
        c = by_cc.setdefault(cc, {"costCenter": cc, "headcount": 0, "gross": 0.0, "net": 0.0, "employerCost": 0.0})
        c["headcount"] += 1
        c["gross"] += p.get("grossSalary") or 0
        c["net"] += p.get("netSalary") or 0
        c["employerCost"] += sum(e["amount"] for e in er)
    if unmapped:
        raise ApiError(400, f"Unmapped pay components: {', '.join(sorted(unmapped))}. Map them to GL accounts before posting.",
                       unmapped=sorted(unmapped))
    lines = [{**r, "debit": round(r["debit"], 2), "credit": round(r["credit"], 2)} for r in sorted(agg.values(), key=lambda r: (r["costCenter"], r["glCode"]))]
    dr, cr = _balanced(lines)
    if abs(dr - cr) > 0.05:
        raise ApiError(500, f"Journal does not balance (Dr {dr} / Cr {cr}).")
    jid = _id("jv")
    j = {"_id": jid, "number": f"JV-PAY-{month}", "type": "PAYROLL", "month": month, "narration": f"Payroll for {month}",
         "lines": lines, "totalDebit": dr, "totalCredit": cr, "costCenters": [{**c, "gross": round(c["gross"], 2), "net": round(c["net"], 2),
                                                                                 "employerCost": round(c["employerCost"], 2)} for c in by_cc.values()],
         "status": "DRAFT", "createdBy": actor_name(user), "createdByUserId": user["_id"], "createdAt": now_iso()}
    modules_store.journals[jid] = j
    notify_roles(FINANCE, "Payroll journal to approve", f"{j['number']}: Dr = Cr = ₹{dr:,.2f}", "FINANCE")
    audit(user, "JOURNAL_CREATED", "FINANCE", "Journal", jid, {"number": j["number"], "debit": dr, "credit": cr})
    return JSONResponse({"journal": _journal_view(j, user)}, status_code=201)


@router.post("/finance/journals")
async def manual_journal(request: Request, user: dict = Depends(require_role(*ACCOUNTS))):
    b = await read_body(request)
    month = _month(b.get("month"))
    if period_closed(month):
        raise ApiError(423, f"Accounting period {month} is closed; posting is blocked.")
    lines = []
    for l in b.get("lines") or []:
        try:
            dr, cr = float(l.get("debit") or 0), float(l.get("credit") or 0)
        except (TypeError, ValueError):
            raise ApiError(400, "Debit and credit must be numbers.")
        if not js_str(l.get("glCode") or "").strip() or (dr and cr) or (dr < 0 or cr < 0):
            raise ApiError(400, "Each line needs a GL code and either a debit or a credit.")
        lines.append({"glCode": js_str(l["glCode"]).strip(), "glName": js_str(l.get("glName") or ""), "costCenter": js_str(l.get("costCenter") or "Corporate"),
                      "debit": round(dr, 2), "credit": round(cr, 2)})
    if len(lines) < 2:
        raise ApiError(400, "A journal needs at least two lines.")
    dr, cr = _balanced(lines)
    if abs(dr - cr) > 0.001:
        raise ApiError(400, f"Debit ({dr:,.2f}) must equal credit ({cr:,.2f}).")
    jid = _id("jv")
    j = {"_id": jid, "number": f"JV-{month}-{rand_base36(4).upper()}", "type": js_str(b.get("type") or "MANUAL").upper(), "month": month,
         "narration": js_str(b.get("narration") or ""), "lines": lines, "totalDebit": dr, "totalCredit": cr, "status": "DRAFT",
         "createdBy": actor_name(user), "createdByUserId": user["_id"], "createdAt": now_iso()}
    modules_store.journals[jid] = j
    audit(user, "JOURNAL_CREATED", "FINANCE", "Journal", jid, {"number": j["number"], "debit": dr})
    return JSONResponse({"journal": _journal_view(j, user)}, status_code=201)


@router.post("/finance/provisions")
async def month_end_provisions(request: Request, user: dict = Depends(require_role(*ACCOUNTS))):
    """Bonus 8.33% of basic, gratuity 4.81% of basic, leave encashment 1.25 days' basic per employee."""
    month = _month((await read_body(request)).get("month"))
    if period_closed(month):
        raise ApiError(423, f"Accounting period {month} is closed; posting is blocked.")
    slips = [p for p in modules_store.payslips.values() if p.get("month") == month and p.get("status") in ("APPROVED", "PAID")]
    if not slips:
        raise ApiError(400, "Provisions are based on the approved payroll of the month; there is none yet.")
    by_cc: dict = {}
    for p in slips:
        earn, _, _ = _slip_lines(p)
        basic = next((e["amount"] for e in earn if e["code"] == "BASIC"), 0)
        cc = by_cc.setdefault(p.get("department") or "Unassigned", {"BONUS": 0.0, "GRATUITY": 0.0, "LEAVE_ENCASHMENT": 0.0})
        cc["BONUS"] += basic * 0.0833
        cc["GRATUITY"] += basic * 0.0481
        cc["LEAVE_ENCASHMENT"] += basic / 26 * 1.25
    lines = []
    for cc, amounts in sorted(by_cc.items()):
        for kind, amt in amounts.items():
            (eg, en), (lg, ln) = PROVISION_GL[kind]
            amt = round(amt, 2)
            lines += [{"glCode": eg, "glName": en, "costCenter": cc, "debit": amt, "credit": 0.0},
                      {"glCode": lg, "glName": ln, "costCenter": cc, "debit": 0.0, "credit": amt}]
    dr, cr = _balanced(lines)
    jid = _id("jv")
    j = {"_id": jid, "number": f"JV-PROV-{month}", "type": "PROVISION", "month": month, "narration": f"Month-end provisions {month} (auto-reverse next month)",
         "lines": lines, "totalDebit": dr, "totalCredit": cr, "status": "DRAFT", "reversible": True,
         "createdBy": actor_name(user), "createdByUserId": user["_id"], "createdAt": now_iso()}
    modules_store.journals[jid] = j
    audit(user, "PROVISION_JOURNAL_CREATED", "FINANCE", "Journal", jid, {"month": month, "amount": dr})
    return JSONResponse({"journal": _journal_view(j, user)}, status_code=201)


@router.get("/finance/journals")
async def list_journals(month: Optional[str] = None, user: dict = Depends(require_role(*FIN_READ))):
    rows = [j for j in modules_store.journals.values() if not month or j["month"] == month]
    return {"journals": [_journal_view(j, user) for j in sorted(rows, key=lambda j: j["createdAt"], reverse=True)]}


@router.post("/finance/journals/{jid}/approve")
async def approve_journal(jid: str, user: dict = Depends(require_role(*FINANCE))):
    j = modules_store.journals.get(jid)
    if not j:
        raise ApiError(404, "Journal not found.")
    if j["status"] != "DRAFT":
        raise ApiError(409, "Only draft journals can be approved.")
    if j["createdByUserId"] == user["_id"]:
        raise ApiError(403, "Maker-checker: you cannot approve a journal you created.")
    if period_closed(j["month"]):
        raise ApiError(423, f"Accounting period {j['month']} is closed; posting is blocked.")
    j.update({"status": "POSTED", "approvedBy": actor_name(user), "approvedByUserId": user["_id"], "postedAt": now_iso()})
    if j.get("reversalOf") and j["reversalOf"] in modules_store.journals:
        modules_store.journals[j["reversalOf"]]["status"] = "REVERSED"
    audit(user, "JOURNAL_POSTED", "FINANCE", "Journal", jid, {"number": j["number"], "debit": j["totalDebit"]})
    return {"journal": _journal_view(j, user)}


@router.post("/finance/journals/{jid}/reject")
async def reject_journal(jid: str, request: Request, user: dict = Depends(require_role(*FINANCE))):
    j = modules_store.journals.get(jid)
    if not j or j["status"] != "DRAFT":
        raise ApiError(404, "Draft journal not found.")
    comment = js_str((await read_body(request)).get("comment") or "").strip()
    if not comment:
        raise ApiError(400, "Give a reason.")
    j.update({"status": "REJECTED", "rejectedBy": actor_name(user), "comment": comment})
    audit(user, "JOURNAL_REJECTED", "FINANCE", "Journal", jid, {"comment": comment})
    return {"journal": _journal_view(j, user)}


@router.post("/finance/journals/{jid}/reverse")
async def reverse_journal(jid: str, request: Request, user: dict = Depends(require_role(*ACCOUNTS))):
    j = modules_store.journals.get(jid)
    if not j or j["status"] != "POSTED":
        raise ApiError(400, "Only posted journals can be reversed.")
    if any(x.get("reversalOf") == jid and x["status"] in ("DRAFT", "POSTED") for x in modules_store.journals.values()):
        raise ApiError(409, "A reversal already exists.")
    b = await read_body(request)
    y, m = (int(x) for x in j["month"].split("-"))
    month = _month(b.get("month") or f"{y + (m == 12)}-{(m % 12) + 1:02d}")
    if period_closed(month):
        raise ApiError(423, f"Accounting period {month} is closed; posting is blocked.")
    rid = _id("jv")
    lines = [{**l, "debit": l["credit"], "credit": l["debit"]} for l in j["lines"]]
    r = {"_id": rid, "number": f"{j['number']}-REV", "type": "REVERSAL", "month": month, "narration": f"Reversal of {j['number']}",
         "lines": lines, "totalDebit": j["totalCredit"], "totalCredit": j["totalDebit"], "status": "DRAFT", "reversalOf": jid,
         "createdBy": actor_name(user), "createdByUserId": user["_id"], "createdAt": now_iso()}
    modules_store.journals[rid] = r
    audit(user, "JOURNAL_REVERSAL_CREATED", "FINANCE", "Journal", rid, {"reversalOf": j["number"]})
    return JSONResponse({"journal": _journal_view(r, user)}, status_code=201)


@router.get("/finance/journals/{jid}/export")
async def export_journal(jid: str, format: str = "tally", user: dict = Depends(require_role(*FIN_READ))):
    j = modules_store.journals.get(jid)
    if not j:
        raise ApiError(404, "Journal not found.")
    if j["status"] != "POSTED":
        raise ApiError(400, "Only posted journals can be exported.")
    audit(user, "JOURNAL_EXPORTED", "FINANCE", "Journal", jid, {"format": format})
    if format == "csv":
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["Voucher", "Date", "GL Code", "GL Name", "Cost Centre", "Debit", "Credit", "Narration"])
        for l in j["lines"]:
            w.writerow([j["number"], f"{j['month']}-01", l["glCode"], l["glName"], l["costCenter"], f"{l['debit']:.2f}", f"{l['credit']:.2f}", j["narration"]])
        return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{j["number"]}.csv"'})
    y, m = j["month"].split("-")
    vdate = f"{y}{m}{_last_day(j['month']):02d}"
    entries = []
    for l in j["lines"]:
        amt = l["debit"] or l["credit"]
        # Tally: debit amounts are negative with ISDEEMEDPOSITIVE=Yes
        entries.append(
            "<ALLLEDGERENTRIES.LIST>"
            f"<LEDGERNAME>{escape(l['glName'] or l['glCode'])}</LEDGERNAME>"
            f"<ISDEEMEDPOSITIVE>{'Yes' if l['debit'] else 'No'}</ISDEEMEDPOSITIVE>"
            f"<AMOUNT>{-amt if l['debit'] else amt:.2f}</AMOUNT>"
            f"<CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><COSTCENTREALLOCATIONS.LIST><NAME>{escape(l['costCenter'])}</NAME>"
            f"<AMOUNT>{-amt if l['debit'] else amt:.2f}</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>"
            "</ALLLEDGERENTRIES.LIST>")
    xml = ("<?xml version=\"1.0\" encoding=\"UTF-8\"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>"
           "<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF=\"TallyUDF\">"
           f"<VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\"><DATE>{vdate}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>"
           f"<VOUCHERNUMBER>{escape(j['number'])}</VOUCHERNUMBER><NARRATION>{escape(j['narration'])}</NARRATION>"
           + "".join(entries) + "</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
    return Response(xml, media_type="application/xml", headers={"Content-Disposition": f'attachment; filename="{j["number"]}.xml"'})


def _last_day(month: str) -> int:
    import calendar
    y, m = (int(x) for x in month.split("-"))
    return calendar.monthrange(y, m)[1]


# ------------------------------------------------------------------ period close

@router.get("/finance/periods")
async def list_periods(user: dict = Depends(require_role(*FIN_READ))):
    return {"periods": sorted(modules_store.accountingPeriods.values(), key=lambda p: p["_id"], reverse=True)}


@router.post("/finance/periods/{month}/close")
async def close_period(month: str, user: dict = Depends(require_role(*ACCOUNTS))):
    month = _month(month)
    if period_closed(month):
        raise ApiError(409, f"{month} is already closed.")
    drafts = [j["number"] for j in modules_store.journals.values() if j["month"] == month and j["status"] == "DRAFT"]
    if drafts:
        raise ApiError(400, f"Post or reject the draft journals first: {', '.join(drafts)}.")
    modules_store.accountingPeriods[month] = {"_id": month, "status": "CLOSED", "closedBy": actor_name(user), "closedAt": now_iso()}
    audit(user, "ACCOUNTING_PERIOD_CLOSED", "FINANCE", "AccountingPeriod", month, {})
    return {"period": modules_store.accountingPeriods[month]}


@router.post("/finance/periods/{month}/reopen")
async def reopen_period(month: str, request: Request, user: dict = Depends(require_role(*FINANCE))):
    p = modules_store.accountingPeriods.get(_month(month))
    if not p or p["status"] != "CLOSED":
        raise ApiError(400, "This period is not closed.")
    reason = js_str((await read_body(request)).get("reason") or "").strip()
    if not reason:
        raise ApiError(400, "Give the reason for reopening.")
    p.update({"status": "OPEN", "reopenedBy": actor_name(user), "reopenedAt": now_iso(), "reopenReason": reason})
    audit(user, "ACCOUNTING_PERIOD_REOPENED", "FINANCE", "AccountingPeriod", month, {"reason": reason})
    return {"period": p}


# ------------------------------------------------------------------ bank reconciliation

@router.post("/finance/bank-recon")
async def bank_recon(request: Request, user: dict = Depends(require_role(*ACCOUNTS))):
    """Upload the bank statement CSV (accountNumber, amount, status[, reference]) for a salary month."""
    fields, files = await read_fields_and_files(request)
    month = _month(fields.get("month"))
    upload = (files.get("file") or [None])[0]
    if not upload:
        raise ApiError(400, "Upload the bank statement (.csv).")
    text = (await upload.read()).decode("utf-8-sig", errors="replace")
    stmt = []
    for row in csv.DictReader([ln for ln in text.splitlines() if ln.strip()]):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        try:
            amt = float(row.get("amount") or 0)
        except ValueError:
            amt = 0.0
        stmt.append({"accountNumber": row.get("accountnumber") or row.get("account") or "", "amount": amt,
                     "status": (row.get("status") or "SUCCESS").upper(), "reference": row.get("reference") or row.get("utr") or ""})
    expected = []
    for p in modules_store.payslips.values():
        if p.get("month") != month or p.get("status") not in ("APPROVED", "PAID") or (p.get("netSalary") or 0) <= 0:
            continue
        bank = (db_store.employees.get(p["employeeId"]) or {}).get("bankInfo") or {}
        if bank.get("accountNumber"):
            expected.append({"employeeId": p["employeeId"], "employeeName": p.get("employeeName"), "employeeCode": p.get("employeeCode"),
                             "accountNumber": bank["accountNumber"], "amount": round(p["netSalary"], 2)})
    matched, failed, unmatched = [], [], []
    used = set()
    for e in expected:
        hit = next((i for i, s in enumerate(stmt) if i not in used and s["accountNumber"] == e["accountNumber"] and abs(s["amount"] - e["amount"]) < 0.01), None)
        if hit is None:
            unmatched.append({**e, "reason": "Not found in bank statement (or amount differs)"})
            continue
        used.add(hit)
        if stmt[hit]["status"] in ("FAILED", "RETURNED", "REJECTED"):
            failed.append({**e, "reference": stmt[hit]["reference"], "reason": f"Bank status {stmt[hit]['status']}"})
        else:
            matched.append({**e, "reference": stmt[hit]["reference"]})
    extra = [s for i, s in enumerate(stmt) if i not in used]
    rid = _id("recon")
    doc = {"_id": rid, "month": month, "fileName": upload.filename, "matched": matched, "failed": failed, "unmatched": unmatched, "unexpected": extra,
           "summary": {"expected": len(expected), "matched": len(matched), "failed": len(failed), "unmatched": len(unmatched), "unexpected": len(extra)},
           "by": actor_name(user), "at": now_iso()}
    modules_store.bankRecons[rid] = doc
    audit(user, "SALARY_BANK_RECONCILED", "FINANCE", "BankRecon", rid, doc["summary"])
    return {"recon": doc}


@router.get("/finance/bank-recon")
async def list_recons(user: dict = Depends(require_role(*FIN_READ))):
    return {"recons": sorted(modules_store.bankRecons.values(), key=lambda r: r["at"], reverse=True)}


# ------------------------------------------------------------------ expense claims

CLAIM_READ_ALL = ("FINANCE", "ACCOUNTS", "AUDITORS")
STATUS_ALIASES = {"PENDING": "PENDING_MANAGER", "APPROVED": "VERIFIED", "REIMBURSED": "PAID"}


def _claim_status(c: dict) -> str:
    return STATUS_ALIASES.get(c.get("status"), c.get("status"))


def _can_manager_decide(user: dict, c: dict) -> bool:
    me = my_employee_id(user)
    return _claim_status(c) == "PENDING_MANAGER" and c["employeeId"] != me and (c.get("approverId") == me or (not c.get("approverId") and is_in_team(me, c["employeeId"])))


def _can_finance_decide(user: dict, c: dict) -> bool:
    return _claim_status(c) == "PENDING_FINANCE" and user.get("role") in FINANCE and c["employeeId"] != my_employee_id(user)


def _claim_view(c: dict, user: dict) -> dict:
    return {**c, "status": _claim_status(c), "canManagerDecide": _can_manager_decide(user, c), "canFinanceDecide": _can_finance_decide(user, c)}


@router.get("/expenses")
async def list_claims(scope: str = "auto", status: Optional[str] = None, employeeId: Optional[str] = None, category: Optional[str] = None,
                      user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    items = list(modules_store.expenseClaims.values())
    if employeeId and employeeId != me and not (user.get("role") in CLAIM_READ_ALL or is_in_team(me, employeeId)):
        raise ApiError(403, "Access denied: you can only see your own claims.")
    if scope == "mine":
        items = [c for c in items if c["employeeId"] == me]
    elif scope == "approvals":
        items = [c for c in items if _can_manager_decide(user, c) or _can_finance_decide(user, c)]
    elif user.get("role") not in CLAIM_READ_ALL:
        items = [c for c in items if c["employeeId"] == me or _can_manager_decide(user, c) or is_in_team(me, c["employeeId"])]
    if employeeId:
        items = [c for c in items if c["employeeId"] == employeeId]
    if category:
        items = [c for c in items if c.get("category") == category]
    views = [_claim_view(c, user) for c in items]
    if status and status != "ALL":
        views = [c for c in views if c["status"] == status]
    return {"claims": sorted(views, key=lambda c: c.get("submittedAt") or "", reverse=True), "limits": settings()["claimLimits"]}


@router.get("/expenses/{claim_id}")
async def get_claim(claim_id: str, user: dict = Depends(require_auth)):
    c = modules_store.expenseClaims.get(claim_id)
    if not c:
        raise ApiError(404, "Claim not found.")
    me = my_employee_id(user)
    if not (c["employeeId"] == me or user.get("role") in CLAIM_READ_ALL or is_in_team(me, c["employeeId"]) or c.get("approverId") == me):
        raise ApiError(403, "Access denied.")
    return {"claim": _claim_view(c, user)}


@router.post("/expenses")
async def submit_claim(request: Request, user: dict = Depends(require_auth)):
    ctype = request.headers.get("content-type") or ""
    if "multipart" in ctype:
        b, files = await read_fields_and_files(request)
        upload = (files.get("receipt") or [None])[0]
    else:
        b, upload = await read_body(request), None
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    emp = db_store.employees[me]
    title = js_str(b.get("title") or "").strip()
    category = js_str(b.get("category") or "").strip().upper()
    bill = js_str(b.get("billNumber") or "").strip()
    try:
        amount = float(b.get("amount"))
        exp_date = date.fromisoformat(js_str(b.get("expenseDate") or "")[:10]).isoformat()
    except (TypeError, ValueError):
        raise ApiError(400, "Give a valid amount and expense date (YYYY-MM-DD).")
    errors = []
    if not title:
        errors.append("Title is required.")
    limits = settings()["claimLimits"]
    if category not in limits:
        errors.append(f"Category must be one of {', '.join(limits)}.")
    if amount <= 0:
        errors.append("Amount must be above zero.")
    elif category in limits and amount > limits[category]:
        errors.append(f"₹{amount:,.0f} is above the {category.title()} limit of ₹{limits[category]:,.0f} per claim.")
    if exp_date > today_str():
        errors.append("The expense date cannot be in the future.")
    if not bill:
        errors.append("Bill / invoice number is required.")
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the claim.", errors=errors)
    dup = next((c for c in modules_store.expenseClaims.values() if bill and (c.get("billNumber") or "").lower() == bill.lower()
                and _claim_status(c) != "REJECTED"), None)
    receipt = None
    if upload:
        saved = await save_upload(upload, DOCUMENTS)
        receipt = {"fileName": upload.filename, "fileUrl": f"/uploads/documents/{saved['storedFileName']}"}
    approver = manager_of(me)
    cid = _id("exp")
    claim = {"_id": cid, "employeeId": me, "employeeName": employee_name(me), "employeeCode": emp.get("employeeCode"), "department": emp.get("department"),
             "title": title, "category": category, "amount": round(amount, 2), "currency": "INR", "expenseDate": exp_date,
             "description": js_str(b.get("description") or ""), "billNumber": bill, "receipt": receipt, "receiptName": (receipt or {}).get("fileName"),
             "duplicateOf": dup["_id"] if dup else None, "duplicateFlag": f"Bill number {bill} already used in claim of {dup.get('employeeName')}" if dup else None,
             "status": "PENDING_MANAGER" if approver else "PENDING_FINANCE", "approverId": approver,
             "submittedAt": now_iso(), "history": [{"action": "SUBMITTED", "by": actor_name(user), "at": now_iso()}]}
    modules_store.expenseClaims[cid] = claim
    if approver:
        notify_employee(approver, "Expense claim to approve", f"{claim['employeeName']}: {title} ₹{amount:,.0f}", "EXPENSES")
    else:
        notify_roles(FINANCE, "Expense claim to verify", f"{claim['employeeName']}: {title} ₹{amount:,.0f}", "EXPENSES", exclude_user_id=user["_id"])
    audit(user, "EXPENSE_SUBMITTED", "EXPENSES", "ExpenseClaim", cid, {"amount": amount, "category": category, "billNumber": bill,
                                                                      "duplicateOf": claim["duplicateOf"]})
    return JSONResponse({"claim": _claim_view(claim, user), "warning": claim["duplicateFlag"]}, status_code=201)


@router.get("/expenses/{claim_id}/receipt")
async def claim_receipt(claim_id: str, user: dict = Depends(require_auth)):
    from app.routes.common import stored_file_response
    c = (await get_claim(claim_id, user))["claim"]
    r = c.get("receipt") or {}
    resp = await stored_file_response(DOCUMENTS, r.get("fileUrl", "").rsplit("/", 1)[-1], r.get("fileName"), inline=True) if r else None
    if not resp:
        raise ApiError(404, "No bill attached.")
    return resp


@router.put("/expenses/{claim_id}/manager-decision")
async def manager_decision(claim_id: str, request: Request, user: dict = Depends(require_auth)):
    c = modules_store.expenseClaims.get(claim_id)
    if not c:
        raise ApiError(404, "Claim not found.")
    if c["employeeId"] == my_employee_id(user):
        raise ApiError(403, "You cannot approve your own claim.")
    if not _can_manager_decide(user, c):
        raise ApiError(403, "Only the employee's reporting manager can approve this claim at this stage.")
    b = await read_body(request)
    decision, comment = b.get("decision"), js_str(b.get("comment") or "").strip()
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Give a reason for rejecting.")
    c["status"] = "PENDING_FINANCE" if decision == "APPROVED" else "REJECTED"
    c.setdefault("history", []).append({"action": f"MANAGER_{decision}", "by": actor_name(user), "at": now_iso(), "comment": comment})
    c.update({"managerDecisionBy": actor_name(user), "managerDecisionAt": now_iso()})
    if decision == "APPROVED":
        notify_roles(FINANCE, "Expense claim to verify", f"{c['employeeName']}: {c['title']} ₹{c['amount']:,.0f}", "EXPENSES")
    notify_employee(c["employeeId"], f"Expense claim {decision.lower()} by manager", f"{c['title']}{': ' + comment if comment else ''}", "EXPENSES")
    audit(user, f"EXPENSE_MANAGER_{decision}", "EXPENSES", "ExpenseClaim", claim_id, {"comment": comment})
    return {"claim": _claim_view(c, user)}


@router.put("/expenses/{claim_id}/finance-decision")
async def finance_decision(claim_id: str, request: Request, user: dict = Depends(require_role(*FINANCE))):
    c = modules_store.expenseClaims.get(claim_id)
    if not c:
        raise ApiError(404, "Claim not found.")
    if c["employeeId"] == my_employee_id(user):
        raise ApiError(403, "You cannot verify your own claim; another Finance user must do it.")
    if _claim_status(c) != "PENDING_FINANCE":
        raise ApiError(409, "This claim is not waiting for Finance verification.")
    b = await read_body(request)
    decision, comment = b.get("decision"), js_str(b.get("comment") or "").strip()
    if decision not in ("VERIFIED", "REJECTED"):
        raise ApiError(400, "Decision must be VERIFIED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Give a reason for rejecting.")
    if decision == "VERIFIED" and c.get("duplicateOf") and not b.get("acceptDuplicate"):
        raise ApiError(409, f"Duplicate bill: {c['duplicateFlag']}. Reject it, or confirm it is genuine (acceptDuplicate).")
    c.setdefault("history", []).append({"action": f"FINANCE_{decision}", "by": actor_name(user), "at": now_iso(), "comment": comment})
    c.update({"status": decision, "verifiedBy": actor_name(user), "verifiedByUserId": user["_id"], "verifiedAt": now_iso()})
    if decision == "VERIFIED":
        mode = b.get("paymentMode") or settings()["claimPaymentDefault"]
        if mode == "PAYROLL":
            month = today_str()[:7]
            while payroll_month_locked(month):
                y, m = (int(x) for x in month.split("-"))
                month = f"{y + (m == 12)}-{(m % 12) + 1:02d}"
            add_payroll_input(c["employeeId"], month, "REIMBURSEMENT", amount=c["amount"], source="EXPENSE", source_id=f"expense:{claim_id}",
                              label=f"Reimbursement: {c['title']}", by=user)
            c.update({"status": "PAYROLL_QUEUED", "paymentMode": "PAYROLL", "payrollMonth": month})
        else:
            c["paymentMode"] = "BANK"
    notify_employee(c["employeeId"], f"Expense claim {c['status'].replace('_', ' ').lower()}", c["title"], "EXPENSES")
    audit(user, f"EXPENSE_FINANCE_{decision}", "EXPENSES", "ExpenseClaim", claim_id, {"comment": comment, "paymentMode": c.get("paymentMode")})
    return {"claim": _claim_view(c, user)}


# payment batches: Accounts prepares, Finance releases (different users)

@router.post("/finance/payment-batches")
async def prepare_batch(request: Request, user: dict = Depends(require_role(*ACCOUNTS))):
    ids = (await read_body(request)).get("claimIds") or []
    claims = [modules_store.expenseClaims.get(i) for i in ids]
    bad = [i for i, c in zip(ids, claims) if not c or _claim_status(c) != "VERIFIED" or c.get("paymentMode") != "BANK" or c.get("batchId")]
    if not ids or bad:
        raise ApiError(400, f"Only verified, bank-mode claims not already in a batch can be paid: {', '.join(bad) or 'none selected'}.")
    if any(c["employeeId"] == my_employee_id(user) for c in claims):
        raise ApiError(403, "You cannot prepare a payment that includes your own claim.")
    bid = _id("pay")
    batch = {"_id": bid, "claimIds": ids, "total": round(sum(c["amount"] for c in claims), 2), "count": len(ids), "status": "PREPARED",
             "preparedBy": actor_name(user), "preparedByUserId": user["_id"], "preparedAt": now_iso()}
    for c in claims:
        c["batchId"] = bid
        c["status"] = "PAYMENT_PREPARED"
    modules_store.paymentBatches[bid] = batch
    notify_roles(FINANCE, "Payment batch to release", f"{len(ids)} claim(s), ₹{batch['total']:,.2f}", "FINANCE")
    audit(user, "PAYMENT_BATCH_PREPARED", "FINANCE", "PaymentBatch", bid, {"total": batch["total"], "claims": ids})
    return JSONResponse({"batch": batch}, status_code=201)


@router.get("/finance/payment-batches")
async def list_batches(user: dict = Depends(require_role(*FIN_READ))):
    return {"batches": [{**b, "canRelease": b["status"] == "PREPARED" and user.get("role") in FINANCE and b["preparedByUserId"] != user["_id"]}
                        for b in sorted(modules_store.paymentBatches.values(), key=lambda b: b["preparedAt"], reverse=True)]}


@router.post("/finance/payment-batches/{bid}/release")
async def release_batch(bid: str, request: Request, user: dict = Depends(require_role(*FINANCE))):
    b = modules_store.paymentBatches.get(bid)
    if not b:
        raise ApiError(404, "Batch not found.")
    if b["status"] != "PREPARED":
        raise ApiError(409, "This batch has already been released.")
    if b["preparedByUserId"] == user["_id"]:
        raise ApiError(403, "Maker-checker: the person who prepared a payment cannot release it.")
    ref = js_str((await read_body(request)).get("reference") or "").strip()
    if not ref:
        raise ApiError(400, "Give the bank payment reference.")
    b.update({"status": "RELEASED", "releasedBy": actor_name(user), "releasedAt": now_iso(), "reference": ref})
    for cid in b["claimIds"]:
        c = modules_store.expenseClaims[cid]
        c.update({"status": "PAID", "paymentReference": ref, "reimbursedAt": now_iso()})
        notify_employee(c["employeeId"], "Expense claim paid", f"{c['title']} ₹{c['amount']:,.0f} (ref {ref})", "EXPENSES")
    audit(user, "PAYMENT_BATCH_RELEASED", "FINANCE", "PaymentBatch", bid, {"reference": ref, "total": b["total"]})
    return {"batch": b}


# ------------------------------------------------------------------ loans / advances

def _loan_view(l: dict) -> dict:
    recovered = 0.0
    schedule = []
    for row in l["schedule"]:
        run = modules_store.payrollRuns.get(row["month"]) or {}
        done = run.get("status") in ("APPROVED", "PAID")
        recovered += row["emi"] if done else 0
        schedule.append({**row, "recovered": done})
    outstanding = round(l["principal"] - recovered, 2)
    return {**l, "schedule": schedule, "recovered": round(recovered, 2), "outstanding": outstanding,
            "status": "CLOSED" if outstanding <= 0.01 else l.get("status", "ACTIVE")}


@router.get("/finance/loans")
async def list_loans(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    rows = list(modules_store.loans.values())
    if user.get("role") not in FIN_READ + ("HR",):
        if employeeId and employeeId != me:
            raise ApiError(403, "Access denied: you can only see your own loans.")
        rows = [l for l in rows if l["employeeId"] == me]
    elif employeeId:
        rows = [l for l in rows if l["employeeId"] == employeeId]
    return {"loans": [_loan_view(l) for l in sorted(rows, key=lambda l: l["sanctionedAt"], reverse=True)]}


@router.post("/finance/loans")
async def sanction_loan(request: Request, user: dict = Depends(require_role(*FINANCE))):
    b = await read_body(request)
    emp_id = b.get("employeeId")
    if emp_id not in db_store.employees:
        raise ApiError(404, "Employee not found.")
    if emp_id == my_employee_id(user):
        raise ApiError(403, "You cannot sanction a loan to yourself.")
    try:
        principal = float(b.get("principal"))
        tenure = int(b.get("tenureMonths"))
    except (TypeError, ValueError):
        raise ApiError(400, "Give the amount and the number of monthly instalments.")
    if principal <= 0 or not 1 <= tenure <= 60:
        raise ApiError(400, "Amount must be above zero and the tenure 1–60 months.")
    start = _month(b.get("startMonth") or today_str()[:7])
    while payroll_month_locked(start):
        y, m = (int(x) for x in start.split("-"))
        start = f"{y + (m == 12)}-{(m % 12) + 1:02d}"
    emi = round(principal / tenure, 2)
    lid = _id("loan")
    schedule = []
    y, m = (int(x) for x in start.split("-"))
    for i in range(tenure):
        month = f"{y + (m - 1 + i) // 12}-{(m - 1 + i) % 12 + 1:02d}"
        amt = emi if i < tenure - 1 else round(principal - emi * (tenure - 1), 2)
        schedule.append({"month": month, "emi": amt})
        add_payroll_input(emp_id, month, "LOAN_EMI", amount=amt, source="LOAN", source_id=f"loan:{lid}:{month}",
                          label=f"{(b.get('type') or 'LOAN').title()} EMI {i + 1}/{tenure}", by=user)
    loan = {"_id": lid, "employeeId": emp_id, "employeeName": employee_name(emp_id), "type": "ADVANCE" if b.get("type") == "ADVANCE" else "LOAN",
            "principal": round(principal, 2), "tenureMonths": tenure, "emi": emi, "startMonth": start, "schedule": schedule,
            "reason": js_str(b.get("reason") or ""), "status": "ACTIVE", "sanctionedBy": actor_name(user), "sanctionedAt": now_iso()}
    modules_store.loans[lid] = loan
    notify_employee(emp_id, f"{loan['type'].title()} sanctioned", f"₹{principal:,.0f}, EMI ₹{emi:,.0f} from {start}", "PAYROLL")
    audit(user, "LOAN_SANCTIONED", "FINANCE", "Loan", lid, {"employeeId": emp_id, "principal": principal, "tenure": tenure})
    return JSONResponse({"loan": _loan_view(loan)}, status_code=201)
