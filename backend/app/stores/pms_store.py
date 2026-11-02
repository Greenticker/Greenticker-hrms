"""
In-memory store for the Performance Management System (PMS).

Collections follow sheet 6_Data_Tables of the PMS brief. Goal lines are kept inside
their goal sheet (one document per sheet) and every locked version is kept in the
sheet's history. Reference data (KPI library, competencies, default template,
increment table) is seeded on first use rather than in __init__, because the
persistence layer replaces every bound collection with what is stored on startup.
"""

import re
from datetime import date
from typing import Optional

from app.stores.db_store import db_store
from app.utils.jsutil import now_iso, now_ms, rand_base36

GOAL_STATUSES = ("DRAFT", "SUBMITTED", "APPROVED", "LOCKED")
DIRECTIONS = ("HIGHER", "LOWER")

# Sheet 1_Overview: goal weight rules
MIN_LINES, MAX_LINES = 3, 8
MIN_WEIGHT, MAX_WEIGHT = 5, 40
COMPLIANCE_KRA = "Compliance (mandatory)"
COMPLIANCE_MIN_WEIGHT = 10

# Sheet 5_Sample_KPIs: (department, KRA, KPI, unit, direction)
SAMPLE_KPIS = [
    ("Sales", "Business growth", "Gross sales", "₹ Cr", "HIGHER"),
    ("Sales", "Business growth", "Net sales (sales – redemptions)", "₹ Cr", "HIGHER"),
    ("Sales", "Business growth", "New SIP registrations", "₹ Cr", "HIGHER"),
    ("Sales", "Distribution", "New active distributors", "Count", "HIGHER"),
    ("Fund Management", "Fund performance", "Return vs benchmark", "%", "HIGHER"),
    ("Fund Management", "Risk", "Investment limit breaches", "Count", "LOWER"),
    ("Research", "Research quality", "Correct recommendations", "%", "HIGHER"),
    ("Operations", "Accuracy", "NAV errors", "Count", "LOWER"),
    ("Operations", "Timeliness", "NAV declared on time", "%", "HIGHER"),
    ("Investor Services", "Service", "Complaint resolution time", "Days", "LOWER"),
    ("Compliance", "Regulatory", "Filings on time", "%", "HIGHER"),
    ("Finance", "Control", "Days to close monthly books", "Days", "LOWER"),
    ("HR", "Retention", "Attrition", "%", "LOWER"),
    ("IT", "Systems", "System uptime", "%", "HIGHER"),
    ("All", COMPLIANCE_KRA, "Mandatory training completion", "%", "HIGHER"),
]

SAMPLE_COMPETENCIES = [
    ("Integrity & Compliance", "ALL"),
    ("Customer Focus", "ALL"),
    ("Ownership & Delivery", "ALL"),
    ("Teamwork & Communication", "ALL"),
    ("Job Knowledge", "ALL"),
    ("People Management", "MANAGERS"),
]

# Draft 360° questions (2 per competency). The brief asks for 12 but does not list them;
# HR can replace them under Setup.
SAMPLE_QUESTIONS_360 = [
    ("Integrity & Compliance", "Acts with honesty and integrity, even when it is inconvenient."),
    ("Integrity & Compliance", "Follows policies, regulations and internal controls without needing reminders."),
    ("Customer Focus", "Understands what internal or external customers need and responds to it."),
    ("Customer Focus", "Resolves customer issues promptly and follows them through to closure."),
    ("Ownership & Delivery", "Takes ownership of their work and delivers on commitments on time."),
    ("Ownership & Delivery", "Raises problems early and proposes solutions instead of waiting to be told."),
    ("Teamwork & Communication", "Works well with colleagues across teams and shares information openly."),
    ("Teamwork & Communication", "Communicates clearly and listens to other people's views."),
    ("Job Knowledge", "Has the knowledge and skills needed to do their job well."),
    ("Job Knowledge", "Keeps their knowledge up to date and uses it to improve results."),
    ("People Management", "Gives their team clear direction and regular, useful feedback."),
    ("People Management", "Develops team members and treats everyone fairly."),
]

# Check-in periods (sheet 3_Workflow steps 5-6); key -> cycle phase key
CHECKIN_PERIODS = [
    ("Q1", "Q1 check-in", "checkin_q1"),
    ("Q2", "Q2 check-in", "checkin_q2"),
    ("MID_YEAR", "Mid-year review", "mid_year"),
    ("Q3", "Q3 check-in", "checkin_q3"),
]

GROUPS_360 = ("MANAGER", "PEER", "TEAM", "OTHER_DEPT")
MAX_RATERS_360 = 20

# Sheet 4_Calculations: rating -> increment % and bonus multiplier
DEFAULT_INCREMENT_TABLE = [
    {"rating": 5, "incrementPct": 14, "bonusMultiplier": 1.5},
    {"rating": 4, "incrementPct": 10, "bonusMultiplier": 1.25},
    {"rating": 3, "incrementPct": 7, "bonusMultiplier": 1.0},
    {"rating": 2, "incrementPct": 3, "bonusMultiplier": 0.5},
    {"rating": 1, "incrementPct": 0, "bonusMultiplier": 0},
]

# Sheet 3_Workflow: (key, label, start (month, day), end (month, day), +1 year?)
PHASE_DEFAULTS = [
    ("goal_setting", "Goal setting", (4, 1), (4, 30), False),
    ("checkin_q1", "Q1 check-in", (6, 1), (6, 30), False),
    ("checkin_q2", "Q2 check-in", (9, 1), (9, 30), False),
    ("mid_year", "Mid-year review", (10, 1), (10, 31), False),
    ("checkin_q3", "Q3 check-in", (12, 1), (12, 31), False),
    ("raters_360", "Nominate 360° raters", (1, 1), (1, 15), True),
    ("feedback_360", "360° feedback", (1, 16), (1, 31), True),
    ("actuals", "Final KPI actuals", (3, 25), (3, 31), True),
    ("self_appraisal", "Self appraisal", (4, 1), (4, 10), True),
    ("manager_appraisal", "Manager appraisal", (4, 11), (4, 20), True),
    ("reviewer_approval", "Reviewer approval", (4, 21), (4, 30), True),
    ("calibration", "Calibration", (5, 1), (5, 15), True),
    ("publish", "Publish ratings", (5, 16), (5, 31), True),
    ("payroll", "Send to payroll", (6, 1), (6, 15), True),
]

_BAND_RE = re.compile(r"\bL\d+\b", re.IGNORECASE)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{now_ms()}_{rand_base36(5)}"


def stamp(doc: dict, user: dict, created: bool = False) -> dict:
    """created_by / updated_by columns required on every PMS table (sheet 6)."""
    now = now_iso()
    if created:
        doc["createdBy"] = user.get("_id")
        doc["createdOn"] = now
    doc["updatedBy"] = user.get("_id")
    doc["updatedOn"] = now
    return doc


def default_phases(start_year: int) -> list:
    out = []
    for key, label, (sm, sd), (em, ed), next_year in PHASE_DEFAULTS:
        y = start_year + (1 if next_year else 0)
        out.append({
            "key": key,
            "label": label,
            "start": date(y, sm, sd).isoformat(),
            "end": date(y, em, ed).isoformat(),
        })
    return out


class PmsStore:
    def __init__(self) -> None:
        self.pmsCycles: dict = {}
        self.pmsTemplates: dict = {}
        self.pmsKpiLibrary: dict = {}
        self.pmsCompetencies: dict = {}
        self.pmsGoalSheets: dict = {}
        self.pmsSettings: dict = {}
        # Phase 2
        self.pmsCheckins: dict = {}
        self.pms360Questions: dict = {}
        self.pms360Nominations: dict = {}
        self.pms360Assignments: dict = {}
        # Kept apart from assignments and without rater ids, so answers stay anonymous
        self.pms360Responses: dict = {}
        # Phase 3
        self.pmsAppraisals: dict = {}
        self.pmsPips: dict = {}
        # Phase 4
        self.pmsNotes: dict = {}

    def appraisal_for(self, employee_id: str, cycle_id: str) -> Optional[dict]:
        return next(
            (a for a in self.pmsAppraisals.values() if a["employeeId"] == employee_id and a["cycleId"] == cycle_id),
            None,
        )

    def competencies_for(self, employee_id: str) -> list:
        is_manager = self.has_reports(employee_id)
        return [c for c in self.pmsCompetencies.values() if c.get("appliesTo") != "MANAGERS" or is_manager]

    def increment_table(self) -> list:
        self.ensure_seeded()
        return self.pmsSettings["incrementTable"]["rows"]

    # ------------------------------------------------------------ reference data

    def ensure_seeded(self) -> None:
        if "seeded" in self.pmsSettings:
            return
        now = now_iso()
        system = {"createdBy": "system", "createdOn": now, "updatedBy": "system", "updatedOn": now}
        for dept, kra, kpi, unit, direction in SAMPLE_KPIS:
            kid = _new_id("kpi")
            self.pmsKpiLibrary[kid] = {
                "_id": kid, "department": dept, "kra": kra, "kpi": kpi, "unit": unit,
                "direction": direction, "mandatory": kra == COMPLIANCE_KRA, **system,
            }
        for name, applies_to in SAMPLE_COMPETENCIES:
            cid = _new_id("comp")
            self.pmsCompetencies[cid] = {
                "_id": cid, "name": name, "description": "", "appliesTo": applies_to, **system,
            }
        tid = _new_id("tmpl")
        self.pmsTemplates[tid] = {
            "_id": tid, "name": "Standard", "grades": [], "isDefault": True,
            "kpiWeight": 70, "competencyWeight": 20, "feedback360Weight": 10, **system,
        }
        self.pmsSettings["incrementTable"] = {"_id": "incrementTable", "rows": DEFAULT_INCREMENT_TABLE, **system}
        self.pmsSettings["seeded"] = {"_id": "seeded", "at": now}

    def ensure_seeded_360(self) -> None:
        """Phase 2 reference data; separate marker so phase-1 installs get it too."""
        self.ensure_seeded()
        if "seeded360" in self.pmsSettings:
            return
        now = now_iso()
        by_name = {c.get("name"): c["_id"] for c in self.pmsCompetencies.values()}
        for order, (competency, text) in enumerate(SAMPLE_QUESTIONS_360, 1):
            if competency not in by_name:
                continue
            qid = _new_id("q360")
            self.pms360Questions[qid] = {
                "_id": qid, "competencyId": by_name[competency], "text": text, "order": order,
                "createdBy": "system", "createdOn": now, "updatedBy": "system", "updatedOn": now,
            }
        self.pmsSettings["seeded360"] = {"_id": "seeded360", "at": now}

    def questions_for(self, ratee_id: str) -> list:
        """Questions that apply to a ratee (people-management ones only for managers)."""
        is_manager = self.has_reports(ratee_id)
        out = []
        for q in sorted(self.pms360Questions.values(), key=lambda q: q.get("order") or 0):
            comp = self.pmsCompetencies.get(q.get("competencyId"))
            if not comp or (comp.get("appliesTo") == "MANAGERS" and not is_manager):
                continue
            out.append({**q, "competencyName": comp.get("name")})
        return out

    def group_360(self, ratee_id: str, rater_id: str) -> str:
        """Rater group worked out from the org chart, so nobody can mislabel a rater."""
        if rater_id == self.manager_id(ratee_id):
            return "MANAGER"
        if self.manager_id(rater_id) == ratee_id:
            return "TEAM"
        ratee, rater = self.employee(ratee_id) or {}, self.employee(rater_id) or {}
        if ratee.get("department") and ratee.get("department") == rater.get("department"):
            return "PEER"
        return "OTHER_DEPT"

    def user_for_employee(self, employee_id: Optional[str]) -> Optional[dict]:
        return next((u for u in db_store.users.values() if employee_id and u.get("employeeId") == employee_id), None)

    # ------------------------------------------------------------------ people

    def employee(self, employee_id: Optional[str]) -> Optional[dict]:
        return db_store.employees.get(employee_id) if employee_id else None

    def employee_name(self, employee_id: Optional[str]) -> str:
        emp = self.employee(employee_id)
        if not emp:
            return ""
        return f"{emp.get('firstName', '')} {emp.get('lastName', '')}".strip()

    def manager_id(self, employee_id: Optional[str]) -> Optional[str]:
        emp = self.employee(employee_id)
        return emp.get("reportingManagerId") if emp else None

    def grade_of(self, employee_id: Optional[str]) -> Optional[str]:
        """Grade = the band (L1, L4, ...) of the employee's designation, if it has one."""
        emp = self.employee(employee_id)
        if not emp:
            return None
        title = (emp.get("designation") or "").strip().lower()
        for d in db_store.designations.values():
            if (d.get("title") or "").strip().lower() == title:
                match = _BAND_RE.search(d.get("level") or "")
                return match.group(0).upper() if match else None
        return None

    def has_reports(self, employee_id: Optional[str]) -> bool:
        return bool(employee_id) and any(
            e.get("reportingManagerId") == employee_id for e in db_store.employees.values()
        )

    # ------------------------------------------------------------------ cycles

    def active_cycle(self) -> Optional[dict]:
        return next((c for c in self.pmsCycles.values() if c.get("status") == "ACTIVE"), None)

    # --------------------------------------------------------------- templates

    def template_for_grade(self, grade: Optional[str]) -> Optional[dict]:
        if grade:
            for t in self.pmsTemplates.values():
                if grade in (t.get("grades") or []):
                    return t
        return next((t for t in self.pmsTemplates.values() if t.get("isDefault")), None)

    # ------------------------------------------------------------- goal sheets

    def sheet_for(self, employee_id: str, cycle_id: str) -> Optional[dict]:
        return next(
            (s for s in self.pmsGoalSheets.values()
             if s.get("employeeId") == employee_id and s.get("cycleId") == cycle_id),
            None,
        )

    def create_sheet(self, employee_id: str, cycle: dict, user: dict) -> dict:
        manager = self.manager_id(employee_id)
        sid = _new_id("goals")
        sheet = {
            "_id": sid,
            "employeeId": employee_id,
            "cycleId": cycle["_id"],
            "managerId": manager,
            "reviewerId": self.manager_id(manager),
            "status": "DRAFT",
            "version": 1,
            "lines": [],
            "history": [],
            "trail": [],
        }
        self.pmsGoalSheets[sid] = stamp(sheet, user, created=True)
        return sheet


pms_store = PmsStore()


def validate_lines(lines: list) -> list:
    """Goal weight rules from sheet 1_Overview. Returns a list of problems (empty = OK)."""
    errors = []
    if not MIN_LINES <= len(lines) <= MAX_LINES:
        errors.append(f"Add between {MIN_LINES} and {MAX_LINES} KPIs (currently {len(lines)}).")
    for i, line in enumerate(lines, 1):
        label = line.get("kpi") or f"KPI {i}"
        if not (line.get("kra") and line.get("kpi") and line.get("unit")):
            errors.append(f"{label}: KRA, KPI and unit are required.")
        if line.get("direction") not in DIRECTIONS:
            errors.append(f"{label}: choose whether higher or lower is better.")
        target = line.get("target")
        if not isinstance(target, (int, float)) or target <= 0:
            errors.append(f"{label}: target must be a number above 0.")
        weight = line.get("weight")
        if not isinstance(weight, (int, float)) or not MIN_WEIGHT <= weight <= MAX_WEIGHT:
            errors.append(f"{label}: weight must be between {MIN_WEIGHT}% and {MAX_WEIGHT}%.")
    total = sum(line.get("weight") or 0 for line in lines if isinstance(line.get("weight"), (int, float)))
    if lines and abs(total - 100) > 1e-6:
        errors.append(f"Weights must add up to 100% (currently {total:g}%).")
    compliance = sum(
        line.get("weight") or 0 for line in lines
        if (line.get("kra") or "").strip().lower() == COMPLIANCE_KRA.lower()
    )
    if compliance < COMPLIANCE_MIN_WEIGHT:
        errors.append(f'Every goal sheet needs the "{COMPLIANCE_KRA}" KRA at {COMPLIANCE_MIN_WEIGHT}% or more.')
    return errors
