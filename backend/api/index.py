"""Vercel entry point: Vercel's Python runtime serves the ASGI `app` exported here.

backend/vercel.json routes every path to this function; FastAPI then routes it.
The wrapper below makes sure FastAPI sees the address the browser asked for:
- Vercel may hand the function its own path (/api/index or /api/index.py) and pass
  the original one in the `x-now-route-matches` header (capture group 1 of the route).
- A root_path set by the runtime would make Starlette strip /api from every route.
GET /api/__routing_debug shows what the function received (paths and header names only).
"""

import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote

# Make the `app` package importable however Vercel sets the working directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app as fastapi_app  # noqa: E402

_FUNCTION_PATHS = ("/api/index", "/api/index.py")


def _original_path(scope: dict) -> str:
    path = scope.get("path") or "/"
    if path.rstrip("/") not in _FUNCTION_PATHS:
        return path
    headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
    matches = parse_qs(headers.get("x-now-route-matches", ""))
    if matches.get("1"):
        return "/" + unquote(matches["1"][0]).lstrip("/")
    for name in ("x-forwarded-uri", "x-original-url", "x-rewrite-url"):
        if headers.get(name):
            return headers[name].split("?", 1)[0] or "/"
    return path


async def app(scope, receive, send):
    if scope["type"] not in ("http", "websocket"):
        return await fastapi_app(scope, receive, send)

    received = {"path": scope.get("path"), "root_path": scope.get("root_path"),
                "raw_path": (scope.get("raw_path") or b"").decode("latin-1")}
    path = _original_path(scope)
    scope = {**scope, "path": path, "raw_path": path.encode("utf-8"), "root_path": ""}

    if scope["type"] == "http" and path.rstrip("/") == "/api/__routing_debug":
        body = json.dumps({
            "received": received,
            "routedTo": path,
            "headerNames": sorted(k.decode("latin-1").lower() for k, _ in scope.get("headers") or []),
        }).encode("utf-8")
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})
        return

    await fastapi_app(scope, receive, send)
