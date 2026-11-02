"""
Geofence helpers for GPS attendance.

Rule: an attendance day is WORK_FROM_OFFICE only when BOTH the check-in and the
check-out GPS fixes are within OFFICE_RADIUS_KM (0.5 km) of the employee's office.
Anything else is WORK_FROM_HOME.

IMPORTANT: replace the coordinates below with the exact latitude / longitude of
each of your offices (right-click the building in Google Maps -> click the
coordinates to copy them). You can also override them without code changes:
  OFFICE_COORDS='[{"match":"bengaluru","name":"Bengaluru HQ","latitude":12.9352,"longitude":77.6245}]'
"""

import json
import math
import os
from typing import Any, Optional

from app.utils.jsutil import clean_num, is_finite_number, js_round

OFFICE_RADIUS_KM = 0.5

# Approximate coordinates - please verify / replace with your exact office pins.
DEFAULT_OFFICES = [
    {"match": "pune", "name": "Pune Corporate HQ (Office No. 102, Mantri Alpine, Bavdhan, Pune, Maharashtra 411021)", "latitude": 18.5524, "longitude": 73.8926},
    {"match": "bengaluru", "name": "Bengaluru HQ (Prestige Tech Park)", "latitude": 12.9373, "longitude": 77.6969},
    {"match": "mumbai", "name": "Mumbai Financial Hub (BKC)", "latitude": 19.0669, "longitude": 72.8696},
    {"match": "hyderabad", "name": "Hyderabad Tech Center (HITEC City)", "latitude": 17.4435, "longitude": 78.3772},
    {"match": "delhi", "name": "Delhi NCR Cyber City", "latitude": 28.4950, "longitude": 77.0890},
]


def _load_offices() -> list:
    raw = os.environ.get("OFFICE_COORDS")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return [
                    {
                        "match": str(o.get("match") or o.get("name") or "").lower(),
                        "name": str(o.get("name") or o.get("match") or "Office"),
                        "latitude": float(o["latitude"]),
                        "longitude": float(o["longitude"]),
                    }
                    for o in parsed
                    if isinstance(o, dict) and is_finite_number(o.get("latitude")) and is_finite_number(o.get("longitude"))
                ]
        except (ValueError, TypeError) as err:
            print("[geofence] OFFICE_COORDS is not valid JSON, using defaults.", err)
    return DEFAULT_OFFICES


OFFICES = _load_offices()


def find_office_for_location(employee_location: Optional[str] = None) -> dict:
    text = (employee_location or "").lower()
    for o in OFFICES:
        if o["match"] and o["match"] in text:
            return o
    return OFFICES[0]


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres (haversine)."""
    to_rad = math.radians
    r = 6371
    d_lat = to_rad(lat2 - lat1)
    d_lon = to_rad(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_valid_fix(g: Any) -> bool:
    return (
        isinstance(g, dict)
        and is_finite_number(g.get("latitude"))
        and is_finite_number(g.get("longitude"))
        and abs(g["latitude"]) <= 90
        and abs(g["longitude"]) <= 180
    )


def distance_from_office(fix: dict, employee_location: Optional[str] = None) -> dict:
    """Distance (km, 3 dp) from the employee's office for one GPS fix."""
    office = find_office_for_location(employee_location)
    km = distance_km(fix["latitude"], fix["longitude"], office["latitude"], office["longitude"])
    return {"office": office, "km": clean_num(js_round(km * 1000) / 1000)}


def is_within_office(km: float) -> bool:
    return km <= OFFICE_RADIUS_KM
