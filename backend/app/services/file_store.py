"""
Uploaded files (employee documents, policy PDFs, resumes, company logos).

With MongoDB configured, files are stored in GridFS (bucket "uploads", filename
"<kind>/<storedFileName>"), so they survive serverless deploys and stay private.
Without MongoDB (local development) they are written under UPLOADS_DIR.
Reads check GridFS first and fall back to the disk, so files uploaded before the
switch to GridFS still open locally.
"""

from pathlib import Path
from typing import Optional

from gridfs import AsyncGridFSBucket

from app.config import IS_VERCEL, UPLOADS_DIR
from app.database import persistence

KINDS = ("documents", "resumes", "logos")
BUCKET = "uploads"


def _disk_path(kind: str, stored: str) -> Path:
    # stored names are generated server-side (timestamp_random.ext), but never trust a path
    return UPLOADS_DIR / kind / Path(stored).name


def _bucket() -> Optional[AsyncGridFSBucket]:
    database = persistence.get_db()
    return AsyncGridFSBucket(database, bucket_name=BUCKET) if database is not None else None


async def save(kind: str, stored: str, data: bytes, content_type: str, original_name: str) -> None:
    assert kind in KINDS
    bucket = _bucket()
    if bucket is not None:
        await bucket.upload_from_stream(
            f"{kind}/{stored}", data,
            metadata={"contentType": content_type, "originalName": original_name, "kind": kind},
        )
        return
    if IS_VERCEL:
        raise RuntimeError("MONGODB_URI must be set to store uploads on Vercel.")
    target = _disk_path(kind, stored)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


async def read(kind: str, stored: str) -> Optional[tuple]:
    """(bytes, content_type) or None when the file does not exist."""
    assert kind in KINDS
    bucket = _bucket()
    if bucket is not None:
        cursor = bucket.find({"filename": f"{kind}/{stored}"}).sort("uploadDate", -1).limit(1)
        async for grid_file in cursor:
            stream = await bucket.open_download_stream(grid_file._id)
            data = await stream.read()
            return data, (grid_file.metadata or {}).get("contentType") or "application/octet-stream"
    path = _disk_path(kind, stored)
    if path.is_file():
        return path.read_bytes(), None
    return None
