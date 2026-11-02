"""
Performance Management (PMS) score calculations.

Implements sheet 4_Calculations of the PMS developer brief:
achievement % -> KPI score -> KPI section score, competency score, 360 score,
final score and final rating. Every function is pure so it can be unit-tested
against the worked example in the brief.
"""

from typing import Iterable, Optional

ACHIEVEMENT_CAP = 1.2

# (lower bound, score): achievement at or above the bound earns the score
KPI_BANDS = [(1.15, 5), (1.05, 4), (0.95, 3), (0.80, 2), (0.0, 1)]

# (lower bound, rating): final score at or above the bound earns the rating
RATING_BANDS = [(4.50, 5), (3.75, 4), (2.75, 3), (2.00, 2), (0.0, 1)]

# 360 group weights; a group counts only with enough replies (manager needs 1)
GROUP_WEIGHTS_360 = {"MANAGER": 0.40, "PEER": 0.25, "TEAM": 0.20, "OTHER_DEPT": 0.15}
MIN_REPLIES_360 = {"MANAGER": 1, "PEER": 3, "TEAM": 3, "OTHER_DEPT": 3}

DEFAULT_SECTION_WEIGHTS = {"kpi": 0.70, "competency": 0.20, "feedback360": 0.10}

# Float noise (e.g. 3.7499999999) must not drop a value into the band below
_EPS = 1e-9


def achievement(direction: str, target: float, actual: Optional[float]) -> Optional[float]:
    """Actual / target (higher is better) or target / actual (lower is better), capped at 120%.

    Lower-is-better with an actual of 0 (e.g. zero complaints) is the best possible
    result, so it gets the cap instead of dividing by zero.
    """
    if actual is None or target is None or target <= 0 or actual < 0:
        return None
    if direction == "LOWER":
        ratio = ACHIEVEMENT_CAP if actual == 0 else target / actual
    else:
        ratio = actual / target
    return min(ratio, ACHIEVEMENT_CAP)


def kpi_score(achievement_ratio: Optional[float]) -> Optional[int]:
    if achievement_ratio is None:
        return None
    for bound, score in KPI_BANDS:
        if achievement_ratio + _EPS >= bound:
            return score
    return 1


def kpi_section_score(lines: Iterable[dict]) -> Optional[float]:
    """Sum of weight x KPI score. Weights are fractions (0.3 = 30%).

    Returns None until every line has a score, so a half-filled sheet never
    shows a misleadingly low total.
    """
    total = 0.0
    any_line = False
    for line in lines:
        any_line = True
        if line.get("score") is None:
            return None
        total += float(line["weight"]) * line["score"]
    return total if any_line else None


def competency_score(ratings: Iterable[Optional[float]]) -> Optional[float]:
    values = [float(r) for r in ratings if r is not None]
    return sum(values) / len(values) if values else None


def score_360(groups: dict) -> Optional[float]:
    """groups: {GROUP: {"responses": int, "average": float}}.

    Groups below their minimum reply count are dropped and their weight is spread
    proportionally over the groups that remain.
    """
    counted = {
        g: data
        for g, data in groups.items()
        if g in GROUP_WEIGHTS_360
        and data.get("average") is not None
        and (data.get("responses") or 0) >= MIN_REPLIES_360[g]
    }
    weight_sum = sum(GROUP_WEIGHTS_360[g] for g in counted)
    if weight_sum == 0:
        return None
    return sum(GROUP_WEIGHTS_360[g] / weight_sum * float(d["average"]) for g, d in counted.items())


def final_score(
    kpi: Optional[float],
    competency: Optional[float],
    feedback360: Optional[float],
    weights: Optional[dict] = None,
) -> Optional[float]:
    """Weighted final score. A missing section's weight is spread over the others."""
    weights = weights or DEFAULT_SECTION_WEIGHTS
    parts = {"kpi": kpi, "competency": competency, "feedback360": feedback360}
    present = {k: v for k, v in parts.items() if v is not None and weights.get(k, 0) > 0}
    weight_sum = sum(weights[k] for k in present)
    if weight_sum == 0:
        return None
    return sum(weights[k] / weight_sum * v for k, v in present.items())


def final_rating(score: Optional[float]) -> Optional[int]:
    if score is None:
        return None
    for bound, rating in RATING_BANDS:
        if score + _EPS >= bound:
            return rating
    return 1


def score_goal_line(line: dict) -> dict:
    """Fill achievement and score on a goal line from its target / actual."""
    ach = achievement(line.get("direction", "HIGHER"), line.get("target"), line.get("actual"))
    line["achievement"] = round(ach, 4) if ach is not None else None
    line["score"] = kpi_score(ach)
    return line
