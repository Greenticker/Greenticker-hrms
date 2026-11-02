from fastapi import APIRouter, Depends

from app.auth.rbac import ROLE_PERMISSIONS, ROLES
from app.auth.security import require_role
from app.stores.db_store import db_store

router = APIRouter()

ROLE_DETAILS = {
    "SUPER_ADMIN": ("Super Admin", "Unrestricted access to every module and system setting."),
    "ADMIN": ("Admin", "Full administrative access across all modules."),
    "ADMIN_1": ("Admin Level 1", "Employee, policy, leave, expense, payroll and compliance administration."),
    "ADMIN_2": ("Admin Level 2", "Attendance, leave and document administration with read access to employees."),
    "FINANCE": ("Finance", "Payroll processing, tax, Form 16 and expense approvals."),
    "HR": ("Human Resources", "Employee lifecycle, organization structure, policies, leave and POSH."),
    "ACCOUNTS": ("Accounts", "Expense approvals, payroll and tax records."),
    "AUDITORS": ("Auditors", "Read-only access to records, audit logs and reports."),
    "MANAGER": ("Manager", "Team attendance, leave and expense approvals."),
    "EMPLOYEE": ("Employee", "Self-service access to own records, leave, expenses and payslips."),
}


@router.get("/rbac/roles")
async def list_roles(_: dict = Depends(require_role("SUPER_ADMIN", "ADMIN", "ADMIN_1", "ADMIN_2", "HR", "AUDITORS"))):
    """Built-in roles and their permissions. Roles are defined in code, so this is read-only."""
    roles = []
    for key in ROLES:
        name, description = ROLE_DETAILS.get(key, (key.replace("_", " ").title(), ""))
        roles.append({
            "key": key,
            "name": name,
            "description": description,
            "isSystemRole": True,
            "permissions": ROLE_PERMISSIONS.get(key, []),
            "userCount": sum(1 for u in db_store.users.values() if u.get("role") == key),
        })
    return {"roles": roles}
