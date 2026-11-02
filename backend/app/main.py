from app import config  # noqa: F401  - loads .env before anything reads os.environ

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import FRONTEND_DIST, PORT, is_production
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
    await persistence.connect()
    # Performance reminders; does nothing until HR switches them on
    reminders = asyncio.get_running_loop().create_task(performance_ops.reminder_loop())
    print(f"[RHYA HRMS] Server running on http://0.0.0.0:{PORT}")
    yield
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
async def persist_after_writes(request: Request, call_next):
    """Save changes to MongoDB / the JSON file shortly after every API write request."""
    response = await call_next(request)
    if request.url.path.startswith("/api") and request.method not in ("GET", "HEAD", "OPTIONS"):
        persistence.schedule_sync()
    return response


# ------------------------------------------------------------------ routes

for module in (auth, employees, organization, onboarding, documents, attendance, leave_expenses,
               payroll, payroll_calculators, performance, performance_feedback, performance_appraisal, performance_ops, policies, rbac, recruitment, operations):
    app.include_router(module.router, prefix="/api")


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(path: str):
    raise ApiError(404, "Endpoint not found.")


# Public static files: ONLY organisation logos (never employee documents)
app.mount("/uploads/logos", StaticFiles(directory=common.LOGOS_DIR), name="logos")


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
