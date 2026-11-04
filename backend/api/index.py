"""Vercel entry point (used if Vercel picks this file; it may also load app/main.py directly).

Request-path handling lives in app/request_path.py, inside the app itself, so it applies
whichever file Vercel uses to start the backend.
"""

import sys
from pathlib import Path

# Make the `app` package importable however Vercel sets the working directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402,F401
