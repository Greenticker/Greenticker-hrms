import time
from typing import Callable, Optional

import bcrypt
import jwt
from fastapi import Request

from app.auth.rbac import has_permission
from app.config import JWT_EXPIRES_SECONDS, JWT_SECRET
from app.errors import ApiError
from app.stores.db_store import db_store


def generate_token(user: dict) -> str:
    now = int(time.time())
    payload = {
        "userId": user["_id"],
        "email": user.get("email"),
        "role": user.get("role"),
        "organizationId": user.get("organizationId"),
        "iat": now,
        "exp": now + JWT_EXPIRES_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def compare_password(plain: str, hashed: str) -> bool:
    try:
        # bcrypt only uses the first 72 bytes; newer versions raise instead of truncating.
        return bcrypt.checkpw(plain.encode("utf-8")[:72], (hashed or "").encode("utf-8"))
    except ValueError:
        return False


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8")[:72], bcrypt.gensalt(10)).decode("utf-8")


def require_auth(request: Request) -> dict:
    """FastAPI dependency: the authenticated, active user (request.state.user)."""
    auth_header = request.headers.get("authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise ApiError(401, "Authentication required. No token provided.")

    parts = auth_header.split(" ")
    decoded = verify_token(parts[1] if len(parts) > 1 else "")
    if not decoded:
        raise ApiError(401, "Invalid or expired authentication token.")

    user = db_store.find_user_by_id(decoded.get("userId"))
    if not user or not user.get("isActive"):
        raise ApiError(401, "User not found or account deactivated.")

    request.state.user = user
    request.state.jwt_payload = decoded
    return user


def require_permission(permission: str) -> Callable:
    def dependency(request: Request) -> dict:
        user = require_auth(request)
        if not has_permission(user.get("role"), permission):
            raise ApiError(403, f"Access Denied. Role '{user.get('role')}' lacks permission: '{permission}'")
        return user

    return dependency


def require_role(*allowed_roles: str) -> Callable:
    def dependency(request: Request) -> dict:
        user = require_auth(request)
        if user.get("role") not in allowed_roles:
            raise ApiError(
                403,
                f"Access Denied. Requires one of [{', '.join(allowed_roles)}]. Current role: {user.get('role')}",
            )
        return user

    return dependency
