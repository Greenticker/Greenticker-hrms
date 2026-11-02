from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import audit, client_ip, read_body
from app.stores.db_store import db_store
from app.utils.geofence import OFFICE_RADIUS_KM, is_valid_fix
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


def _target_employee_id(user: dict, requested) -> str:
    emp_id = user.get("employeeId")
    if user.get("role") == "ADMIN" and requested:
        emp_id = requested
    return emp_id


@router.get("/attendance")
async def list_attendance(
    date: Optional[str] = None,
    month: Optional[str] = None,
    employeeId: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    records = db_store.get_attendance_for_user(user, date=date, month=month, employee_id=employeeId, status=status)
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
    try:
        record = db_store.check_in(emp_id, location_text, client_ip(request), geo, body.get("clientTime"))
    except ValueError as err:
        raise ApiError(500, str(err))

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
    try:
        record = db_store.check_out(emp_id, location_text, geo, body.get("clientTime"))
    except ValueError as err:
        raise ApiError(500, str(err))

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
async def regularize(record_id: str, request: Request, user: dict = Depends(require_role("ADMIN"))):
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

    details = {k: v for k, v in {
        "checkInTime": body.get("checkInTime"),
        "checkOutTime": body.get("checkOutTime"),
        "status": body.get("status"),
        "reason": js_str(reason).strip(),
    }.items() if v is not None}
    audit(user, "ATTENDANCE_REGULARIZED", "ATTENDANCE", "AttendanceRecord", record_id, details)
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
async def create_shift(request: Request, _: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    name, start, end = body.get("name"), body.get("startTime"), body.get("endTime")
    if not truthy(name) or not truthy(start) or not truthy(end):
        raise ApiError(400, "Shift name, start time, and end time are required.")

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
    })

    if isinstance(assigned_ids, list) and assigned_ids:
        _assign_shift(assigned_ids, shift)
    return JSONResponse({"success": True, "shift": shift}, status_code=201)


@router.put("/shifts/{shift_id}")
async def update_shift(shift_id: str, request: Request, _: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    updated = db_store.update_shift(shift_id, body)
    if not updated:
        raise ApiError(404, "Shift not found.")
    if isinstance(body.get("assignedEmployeeIds"), list):
        _assign_shift(body["assignedEmployeeIds"], updated)
    return {"success": True, "shift": updated}


@router.post("/shifts/{shift_id}/end")
async def end_shift(shift_id: str, request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    ended = db_store.end_shift(shift_id, body.get("reason"), user.get("email") or "Administrator")
    if not ended:
        raise ApiError(404, "Shift not found.")
    return {"success": True, "message": "Shift ended and stored in shift history.", "shift": ended}


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: str, user: dict = Depends(require_role("ADMIN"))):
    ended = db_store.end_shift(shift_id, "Ended by admin action", user.get("email") or "Administrator")
    if not ended:
        raise ApiError(404, "Shift not found.")
    return {"success": True, "message": "Shift ended and stored in history.", "shift": ended}
