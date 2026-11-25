from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, client_ip, read_body
from app.stores.db_store import db_store
from app.auth.employee_access import MASTER_WRITE_ROLES
from app.utils.geofence import OFFICE_RADIUS_KM, distance_from_office, is_valid_fix, is_within_office
from app.utils.workflow import is_in_team, my_employee_id
from app.utils.jsutil import clean_num, is_finite_number, js_round, js_str, s, today_str, to_number, truthy

router = APIRouter()


def _location_text(location) -> str:
    if isinstance(location, dict) and is_finite_number(location.get("latitude")):
        lng = location.get("longitude")
        lng_text = f"{lng:.4f}" if is_finite_number(lng) else "NaN"
        return f"Lat: {location['latitude']:.4f}, Lng: {lng_text} (±{js_round(to_number(location.get('accuracy'), 10))}m)"
    if isinstance(location, str):
        return location
    return "Office Location"


def _round2(x: float):
    return clean_num(js_round(x * 100) / 100)


ATT_ADMIN_ROLES = MASTER_WRITE_ROLES + ("ADMIN_2",)
ATT_READ_ALL = ATT_ADMIN_ROLES + ("AUDITORS", "FINANCE", "ACCOUNTS")


def _target_employee_id(user: dict, requested) -> str:
    """Everyone punches for themself only (punching for someone else would be fake attendance)."""
    return user.get("employeeId")


@router.get("/attendance")
async def list_attendance(
    date: Optional[str] = None,
    month: Optional[str] = None,
    employeeId: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    me = my_employee_id(user)
    if employeeId and employeeId != me and user.get("role") not in ATT_READ_ALL and not is_in_team(me, employeeId):
        raise ApiError(403, "Access denied: you can only view your own (or your team's) attendance.")
    records = list(db_store.attendanceRecords.values())
    if employeeId:
        records = [r for r in records if r.get("employeeId") == employeeId]
    elif user.get("role") not in ATT_READ_ALL:
        records = [r for r in records if r.get("employeeId") == me or is_in_team(me, r.get("employeeId"))]
    if date:
        records = [r for r in records if r.get("date") == date]
    if month:
        records = [r for r in records if (r.get("date") or "").startswith(month)]
    if status and status != "ALL":
        records = [r for r in records if r.get("status") == status]
    records.sort(key=lambda r: r.get("date") or "", reverse=True)
    today = today_str()
    today_records = [r for r in records if r.get("date") == today]
    stats = {
        "totalRecords": len(records),
        "todayPresent": sum(1 for r in today_records if r.get("status") in ("PRESENT", "WORK_FROM_HOME")),
        "todayCheckedInNow": sum(1 for r in today_records if r.get("checkInTime") and not r.get("checkOutTime")),
        "todayLate": sum(1 for r in today_records if r.get("status") == "LATE"),
        "totalOvertimeHours": _round2(sum(r.get("overtimeHours") or 0 for r in records)),
        "totalExtraDayCredit": _round2(sum(r.get("extraDayCredit") or 0 for r in records)),
        "totalWorkedHours": _round2(sum(r.get("effectiveWorkingHours") or 0 for r in records)),
    }
    return {"records": records, "stats": stats, "userRole": user.get("role")}


@router.post("/attendance/check-in")
async def check_in(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    emp_id = _target_employee_id(user, body.get("employeeId"))
    if not emp_id:
        raise ApiError(400, "No associated employee record found for check-in.")

    location = body.get("location")
    location_text = _location_text(location)
    geo = location if is_valid_fix(location) else None
    from app.routes.attendance_mgmt import mark_timing, require_unlocked, settings as att_settings
    require_unlocked(today_str())
    emp = db_store.employees.get(emp_id) or {}
    outside = None
    if geo:
        outside = not is_within_office(distance_from_office(geo, emp.get("location"))["km"])
        if outside and att_settings()["outsideGeofence"] == "BLOCK":
            raise ApiError(403, f"You are outside the office geo-fence ({js_str(OFFICE_RADIUS_KM * 1000)} m). Punch-in is blocked; raise a regularization if you were on duty.")
    try:
        record = db_store.check_in(emp_id, location_text, client_ip(request), geo, body.get("clientTime"))
    except ValueError as err:
        raise ApiError(500, str(err))
    record["geoFlag"] = "OUTSIDE_GEOFENCE" if outside else ("NO_GPS" if not geo else None)
    record["source"] = "WEB"
    mark_timing(record, emp)

    details = {
        "time": record.get("checkInTime"),
        "location": location_text,
        "workMode": record.get("workMode"),
        "distanceKm": record.get("checkInDistanceKm"),
    }
    audit(user, "ATTENDANCE_CHECK_IN", "ATTENDANCE", "AttendanceRecord", record["_id"], {k: v for k, v in details.items() if v is not None})

    distance = record.get("checkInDistanceKm")
    if record.get("workMode") == "WORK_FROM_OFFICE":
        mode_text = (
            f" You are {js_round((distance or 0) * 1000)} m from the office (within {js_str(OFFICE_RADIUS_KM * 1000)} m)"
            " - marked Work From Office."
        )
    elif record.get("workMode") == "WORK_FROM_HOME":
        mode_text = (
            f" You are {(distance if distance is not None else 0):.2f} km from the office (outside {js_str(OFFICE_RADIUS_KM)} km)"
            " - marked Work From Home."
        )
    else:
        mode_text = ""

    return {"success": True, "message": f"Checked in successfully at {s(record.get('checkInTime'))}.{mode_text}", "record": record}


@router.post("/attendance/check-out")
async def check_out(request: Request, user: dict = Depends(require_auth)):
    body = await read_body(request)
    emp_id = _target_employee_id(user, body.get("employeeId"))
    if not emp_id:
        raise ApiError(400, "No associated employee record found for check-out.")

    location = body.get("location")
    location_text = _location_text(location)
    geo = location if is_valid_fix(location) else None
    from app.routes.attendance_mgmt import mark_timing, require_unlocked
    require_unlocked(today_str())
    try:
        record = db_store.check_out(emp_id, location_text, geo, body.get("clientTime"))
    except ValueError as err:
        raise ApiError(500, str(err))
    mark_timing(record, db_store.employees.get(emp_id) or {})

    details = {
        "time": record.get("checkOutTime"),
        "effectiveHours": record.get("effectiveWorkingHours"),
        "overtimeHours": record.get("overtimeHours"),
        "extraDayCredit": record.get("extraDayCredit"),
        "extraPayTier": record.get("extraPayTier"),
        "workMode": record.get("workMode"),
        "distanceKm": record.get("checkOutDistanceKm"),
    }
    audit(user, "ATTENDANCE_CHECK_OUT", "ATTENDANCE", "AttendanceRecord", record["_id"], {k: v for k, v in details.items() if v is not None})

    credit = record.get("extraDayCredit")
    if truthy(credit):
        credit_text = f" Extra pay earned: +{js_str(credit)} day{'' if credit == 1 else 's'}."
    else:
        credit_text = " No extra pay for this shift."

    if record.get("workMode") == "WORK_FROM_OFFICE":
        mode_text = " Day marked Work From Office (check-in and check-out both within 0.5 km of the office)."
    elif record.get("workMode") == "WORK_FROM_HOME":
        mode_text = " Day marked Work From Home (check-in or check-out was more than 0.5 km from the office)."
    else:
        mode_text = ""

    total_hours = js_str(_round2((record.get("totalMinutesWorked") or 0) / 60))
    return {
        "success": True,
        "message": f"Checked out successfully at {s(record.get('checkOutTime'))}. Total time: {total_hours}h (break included).{credit_text}{mode_text}",
        "record": record,
    }


@router.post("/attendance/{record_id}/regularize")
async def regularize(record_id: str, request: Request, user: dict = Depends(require_role(*MASTER_WRITE_ROLES))):
    """HR correction of a record (employees raise a regularization request instead)."""
    from app.routes.attendance_mgmt import require_unlocked
    rec = db_store.attendanceRecords.get(record_id)
    if not rec:
        raise ApiError(404, "Attendance record not found.")
    if rec.get("employeeId") == my_employee_id(user):
        raise ApiError(403, "You cannot correct your own attendance; raise a regularization request.")
    require_unlocked(rec.get("date") or "")
    before = {k: rec.get(k) for k in ("checkInTime", "checkOutTime", "status")}
    body = await read_body(request)
    reason = body.get("reason")
    if not truthy(reason) or not js_str(reason).strip():
        raise ApiError(400, "A justification reason is required for regularization.")

    updated = db_store.regularize_attendance(
        record_id,
        {
            "checkInTime": body.get("checkInTime"),
            "checkOutTime": body.get("checkOutTime"),
            "status": body.get("status"),
            "regularizationReason": js_str(reason).strip(),
        },
        f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})",
    )
    if not updated:
        raise ApiError(404, "Attendance record not found.")

    audit(user, "ATTENDANCE_REGULARIZED", "ATTENDANCE", "AttendanceRecord", record_id, {
        "reason": js_str(reason).strip(),
        "changes": [{"field": k, "oldValue": v, "newValue": updated.get(k)} for k, v in before.items() if v != updated.get(k)],
    })
    return {"success": True, "record": updated}


# ------------------------------------------------------------------ shifts

def _assign_shift(employee_ids: list, shift: dict) -> None:
    label = f"{shift.get('name')} ({shift.get('startTime')} - {shift.get('endTime')})"
    for emp_id in employee_ids:
        emp = db_store.employees.get(emp_id)
        if emp:
            emp["shift"] = label


@router.get("/shifts")
async def list_shifts(_: dict = Depends(require_auth)):
    return {"shifts": db_store.get_shifts()}


@router.post("/shifts")
async def create_shift(request: Request, user: dict = Depends(require_role(*ATT_ADMIN_ROLES))):
    body = await read_body(request)
    name, start, end = body.get("name"), body.get("startTime"), body.get("endTime")
    shift_type = body.get("type") if body.get("type") in ("FIXED", "ROTATIONAL") else "FIXED"
    rotation = [sid for sid in (body.get("rotationShiftIds") or []) if sid in db_store.shifts]
    if shift_type == "ROTATIONAL":
        if len(rotation) < 2:
            raise ApiError(400, "A rotational shift needs at least two shifts to rotate between.")
        first = db_store.shifts[rotation[0]]
        start, end = start or first.get("startTime"), end or first.get("endTime")
    if not truthy(name) or not truthy(start) or not truthy(end):
        raise ApiError(400, "Shift name, start time, and end time are required.")
    if any((s_.get("name") or "").lower() == js_str(name).strip().lower() and s_.get("status") != "ENDED" for s_ in db_store.shifts.values()):
        raise ApiError(409, f'A shift called "{name}" already exists.')

    assigned_ids = body.get("assignedEmployeeIds")
    assigned = body.get("assignedEmployees")
    shift = db_store.create_shift({
        "name": name,
        "code": body.get("code") or js_str(name)[:4].upper(),
        "startTime": start,
        "endTime": end,
        "expectedHours": to_number(body.get("expectedHours"), 8),
        "breakMinutes": body.get("breakMinutes") or 60,
        "gracePeriodMinutes": body.get("gracePeriodMinutes") or 15,
        "isNightShift": truthy(body.get("isNightShift")),
        "departments": body["departments"] if isinstance(body.get("departments"), list) else [],
        "isActive": truthy(body.get("isActive")) if "isActive" in body and body.get("isActive") is not None else True,
        "status": "ACTIVE",
        "assignedEmployeeIds": assigned_ids if isinstance(assigned_ids, list) else [],
        "assignedEmployees": assigned if isinstance(assigned, list) else [],
        "type": shift_type,
        "rotationShiftIds": rotation if shift_type == "ROTATIONAL" else [],
        "rotateEveryDays": int(body.get("rotateEveryDays") or 7),
        "rotationStart": body.get("rotationStart") or today_str(),
    })
    audit(user, "SHIFT_CREATED", "ATTENDANCE", "Shift", shift["_id"], {"name": shift.get("name"), "type": shift_type,
                                                                          "grace": shift.get("gracePeriodMinutes")})

    if isinstance(assigned_ids, list) and assigned_ids:
        _assign_shift(assigned_ids, shift)
    return JSONResponse({"success": True, "shift": shift}, status_code=201)


@router.put("/shifts/{shift_id}")
async def update_shift(shift_id: str, request: Request, _: dict = Depends(require_role(*ATT_ADMIN_ROLES))):
    body = await read_body(request)
    updated = db_store.update_shift(shift_id, body)
    if not updated:
        raise ApiError(404, "Shift not found.")
    if isinstance(body.get("assignedEmployeeIds"), list):
        _assign_shift(body["assignedEmployeeIds"], updated)
    return {"success": True, "shift": updated}


@router.post("/shifts/{shift_id}/end")
async def end_shift(shift_id: str, request: Request, user: dict = Depends(require_role(*ATT_ADMIN_ROLES))):
    body = await read_body(request)
    ended = db_store.end_shift(shift_id, body.get("reason"), user.get("email") or "Administrator")
    if not ended:
        raise ApiError(404, "Shift not found.")
    return {"success": True, "message": "Shift ended and stored in shift history.", "shift": ended}


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: str, user: dict = Depends(require_role(*ATT_ADMIN_ROLES))):
    ended = db_store.end_shift(shift_id, "Ended by admin action", user.get("email") or "Administrator")
    if not ended:
        raise ApiError(404, "Shift not found.")
    return {"success": True, "message": "Shift ended and stored in history.", "shift": ended}
