"""
Module access from the official HRMS role matrix (Roles PDF; mirrored in
frontend/src/types/rbac.ts as HRMS_ACCESS_MATRIX). Keep the two in step.

READ_WRITE roles may change data in a module; READ_ONLY roles may view it.
The legacy "ADMIN" role is not in the matrix and keeps full access everywhere.
"""

from typing import Callable

from fastapi import Request

from app.auth.security import require_auth
from app.errors import ApiError

FULL_ACCESS = ("ADMIN",)

# module id -> (read & write roles, read-only roles)
MATRIX = {
    "core_hr": (("SUPER_ADMIN", "ADMIN_1", "HR"), ("ADMIN_2", "FINANCE", "AUDITORS")),
    "asset": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("FINANCE", "ACCOUNTS", "AUDITORS")),
    "employee_adv_loan": (("SUPER_ADMIN", "ADMIN_1", "FINANCE", "ACCOUNTS"), ("ADMIN_2", "HR", "AUDITORS")),
    "report_analytics": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2"), ("FINANCE", "HR", "ACCOUNTS", "AUDITORS")),
    "audit_log": (("SUPER_ADMIN",), ("ADMIN_1", "ADMIN_2", "HR", "AUDITORS")),
    "ticketing": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "FINANCE", "HR", "ACCOUNTS"), ("AUDITORS",)),
    "announcements": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("FINANCE", "ACCOUNTS", "AUDITORS")),
    "leave": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("FINANCE", "AUDITORS")),
    "attendance": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("FINANCE", "AUDITORS")),
    "self_onboarding": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("AUDITORS",)),
    # HR prepares (maker), Finance approves / releases (checker); admins get no salary data
    "payroll": (("HR", "FINANCE"), ("ACCOUNTS", "AUDITORS")),
    "recruitment": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("FINANCE", "AUDITORS")),
    "performance": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("AUDITORS",)),
    "learning": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("FINANCE", "AUDITORS")),
    "insurance": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "FINANCE", "HR"), ("ACCOUNTS", "AUDITORS")),
    "timesheet": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "HR"), ("FINANCE", "ACCOUNTS", "AUDITORS")),
    "exit_mgmt": (("SUPER_ADMIN", "ADMIN_1", "ADMIN_2", "FINANCE", "HR"), ("ACCOUNTS", "AUDITORS")),
    "accounting": (("SUPER_ADMIN", "ACCOUNTS"), ("ADMIN_1", "ADMIN_2", "FINANCE", "AUDITORS")),
    "system_config": (("SUPER_ADMIN",), ()),
}


# Modules even the legacy full-access ADMIN does not get (salary data stays with HR / Finance)
NO_ADMIN_MODULES = ("payroll",)


def _overrides(module: str) -> dict:
    """Role permissions configured by the Super Admin (Admin > Roles), logged when changed."""
    try:
        from app.stores.modules_store import modules_store
        return ((modules_store.systemSettings.get("settings") or {}).get("rolePermissions") or {}).get(module) or {}
    except Exception:  # noqa: BLE001
        return {}


def write_roles(module: str) -> tuple:
    base = (() if module in NO_ADMIN_MODULES else FULL_ACCESS) + MATRIX[module][0]
    o = _overrides(module)
    return tuple(r for r in base if o.get(r, "READ_WRITE") == "READ_WRITE") + tuple(r for r, a in o.items() if a == "READ_WRITE" and r not in base)


def read_roles(module: str) -> tuple:
    o = _overrides(module)
    base = write_roles(module) + tuple(r for r in MATRIX[module][1] if o.get(r, "READ_ONLY") != "NO_ACCESS")
    return base + tuple(r for r, a in o.items() if a == "READ_ONLY" and r not in base)


def can_write(user: dict, module: str) -> bool:
    return user.get("role") in write_roles(module)


def can_read(user: dict, module: str) -> bool:
    return user.get("role") in read_roles(module)


def _require(module: str, write: bool) -> Callable:
    def check(request: Request) -> dict:
        user = require_auth(request)
        if not (can_write(user, module) if write else can_read(user, module)):
            raise ApiError(403, f"Your role ({user.get('role')}) {'cannot change' if write else 'has no access to'} this module.")
        return user

    return check


def require_write(module: str) -> Callable:
    """FastAPI dependency: the signed-in user, if their role may change this module."""
    return _require(module, write=True)


def require_read(module: str) -> Callable:
    """FastAPI dependency: the signed-in user, if their role may view this module."""
    return _require(module, write=False)
