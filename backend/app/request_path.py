"""
Make FastAPI see the address the browser asked for, however the hosting runtime calls us.

Serverless runtimes (Vercel) can pass a request in ways that stop routes matching:
- a `root_path`, which Starlette strips from the path before routing (so /api/health
  would be routed as /health and miss every route);
- the function's own path (/api/index, /api/index.py) with the original path in a header.

GET .../__routing_debug returns what actually arrived: paths, header *names* and which
required settings are present (yes/no only, never values).
"""

import json
import os
import sys
from urllib.parse import parse_qs, unquote

_FUNCTION_PATHS = ("/api/index", "/api/index.py", "/api/main", "/api/main.py")
_REQUIRED_ENV = ("MONGODB_URI", "MONGODB_DB_NAME", "JWT_SECRET", "NODE_ENV", "APP_URL", "CRON_SECRET")


def _headers(scope: dict) -> dict:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}


def original_path(scope: dict) -> str:
    path = scope.get("path") or "/"
    root = (scope.get("root_path") or "").rstrip("/")
    # Some runtimes put the mount prefix in root_path and strip it from path
    if root and not path.startswith(root + "/") and path != root:
        path = root + (path if path.startswith("/") else "/" + path)
    if path.rstrip("/") in _FUNCTION_PATHS:
        headers = _headers(scope)
        matches = parse_qs(headers.get("x-now-route-matches", ""))
        if matches.get("1"):
            return "/" + unquote(matches["1"][0]).lstrip("/")
        for name in ("x-forwarded-uri", "x-original-url", "x-rewrite-url"):
            if headers.get(name):
                return headers[name].split("?", 1)[0] or "/"
    return path


class RequestPathMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        received = {"path": scope.get("path"), "root_path": scope.get("root_path"),
                    "raw_path": (scope.get("raw_path") or b"").decode("latin-1")}
        path = original_path(scope)
        scope = {**scope, "path": path, "raw_path": path.encode("utf-8"), "root_path": ""}

        if scope["type"] == "http" and path.rstrip("/").endswith("/__routing_debug"):
            main = sys.modules.get("__main__")
            body = json.dumps({
                "received": received,
                "routedTo": path,
                "headerNames": sorted(_headers(scope)),
                "settingsPresent": {name: bool(os.environ.get(name)) for name in _REQUIRED_ENV},
                "onVercel": bool(os.environ.get("VERCEL")),
                "entry": {"mainModule": getattr(main, "__file__", None), "cwd": os.getcwd()},
            }).encode("utf-8")
            await send({"type": "http.response.start", "status": 200,
                        "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": body})
            return

        await self.app(scope, receive, send)
