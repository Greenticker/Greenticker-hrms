import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# Must run before other modules read os.environ.
load_dotenv(BACKEND_ROOT / ".env")

# Vercel sets VERCEL=1. Its filesystem is read-only apart from /tmp, so there all data
# (including uploaded files) lives in MongoDB.
IS_VERCEL = bool(os.environ.get("VERCEL"))

DATA_FILE = Path(os.environ.get("HRMS_DATA_FILE") or BACKEND_ROOT / "data" / "hrms_store.json")
# Local disk copy of uploads; only used when MongoDB is not configured (local development)
UPLOADS_DIR = Path(os.environ.get("HRMS_UPLOADS_DIR") or ("/tmp/hrms-uploads" if IS_VERCEL else BACKEND_ROOT / "uploads"))
FRONTEND_DIST = BACKEND_ROOT.parent / "frontend" / "dist"

DEV_JWT_SECRET = "zenith-hrms-enterprise-jwt-super-secret-key-2026"
JWT_SECRET = os.environ.get("JWT_SECRET") or DEV_JWT_SECRET
JWT_EXPIRES_SECONDS = 24 * 60 * 60

PORT = int(os.environ.get("PORT") or 5000)


def is_production() -> bool:
    return os.environ.get("NODE_ENV") == "production" or os.environ.get("APP_ENV") == "production"
