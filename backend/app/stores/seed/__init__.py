import copy
import json
from pathlib import Path

_SEED_FILE = Path(__file__).with_name("seed_data.json")
_seed = json.loads(_SEED_FILE.read_text(encoding="utf-8"))


def _materialize(spec: dict):
    if spec["kind"] == "map":
        return {k: v for k, v in copy.deepcopy(spec["entries"])}
    if spec["kind"] == "array":
        return copy.deepcopy(spec["items"])
    return copy.deepcopy(spec["value"])


def seed_container(store: str, name: str):
    """Fresh copy of the initial contents of one store container ('db' or 'modules')."""
    return _materialize(_seed[store][name])


def fallback_assets() -> list:
    return copy.deepcopy(_seed["fallbackAssets"])


def letter_gallery() -> list:
    return copy.deepcopy(_seed["letterGallery"])
