"""Per-request values that deep helpers (e.g. audit logging) need without a Request object."""

from contextvars import ContextVar
from typing import Optional

from starlette.requests import Request

_client_ip: ContextVar[Optional[str]] = ContextVar("client_ip", default=None)


def ip_of(request: Request) -> str:
    """The caller's IP. Behind a proxy (Vercel) the first X-Forwarded-For entry is the client."""
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    real_ip = (request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    return request.client.host if request.client else ""


def set_client_ip(ip: Optional[str]):
    return _client_ip.set(ip)


def reset_client_ip(token) -> None:
    _client_ip.reset(token)


def current_client_ip() -> Optional[str]:
    return _client_ip.get()
