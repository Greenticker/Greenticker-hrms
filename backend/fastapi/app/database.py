from typing import Optional

from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings

client: Optional[AsyncIOMotorClient] = None
db: Optional[AsyncIOMotorDatabase] = None


async def connect_to_mongo() -> None:
    """Create the client and verify the server is reachable (raises if not)."""
    global client, db
    client = AsyncIOMotorClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000)
    await client.admin.command("ping")
    db = client[settings.MONGODB_DB_NAME]
    print(f"Connected to MongoDB database: {settings.MONGODB_DB_NAME}")


async def close_mongo_connection() -> None:
    global client, db
    if client:
        client.close()
        client = None
        db = None
        print("Closed MongoDB connection.")


def get_database() -> AsyncIOMotorDatabase:
    """Return the active database or a clean 503 (instead of an AttributeError on None)."""
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not available.",
        )
    return db
