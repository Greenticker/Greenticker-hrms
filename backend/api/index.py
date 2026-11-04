"""Vercel entry point: Vercel's Python runtime serves the ASGI `app` exported here.

backend/vercel.json routes every path to this function; FastAPI then routes it.
"""

import sys
from pathlib import Path

# Make the `app` package importable however Vercel sets the working directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402,F401
