"""
Approved salary revisions with an effective date (e.g. appraisal increments).

An employee record can carry `salaryRevisions`: [{effectiveFrom, oldSalary, newSalary, status,
approvedBy, ...}]. Only APPROVED revisions count. Payroll asks `salary_for_month` which CTC
applies to a given month, so an increment is paid from its effective month onwards and never
before it is approved. `apply_due_revisions` moves `annualSalary` to the new figure once the
effective date has arrived, so the rest of the app shows the current CTC.
"""

import calendar
from typing import Optional

from app.stores.db_store import db_store
from app.utils.jsutil import now_iso, today_str


def approved_revisions(emp: dict) -> list:
    revs = [r for r in emp.get("salaryRevisions") or [] if r.get("status") == "APPROVED" and r.get("effectiveFrom")]
    return sorted(revs, key=lambda r: r["effectiveFrom"])


def _month_end(month_str: str) -> str:
    year, month = (int(x) for x in month_str[:7].split("-"))
    return f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def salary_for_month(emp: dict, month_str: str) -> Optional[float]:
    """Annual CTC to pay for the month `YYYY-MM`."""
    revs = approved_revisions(emp)
    if not revs:
        return emp.get("annualSalary")
    month_end = _month_end(month_str)
    future = [r for r in revs if r["effectiveFrom"] > month_end]
    if future:
        return future[0].get("oldSalary")
    return revs[-1].get("newSalary")


def apply_due_revisions(today: Optional[str] = None) -> list:
    """Make approved revisions whose effective date has arrived the employee's current CTC."""
    today = today or today_str()
    applied = []
    for emp in db_store.employees.values():
        for rev in approved_revisions(emp):
            if rev["effectiveFrom"] <= today and not rev.get("appliedOn"):
                emp["annualSalary"] = rev.get("newSalary")
                rev["appliedOn"] = now_iso()
                applied.append(emp["_id"])
    return applied
