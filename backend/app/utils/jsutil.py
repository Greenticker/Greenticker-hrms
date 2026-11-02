"""
Small helpers that reproduce JavaScript behaviour the API (and the frontend) relies on:
ISO timestamps, Date parsing for sorting, Math.round, toLocaleString('en-IN'), and
number-to-string conversion without a trailing ".0".
"""

import math
import random
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional

IST = timezone(timedelta(hours=5, minutes=30))
_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def now_ms() -> int:
    """Date.now()"""
    return int(time.time() * 1000)


def rand_int(n: int) -> int:
    """Math.floor(Math.random() * n)"""
    return random.randrange(n)


def rand_base36(length: int) -> str:
    """Math.random().toString(36).slice(2, 2 + length)"""
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    return "".join(random.choice(alphabet) for _ in range(length))


def iso(dt: datetime) -> str:
    """Date.prototype.toISOString(): UTC, millisecond precision, trailing Z."""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def now_iso() -> str:
    """new Date().toISOString()"""
    return iso(datetime.now(timezone.utc))


def iso_from_ms(ms: float) -> str:
    return iso(datetime.fromtimestamp(ms / 1000, tz=timezone.utc))


def today_str() -> str:
    """new Date().toISOString().split('T')[0] (UTC date)"""
    return now_iso()[:10]


def local_hhmm() -> str:
    """new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: false})"""
    return datetime.now().strftime("%H:%M")


def parse_date(value: Any) -> Optional[datetime]:
    """Parse the date formats JS `new Date(str)` accepts in this app. Date-only strings are UTC."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    s = str(value).strip()
    try:
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            d = date.fromisoformat(s)
            return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        s2 = s[:-1] + "+00:00" if s.endswith("Z") else s
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.astimezone()  # JS treats date-time strings without offset as local time
        return dt
    except ValueError:
        return None


def date_ms(value: Any) -> float:
    """new Date(value).getTime(); invalid dates sort as 0 instead of NaN."""
    dt = parse_date(value)
    return dt.timestamp() * 1000 if dt else 0.0


def add_months_date(start: Any, months: float) -> str:
    """new Date(start || Date.now()); d.setMonth(d.getMonth() + months); d.toISOString().split('T')[0].
    setMonth works in local time and rolls over (Jan 31 + 1 month -> Mar 2/3)."""
    dt = parse_date(start) if start else None
    if dt is None:
        dt = datetime.now(timezone.utc)
    local = dt.astimezone()
    total = local.month - 1 + int(months)
    year, month = local.year + total // 12, total % 12 + 1
    first_of_month = local.replace(year=year, month=month, day=1)
    rolled = first_of_month + timedelta(days=local.day - 1)
    return rolled.astimezone(timezone.utc).strftime("%Y-%m-%d")


def js_round(x: float) -> int:
    """Math.round: halves round towards +infinity."""
    return int(math.floor(x + 0.5))


def r2(n: float) -> float:
    """Math.round((n + Number.EPSILON) * 100) / 100"""
    return js_round((n + 2.220446049250313e-16) * 100) / 100


def num(v: Any) -> Optional[float]:
    """Number(v). Returns None where JavaScript gives NaN (None stands in for `undefined`)."""
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v if v == v else None
    if v is None or isinstance(v, (dict, list)):
        return None
    text = str(v).strip()
    if text == "":
        return 0
    try:
        n = float(text)
    except ValueError:
        return None
    if n != n:
        return None
    return int(n) if n.is_integer() and math.isfinite(n) else n


def to_number(v: Any, default: float = 0) -> float:
    """Number(v) || default"""
    n = num(v)
    return n if n else default


def is_finite_number(v: Any) -> bool:
    """Number.isFinite(v) (no coercion)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def js_str(v: Any) -> str:
    """String(v) / template-literal conversion: 5.0 -> '5', None -> 'null', True -> 'true'."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return repr(v)
    return str(v)


def s(v: Any) -> str:
    """String(v ?? '')"""
    return "" if v is None else js_str(v)


def clean_num(v: Any) -> Any:
    """Turn integral floats into ints so JSON looks like JavaScript's (1000 not 1000.0)."""
    if isinstance(v, float) and v.is_integer() and abs(v) < 2**53:
        return int(v)
    return v


def _group_indian(int_part: str) -> str:
    if len(int_part) <= 3:
        return int_part
    head, tail = int_part[:-3], int_part[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups) + "," + tail


def format_en_in(n: float, min_fraction: int = 0, max_fraction: int = 3) -> str:
    """Number.prototype.toLocaleString('en-IN', {...FractionDigits})"""
    n = float(n or 0)
    neg = n < 0
    n = abs(n)
    scaled = js_round(n * 10**max_fraction)
    int_part, frac = divmod(scaled, 10**max_fraction)
    frac_str = str(frac).rjust(max_fraction, "0") if max_fraction else ""
    frac_str = frac_str.rstrip("0")
    if len(frac_str) < min_fraction:
        frac_str = frac_str.ljust(min_fraction, "0")
    out = _group_indian(str(int_part)) + ("." + frac_str if frac_str else "")
    return ("-" if neg else "") + out


def format_en_us(n: float) -> str:
    """Number.prototype.toLocaleString() with the default en-US locale (max 3 decimals)."""
    n = float(n or 0)
    text = f"{abs(n):,.3f}".rstrip("0").rstrip(".")
    return ("-" if n < 0 and text != "0" else "") + text


def letter_date() -> str:
    """new Date().toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})"""
    d = datetime.now()
    return f"{d.day:02d} {_MONTHS_SHORT[d.month - 1]} {d.year}"


def ist_medium_short(iso_str: str) -> str:
    """toLocaleString('en-IN', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata'})"""
    dt = parse_date(iso_str)
    if not dt:
        return "Invalid Date"
    d = dt.astimezone(IST)
    hour = d.hour % 12 or 12
    ampm = "am" if d.hour < 12 else "pm"
    return f"{d.day} {_MONTHS_SHORT[d.month - 1]} {d.year}, {hour}:{d.minute:02d} {ampm}"


def compact(d: dict) -> dict:
    """Drop keys whose value is None, mirroring how JSON.stringify drops `undefined`."""
    return {k: v for k, v in d.items() if v is not None}


def truthy(v: Any) -> bool:
    """JavaScript truthiness."""
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and v == v
    if isinstance(v, str):
        return v != ""
    return True


def first(items: Iterable, pred) -> Any:
    for it in items:
        if pred(it):
            return it
    return None
