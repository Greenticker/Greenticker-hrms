"""
Investment declarations and proofs (TDS).

- The employee picks the regime (old / new), opts in or out of NPS (80CCD(1B)) and declares
  amounts per section while HR / Finance keep the declaration window open.
- In the proof window the employee uploads proofs per section; HR / Finance verify them
  (never their own). After the proof window, TDS uses verified amounts only.
- Payroll TDS (utils/payroll_engine) reads `deduction_total`.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import DOCUMENTS, audit, read_body, read_fields_and_files, save_upload
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.payroll_engine import fy_of, payroll_settings
from app.utils.workflow import actor_name, employee_name, my_employee_id, notify_employee, notify_roles

router = APIRouter()

VERIFIER_ROLES = ("HR", "FINANCE")

# section: (label, annual cap or None, regimes it counts in)
SECTIONS = {
    "80C": ("80C – PPF, ELSS, LIC, EPF top-up, tuition fees, home-loan principal, NSC, SSY, 5-yr FD", 150000, ("OLD",)),
    "80CCD1B": ("80CCD(1B) – own NPS contribution (beyond 80C)", 50000, ("OLD",)),
    "80CCD2": ("80CCD(2) – employer NPS contribution", None, ("OLD", "NEW")),
    "80D_SELF": ("80D – health insurance: self, spouse, children", 25000, ("OLD",)),
    "80D_PARENTS": ("80D – health insurance: parents", 50000, ("OLD",)),
    "80DD": ("80DD – disabled dependant", 125000, ("OLD",)),
    "80DDB": ("80DDB – treatment of specified diseases", 100000, ("OLD",)),
    "80E": ("80E – interest on education loan", None, ("OLD",)),
    "80EEA": ("80EEA – interest on affordable housing loan", 150000, ("OLD",)),
    "80G": ("80G – donations (eligible amount)", None, ("OLD",)),
    "80GG": ("80GG – rent paid (no HRA received)", 60000, ("OLD",)),
    "80TTA": ("80TTA – savings account interest", 10000, ("OLD",)),
    "80TTB": ("80TTB – deposit interest (senior citizens)", 50000, ("OLD",)),
    "80U": ("80U – person with disability", 125000, ("OLD",)),
    "24B": ("24(b) – interest on home loan (self-occupied)", 200000, ("OLD",)),
    "HRA": ("HRA exemption – annual rent paid", None, ("OLD",)),
    "LTA": ("LTA – travel claimed", None, ("OLD",)),
}


def _window(name: str) -> bool:
    w = payroll_settings().get(name) or {}
    return bool(w.get("open")) and (not w.get("until") or today_str() <= w["until"])


def declaration_for(emp_id: str, fy: str) -> dict:
    return modules_store.investmentDeclarations.get(f"{emp_id}:{fy}") or {"employeeId": emp_id, "fy": fy, "regime": "NEW", "npsOptIn": False, "items": {}}


def _amount(item: dict, verified_only: bool) -> float:
    proofs = item.get("proofs") or []
    verified = sum(p.get("verifiedAmount") or 0 for p in proofs if p.get("status") == "VERIFIED")
    if verified_only:
        return verified
    return max(verified, item.get("declared") or 0)


def deduction_total(decl: dict, regime: str, projected_pf: float = 0) -> float:
    """Chapter VI-A / exemption amounts counted for TDS, with caps. EPF counts in 80C."""
    verified_only = bool((payroll_settings().get("proofWindow") or {}).get("until")) and today_str() > payroll_settings()["proofWindow"]["until"]
    total = 0.0
    items = decl.get("items") or {}
    for code, (label, cap, regimes) in SECTIONS.items():
        if regime not in regimes:
            continue
        amt = _amount(items.get(code) or {}, verified_only)
        if code == "80C":
            amt += projected_pf
        if code == "80CCD1B" and not decl.get("npsOptIn"):
            amt = 0
        if cap is not None:
            amt = min(amt, cap)
        total += amt
    return total


def _view(decl: dict) -> dict:
    regime = decl.get("regime") or "NEW"
    rows = []
    for code, (label, cap, regimes) in SECTIONS.items():
        item = (decl.get("items") or {}).get(code) or {}
        rows.append({"section": code, "label": label, "cap": cap, "applies": regime in regimes, "declared": item.get("declared") or 0,
                     "proofs": item.get("proofs") or []})
    return {**decl, "sections": rows, "declarationOpen": _window("declarationWindow"), "proofOpen": _window("proofWindow"),
            "windows": {"declaration": payroll_settings().get("declarationWindow"), "proof": payroll_settings().get("proofWindow")}}


@router.get("/tax/declarations/me")
async def my_declaration(fy: Optional[str] = None, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    return {"declaration": _view(declaration_for(me, fy or fy_of(today_str())))}


@router.put("/tax/declarations/me")
async def save_declaration(request: Request, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    if not _window("declarationWindow"):
        raise ApiError(403, "The investment declaration window is closed.")
    b = await read_body(request)
    fy = js_str(b.get("fy") or fy_of(today_str()))
    regime = b.get("regime") if b.get("regime") in ("OLD", "NEW") else "NEW"
    key = f"{me}:{fy}"
    decl = modules_store.investmentDeclarations.get(key) or {"_id": key, "employeeId": me, "employeeName": employee_name(me), "fy": fy, "items": {}}
    items = decl.setdefault("items", {})
    for code, raw in (b.get("items") or {}).items():
        if code not in SECTIONS:
            raise ApiError(400, f"Unknown section {code}.")
        try:
            amount = float(raw if not isinstance(raw, dict) else raw.get("declared", 0))
        except (TypeError, ValueError):
            raise ApiError(400, f"{code}: amount must be a number.")
        if amount < 0 or amount > 10_000_000:
            raise ApiError(400, f"{code}: amount must be between 0 and 1,00,00,000.")
        items.setdefault(code, {})["declared"] = amount
    decl.update({"regime": regime, "npsOptIn": bool(b.get("npsOptIn")), "updatedAt": now_iso(), "status": "DECLARED"})
    modules_store.investmentDeclarations[key] = decl
    audit(user, "TAX_DECLARATION_SAVED", "PAYROLL", "InvestmentDeclaration", key, {"regime": regime, "npsOptIn": decl["npsOptIn"]})
    return {"declaration": _view(decl)}


@router.post("/tax/declarations/me/proofs")
async def upload_proof(request: Request, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    if not _window("proofWindow"):
        raise ApiError(403, "The proof submission window is closed.")
    fields, files = await read_fields_and_files(request)
    code = fields.get("section")
    if code not in SECTIONS:
        raise ApiError(400, "Choose a valid section.")
    upload = (files.get("file") or [None])[0]
    if not upload:
        raise ApiError(400, "Attach the proof document.")
    if not (upload.filename or "").lower().endswith((".pdf", ".jpg", ".jpeg", ".png")):
        raise ApiError(400, "Proofs must be PDF, JPG or PNG.")
    try:
        amount = float(fields.get("amount"))
    except (TypeError, ValueError):
        raise ApiError(400, "Proof amount must be a number.")
    saved = await save_upload(upload, DOCUMENTS)
    fy = fields.get("fy") or fy_of(today_str())
    key = f"{me}:{fy}"
    decl = modules_store.investmentDeclarations.get(key) or {"_id": key, "employeeId": me, "employeeName": employee_name(me), "fy": fy,
                                                             "regime": "NEW", "items": {}}
    proof = {"_id": f"proof_{now_ms()}_{rand_base36(4)}", "amount": amount, "fileName": upload.filename, "storedFileName": saved["storedFileName"],
             "uploadedAt": now_iso(), "status": "SUBMITTED"}
    decl.setdefault("items", {}).setdefault(code, {}).setdefault("proofs", []).append(proof)
    modules_store.investmentDeclarations[key] = decl
    notify_roles(VERIFIER_ROLES, "Investment proof to verify", f"{employee_name(me)} uploaded a proof for {code} (₹{amount:,.0f}).", "PAYROLL",
                 exclude_user_id=user["_id"])
    audit(user, "TAX_PROOF_UPLOADED", "PAYROLL", "InvestmentDeclaration", key, {"section": code, "amount": amount})
    return {"declaration": _view(decl)}


@router.get("/tax/declarations")
async def list_declarations(fy: Optional[str] = None, user: dict = Depends(require_role(*VERIFIER_ROLES, "AUDITORS"))):
    fy = fy or fy_of(today_str())
    rows = [_view(d) for d in modules_store.investmentDeclarations.values() if d.get("fy") == fy]
    return {"fy": fy, "declarations": rows}


@router.post("/tax/declarations/{employee_id}/proofs/{proof_id}/verify")
async def verify_proof(employee_id: str, proof_id: str, request: Request, user: dict = Depends(require_role(*VERIFIER_ROLES))):
    if employee_id == my_employee_id(user):
        raise ApiError(403, "You cannot verify your own investment proofs.")
    b = await read_body(request)
    decision = b.get("decision")
    if decision not in ("VERIFIED", "REJECTED"):
        raise ApiError(400, "Decision must be VERIFIED or REJECTED.")
    for decl in modules_store.investmentDeclarations.values():
        if decl.get("employeeId") != employee_id:
            continue
        for code, item in (decl.get("items") or {}).items():
            for p in item.get("proofs") or []:
                if p["_id"] == proof_id:
                    amount = float(b.get("verifiedAmount", p["amount"]) or 0) if decision == "VERIFIED" else 0
                    comment = js_str(b.get("comment") or "").strip()
                    if decision == "REJECTED" and not comment:
                        raise ApiError(400, "Give the reason for rejecting the proof.")
                    p.update({"status": decision, "verifiedAmount": amount, "verifiedBy": actor_name(user), "verifiedAt": now_iso(), "comment": comment})
                    notify_employee(employee_id, f"Investment proof {decision.lower()}",
                                    f"{code}: ₹{amount:,.0f} accepted." if decision == "VERIFIED" else f"{code} proof rejected: {comment}", "PAYROLL")
                    audit(user, f"TAX_PROOF_{decision}", "PAYROLL", "InvestmentDeclaration", decl["_id"],
                          {"section": code, "claimed": p["amount"], "verifiedAmount": amount, "comment": comment})
                    return {"declaration": _view(decl)}
    raise ApiError(404, "Proof not found.")


@router.put("/tax/windows")
async def set_windows(request: Request, user: dict = Depends(require_role(*VERIFIER_ROLES))):
    b = await read_body(request)
    s = payroll_settings()
    old = {k: s.get(k) for k in ("declarationWindow", "proofWindow")}
    for name in ("declarationWindow", "proofWindow"):
        if name in b:
            w = b[name] or {}
            until = js_str(w.get("until") or "")[:10] or None
            if until:
                try:
                    date.fromisoformat(until)
                except ValueError:
                    raise ApiError(400, "Dates must be YYYY-MM-DD.")
            s[name] = {"open": bool(w.get("open")), "until": until}
    audit(user, "TAX_WINDOWS_UPDATED", "PAYROLL", "PayrollSettings", "settings",
          {"changes": [{"field": k, "oldValue": v, "newValue": s.get(k)} for k, v in old.items() if v != s.get(k)]})
    return {"windows": {k: s.get(k) for k in ("declarationWindow", "proofWindow")}}


@router.get("/tax/declarations/{employee_id}/proofs/{proof_id}/file")
async def proof_file(employee_id: str, proof_id: str, user: dict = Depends(require_auth)):
    from app.routes.common import stored_file_response
    if employee_id != my_employee_id(user) and user.get("role") not in VERIFIER_ROLES + ("AUDITORS",):
        raise ApiError(403, "Access denied.")
    for decl in modules_store.investmentDeclarations.values():
        if decl.get("employeeId") != employee_id:
            continue
        for item in (decl.get("items") or {}).values():
            for p in item.get("proofs") or []:
                if p["_id"] == proof_id:
                    resp = await stored_file_response(DOCUMENTS, p["storedFileName"], p.get("fileName"))
                    if not resp:
                        raise ApiError(404, "Proof file is missing.")
                    return resp
    raise ApiError(404, "Proof not found.")
