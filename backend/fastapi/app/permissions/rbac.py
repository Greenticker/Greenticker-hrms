from enum import Enum
from typing import List, Dict, Set

class Role(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN_1 = "ADMIN_1"
    ADMIN_2 = "ADMIN_2"
    FINANCE = "FINANCE"
    HR = "HR"
    ACCOUNTS = "ACCOUNTS"
    AUDITORS = "AUDITORS"
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    EMPLOYEE = "EMPLOYEE"

class Permission(str, Enum):
    # Employee Management
    EMPLOYEE_VIEW_ALL = "employee:view_all"
    EMPLOYEE_VIEW_TEAM = "employee:view_team"
    EMPLOYEE_VIEW_SELF = "employee:view_self"
    EMPLOYEE_CREATE = "employee:create"
    EMPLOYEE_EDIT_ALL = "employee:edit_all"
    EMPLOYEE_EDIT_HR = "employee:edit_hr"
    EMPLOYEE_EDIT_SELF = "employee:edit_self"
    EMPLOYEE_DELETE = "employee:delete"
    EMPLOYEE_DEACTIVATE = "employee:deactivate"

    # Organization & Settings
    ORG_CONFIG = "org:configure"
    DEPARTMENT_MANAGE = "department:manage"
    DESIGNATION_MANAGE = "designation:manage"
    LOCATION_MANAGE = "location:manage"

    # Policies
    POLICY_CREATE = "policy:create"
    POLICY_EDIT = "policy:edit"
    POLICY_DELETE = "policy:delete"
    POLICY_VIEW = "policy:view"
    POLICY_ACKNOWLEDGE = "policy:acknowledge"

    # Attendance & Working Hours
    ATTENDANCE_CHECKIN_OUT = "attendance:checkin_out"
    ATTENDANCE_VIEW_SELF = "attendance:view_self"
    ATTENDANCE_VIEW_TEAM = "attendance:view_team"
    ATTENDANCE_VIEW_ALL = "attendance:view_all"
    ATTENDANCE_MANAGE = "attendance:manage"

    # Leave Management
    LEAVE_APPLY = "leave:apply"
    LEAVE_VIEW_SELF = "leave:view_self"
    LEAVE_VIEW_TEAM = "leave:view_team"
    LEAVE_VIEW_ALL = "leave:view_all"
    LEAVE_APPROVE_TEAM = "leave:approve_team"
    LEAVE_APPROVE_ALL = "leave:approve_all"
    LEAVE_CONFIG = "leave:configure"

    # Expense Management
    EXPENSE_APPLY = "expense:apply"
    EXPENSE_VIEW_SELF = "expense:view_self"
    EXPENSE_VIEW_TEAM = "expense:view_team"
    EXPENSE_VIEW_ALL = "expense:view_all"
    EXPENSE_APPROVE_TEAM = "expense:approve_team"
    EXPENSE_APPROVE_ALL = "expense:approve_all"
    EXPENSE_CONFIG = "expense:configure"

    # Payroll & Tax
    PAYROLL_VIEW_SELF = "payroll:view_self"
    PAYROLL_VIEW_ALL = "payroll:view_all"
    PAYROLL_PROCESS = "payroll:process"
    PAYROLL_CONFIG = "payroll:configure"
    TAX_VIEW_SELF = "tax:view_self"
    TAX_MANAGE_ALL = "tax:manage_all"
    FORM16_VIEW_SELF = "form16:view_self"
    FORM16_GENERATE = "form16:generate"

    # Documents & HR Letters
    DOCUMENT_VIEW_SELF = "document:view_self"
    DOCUMENT_VIEW_ALL = "document:view_all"
    DOCUMENT_VERIFY = "document:verify"
    DOCUMENT_GENERATE_LETTERS = "document:generate_letters"

    # POSH & Compliance
    POSH_VIEW_CASES = "posh:view_cases"
    POSH_MANAGE = "posh:manage"

    # AI Assistant
    AI_USE = "ai:use"
    AI_CONFIG = "ai:configure"

    # Audit & Reports
    AUDIT_VIEW = "audit:view"
    REPORT_VIEW_ALL = "report:view_all"
    REPORT_VIEW_TEAM = "report:view_team"
    REPORT_VIEW_SELF = "report:view_self"

ROLE_PERMISSIONS: Dict[Role, Set[Permission]] = {
    Role.SUPER_ADMIN: {perm for perm in Permission},
    Role.ADMIN: {perm for perm in Permission},
    Role.ADMIN_1: {perm for perm in Permission if perm != Permission.ORG_CONFIG},
    Role.ADMIN_2: {
        Permission.EMPLOYEE_VIEW_ALL,
        Permission.ATTENDANCE_VIEW_ALL,
        Permission.ATTENDANCE_MANAGE,
        Permission.LEAVE_VIEW_ALL,
        Permission.LEAVE_APPROVE_ALL,
        Permission.EXPENSE_VIEW_ALL,
        Permission.DOCUMENT_VIEW_ALL,
        Permission.POLICY_VIEW,
        Permission.AI_USE,
        Permission.REPORT_VIEW_ALL,
    },
    Role.FINANCE: {
        Permission.EMPLOYEE_VIEW_ALL,
        Permission.EXPENSE_VIEW_ALL,
        Permission.EXPENSE_APPROVE_ALL,
        Permission.PAYROLL_VIEW_ALL,
        Permission.PAYROLL_PROCESS,
        Permission.TAX_MANAGE_ALL,
        Permission.FORM16_GENERATE,
        Permission.DOCUMENT_VIEW_ALL,
        Permission.REPORT_VIEW_ALL,
    },
    Role.HR: {
        Permission.EMPLOYEE_VIEW_ALL,
        Permission.EMPLOYEE_CREATE,
        Permission.EMPLOYEE_EDIT_ALL,
        Permission.ORG_CONFIG,
        Permission.DEPARTMENT_MANAGE,
        Permission.POLICY_CREATE,
        Permission.POLICY_EDIT,
        Permission.ATTENDANCE_VIEW_ALL,
        Permission.LEAVE_VIEW_ALL,
        Permission.LEAVE_APPROVE_ALL,
        Permission.DOCUMENT_VIEW_ALL,
        Permission.DOCUMENT_VERIFY,
        Permission.POSH_VIEW_CASES,
        Permission.POSH_MANAGE,
        Permission.REPORT_VIEW_ALL,
    },
    Role.ACCOUNTS: {
        Permission.EMPLOYEE_VIEW_ALL,
        Permission.EXPENSE_VIEW_ALL,
        Permission.PAYROLL_VIEW_ALL,
        Permission.TAX_MANAGE_ALL,
        Permission.REPORT_VIEW_ALL,
    },
    Role.AUDITORS: {
        Permission.EMPLOYEE_VIEW_ALL,
        Permission.POLICY_VIEW,
        Permission.ATTENDANCE_VIEW_ALL,
        Permission.LEAVE_VIEW_ALL,
        Permission.EXPENSE_VIEW_ALL,
        Permission.PAYROLL_VIEW_ALL,
        Permission.DOCUMENT_VIEW_ALL,
        Permission.AUDIT_VIEW,
        Permission.REPORT_VIEW_ALL,
    },
    Role.EMPLOYEE: {
        Permission.EMPLOYEE_VIEW_SELF,
        Permission.EMPLOYEE_EDIT_SELF,
        Permission.ATTENDANCE_CHECKIN_OUT,
        Permission.ATTENDANCE_VIEW_SELF,
        Permission.LEAVE_APPLY,
        Permission.LEAVE_VIEW_SELF,
        Permission.EXPENSE_APPLY,
        Permission.EXPENSE_VIEW_SELF,
        Permission.PAYROLL_VIEW_SELF,
        Permission.TAX_VIEW_SELF,
        Permission.FORM16_VIEW_SELF,
        Permission.DOCUMENT_VIEW_SELF,
        Permission.POLICY_VIEW,
        Permission.POLICY_ACKNOWLEDGE,
        Permission.AI_USE,
        Permission.REPORT_VIEW_SELF,
    },
}

def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
