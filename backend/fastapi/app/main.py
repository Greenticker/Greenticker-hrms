from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import database
from app.config import settings
from app.database import close_mongo_connection, connect_to_mongo
from app.permissions.rbac import ROLE_PERMISSIONS


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await connect_to_mongo()
    except Exception as exc:  # keep the process up so /api/health can report the problem
        print(f"WARNING: could not connect to MongoDB: {exc}")
    yield
    await close_mongo_connection()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan,
)

# CORS: explicit origins only (a wildcard combined with credentials is rejected by browsers).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy" if database.db is not None else "degraded",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "database": "connected" if database.db is not None else "unavailable",
    }


@app.get("/api/rbac/permissions")
async def get_role_permissions():
    """Return all permissions grouped by role for audit and client introspection."""
    return {
        role.value: [p.value for p in perms]
        for role, perms in ROLE_PERMISSIONS.items()
    }


# Register API routers
from app.routers.documents_router import router as documents_router  # noqa: E402
from app.routers.employees_router import router as employees_router  # noqa: E402

app.include_router(documents_router, prefix="/api")
app.include_router(employees_router, prefix="/api")
