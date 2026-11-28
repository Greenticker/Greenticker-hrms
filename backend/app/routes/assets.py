"""Asset management: asset master, request -> manager -> admin issue, employee acknowledgement,
return / transfer with history, damage / loss with recovery through payroll (Finance approval),
write-off / disposal (Finance approval, never hard delete), depreciation (Accounts), asset register,
and exit clearance used by full & final settlement.

Separation of duties: whoever records an asset cannot also issue it; nobody approves their own
request; write-offs and recoveries need Finance; there is no delete."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.workflow import (
    actor_name, add_payroll_input, employee_name, is_in_team, manager_of, my_employee_id, notify_employee, notify_roles,
    payroll_month_locked,
)

router = APIRouter()

ASSET_ADMIN = ("ADMIN", "ADMIN_1", "ADMIN_2", "SUPER_ADMIN")
READ_ALL = ASSET_ADMIN + ("HR", "FINANCE", "ACCOUNTS", "AUDITORS")
# Who may record a new asset into stock. HR can add assets, but issuing, returns,
# transfers, recoveries and write-offs stay with ASSET_ADMIN (maker-checker).
ASSET_CREATORS = ASSET_ADMIN + ("HR",)
TYPES = ("LAPTOP", "DESKTOP", "MONITOR", "PHONE", "SIM", "TABLET", "HEADSET", "CHARGER", "CHAIR", "DESK", "CABINET",
         "SOFTWARE_LICENSE", "SUBSCRIPTION", "CAR", "BIKE", "OTHER")
DEFAULT_LIFE = {"LAPTOP": 3, "DESKTOP": 3, "MONITOR": 5, "PHONE": 2, "SIM": 1, "TABLET": 3, "HEADSET": 2, "CHARGER": 2,
                "CHAIR": 10, "DESK": 10, "CABINET": 10, "SOFTWARE_LICENSE": 1, "SUBSCRIPTION": 1, "CAR": 8, "BIKE": 8, "OTHER": 5}
HELD = ("ALLOCATED", "REPORTED_LOST", "REPORTED_DAMAGED")


def _id(p: str) -> str:
    return f"{p}_{now_ms()}_{rand_base36(4)}"


def _next_open_month() -> str:
    month = today_str()[:7]
    while payroll_month_locked(month):
        y, m = (int(x) for x in month.split("-"))
        month = f"{y + (m == 12)}-{(m % 12) + 1:02d}"
    return month


def _hist(a: dict, action: str, user: Optional[dict], **extra) -> None:
    a.setdefault("history", []).append({"action": action, "by": actor_name(user) if user else "System", "at": now_iso(), **extra})


def _norm(a: dict) -> dict:
    """Older records only knew ALLOCATED / RETURNED."""
    if a.get("status") == "RETURNED":
        a["status"] = "IN_STOCK"
    if a.get("employeeId") and a["employeeId"] not in db_store.employees and a.get("status") == "ALLOCATED":
        a.setdefault("note", "Holder not found in employee master")
    a.setdefault("ackStatus", "ACCEPTED" if a.get("status") == "ALLOCATED" else None)
    return a


def pending_assets(emp_id: str) -> list:
    """Assets an exiting employee still has to return (or settle through an approved recovery / write-off)."""
    out = []
    for a in modules_store.assets.values():
        _norm(a)
        if a.get("employeeId") != emp_id or a.get("status") not in HELD:
            continue
        rec = a.get("recovery") or {}
        if rec.get("status") == "APPROVED":
            continue
        out.append({"_id": a["_id"], "assetTag": a.get("assetTag"), "name": a.get("name"), "status": a["status"]})
    return out


def _visible(a: dict, user: dict) -> bool:
    me = my_employee_id(user)
    return user.get("role") in READ_ALL or a.get("employeeId") == me or (a.get("employeeId") and is_in_team(me, a["employeeId"]))


def _view(a: dict, user: dict) -> dict:
    me = my_employee_id(user)
    rec, wo = a.get("recovery") or {}, a.get("writeOff") or {}
    return {**a,
            "canAcknowledge": a.get("employeeId") == me and a.get("ackStatus") == "PENDING",
            "canIssue": user.get("role") in ASSET_ADMIN and a.get("status") == "IN_STOCK" and a.get("recordedByUserId") != user["_id"],
            "canApproveRecovery": rec.get("status") == "PENDING_FINANCE" and user.get("role") == "FINANCE" and rec.get("requestedByUserId") != user["_id"]
                                  and a.get("employeeId") != me,
            "canApproveWriteOff": wo.get("status") == "PENDING_FINANCE" and user.get("role") == "FINANCE" and wo.get("requestedByUserId") != user["_id"]}


# ------------------------------------------------------------------ master

@router.get("/assets")
async def list_assets(employeeId: Optional[str] = None, status: Optional[str] = None, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if employeeId and employeeId != me and not (user.get("role") in READ_ALL or is_in_team(me, employeeId)):
        raise ApiError(403, "Access denied: you can only see your own assets.")
    rows = [_norm(a) for a in modules_store.assets.values()]
    rows = [a for a in rows if _visible(a, user) and (not employeeId or a.get("employeeId") == employeeId) and (not status or a.get("status") == status)]
    if user.get("role") not in READ_ALL and not employeeId:
        rows = [a for a in rows if a.get("employeeId") == me]
    return {"assets": [_view(a, user) for a in sorted(rows, key=lambda a: a.get("assetTag") or "")], "types": TYPES,
            "canManage": user.get("role") in ASSET_ADMIN}


@router.get("/assets/register")
async def register(user: dict = Depends(require_role(*READ_ALL))):
    rows = [_norm(a) for a in modules_store.assets.values()]
    summary: dict = {}
    for a in rows:
        s = summary.setdefault(a.get("status") or "UNKNOWN", {"status": a.get("status"), "count": 0, "cost": 0.0, "bookValue": 0.0})
        s["count"] += 1
        s["cost"] += a.get("cost") or 0
        s["bookValue"] += a.get("bookValue", a.get("cost") or 0) or 0
    audit(user, "ASSET_REGISTER_VIEWED", "ASSETS", "Asset", "register", {"count": len(rows)})
    return {"rows": [{k: a.get(k) for k in ("_id", "assetTag", "serialNumber", "type", "name", "vendor", "cost", "purchaseDate", "status",
                                             "employeeName", "employeeCode", "bookValue", "accumulatedDepreciation", "lastVerifiedAt")}
                     for a in sorted(rows, key=lambda a: a.get("assetTag") or "")],
            "summary": list(summary.values()), "total": len(rows), "readOnly": user.get("role") == "AUDITORS"}


@router.post("/assets")
async def create_asset(request: Request, user: dict = Depends(require_role(*ASSET_CREATORS))):
    b = await read_body(request)
    errors = []
    a_type = js_str(b.get("type") or "").upper()
    name, tag, serial = (js_str(b.get(k) or "").strip() for k in ("name", "assetTag", "serialNumber"))
    vendor = js_str(b.get("vendor") or "").strip()
    if a_type not in TYPES:
        errors.append("Choose a valid asset type.")
    if not name:
        errors.append("Asset name / model is required.")
    if not tag:
        errors.append("Asset tag is required.")
    if not serial:
        errors.append("Serial number is required.")
    try:
        cost = float(b.get("cost"))
        purchase = date.fromisoformat(js_str(b.get("purchaseDate") or "")[:10]).isoformat()
    except (TypeError, ValueError):
        raise ApiError(400, "Give the purchase cost and purchase date (YYYY-MM-DD).")
    if cost < 0:
        errors.append("Cost cannot be negative.")
    if purchase > today_str():
        errors.append("Purchase date cannot be in the future.")
    live = [a for a in modules_store.assets.values() if a.get("status") not in ("DISPOSED", "WRITTEN_OFF")]
    if serial and any((a.get("serialNumber") or "").lower() == serial.lower() for a in live):
        errors.append(f"Serial number {serial} already exists in the asset master.")
    if tag and any((a.get("assetTag") or "").lower() == tag.lower() for a in modules_store.assets.values()):
        errors.append(f"Asset tag {tag} already exists.")
    if errors:
        raise ApiError(409 if any("already exists" in e for e in errors) and len(errors) == 1 else 400,
                       errors[0] if len(errors) == 1 else "Please fix the asset details.", errors=errors)
    aid = _id("asset")
    method = b.get("depreciationMethod") if b.get("depreciationMethod") in ("SLM", "WDV") else "SLM"
    a = {"_id": aid, "type": a_type, "category": js_str(b.get("category") or "").upper() or None, "name": name, "assetTag": tag, "serialNumber": serial,
         "vendor": vendor, "invoiceNumber": js_str(b.get("invoiceNumber") or ""), "cost": round(cost, 2), "purchaseDate": purchase,
         "depreciationMethod": method, "usefulLifeYears": float(b.get("usefulLifeYears") or DEFAULT_LIFE.get(a_type, 5)),
         "wdvRate": float(b.get("wdvRate") or 40), "salvagePct": 5.0, "bookValue": round(cost, 2), "accumulatedDepreciation": 0.0,
         "status": "IN_STOCK", "employeeId": None, "recordedBy": actor_name(user), "recordedByUserId": user["_id"], "recordedAt": now_iso()}
    _hist(a, "RECORDED", user, cost=cost, vendor=vendor)
    modules_store.assets[aid] = a
    audit(user, "ASSET_RECORDED", "ASSETS", "Asset", aid, {"assetTag": tag, "serialNumber": serial, "cost": cost})
    return JSONResponse({"asset": _view(a, user)}, status_code=201)


@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, user: dict = Depends(require_auth)):
    audit(user, "ASSET_DELETE_BLOCKED", "ASSETS", "Asset", asset_id, {})
    raise ApiError(403, "Asset records cannot be deleted. Use write-off / disposal, which needs Finance approval and keeps the history.")


# ------------------------------------------------------------------ requests

@router.get("/assets/requests")
async def list_requests(user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    rows = []
    for r in modules_store.assetRequests.values():
        mine, approver = r["employeeId"] == me, r.get("approverId") == me
        if mine or approver or user.get("role") in READ_ALL:
            rows.append({**r, "canDecide": approver and r["status"] == "PENDING_MANAGER" and not mine})
    return {"requests": sorted(rows, key=lambda r: r["raisedAt"], reverse=True)}


@router.post("/assets/requests")
async def raise_request(request: Request, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    b = await read_body(request)
    a_type, reason = js_str(b.get("type") or "").upper(), js_str(b.get("reason") or "").strip()
    if a_type not in TYPES or not reason:
        raise ApiError(400, "Choose the asset type and give a reason.")
    approver = manager_of(me)
    rid = _id("areq")
    r = {"_id": rid, "employeeId": me, "employeeName": employee_name(me), "type": a_type, "reason": reason, "approverId": approver,
         "approverName": employee_name(approver) if approver else None, "status": "PENDING_MANAGER" if approver else "PENDING_ISSUE",
         "raisedAt": now_iso(), "history": [{"action": "RAISED", "by": actor_name(user), "at": now_iso()}]}
    modules_store.assetRequests[rid] = r
    if approver:
        notify_employee(approver, "Asset request to approve", f"{r['employeeName']} requested a {a_type.lower()}: {reason}", "ASSETS")
    else:
        notify_roles(ASSET_ADMIN, "Asset request to fulfil", f"{r['employeeName']}: {a_type.lower()}", "ASSETS", exclude_user_id=user["_id"])
    audit(user, "ASSET_REQUESTED", "ASSETS", "AssetRequest", rid, {"type": a_type})
    return JSONResponse({"request": r}, status_code=201)


@router.post("/assets/requests/{rid}/decide")
async def decide_request(rid: str, request: Request, user: dict = Depends(require_auth)):
    r = modules_store.assetRequests.get(rid)
    if not r:
        raise ApiError(404, "Request not found.")
    me = my_employee_id(user)
    if r["employeeId"] == me:
        raise ApiError(403, "You cannot approve your own asset request; it goes to your manager.")
    if r.get("approverId") != me or r["status"] != "PENDING_MANAGER":
        raise ApiError(403, "Only the employee's manager can approve this request.")
    b = await read_body(request)
    decision, comment = b.get("decision"), js_str(b.get("comment") or "").strip()
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Give a reason for rejecting.")
    r["status"] = "PENDING_ISSUE" if decision == "APPROVED" else "REJECTED"
    r["history"].append({"action": f"MANAGER_{decision}", "by": actor_name(user), "at": now_iso(), "comment": comment})
    if decision == "APPROVED":
        notify_roles(ASSET_ADMIN, "Approved asset request to fulfil", f"{r['employeeName']}: {r['type'].lower()}", "ASSETS")
    notify_employee(r["employeeId"], f"Asset request {decision.lower()}", f"{r['type'].title()}{': ' + comment if comment else ''}", "ASSETS")
    audit(user, f"ASSET_REQUEST_{decision}", "ASSETS", "AssetRequest", rid, {"comment": comment})
    return {"request": r}


# ------------------------------------------------------------------ issue / acknowledge / return / transfer

def _asset(asset_id: str) -> dict:
    a = modules_store.assets.get(asset_id)
    if not a:
        raise ApiError(404, "Asset not found.")
    return _norm(a)


@router.post("/assets/{asset_id}/issue")
async def issue_asset(asset_id: str, request: Request, user: dict = Depends(require_role(*ASSET_ADMIN))):
    a = _asset(asset_id)
    b = await read_body(request)
    emp_id = b.get("employeeId")
    if emp_id not in db_store.employees:
        raise ApiError(404, "Employee not found.")
    if a["status"] != "IN_STOCK":
        raise ApiError(409, f"Asset is {a['status'].replace('_', ' ').lower()}, not in stock.")
    if a.get("recordedByUserId") == user["_id"]:
        raise ApiError(403, "Separation of duties: the person who recorded this asset cannot also issue it. Ask another admin.")
    if emp_id == my_employee_id(user):
        raise ApiError(403, "You cannot issue an asset to yourself.")
    req = modules_store.assetRequests.get(b.get("requestId") or "")
    if req:
        if req["employeeId"] != emp_id or req["status"] != "PENDING_ISSUE":
            raise ApiError(400, "That request is not approved for this employee.")
        req["status"] = "FULFILLED"
        req["assetId"] = asset_id
        req["history"].append({"action": "ISSUED", "by": actor_name(user), "at": now_iso(), "assetTag": a["assetTag"]})
    a.update({"status": "ALLOCATED", "employeeId": emp_id, "employeeName": employee_name(emp_id), "employeeCode": db_store.employees[emp_id].get("employeeCode"),
              "issuedDate": today_str(), "issuedBy": actor_name(user), "issueCondition": js_str(b.get("condition") or "GOOD"),
              "ackStatus": "PENDING", "acknowledgedAt": None})
    _hist(a, "ISSUED", user, to=a["employeeName"], condition=a["issueCondition"])
    notify_employee(emp_id, "Please acknowledge your asset", f"{a['name']} ({a['assetTag']}) has been issued to you.", "ASSETS")
    audit(user, "ASSET_ISSUED", "ASSETS", "Asset", asset_id, {"assetTag": a["assetTag"], "employee": a["employeeName"]})
    return {"asset": _view(a, user)}


@router.post("/assets/{asset_id}/acknowledge")
async def acknowledge(asset_id: str, request: Request, user: dict = Depends(require_auth)):
    a = _asset(asset_id)
    if a.get("employeeId") != my_employee_id(user):
        raise ApiError(403, "Only the person the asset is issued to can acknowledge it.")
    if a.get("ackStatus") != "PENDING":
        raise ApiError(409, "This asset has already been acknowledged.")
    b = await read_body(request)
    accept = b.get("decision", "ACCEPTED") != "DISPUTED"
    a.update({"ackStatus": "ACCEPTED" if accept else "DISPUTED", "acknowledgedAt": now_iso(), "ackRemarks": js_str(b.get("remarks") or "")})
    _hist(a, "ACKNOWLEDGED" if accept else "DISPUTED", user, remarks=a["ackRemarks"])
    if not accept:
        notify_roles(ASSET_ADMIN, "Asset receipt disputed", f"{a['employeeName']}: {a['assetTag']} — {a['ackRemarks']}", "ASSETS")
    audit(user, "ASSET_ACKNOWLEDGED", "ASSETS", "Asset", asset_id, {"accepted": accept})
    return {"asset": _view(a, user)}


@router.put("/assets/{asset_id}/return")
@router.post("/assets/{asset_id}/return")
async def return_asset(asset_id: str, request: Request, user: dict = Depends(require_role(*ASSET_ADMIN))):
    a = _asset(asset_id)
    if a["status"] not in ("ALLOCATED", "REPORTED_DAMAGED"):
        raise ApiError(409, "Only issued assets can be returned.")
    b = await read_body(request)
    condition = js_str(b.get("condition") or "GOOD").upper()
    if condition not in ("GOOD", "FAIR", "DAMAGED"):
        raise ApiError(400, "Condition must be GOOD, FAIR or DAMAGED.")
    holder = a.get("employeeName")
    _hist(a, "RETURNED", user, by_employee=holder, condition=condition, notes=js_str(b.get("notes") or ""))
    a.update({"status": "IN_STOCK" if condition != "DAMAGED" else "DAMAGED", "employeeId": None, "employeeName": None, "employeeCode": None,
              "returnedDate": today_str(), "returnCondition": condition, "ackStatus": None})
    audit(user, "ASSET_RETURNED", "ASSETS", "Asset", asset_id, {"from": holder, "condition": condition})
    return {"asset": _view(a, user)}


@router.post("/assets/{asset_id}/transfer")
async def transfer_asset(asset_id: str, request: Request, user: dict = Depends(require_role(*ASSET_ADMIN))):
    a = _asset(asset_id)
    to = (await read_body(request)).get("toEmployeeId")
    if to not in db_store.employees:
        raise ApiError(404, "Employee not found.")
    if a["status"] != "ALLOCATED":
        raise ApiError(409, "Only issued assets can be transferred.")
    if to == my_employee_id(user):
        raise ApiError(403, "You cannot transfer an asset to yourself.")
    frm = a.get("employeeName")
    a.update({"employeeId": to, "employeeName": employee_name(to), "employeeCode": db_store.employees[to].get("employeeCode"),
              "issuedDate": today_str(), "ackStatus": "PENDING", "acknowledgedAt": None})
    _hist(a, "TRANSFERRED", user, frm=frm, to=a["employeeName"])
    notify_employee(to, "Please acknowledge your asset", f"{a['name']} ({a['assetTag']}) has been transferred to you.", "ASSETS")
    audit(user, "ASSET_TRANSFERRED", "ASSETS", "Asset", asset_id, {"from": frm, "to": a["employeeName"]})
    return {"asset": _view(a, user)}


# ------------------------------------------------------------------ damage / loss / recovery

@router.post("/assets/{asset_id}/report")
async def report_issue(asset_id: str, request: Request, user: dict = Depends(require_auth)):
    a = _asset(asset_id)
    if a.get("employeeId") != my_employee_id(user):
        raise ApiError(403, "You can only report your own assets.")
    b = await read_body(request)
    kind, desc = js_str(b.get("kind") or "").upper(), js_str(b.get("description") or "").strip()
    if kind not in ("DAMAGE", "LOSS") or not desc:
        raise ApiError(400, "Say whether it is damage or loss and describe what happened.")
    a["status"] = "REPORTED_LOST" if kind == "LOSS" else "REPORTED_DAMAGED"
    a["incident"] = {"kind": kind, "description": desc, "reportedAt": now_iso(), "reportedBy": actor_name(user)}
    _hist(a, f"REPORTED_{kind}", user, description=desc)
    notify_roles(ASSET_ADMIN, f"Asset {kind.lower()} reported", f"{a['employeeName']}: {a['name']} ({a['assetTag']}) — {desc}", "ASSETS")
    audit(user, f"ASSET_{kind}_REPORTED", "ASSETS", "Asset", asset_id, {"description": desc})
    return {"asset": _view(a, user)}


@router.post("/assets/{asset_id}/recovery")
async def propose_recovery(asset_id: str, request: Request, user: dict = Depends(require_role(*ASSET_ADMIN))):
    a = _asset(asset_id)
    if not a.get("employeeId"):
        raise ApiError(400, "This asset is not with an employee.")
    b = await read_body(request)
    try:
        amount = float(b.get("amount"))
    except (TypeError, ValueError):
        raise ApiError(400, "Recovery amount must be a number (0 to waive).")
    reason = js_str(b.get("reason") or "").strip()
    if amount < 0 or not reason:
        raise ApiError(400, "Give the recovery amount and the reason.")
    if amount > max(a.get("bookValue") or 0, a.get("cost") or 0):
        raise ApiError(400, "Recovery cannot exceed the asset's cost.")
    a["recovery"] = {"amount": round(amount, 2), "reason": reason, "status": "PENDING_FINANCE", "requestedBy": actor_name(user),
                     "requestedByUserId": user["_id"], "requestedAt": now_iso(), "employeeId": a["employeeId"]}
    _hist(a, "RECOVERY_PROPOSED", user, amount=amount)
    notify_roles(("FINANCE",), "Asset recovery to approve", f"{a['employeeName']}: ₹{amount:,.0f} for {a['assetTag']}", "ASSETS")
    audit(user, "ASSET_RECOVERY_PROPOSED", "ASSETS", "Asset", asset_id, {"amount": amount, "reason": reason})
    return {"asset": _view(a, user)}


@router.post("/assets/{asset_id}/recovery/decide")
async def decide_recovery(asset_id: str, request: Request, user: dict = Depends(require_role("FINANCE"))):
    a = _asset(asset_id)
    rec = a.get("recovery") or {}
    if rec.get("status") != "PENDING_FINANCE":
        raise ApiError(409, "No recovery is waiting for approval.")
    if rec.get("requestedByUserId") == user["_id"] or rec.get("employeeId") == my_employee_id(user):
        raise ApiError(403, "Maker-checker: you cannot approve this recovery.")
    b = await read_body(request)
    decision = b.get("decision")
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    rec.update({"status": decision, "decidedBy": actor_name(user), "decidedAt": now_iso(), "comment": js_str(b.get("comment") or "")})
    if decision == "APPROVED" and rec["amount"] > 0:
        month = _next_open_month()
        add_payroll_input(rec["employeeId"], month, "RECOVERY", amount=rec["amount"], source="ASSET", source_id=f"asset:{asset_id}",
                          label=f"Asset recovery {a['assetTag']}", by=user)
        rec["payrollMonth"] = month
        # F&F of an exiting employee also picks this up as an asset recovery line
    _hist(a, f"RECOVERY_{decision}", user, amount=rec["amount"])
    notify_employee(rec["employeeId"], f"Asset recovery {decision.lower()}", f"{a['assetTag']}: ₹{rec['amount']:,.0f}", "ASSETS")
    audit(user, f"ASSET_RECOVERY_{decision}", "ASSETS", "Asset", asset_id, {"amount": rec["amount"], "payrollMonth": rec.get("payrollMonth")})
    return {"asset": _view(a, user)}


@router.post("/assets/{asset_id}/write-off")
async def request_write_off(asset_id: str, request: Request, user: dict = Depends(require_role(*ASSET_ADMIN))):
    a = _asset(asset_id)
    if a["status"] in ("WRITTEN_OFF", "DISPOSED"):
        raise ApiError(409, "Already written off.")
    if (a.get("writeOff") or {}).get("status") == "PENDING_FINANCE":
        raise ApiError(409, "A write-off is already waiting for Finance.")
    b = await read_body(request)
    reason, kind = js_str(b.get("reason") or "").strip(), (b.get("kind") or "WRITE_OFF").upper()
    if not reason or kind not in ("WRITE_OFF", "DISPOSAL"):
        raise ApiError(400, "Give the reason (and kind WRITE_OFF or DISPOSAL).")
    a["writeOff"] = {"kind": kind, "reason": reason, "status": "PENDING_FINANCE", "bookValue": a.get("bookValue"), "requestedBy": actor_name(user),
                     "requestedByUserId": user["_id"], "requestedAt": now_iso()}
    _hist(a, f"{kind}_REQUESTED", user, reason=reason)
    notify_roles(("FINANCE",), "Asset write-off to approve", f"{a['assetTag']} ({a['name']}): {reason}", "ASSETS")
    audit(user, "ASSET_WRITE_OFF_REQUESTED", "ASSETS", "Asset", asset_id, {"reason": reason, "bookValue": a.get("bookValue")})
    return {"asset": _view(a, user)}


@router.post("/assets/{asset_id}/write-off/decide")
async def decide_write_off(asset_id: str, request: Request, user: dict = Depends(require_role("FINANCE"))):
    a = _asset(asset_id)
    wo = a.get("writeOff") or {}
    if wo.get("status") != "PENDING_FINANCE":
        raise ApiError(409, "No write-off is waiting for approval.")
    if wo.get("requestedByUserId") == user["_id"]:
        raise ApiError(403, "Maker-checker: you cannot approve a write-off you requested.")
    decision = (await read_body(request)).get("decision")
    if decision not in ("APPROVED", "REJECTED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    wo.update({"status": decision, "decidedBy": actor_name(user), "decidedAt": now_iso()})
    if decision == "APPROVED":
        a.update({"status": "WRITTEN_OFF" if wo["kind"] == "WRITE_OFF" else "DISPOSED", "writtenOffValue": a.get("bookValue"), "bookValue": 0.0})
    _hist(a, f"{wo['kind']}_{decision}", user)
    audit(user, f"ASSET_WRITE_OFF_{decision}", "ASSETS", "Asset", asset_id, {"kind": wo["kind"], "value": a.get("writtenOffValue")})
    return {"asset": _view(a, user)}


# ------------------------------------------------------------------ depreciation (Accounts)

@router.post("/assets/depreciation")
async def run_depreciation(request: Request, user: dict = Depends(require_role("ACCOUNTS"))):
    b = await read_body(request)
    as_of = js_str(b.get("asOf") or today_str())[:10]
    try:
        on = date.fromisoformat(as_of)
    except ValueError:
        raise ApiError(400, "asOf must be YYYY-MM-DD.")
    rows = []
    for a in modules_store.assets.values():
        _norm(a)
        if a.get("status") in ("WRITTEN_OFF", "DISPOSED") or not a.get("cost") or not a.get("purchaseDate"):
            continue
        years = max(0.0, (on - date.fromisoformat(a["purchaseDate"][:10])).days / 365.25)
        cost = a["cost"]
        salvage = cost * (a.get("salvagePct", 5.0) / 100)
        if a.get("depreciationMethod") == "WDV":
            book = max(salvage, cost * (1 - (a.get("wdvRate") or 40) / 100) ** years)
        else:
            life = a.get("usefulLifeYears") or DEFAULT_LIFE.get(a.get("type"), 5)
            book = max(salvage, cost - (cost - salvage) * min(1.0, years / life))
        old = a.get("bookValue", cost)
        a.update({"bookValue": round(book, 2), "accumulatedDepreciation": round(cost - book, 2), "depreciatedAsOf": as_of})
        rows.append({"assetTag": a.get("assetTag"), "method": a.get("depreciationMethod", "SLM"), "cost": cost, "previousBookValue": old,
                     "bookValue": a["bookValue"], "accumulatedDepreciation": a["accumulatedDepreciation"]})
    audit(user, "ASSET_DEPRECIATION_RUN", "ASSETS", "Asset", "depreciation", {"asOf": as_of, "assets": len(rows),
                                                                              "charge": round(sum(r["previousBookValue"] - r["bookValue"] for r in rows), 2)})
    return {"asOf": as_of, "rows": rows}


@router.get("/assets/clearance/{emp_id}")
async def clearance(emp_id: str, user: dict = Depends(require_auth)):
    if emp_id != my_employee_id(user) and user.get("role") not in READ_ALL:
        raise ApiError(403, "Access denied.")
    pending = pending_assets(emp_id)
    return {"employeeId": emp_id, "cleared": not pending, "pending": pending}
