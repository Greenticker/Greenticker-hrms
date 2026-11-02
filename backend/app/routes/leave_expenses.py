import math
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, read_body
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import num, parse_date, truthy

router = APIRouter()


def _target_employee(user: dict, target_employee_id) -> tuple:
    """(employee, is_privileged). Admin / HR may act on behalf of any employee."""
    is_privileged = user.get("role") in ("ADMIN", "HR")
    if target_employee_id and is_privileged:
        emp = db_store.employees.get(target_employee_id)
    elif user.get("employeeId"):
        emp = db_store.employees.get(user["employeeId"])
    else:
        emp = None
    if not emp:
        raise ApiError(400, "Valid employee record not found.")
    return emp, is_privileged


# ------------------------------------------------------------------- leave

@router.get("/leave/balance")
async def leave_balance(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    target = employeeId if user.get("role") == "ADMIN" and employeeId else (user.get("employeeId") or "emp_admin_01")
    return {"balance": modules_store.get_leave_balance(target)}


@router.get("/leave/requests")
async def leave_requests(status: Optional[str] = None, employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    requests = modules_store.get_leave_requests(user, status=status, employee_id=employeeId)
    balance = modules_store.get_leave_balance(user["employeeId"]) if user.get("employeeId") else None
    return {"requests": requests, "balance": balance}


@router.post("/leave/apply")
async def apply_leave(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    leave_type, start_date, end_date, reason = body.get("leaveType"), body.get("startDate"), body.get("endDate"), body.get("reason")
    if not all(truthy(v) for v in (leave_type, start_date, end_date, reason)):
        raise ApiError(400, "leaveType, startDate, endDate, and reason are required.")

    emp, is_privileged = _target_employee(user, body.get("targetEmployeeId"))

    start, end = parse_date(start_date), parse_date(end_date)
    if start and end:
        diff_ms = abs((end - start).total_seconds() * 1000)
        days_count = math.ceil(diff_ms / (1000 * 60 * 60 * 24)) + 1
    else:
        days_count = None  # NaN in JavaScript
    if truthy(body.get("isHalfDay")):
        days_count = 0.5

    leave_reason = reason
    if is_privileged and emp["_id"] != user.get("employeeId"):
        leave_reason = f"[Applied by {user.get('firstName')} {user.get('lastName')} ({user.get('role')})] {reason}"

    leave = modules_store.create_leave_request({
        "employeeId": emp["_id"],
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "employeeCode": emp.get("employeeCode"),
        "department": emp.get("department"),
        "leaveType": leave_type,
        "startDate": start_date,
        "endDate": end_date,
        "daysCount": days_count,
        "isHalfDay": truthy(body.get("isHalfDay")),
        "halfDaySession": body.get("halfDaySession"),
        "reason": leave_reason,
        "documentUrl": body.get("documentUrl"),
    })

    if is_privileged:
        modules_store.update_leave_status(
            leave["_id"], "APPROVED", f"Auto-approved by {user.get('firstName')} {user.get('lastName')} ({user.get('role')})"
        )

    audit(user, "LEAVE_APPLIED_FOR_EMPLOYEE", "LEAVE", "LeaveRequest", leave["_id"], {
        "appliedFor": f"{emp.get('firstName')} {emp.get('lastName')} ({emp.get('employeeCode')})",
        "leaveType": leave_type,
        "daysCount": days_count,
        "startDate": start_date,
        "endDate": end_date,
    })
    return JSONResponse({"success": True, "leave": leave}, status_code=201)


@router.put("/leave/{leave_id}/status")
async def update_leave_status(leave_id: str, request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    status = body.get("status")
    if status not in ("APPROVED", "REJECTED", "CANCELLED"):
        raise ApiError(400, "Invalid status.")
    reviewer = f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})"
    leave = modules_store.update_leave_status(leave_id, status, reviewer, body.get("rejectionReason"))
    if not leave:
        raise ApiError(404, "Leave request not found.")
    return {"success": True, "leave": leave}


# ---------------------------------------------------------------- expenses

@router.get("/expenses")
async def list_expenses(
    status: Optional[str] = None,
    category: Optional[str] = None,
    employeeId: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    return {"claims": modules_store.get_expenses(user, status=status, category=category, employee_id=employeeId)}


@router.post("/expenses")
async def create_expense(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    title, category, amount = body.get("title"), body.get("category"), body.get("amount")
    expense_date, description = body.get("expenseDate"), body.get("description")
    currency = body.get("currency") if body.get("currency") is not None else "INR"
    if not all(truthy(v) for v in (title, category, amount, expense_date, description)):
        raise ApiError(400, "Missing required expense fields.")

    emp, is_privileged = _target_employee(user, body.get("targetEmployeeId"))
    claim_description = description
    if is_privileged and emp["_id"] != user.get("employeeId"):
        claim_description = f"[Submitted by {user.get('firstName')} {user.get('lastName')} ({user.get('role')})] {description}"

    claim = modules_store.create_expense({
        "employeeId": emp["_id"],
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "employeeCode": emp.get("employeeCode"),
        "department": emp.get("department"),
        "title": title,
        "category": category,
        "amount": num(amount),
        "currency": currency,
        "expenseDate": expense_date,
        "description": claim_description,
        "receiptName": body.get("receiptName"),
    })

    audit(user, "EXPENSE_CLAIMED_FOR_EMPLOYEE", "EXPENSES", "ExpenseClaim", claim["_id"], {
        "claimedFor": f"{emp.get('firstName')} {emp.get('lastName')} ({emp.get('employeeCode')})",
        "title": title,
        "amount": amount,
        "category": category,
    })
    return JSONResponse({"success": True, "claim": claim}, status_code=201)


@router.put("/expenses/{exp_id}/status")
async def update_expense_status(exp_id: str, request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    reviewer = f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})"
    updated = modules_store.update_expense_status(
        exp_id, body.get("status"), reviewer, body.get("rejectionReason"), body.get("paymentReference")
    )
    if not updated:
        raise ApiError(404, "Expense claim not found.")
    return {"success": True, "claim": updated}
