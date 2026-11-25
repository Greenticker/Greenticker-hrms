"""
Shared helpers for approval workflows across modules (leave, attendance, claims, assets, ...):
notifications, reporting lines, maker-checker checks and payroll inputs.

Payroll inputs: other modules never touch payslips directly. They add input rows here
(LOP days, leave encashment, overtime, reimbursements, loan EMIs, recoveries, ...) and the
payroll run reads them for the month. Each row: {employeeId, month 'YYYY-MM', kind, amount,
days, source, sourceId, label, status}. Rows of a locked payroll month cannot be added.
"""

from typing import Optional

from app.errors import ApiError
from app.stores.db_store import db_store
from app.utils.jsutil import now_iso, now_ms, rand_base36

PAYROLL_INPUT_KINDS = {
    # kind: (label, is_earning)
    "LOP_DAYS": ("Loss of pay days", False),
    "LEAVE_ENCASHMENT": ("Leave encashment", True),
    "OVERTIME": ("Overtime", True),
    "ARREARS": ("Arrears", True),
    "VARIABLE_PAY": ("Variable pay / bonus", True),
    "REIMBURSEMENT": ("Reimbursement", True),
    "LOAN_EMI": ("Loan / advance EMI", False),
    "RECOVERY": ("Recovery", False),
    "INSURANCE_PREMIUM": ("Insurance premium (employee share)", False),
    "OTHER_DEDUCTION": ("Other deduction", False),
}


def employee_name(emp_id: Optional[str]) -> str:
    emp = db_store.employees.get(emp_id or "")
    return f"{emp.get('firstName')} {emp.get('lastName')}" if emp else ""


def actor_name(user: dict) -> str:
    return f"{user.get('firstName') or ''} {user.get('lastName') or ''}".strip() or user.get("email") or "User"


def my_employee_id(user: dict) -> Optional[str]:
    if user.get("employeeId"):
        return user["employeeId"]
    emp = db_store.find_employee_by_user_id(user["_id"])
    return emp["_id"] if emp else None


def manager_of(emp_id: Optional[str]) -> Optional[str]:
    emp = db_store.employees.get(emp_id or "")
    mgr = (emp or {}).get("reportingManagerId")
    return mgr if mgr and mgr != emp_id and mgr in db_store.employees else None


def is_in_team(manager_emp_id: Optional[str], emp_id: Optional[str]) -> bool:
    """True if emp_id reports (directly or indirectly) to manager_emp_id."""
    seen = set()
    current = manager_of(emp_id)
    while current and current not in seen:
        if current == manager_emp_id:
            return True
        seen.add(current)
        current = manager_of(current)
    return False


def notify_user(user_id: Optional[str], title: str, message: str, kind: str = "SYSTEM") -> None:
    if not user_id:
        return
    db_store.notifications.insert(0, {
        "_id": f"notif_{now_ms()}_{rand_base36(6)}", "recipientUserId": user_id, "title": title,
        "message": message, "type": kind, "isRead": False, "createdAt": now_iso(),
    })


def notify_employee(emp_id: Optional[str], title: str, message: str, kind: str = "SYSTEM") -> None:
    emp = db_store.employees.get(emp_id or "")
    if emp and emp.get("userId"):
        notify_user(emp["userId"], title, message, kind)


def notify_roles(roles: tuple, title: str, message: str, kind: str = "SYSTEM", exclude_user_id: Optional[str] = None) -> int:
    n = 0
    for u in db_store.users.values():
        if u.get("role") in roles and u.get("isActive", True) and u["_id"] != exclude_user_id:
            notify_user(u["_id"], title, message, kind)
            n += 1
    return n


# ------------------------------------------------------------------ payroll inputs

def payroll_month_locked(month: str) -> bool:
    from app.stores.modules_store import modules_store
    lock = (modules_store.payrollLocks or {}).get(month) or {}
    return bool(lock.get("locked"))


def add_payroll_input(employee_id: str, month: str, kind: str, *, amount: float = 0, days: float = 0,
                      source: str, source_id: str, label: Optional[str] = None, by: Optional[dict] = None) -> dict:
    from app.stores.modules_store import modules_store
    if kind not in PAYROLL_INPUT_KINDS:
        raise ValueError(f"Unknown payroll input kind {kind}")
    if payroll_month_locked(month):
        raise ApiError(409, f"Payroll for {month} is locked; this change has to go into a later month.")
    # One row per source record and kind: re-running replaces it instead of paying twice
    for row in modules_store.payrollInputs.values():
        if row.get("sourceId") == source_id and row.get("kind") == kind and row.get("employeeId") == employee_id and row.get("status") != "CANCELLED":
            row.update({"month": month, "amount": round(amount, 2), "days": days, "updatedAt": now_iso()})
            return row
    row_id = f"pin_{now_ms()}_{rand_base36(6)}"
    row = {
        "_id": row_id, "employeeId": employee_id, "month": month, "kind": kind, "amount": round(amount, 2), "days": days,
        "label": label or PAYROLL_INPUT_KINDS[kind][0], "source": source, "sourceId": source_id, "status": "OPEN",
        "createdAt": now_iso(), "createdBy": actor_name(by) if by else "System",
    }
    modules_store.payrollInputs[row_id] = row
    return row


def cancel_payroll_inputs(source_id: str) -> int:
    from app.stores.modules_store import modules_store
    n = 0
    for row in modules_store.payrollInputs.values():
        if row.get("sourceId") == source_id and row.get("status") == "OPEN" and not payroll_month_locked(row.get("month") or ""):
            row["status"] = "CANCELLED"
            n += 1
    return n


def payroll_inputs_for(employee_id: str, month: str) -> list:
    from app.stores.modules_store import modules_store
    return [r for r in modules_store.payrollInputs.values()
            if r.get("employeeId") == employee_id and r.get("month") == month and r.get("status") != "CANCELLED"]
