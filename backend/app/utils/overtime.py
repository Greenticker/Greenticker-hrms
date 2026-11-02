SHIFT_MINUTES = 8 * 60  # standard shift, break included
UNPAID_BUFFER_LIMIT_MINUTES = 10 * 60  # up to 10h => nothing extra
TIER_TWO_LIMIT_MINUTES = 14 * 60  # 10h-14h => tier 1, above 14h => tier 2


def _to_minutes(hhmm: str) -> int:
    parts = (hhmm or "").split(":")

    def part(i: int) -> int:
        try:
            return int(parts[i])
        except (IndexError, ValueError):
            return 0

    return part(0) * 60 + part(1)


def gross_minutes_between(check_in: str, check_out: str) -> int:
    """If check-out is earlier than check-in, the shift crossed midnight."""
    start = _to_minutes(check_in)
    end = _to_minutes(check_out)
    return end - start if end >= start else end + 24 * 60 - start


def compute_shift_credit(gross_minutes: int, is_night_shift: bool) -> dict:
    extra_minutes = max(0, gross_minutes - SHIFT_MINUTES)
    return {"extraDayCredit": 0, "tier": "NONE", "extraMinutes": extra_minutes}


def describe_tier(tier: str) -> str:
    return {
        "HALF_DAY": "+0.5 day",
        "FULL_DAY": "+1 day",
        "ONE_AND_HALF_DAY": "+1.5 days",
    }.get(tier, "No extra pay")
