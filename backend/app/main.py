from app import config  # noqa: F401  - loads .env before anything reads os.environ

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import FRONTEND_DIST, IS_VERCEL, PORT, is_production
from app.database import persistence
from app.errors import ApiError
from app.routes import (
    attendance,
    auth,
    common,
    documents,
    employees,
    leave_expenses,
    onboarding,
    operations,
    organization,
    payroll,
    payroll_calculators,
    performance,
    performance_appraisal,
    performance_feedback,
    performance_ops,
    policies,
    rbac,
    recruitment,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # On Vercel this may not run at all; persistence also connects lazily on the first request.
    await persistence.connect()
    # Performance reminders; does nothing until HR switches them on. On Vercel, Vercel Cron
    # calls /api/performance/reminders/cron instead (see vercel.json).
    reminders = None if IS_VERCEL else asyncio.get_running_loop().create_task(performance_ops.reminder_loop())
    print(f"[RHYA HRMS] Server running on http://0.0.0.0:{PORT}")
    yield
    if reminders:
        reminders.cancel()
    print("[RHYA HRMS] Shutting down, saving data...")
    await persistence.flush_and_close()


app = FastAPI(title="vetan.ai HRMS API", version="2.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)


# ------------------------------------------------------------------ errors

@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return JSONResponse(exc.body, status_code=exc.status)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    if exc.status_code == 404 and message == "Not Found":
        message = "Endpoint not found."
    return JSONResponse({"error": message}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Invalid request.", "details": exc.errors()}, status_code=400)


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception):
    print("[RHYA HRMS] Unhandled error:", repr(exc))
    return JSONResponse({"error": "Internal server error."}, status_code=500)


# ------------------------------------------------------------- persistence

@app.middleware("http")
async def sync_data(request: Request, call_next):
    """Load other instances' changes before each API request and save this one's before replying."""
    if not request.url.path.startswith("/api"):
        return await call_next(request)
    async with persistence.request_scope(writes=request.method not in ("GET", "HEAD", "OPTIONS")):
        return await call_next(request)


# ------------------------------------------------------------------ routes

for module in (auth, employees, organization, onboarding, documents, attendance, leave_expenses,
               payroll, payroll_calculators, performance, performance_feedback, performance_appraisal, performance_ops, policies, rbac, recruitment, operations):
    app.include_router(module.router, prefix="/api")


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(path: str):
    raise ApiError(404, "Endpoint not found.")


# Public files: ONLY organisation logos (never employee documents)
@app.get("/uploads/logos/{name}", include_in_schema=False)
async def logo_file(name: str):
    response = await common.stored_file_response(common.LOGOS, name, name, inline=True)
    if not response:
        raise ApiError(404, "Logo not found.")
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


# Built frontend (frontend/dist). Only served when it exists, e.g. in production;
# in development the Vite dev server serves the UI and proxies /api here.
if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets", check_dir=False), name="frontend-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
elif is_production():
    print('[RHYA HRMS] frontend/dist not found; run "npm run build" in frontend/. Serving API only.')


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT)
