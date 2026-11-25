"""
Who may see / change which employee records, and how much of each record they see.

- View-all roles (employee:view_all permission) see every employee.
- MANAGER sees their direct and indirect reportees (never themself as a "team member").
- Everyone sees their own record.
- Bank, PAN, Aadhaar, UAN and ESI are shown in full only to SENSITIVE_FULL_ROLES (and to
  the employee themself). Other view-all roles (e.g. AUDITORS) get masked values.
- A manager looking at a reportee gets no salary, bank or statutory data at all.
"""

import re
from typing import Optional

from app.auth.rbac import Permissions, has_permission
from app.stores.db_store import db_store

# Roles that may create / edit employee master data, org masters and employee documents
# (core_hr READ_WRITE in module_access.MATRIX, plus the legacy full-access ADMIN).
MASTER_WRITE_ROLES = ("ADMIN", "SUPER_ADMIN", "ADMIN_1", "HR")

# Roles that see bank / statutory identifiers unmasked (payroll maker and checker need them).
SENSITIVE_FULL_ROLES = ("HR", "FINANCE")
# Roles that see salary figures of other employees. Admins manage the system, not salary data.
SALARY_VIEW_ROLES = ("HR", "FINANCE", "AUDITORS")
SALARY_FIELDS = ("annualSalary", "salaryRevisions", "salaryStructure", "salaryStructureId")

# Fields the employee directory shows to everyone.
DIRECTORY_FIELDS = (
    "_id", "employeeCode", "firstName", "lastName", "department", "designation",
    "workEmail", "extension", "location",
)

_MASK = "•"

# What a manager never sees about a reportee: pay, bank, identity numbers and medical details
TEAM_HIDDEN_FIELDS = (
    "annualSalary", "bankInfo", "statutory", "salaryStructure", "pendingBankChange", "bankChangeHistory",
    "bloodGroup", "medicalConditions", "medicalHistory", "disability", "allergies", "insurance",
)


def can_view_all(user: dict) -> bool:
    return has_permission(user.get("role"), Permissions.EMPLOYEE_VIEW_ALL)


def can_write_master(user: dict) -> bool:
    return user.get("role") in MASTER_WRITE_ROLES


def own_employee_id(user: dict) -> Optional[str]:
    if user.get("employeeId"):
        return user["employeeId"]
    emp = db_store.find_employee_by_user_id(user["_id"])
    return emp["_id"] if emp else None


def reportee_ids(manager_emp_id: Optional[str]) -> dict:
    """{employee_id: 'DIRECT' | 'INDIRECT'} for everyone below the manager (cycle-safe)."""
    if not manager_emp_id:
        return {}
    children: dict = {}
    for e in db_store.employees.values():
        mgr = e.get("reportingManagerId")
        if mgr:
            children.setdefault(mgr, []).append(e["_id"])
    out: dict = {}
    frontier = [(cid, "DIRECT") for cid in children.get(manager_emp_id, [])]
    while frontier:
        emp_id, relation = frontier.pop()
        if emp_id in out or emp_id == manager_emp_id:
            continue
        out[emp_id] = relation
        frontier.extend((cid, "INDIRECT") for cid in children.get(emp_id, []))
    return out


def relation_to(user: dict, emp: dict) -> Optional[str]:
    """'SELF', 'ALL' (view-all role), 'TEAM' (manager's reportee) or None (no access)."""
    if emp.get("userId") == user["_id"] or emp["_id"] == user.get("employeeId"):
        return "SELF"
    if can_view_all(user):
        return "ALL"
    if user.get("role") == "MANAGER" and emp["_id"] in reportee_ids(own_employee_id(user)):
        return "TEAM"
    return None


# ------------------------------------------------------------------ masking

def _clean_masked(value) -> str:
    # Older records hold pre-masked values whose bullets were mangled into U+FFFD.
    return str(value).replace("�", _MASK) if value else ""


def mask_tail(value, keep: int = 4) -> str:
    raw = re.sub(r"\s+", "", str(value or ""))
    if not raw:
        return ""
    if len(raw) <= keep:
        return _MASK * len(raw)
    return _MASK * (len(raw) - keep) + raw[-keep:]


def mask_pan(value) -> str:
    raw = str(value or "").strip().upper()
    if len(raw) != 10:
        return mask_tail(raw, 2)
    return f"{raw[:2]}{_MASK * 6}{raw[8:]}"


def _masked_statutory(st: dict) -> dict:
    return {
        "panMasked": mask_pan(st["panNumber"]) if st.get("panNumber") else _clean_masked(st.get("panMasked")),
        "aadhaarMasked": mask_tail(st["aadhaarNumber"]) if st.get("aadhaarNumber") else _clean_masked(st.get("aadhaarMasked")),
        "uanMasked": mask_tail(st["uanNumber"]) if st.get("uanNumber") else _clean_masked(st.get("uanMasked")),
        "esiMasked": mask_tail(st["esiNumber"]) if st.get("esiNumber") else _clean_masked(st.get("esiMasked")),
    }


def _masked_bank(bank: dict) -> dict:
    out = {k: bank.get(k) for k in ("bankName", "accountHolder", "ifsc", "branch") if bank.get(k)}
    number = bank.get("accountNumber")
    out["accountNumberMasked"] = mask_tail(number) if number else _clean_masked(bank.get("accountNumberMasked"))
    return out


def present_employee(user: dict, emp: dict, relation: Optional[str] = None) -> dict:
    """The employee as this user may see it. Adds `sensitiveAccess`: FULL | MASKED | NONE."""
    relation = relation or relation_to(user, emp)
    out = dict(emp)
    if relation == "SELF" or user.get("role") in SENSITIVE_FULL_ROLES:
        out["sensitiveAccess"] = "FULL"
        if isinstance(out.get("statutory"), dict):
            out["statutory"] = {**out["statutory"], **{k: v for k, v in _masked_statutory(out["statutory"]).items() if v}}
        if isinstance(out.get("bankInfo"), dict):
            out["bankInfo"] = {**out["bankInfo"], **_masked_bank(out["bankInfo"])}
        if isinstance(out.get("pendingBankChange"), dict):
            out["pendingBankChange"] = {**out["pendingBankChange"], **_masked_bank(out["pendingBankChange"])}
        return out
    if relation == "ALL":
        out["sensitiveAccess"] = "MASKED"
        if user.get("role") not in SALARY_VIEW_ROLES:
            for key in SALARY_FIELDS:
                out.pop(key, None)
        if isinstance(out.get("statutory"), dict):
            out["statutory"] = _masked_statutory(out["statutory"])
        if isinstance(out.get("bankInfo"), dict):
            out["bankInfo"] = _masked_bank(out["bankInfo"])
        if isinstance(out.get("pendingBankChange"), dict):
            pending = out["pendingBankChange"]
            out["pendingBankChange"] = {**{k: v for k, v in pending.items() if k != "accountNumber"}, **_masked_bank(pending)}
        out.pop("bankChangeHistory", None)
        return out
    # TEAM (or anything else): no pay, bank, statutory or medical data
    for key in TEAM_HIDDEN_FIELDS:
        out.pop(key, None)
    out["sensitiveAccess"] = "NONE"
    return out


def directory_entry(emp: dict) -> dict:
    return {k: emp.get(k) for k in DIRECTORY_FIELDS if emp.get(k) is not None}


def mask_for_log(field: str, value):
    """Audit entries never store full identifiers."""
    if value in (None, ""):
        return value
    if field in ("panNumber",):
        return mask_pan(value)
    if field in ("aadhaarNumber", "uanNumber", "esiNumber", "accountNumber"):
        return mask_tail(value)
    return value


# ---------------------------------------------------------- reporting lines

def creates_reporting_cycle(emp_id: str, new_manager_id: Optional[str]) -> bool:
    """True if making new_manager_id the manager of emp_id would loop back to emp_id."""
    if not new_manager_id:
        return False
    if new_manager_id == emp_id:
        return True
    seen = set()
    current = new_manager_id
    while current and current not in seen:
        if current == emp_id:
            return True
        seen.add(current)
        mgr = db_store.employees.get(current)
        current = mgr.get("reportingManagerId") if mgr else None
    return False


def creator_user_id(emp: dict) -> Optional[str]:
    """Who created this employee record (for maker-checker rules). Older records carry no
    createdByUserId, so fall back to the audit trail."""
    if emp.get("createdByUserId"):
        return emp["createdByUserId"]
    for log in db_store.auditLogs:
        if log.get("entityId") == emp["_id"] and log.get("action") in ("EMPLOYEE_CREATED", "ONBOARDING_EMPLOYEE_CREATED"):
            return log.get("userId")
        if log.get("action") == "CANDIDATE_HIRED" and (log.get("details") or {}).get("employeeId") == emp["_id"]:
            return log.get("userId")
    return None
