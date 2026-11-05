"""
Make FastAPI see the address the browser asked for, however the hosting runtime calls us.

Serverless runtimes (Vercel) can pass a request in ways that stop routes matching:
- a `root_path`, which Starlette strips from the path before routing (so /api/health
  would be routed as /health and miss every route);
- the function's own path (/api/index, /api/index.py) with the original path in a header.
"""

from urllib.parse import parse_qs, unquote

_FUNCTION_PATHS = ("/api/index", "/api/index.py", "/api/main", "/api/main.py")


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
        if scope["type"] in ("http", "websocket"):
            path = original_path(scope)
            scope = {**scope, "path": path, "raw_path": path.encode("utf-8"), "root_path": ""}
        await self.app(scope, receive, send)
