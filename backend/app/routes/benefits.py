"""Employee benefits: group insurance policies (GMC / GPA / GTL / top-up) with grade eligibility,
auto-enrolment of joiners, dependents (enrolment window, limits, age rules, life events with HR
verification), e-cards, top-up premium via payroll, claim intimation, and coverage end on exit.

Matrix: HR full; Admin / Super Admin configure; Finance records premium payments (cannot change
cover); Accounts sees premium accounting; Auditors read; employees see only their own; managers
have no access to medical data."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import DOCUMENTS, audit, read_body, read_fields_and_files, save_upload
from app.stores.db_store import db_store
from app.stores.modules_store import modules_store
from app.utils.jsutil import js_str, now_iso, now_ms, rand_base36, today_str
from app.utils.workflow import actor_name, add_payroll_input, employee_name, my_employee_id, notify_employee, notify_roles, payroll_month_locked

router = APIRouter()

MANAGE = ("HR", "ADMIN", "SUPER_ADMIN", "ADMIN_1")          # create / edit policies
VERIFY = ("HR",)                                            # verify dependents, claims
READ_ALL = ("HR", "ADMIN", "SUPER_ADMIN", "ADMIN_1", "AUDITORS")
PREMIUM = ("FINANCE",)
PREMIUM_READ = ("FINANCE", "ACCOUNTS", "AUDITORS", "HR")
TYPES = ("GMC", "GPA", "GTL", "TOPUP")
RELATIONS = ("SPOUSE", "CHILD", "PARENT", "PARENT_IN_LAW")


def _id(p: str) -> str:
    return f"{p}_{now_ms()}_{rand_base36(4)}"


def _settings() -> dict:
    s = modules_store.benefitSettings.setdefault("settings", {"_id": "settings"})
    s.setdefault("enrollmentWindow", {"open": False, "from": None, "until": None})
    s.setdefault("lifeEventDays", 30)
    return s


def _window_open() -> bool:
    w = _settings()["enrollmentWindow"]
    t = today_str()
    return bool(w.get("open")) and (not w.get("from") or w["from"] <= t) and (not w.get("until") or t <= w["until"])


def _grade(emp: dict) -> str:
    return (emp.get("grade") or emp.get("gradeCode") or "").upper()


def policies() -> dict:
    if not modules_store.benefitPolicies:
        year = int(today_str()[:4])
        defaults = [
            ("GMC", "Group Mediclaim", "Star Health & Allied Insurance", "GMC/2026/001948", 500000, 9000, 5),
            ("GPA", "Group Personal Accident", "ICICI Lombard", "GPA/2026/22871", 1500000, 1200, 0),
            ("GTL", "Group Term Life", "HDFC Life", "GTL/2026/77120", 2000000, 2400, 0),
            ("TOPUP", "Parental Top-up Cover", "Star Health & Allied Insurance", "TOP/2026/0041", 300000, 7200, 2),
        ]
        for t, name, insurer, no, si, prem, maxdep in defaults:
            pid = f"benpol_{t.lower()}"
            modules_store.benefitPolicies[pid] = {
                "_id": pid, "type": t, "name": name, "insurer": insurer, "policyNumber": no, "sumInsured": si,
                "premiumAnnual": prem, "validFrom": f"{year}-04-01" if today_str() >= f"{year}-04-01" else f"{year - 1}-04-01",
                "validTo": f"{year + 1}-03-31" if today_str() >= f"{year}-04-01" else f"{year}-03-31",
                "eligibleGrades": [], "maxDependents": maxdep, "allowedRelations": ["PARENT", "PARENT_IN_LAW"] if t == "TOPUP" else (list(RELATIONS) if t == "GMC" else []),
                "childMaxAge": 25, "parentMaxAge": 80, "optional": t == "TOPUP", "active": True, "createdBy": "System default", "createdAt": now_iso()}
    return modules_store.benefitPolicies


def _eligible(policy: dict, emp: dict) -> bool:
    return policy.get("active", True) and (not policy.get("eligibleGrades") or _grade(emp) in policy["eligibleGrades"])


def _key(emp_id: str, pid: str) -> str:
    return f"{emp_id}:{pid}"


def auto_enroll(emp: dict) -> list:
    """Enrol an employee in every mandatory policy they are eligible for, from the joining date."""
    out = []
    if (emp.get("status") or "ACTIVE").upper() in ("TERMINATED", "EXITED", "INACTIVE"):
        return out
    for p in policies().values():
        k = _key(emp["_id"], p["_id"])
        if p.get("optional") or not _eligible(p, emp) or k in modules_store.benefitEnrollments:
            continue
        start = max((emp.get("joiningDate") or today_str())[:10], p["validFrom"])
        doc = {"_id": k, "employeeId": emp["_id"], "employeeName": employee_name(emp["_id"]), "employeeCode": emp.get("employeeCode"),
               "policyId": p["_id"], "policyType": p["type"], "coverageStart": start, "coverageEnd": p["validTo"], "status": "ACTIVE",
               "sumInsured": p["sumInsured"], "eCardNumber": f"{p['type']}-{emp.get('employeeCode') or emp['_id'][-6:]}-{p['policyNumber'][-4:]}",
               "dependents": [], "enrolledAt": now_iso(), "enrolledBy": "AUTO (joiner)"}
        # bring over dependents from the old single-policy enrolment
        legacy = modules_store.insuranceEnrollments.get(emp["_id"]) if p["type"] == "GMC" else None
        for d in (legacy or {}).get("dependents") or []:
            rel = (d.get("relation") or "").upper()
            rel = {"FATHER": "PARENT", "MOTHER": "PARENT", "SON": "CHILD", "DAUGHTER": "CHILD", "WIFE": "SPOUSE", "HUSBAND": "SPOUSE"}.get(rel, rel)
            doc["dependents"].append({"_id": _id("dep"), "name": d.get("name"), "relation": rel if rel in RELATIONS else "CHILD", "dob": d.get("dob"),
                                      "gender": d.get("gender"), "status": "ACTIVE", "addedVia": "MIGRATED", "addedAt": now_iso()})
        modules_store.benefitEnrollments[k] = doc
        out.append(doc)
    return out


def end_coverage(emp_id: str, end: str, user: Optional[dict] = None) -> list:
    ended = []
    for e in modules_store.benefitEnrollments.values():
        if e["employeeId"] == emp_id and e["status"] in ("ACTIVE", "ENDING"):
            e.update({"coverageEnd": end[:10], "status": "ENDING" if end[:10] >= today_str() else "ENDED", "endReason": "EXIT"})
            ended.append(e["_id"])
    if user and ended:
        audit(user, "BENEFITS_COVERAGE_ENDED", "BENEFITS", "Employee", emp_id, {"coverageEnd": end[:10], "enrollments": ended})
    return ended


def _age(dob: str, on: str) -> int:
    b, o = date.fromisoformat(dob[:10]), date.fromisoformat(on[:10])
    return o.year - b.year - ((o.month, o.day) < (b.month, b.day))


def _view(e: dict, user: dict) -> dict:
    p = policies().get(e["policyId"]) or {}
    deps = [{**d, "canVerify": d["status"] == "PENDING_VERIFICATION" and user.get("role") in VERIFY and e["employeeId"] != my_employee_id(user)}
            for d in e.get("dependents") or []]
    status = e["status"]
    if status == "ENDING" and e["coverageEnd"] < today_str():
        status = e["status"] = "ENDED"
    return {**e, "status": status, "dependents": deps, "policy": {k: p.get(k) for k in ("name", "type", "insurer", "policyNumber", "validFrom", "validTo",
                                                                                          "maxDependents", "allowedRelations", "childMaxAge", "parentMaxAge")}}


# ------------------------------------------------------------------ policies

@router.get("/benefits/policies")
async def list_policies(user: dict = Depends(require_auth)):
    return {"policies": sorted(policies().values(), key=lambda p: p["type"]), "settings": _settings(), "windowOpen": _window_open(),
            "canManage": user.get("role") in MANAGE}


@router.post("/benefits/policies")
@router.put("/benefits/policies/{pid}")
async def save_policy(request: Request, pid: Optional[str] = None, user: dict = Depends(require_role(*MANAGE))):
    b = await read_body(request)
    existing = policies().get(pid) if pid else None
    if pid and not existing:
        raise ApiError(404, "Policy not found.")
    errors = []
    t = js_str(b.get("type") or (existing or {}).get("type") or "").upper()
    if t not in TYPES:
        errors.append(f"Type must be one of {', '.join(TYPES)}.")
    for f in ("name", "insurer", "policyNumber"):
        if not js_str(b.get(f) or (existing or {}).get(f) or "").strip():
            errors.append(f"{f} is required.")
    try:
        si = float(b.get("sumInsured", (existing or {}).get("sumInsured")))
        prem = float(b.get("premiumAnnual", (existing or {}).get("premiumAnnual")))
        vf = date.fromisoformat(js_str(b.get("validFrom") or (existing or {}).get("validFrom"))[:10]).isoformat()
        vt = date.fromisoformat(js_str(b.get("validTo") or (existing or {}).get("validTo"))[:10]).isoformat()
    except (TypeError, ValueError):
        raise ApiError(400, "Give sum insured, premium and validity dates (YYYY-MM-DD).")
    if si <= 0 or prem < 0:
        errors.append("Sum insured must be above zero and premium not negative.")
    if vt <= vf:
        errors.append("Valid-to must be after valid-from.")
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "Please fix the policy.", errors=errors)
    doc = {**(existing or {}), "_id": pid or _id("benpol"), "type": t, "name": js_str(b.get("name") or existing["name"]).strip(),
           "insurer": js_str(b.get("insurer") or existing["insurer"]).strip(), "policyNumber": js_str(b.get("policyNumber") or existing["policyNumber"]).strip(),
           "sumInsured": si, "premiumAnnual": prem, "validFrom": vf, "validTo": vt,
           "eligibleGrades": [js_str(g).strip().upper() for g in (b.get("eligibleGrades") if "eligibleGrades" in b else (existing or {}).get("eligibleGrades") or []) if js_str(g).strip()],
           "maxDependents": int(b.get("maxDependents", (existing or {}).get("maxDependents", 5)) or 0),
           "allowedRelations": [r for r in (b.get("allowedRelations") or (existing or {}).get("allowedRelations") or list(RELATIONS)) if r in RELATIONS],
           "childMaxAge": int(b.get("childMaxAge", (existing or {}).get("childMaxAge", 25))),
           "parentMaxAge": int(b.get("parentMaxAge", (existing or {}).get("parentMaxAge", 80))),
           "optional": bool(b.get("optional", (existing or {}).get("optional", t == "TOPUP"))), "active": b.get("active", True) is not False,
           "updatedBy": actor_name(user), "updatedAt": now_iso()}
    doc.setdefault("createdBy", actor_name(user))
    policies()[doc["_id"]] = doc
    changes = [{"field": k, "oldValue": (existing or {}).get(k), "newValue": doc[k]} for k in ("sumInsured", "premiumAnnual", "validTo", "eligibleGrades")
               if existing and existing.get(k) != doc[k]]
    audit(user, "BENEFIT_POLICY_UPDATED" if existing else "BENEFIT_POLICY_CREATED", "BENEFITS", "BenefitPolicy", doc["_id"], {"name": doc["name"], "changes": changes})
    if not existing and not doc["optional"]:
        for emp in db_store.employees.values():
            auto_enroll(emp)
    return JSONResponse({"policy": doc}, status_code=200 if existing else 201)


@router.put("/benefits/settings")
async def save_settings(request: Request, user: dict = Depends(require_role(*MANAGE))):
    b = await read_body(request)
    s = _settings()
    old = dict(s["enrollmentWindow"])
    w = b.get("enrollmentWindow") or {}
    s["enrollmentWindow"] = {"open": bool(w.get("open")), "from": js_str(w.get("from") or "")[:10] or None, "until": js_str(w.get("until") or "")[:10] or None}
    if "lifeEventDays" in b:
        s["lifeEventDays"] = max(1, int(b["lifeEventDays"]))
    audit(user, "BENEFIT_SETTINGS_UPDATED", "BENEFITS", "BenefitSettings", "settings",
          {"changes": [{"field": "enrollmentWindow", "oldValue": old, "newValue": s["enrollmentWindow"]}]})
    return {"settings": s, "windowOpen": _window_open()}


# ------------------------------------------------------------------ employee self-service

@router.get("/benefits/me")
async def my_benefits(user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    auto_enroll(db_store.employees[me])
    rows = [_view(e, user) for e in modules_store.benefitEnrollments.values() if e["employeeId"] == me]
    optional = [p for p in policies().values() if p.get("optional") and _eligible(p, db_store.employees[me])
                and _key(me, p["_id"]) not in modules_store.benefitEnrollments]
    return {"enrollments": rows, "optionalPolicies": optional, "windowOpen": _window_open(), "settings": _settings()}


@router.post("/benefits/me/dependents")
async def add_dependent(request: Request, user: dict = Depends(require_auth)):
    ctype = request.headers.get("content-type") or ""
    if "multipart" in ctype:
        b, files = await read_fields_and_files(request)
        proof = (files.get("proof") or [None])[0]
    else:
        b, proof = await read_body(request), None
    me = my_employee_id(user)
    e = modules_store.benefitEnrollments.get(_key(me or "", b.get("policyId") or ""))
    if not e or e["status"] not in ("ACTIVE",):
        raise ApiError(404, "You are not enrolled in this policy.")
    p = policies()[e["policyId"]]
    name, rel = js_str(b.get("name") or "").strip(), js_str(b.get("relation") or "").upper()
    try:
        dob = date.fromisoformat(js_str(b.get("dob") or "")[:10]).isoformat()
    except ValueError:
        raise ApiError(400, "Date of birth must be YYYY-MM-DD.")
    life_event = js_str(b.get("lifeEvent") or "").upper() or None      # BIRTH | MARRIAGE | ADOPTION
    errors = []
    if not name:
        errors.append("Dependent name is required.")
    if rel not in p.get("allowedRelations", []):
        errors.append(f"{p['name']} covers: {', '.join(p.get('allowedRelations') or []) or 'the employee only'}.")
    active = [d for d in e["dependents"] if d["status"] != "REJECTED"]
    if len(active) >= (p.get("maxDependents") or 0):
        errors.append(f"{p['name']} allows at most {p.get('maxDependents')} dependent(s).")
    if rel == "SPOUSE" and any(d["relation"] == "SPOUSE" for d in active):
        errors.append("A spouse is already covered.")
    if dob > today_str():
        errors.append("Date of birth cannot be in the future.")
    elif rel == "CHILD" and _age(dob, today_str()) > p.get("childMaxAge", 25):
        errors.append(f"Children are covered up to age {p.get('childMaxAge', 25)}.")
    elif rel in ("PARENT", "PARENT_IN_LAW") and _age(dob, today_str()) > p.get("parentMaxAge", 80):
        errors.append(f"Parents are covered up to age {p.get('parentMaxAge', 80)}.")
    event_date = None
    if not _window_open():
        if not life_event:
            errors.append("The enrolment window is closed. Dependents can be added now only for a life event (birth, marriage, adoption) with proof.")
        else:
            try:
                event_date = date.fromisoformat(js_str(b.get("eventDate") or "")[:10]).isoformat()
            except ValueError:
                errors.append("Give the life-event date.")
            if event_date and (date.fromisoformat(today_str()) - date.fromisoformat(event_date)).days > _settings()["lifeEventDays"]:
                errors.append(f"Life-event changes must be requested within {_settings()['lifeEventDays']} days of the event.")
            if not proof:
                errors.append("Attach proof of the life event (birth / marriage certificate).")
    if errors:
        raise ApiError(400, errors[0] if len(errors) == 1 else "The dependent cannot be added.", errors=errors)
    proof_doc = None
    if proof:
        saved = await save_upload(proof, DOCUMENTS)
        proof_doc = {"fileName": proof.filename, "fileUrl": f"/uploads/documents/{saved['storedFileName']}"}
    dep = {"_id": _id("dep"), "name": name, "relation": rel, "dob": dob, "gender": js_str(b.get("gender") or ""), "status": "PENDING_VERIFICATION",
           "addedVia": "LIFE_EVENT" if life_event and not _window_open() else "WINDOW", "lifeEvent": life_event, "eventDate": event_date,
           "proof": proof_doc, "addedAt": now_iso()}
    e["dependents"].append(dep)
    notify_roles(VERIFY, "Dependent to verify", f"{e['employeeName']}: {name} ({rel.lower()}) in {p['name']}", "BENEFITS", exclude_user_id=user["_id"])
    audit(user, "BENEFIT_DEPENDENT_ADDED", "BENEFITS", "BenefitEnrollment", e["_id"], {"relation": rel, "addedVia": dep["addedVia"]})
    return JSONResponse({"enrollment": _view(e, user)}, status_code=201)


@router.post("/benefits/me/topup")
async def opt_topup(request: Request, user: dict = Depends(require_auth)):
    """Opt into an optional (top-up / parental) cover; the employee pays the premium through payroll."""
    me = my_employee_id(user)
    pid = (await read_body(request)).get("policyId")
    p = policies().get(pid or "")
    if not me or not p or not p.get("optional"):
        raise ApiError(404, "Optional policy not found.")
    emp = db_store.employees[me]
    if not _eligible(p, emp):
        raise ApiError(403, "You are not eligible for this cover.")
    k = _key(me, pid)
    if k in modules_store.benefitEnrollments:
        raise ApiError(409, "You have already opted for this cover.")
    month = today_str()[:7]
    while payroll_month_locked(month):
        y, m = (int(x) for x in month.split("-"))
        month = f"{y + (m == 12)}-{(m % 12) + 1:02d}"
    months = []
    y, m = (int(x) for x in month.split("-"))
    while f"{y}-{m:02d}" <= p["validTo"][:7]:
        months.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    monthly = round(p["premiumAnnual"] / 12, 2)
    for mo in months:
        add_payroll_input(me, mo, "INSURANCE_PREMIUM", amount=monthly, source="BENEFITS", source_id=f"benefit:{k}:{mo}",
                          label=f"{p['name']} premium", by=user)
    doc = {"_id": k, "employeeId": me, "employeeName": employee_name(me), "employeeCode": emp.get("employeeCode"), "policyId": pid, "policyType": p["type"],
           "coverageStart": f"{month}-01", "coverageEnd": p["validTo"], "status": "ACTIVE", "sumInsured": p["sumInsured"], "monthlyPremium": monthly,
           "premiumMonths": months, "eCardNumber": f"{p['type']}-{emp.get('employeeCode')}-{p['policyNumber'][-4:]}", "dependents": [],
           "enrolledAt": now_iso(), "enrolledBy": actor_name(user)}
    modules_store.benefitEnrollments[k] = doc
    audit(user, "BENEFIT_TOPUP_OPTED", "BENEFITS", "BenefitEnrollment", k, {"monthlyPremium": monthly, "months": months})
    return JSONResponse({"enrollment": _view(doc, user)}, status_code=201)


@router.get("/benefits/ecard/{enrollment_id}")
async def ecard(enrollment_id: str, user: dict = Depends(require_auth)):
    e = modules_store.benefitEnrollments.get(enrollment_id)
    if not e:
        raise ApiError(404, "Enrolment not found.")
    if e["employeeId"] != my_employee_id(user) and user.get("role") not in VERIFY:
        raise ApiError(403, "Access denied: you can only download your own e-card.")
    p = policies()[e["policyId"]]
    return {"ecard": {"cardNumber": e["eCardNumber"], "insurer": p["insurer"], "policyNumber": p["policyNumber"], "policyName": p["name"],
                      "member": e["employeeName"], "employeeCode": e["employeeCode"], "sumInsured": e["sumInsured"],
                      "validFrom": e["coverageStart"], "validTo": e["coverageEnd"],
                      "dependents": [{"name": d["name"], "relation": d["relation"], "dob": d["dob"]} for d in e["dependents"] if d["status"] == "ACTIVE"]}}


# ------------------------------------------------------------------ HR

@router.get("/benefits/enrollments")
async def list_enrollments(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if user.get("role") not in READ_ALL:
        if employeeId and employeeId != me:
            raise ApiError(403, "Access denied: benefits and medical details are visible only to the employee and HR.")
        employeeId = me
    rows = [e for e in modules_store.benefitEnrollments.values() if not employeeId or e["employeeId"] == employeeId]
    return {"enrollments": [_view(e, user) for e in sorted(rows, key=lambda e: (e["employeeName"] or "", e["policyType"]))]}


@router.post("/benefits/enrollments/{emp_id}/{pid}/dependents/{dep_id}/verify")
async def verify_dependent(emp_id: str, pid: str, dep_id: str, request: Request, user: dict = Depends(require_role(*VERIFY))):
    if emp_id == my_employee_id(user):
        raise ApiError(403, "You cannot verify your own dependents; another HR user must do it.")
    e = modules_store.benefitEnrollments.get(_key(emp_id, pid))
    d = next((x for x in (e or {}).get("dependents") or [] if x["_id"] == dep_id), None)
    if not d:
        raise ApiError(404, "Dependent not found.")
    if d["status"] != "PENDING_VERIFICATION":
        raise ApiError(409, "This dependent has already been verified.")
    b = await read_body(request)
    decision, comment = b.get("decision"), js_str(b.get("comment") or "").strip()
    if decision not in ("ACTIVE", "REJECTED", "APPROVED"):
        raise ApiError(400, "Decision must be APPROVED or REJECTED.")
    if decision == "REJECTED" and not comment:
        raise ApiError(400, "Give the reason for rejecting.")
    d.update({"status": "REJECTED" if decision == "REJECTED" else "ACTIVE", "verifiedBy": actor_name(user), "verifiedAt": now_iso(), "comment": comment,
              "coveredFrom": max(d.get("eventDate") or today_str(), e["coverageStart"]) if decision != "REJECTED" else None})
    notify_employee(emp_id, f"Dependent {d['status'].lower()}", f"{d['name']} in {policies()[pid]['name']}{': ' + comment if comment else ''}", "BENEFITS")
    audit(user, f"BENEFIT_DEPENDENT_{d['status']}", "BENEFITS", "BenefitEnrollment", e["_id"], {"dependent": d["name"], "comment": comment})
    return {"enrollment": _view(e, user)}


@router.get("/benefits/enrollments/{emp_id}/{pid}/dependents/{dep_id}/proof")
async def dependent_proof(emp_id: str, pid: str, dep_id: str, user: dict = Depends(require_auth)):
    from app.routes.common import stored_file_response
    if emp_id != my_employee_id(user) and user.get("role") not in VERIFY:
        raise ApiError(403, "Access denied.")
    e = modules_store.benefitEnrollments.get(_key(emp_id, pid))
    d = next((x for x in (e or {}).get("dependents") or [] if x["_id"] == dep_id), None)
    proof = (d or {}).get("proof") or {}
    resp = await stored_file_response(DOCUMENTS, proof.get("fileUrl", "").rsplit("/", 1)[-1], proof.get("fileName"), inline=True) if proof else None
    if not resp:
        raise ApiError(404, "No proof attached.")
    return resp


@router.post("/benefits/exit/{emp_id}")
async def process_exit(emp_id: str, request: Request, user: dict = Depends(require_role(*VERIFY))):
    emp = db_store.employees.get(emp_id)
    if not emp:
        raise ApiError(404, "Employee not found.")
    end = js_str((await read_body(request)).get("coverageEnd") or emp.get("lastWorkingDay") or today_str())[:10]
    ended = end_coverage(emp_id, end, user)
    return {"ended": ended, "coverageEnd": end}


@router.get("/benefits/insurer-file")
async def insurer_file(kind: str = "deletion", month: Optional[str] = None, policyId: Optional[str] = None, user: dict = Depends(require_role(*VERIFY, "AUDITORS"))):
    """Additions (coverage starting) or deletions (coverage ending) in a month, one row per life."""
    month = month or today_str()[:7]
    rows = []
    for e in modules_store.benefitEnrollments.values():
        if policyId and e["policyId"] != policyId:
            continue
        p = policies().get(e["policyId"]) or {}
        if kind == "deletion" and e["status"] in ("ENDING", "ENDED") and e["coverageEnd"][:7] == month:
            lives = [("SELF", e["employeeName"], None)] + [(d["relation"], d["name"], d["dob"]) for d in e["dependents"] if d["status"] == "ACTIVE"]
            rows += [{"policyNumber": p.get("policyNumber"), "employeeCode": e["employeeCode"], "relation": r, "name": n, "dob": dob,
                      "effectiveDate": e["coverageEnd"], "action": "DELETE"} for r, n, dob in lives]
        elif kind == "addition":
            if e["coverageStart"][:7] == month:
                rows.append({"policyNumber": p.get("policyNumber"), "employeeCode": e["employeeCode"], "relation": "SELF", "name": e["employeeName"],
                             "dob": (db_store.employees.get(e["employeeId"]) or {}).get("dob"), "effectiveDate": e["coverageStart"], "action": "ADD"})
            rows += [{"policyNumber": p.get("policyNumber"), "employeeCode": e["employeeCode"], "relation": d["relation"], "name": d["name"], "dob": d["dob"],
                      "effectiveDate": d.get("coveredFrom"), "action": "ADD"} for d in e["dependents"]
                     if d["status"] == "ACTIVE" and (d.get("coveredFrom") or "")[:7] == month]
    audit(user, "INSURER_FILE_GENERATED", "BENEFITS", "BenefitEnrollment", kind, {"month": month, "lives": len(rows)})
    return {"kind": kind, "month": month, "rows": rows}


# ------------------------------------------------------------------ claims

def _claim_visible(c: dict, user: dict) -> bool:
    return c["employeeId"] == my_employee_id(user) or user.get("role") in ("HR", "AUDITORS")


@router.get("/benefits/claims")
async def list_claims(employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    if employeeId and employeeId != my_employee_id(user) and user.get("role") not in ("HR", "AUDITORS"):
        raise ApiError(403, "Access denied: claims are visible only to the employee and HR.")
    old = [{**c, "_legacy": True} for c in modules_store.insuranceClaims.values()]
    rows = [c for c in list(modules_store.benefitClaims.values()) + old if _claim_visible(c, user) and (not employeeId or c["employeeId"] == employeeId)]
    return {"claims": sorted(rows, key=lambda c: c.get("submittedAt") or "", reverse=True)}


@router.post("/benefits/claims")
async def intimate_claim(request: Request, user: dict = Depends(require_auth)):
    me = my_employee_id(user)
    if not me:
        raise ApiError(400, "No employee record linked to your login.")
    b = await read_body(request)
    e = modules_store.benefitEnrollments.get(_key(me, b.get("policyId") or "benpol_gmc"))
    if not e or e["status"] not in ("ACTIVE", "ENDING"):
        raise ApiError(400, "You have no active cover under this policy.")
    patient = js_str(b.get("patientName") or "").strip()
    try:
        amount = float(b.get("amountRequested") or b.get("estimatedAmount"))
    except (TypeError, ValueError):
        raise ApiError(400, "Give the estimated claim amount.")
    if not patient or not js_str(b.get("hospitalName") or "").strip():
        raise ApiError(400, "Patient and hospital are required.")
    cid = _id("bclm")
    claim = {"_id": cid, "claimNumber": f"CLM-{today_str()[:4]}-{rand_base36(5).upper()}", "employeeId": me, "employeeName": e["employeeName"],
             "employeeCode": e["employeeCode"], "policyId": e["policyId"], "patientName": patient, "relation": js_str(b.get("relation") or "SELF"),
             "hospitalName": js_str(b["hospitalName"]), "admissionDate": js_str(b.get("admissionDate") or today_str()), "claimType": js_str(b.get("claimType") or "CASHLESS"),
             "amountRequested": amount, "diagnosis": js_str(b.get("diagnosis") or ""), "status": "INTIMATED", "submittedAt": now_iso(),
             "history": [{"status": "INTIMATED", "at": now_iso(), "by": actor_name(user)}]}
    modules_store.benefitClaims[cid] = claim
    notify_roles(VERIFY, "Insurance claim intimated", f"{claim['employeeName']}: {claim['claimNumber']}", "BENEFITS", exclude_user_id=user["_id"])
    audit(user, "INSURANCE_CLAIM_INTIMATED", "BENEFITS", "InsuranceClaim", cid, {"claimNumber": claim["claimNumber"]})
    return JSONResponse({"claim": claim}, status_code=201)


@router.put("/benefits/claims/{cid}/status")
async def update_claim(cid: str, request: Request, user: dict = Depends(require_role(*VERIFY))):
    c = modules_store.benefitClaims.get(cid)
    if not c:
        raise ApiError(404, "Claim not found.")
    if c["employeeId"] == my_employee_id(user):
        raise ApiError(403, "You cannot process your own claim; another HR user must do it.")
    b = await read_body(request)
    status = b.get("status")
    if status not in ("UNDER_REVIEW", "SUBMITTED_TO_TPA", "APPROVED", "SETTLED", "REJECTED"):
        raise ApiError(400, "Invalid status.")
    c.update({"status": status, "remarks": js_str(b.get("remarks") or ""), "amountApproved": b.get("amountApproved", c.get("amountApproved"))})
    c["history"].append({"status": status, "at": now_iso(), "by": actor_name(user), "remarks": c["remarks"]})
    notify_employee(c["employeeId"], "Insurance claim update", f"{c['claimNumber']}: {status.replace('_', ' ').lower()}", "BENEFITS")
    audit(user, "INSURANCE_CLAIM_UPDATED", "BENEFITS", "InsuranceClaim", cid, {"status": status})
    return {"claim": c}


# ------------------------------------------------------------------ premium payments (Finance)

@router.get("/benefits/premium-payments")
async def list_premiums(user: dict = Depends(require_role(*PREMIUM_READ))):
    return {"payments": sorted(modules_store.benefitPremiumPayments.values(), key=lambda p: p["paidAt"], reverse=True)}


@router.post("/benefits/premium-payments")
async def record_premium(request: Request, user: dict = Depends(require_role(*PREMIUM))):
    b = await read_body(request)
    p = policies().get(b.get("policyId") or "")
    if not p:
        raise ApiError(404, "Policy not found.")
    try:
        amount = float(b.get("amount"))
    except (TypeError, ValueError):
        raise ApiError(400, "Amount must be a number.")
    ref = js_str(b.get("reference") or "").strip()
    if amount <= 0 or not ref:
        raise ApiError(400, "Give the amount and the payment reference.")
    pid = _id("prem")
    lives = sum(1 + len([d for d in e["dependents"] if d["status"] == "ACTIVE"]) for e in modules_store.benefitEnrollments.values()
                if e["policyId"] == p["_id"] and e["status"] in ("ACTIVE", "ENDING"))
    doc = {"_id": pid, "policyId": p["_id"], "policyName": p["name"], "insurer": p["insurer"], "amount": amount, "reference": ref,
           "period": js_str(b.get("period") or ""), "livesCovered": lives, "glCode": "5401", "glName": "Group insurance premium",
           "paidBy": actor_name(user), "paidAt": now_iso()}
    modules_store.benefitPremiumPayments[pid] = doc
    audit(user, "INSURANCE_PREMIUM_PAID", "BENEFITS", "BenefitPolicy", p["_id"], {"amount": amount, "reference": ref})
    return JSONResponse({"payment": doc}, status_code=201)
