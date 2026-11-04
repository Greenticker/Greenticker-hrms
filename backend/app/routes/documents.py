import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.auth.security import require_auth, require_role
from app.errors import ApiError
from app.routes.common import (
    DOCUMENTS,
    MAX_UPLOAD_BYTES,
    audit,
    format_bytes,
    read_body,
    read_fields_and_files,
    save_upload,
    stored_file_response,
)
from app.stores.db_store import db_store
from app.utils.jsutil import now_iso, now_ms, truthy

router = APIRouter()

MAX_FILE_BYTES = MAX_UPLOAD_BYTES  # 4 MB: Vercel's request size limit
MAX_BATCH_BYTES = MAX_UPLOAD_BYTES  # a batch arrives in one request, so the same limit applies


def _strip_ext(name: str) -> str:
    return re.sub(r"\.[^/.]+$", "", name)


def _target_employee(user: dict, requested_employee_id) -> dict:
    is_privileged = user.get("role") in ("ADMIN", "HR")
    target_id = user.get("employeeId")
    if is_privileged and requested_employee_id:
        target_id = requested_employee_id
    if not target_id:
        raise ApiError(400, "Target employee record not identified.")
    emp = db_store.get_employee_by_id(target_id)
    if not emp:
        raise ApiError(404, "Target employee not found.")
    return emp


def _new_document(user: dict, emp: dict, **fields) -> dict:
    is_privileged = user.get("role") in ("ADMIN", "HR")
    now = now_iso()
    doc = {
        "employeeId": emp["_id"],
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "employeeCode": emp.get("employeeCode"),
        "department": emp.get("department"),
        **fields,
        "uploadedBy": f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})",
        "uploadedAt": now,
        "status": "VERIFIED" if is_privileged else "PENDING",
        "verifiedBy": f"{user.get('firstName')} {user.get('lastName')}" if is_privileged else None,
        "verifiedAt": now if is_privileged else None,
    }
    return db_store.create_document(doc)


@router.get("/documents")
async def list_documents(
    category: Optional[str] = None,
    status: Optional[str] = None,
    employeeId: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    docs = db_store.get_documents_for_user(user, category=category, status=status, employee_id=employeeId)
    return {"total": len(docs), "documents": docs}


@router.post("/documents")
async def upload_document(request: Request, user: dict = Depends(require_auth)):
    body, files = await read_fields_and_files(request)
    upload = (files.get("file") or [None])[0]

    category = body.get("category") or "IDENTITY"
    title = body.get("title") or (_strip_ext(upload.filename) if upload else "")
    if not title:
        raise ApiError(400, "Document title is required.")

    emp = _target_employee(user, body.get("employeeId"))

    stored = None
    if upload:
        saved = await save_upload(upload, DOCUMENTS, MAX_FILE_BYTES)
        stored = saved["storedFileName"]
        file_name, file_type, file_size = saved["originalName"], saved["mimeType"], format_bytes(saved["size"])
    else:
        file_name = body.get("fileName") or "document_scan.pdf"
        file_type = body.get("fileType") or "application/pdf"
        file_size = body.get("fileSize") or "1.5 MB"

    new_doc = _new_document(
        user, emp,
        category=category,
        title=title,
        fileName=file_name,
        fileType=file_type,
        fileSize=file_size,
        fileUrl=f"/api/documents/files/{stored}" if stored else f"/api/documents/demo/{file_name}",
        expiryDate=body.get("expiryDate"),
    )
    if stored:
        new_doc["storedFileName"] = stored

    audit(user, "DOCUMENT_UPLOADED", "DOCUMENTS", "Document", new_doc["_id"], {
        "title": title, "category": category, "employeeCode": emp.get("employeeCode"),
    })
    return JSONResponse({"success": True, "document": new_doc}, status_code=201)


@router.post("/documents/multiple")
async def upload_multiple(request: Request, user: dict = Depends(require_auth)):
    body, files = await read_fields_and_files(request)
    uploads = (files.get("files") or [])[:20]
    if not uploads:
        raise ApiError(400, "Please select at least one document to upload.")

    sizes = [u.size or 0 for u in uploads]
    total_bytes = sum(sizes)
    if any(sz > MAX_FILE_BYTES for sz in sizes):
        raise ApiError(400, f"File too large. The maximum size is {format_bytes(MAX_FILE_BYTES)}.")
    if total_bytes > MAX_BATCH_BYTES:
        raise ApiError(
            400,
            f"Total size of uploaded documents ({format_bytes(total_bytes)}) exceeds the {format_bytes(MAX_BATCH_BYTES)} total limit. "
            f"Please keep the combined size under {format_bytes(MAX_BATCH_BYTES)}, or upload them in smaller batches.",
            totalSize=format_bytes(total_bytes),
            maxAllowed=format_bytes(MAX_BATCH_BYTES),
        )

    default_category = body.get("category") or "IDENTITY"
    default_expiry = body.get("expiryDate")
    parsed_meta: dict = {}
    if body.get("filesMetadata"):
        raw = body["filesMetadata"]
        try:
            parsed_meta = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            parsed_meta = {}
        if not isinstance(parsed_meta, dict):
            parsed_meta = {}

    emp = _target_employee(user, body.get("employeeId"))

    created = []
    for idx, upload in enumerate(uploads):
        meta = parsed_meta.get(upload.filename) or parsed_meta.get(str(idx)) or {}
        saved = await save_upload(upload, DOCUMENTS, MAX_FILE_BYTES)
        stored = saved["storedFileName"]
        doc = _new_document(
            user, emp,
            category=meta.get("category") or default_category,
            title=meta.get("title") or _strip_ext(upload.filename),
            fileName=upload.filename,
            fileType=saved["mimeType"],
            fileSize=format_bytes(saved["size"]),
            fileUrl=f"/api/documents/files/{stored}",
            expiryDate=meta.get("expiryDate") or default_expiry,
        )
        doc["storedFileName"] = stored
        created.append(doc)

    audit(user, "DOCUMENTS_MULTIPLE_UPLOADED", "DOCUMENTS", "DocumentBatch", f"batch_{now_ms()}", {
        "count": len(created),
        "totalSize": format_bytes(total_bytes),
        "employeeCode": emp.get("employeeCode"),
        "titles": [d.get("title") for d in created],
    })
    return JSONResponse(
        {"success": True, "count": len(created), "documents": created, "totalSize": format_bytes(total_bytes)},
        status_code=201,
    )


@router.get("/documents/{doc_id}/download")
async def download_document(doc_id: str, _: dict = Depends(require_auth)):
    doc = db_store.documents.get(doc_id)
    if not doc:
        raise ApiError(404, "Document record not found.")

    stored = doc.get("storedFileName")
    if stored:
        response = await stored_file_response(DOCUMENTS, stored, doc.get("fileName"))
        if response:
            return response

    content = (
        "%PDF-1.4\n% vetan.ai HRMS Enterprise Compliance Document Vault\n"
        f"Document: {doc.get('title')}\nEmployee: {doc.get('employeeName')} ({doc.get('employeeCode')})\n"
        f"Department: {doc.get('department')}\nCategory: {doc.get('category')}\nStatus: {doc.get('status')}\n"
        f"Verified By: {doc.get('verifiedBy') or 'Pending'}\nTimestamp: {doc.get('uploadedAt')}\n"
    )
    return Response(
        content.encode("utf-8"),
        media_type=doc.get("fileType") or "application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{doc.get("fileName")}"'},
    )


@router.post("/documents/{doc_id}/verify")
async def verify_document(doc_id: str, user: dict = Depends(require_role("ADMIN"))):
    updated = db_store.update_document(doc_id, {
        "status": "VERIFIED",
        "verifiedBy": f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})",
        "verifiedAt": now_iso(),
        "rejectionReason": None,
    })
    if not updated:
        raise ApiError(404, "Document not found.")
    audit(user, "DOCUMENT_VERIFIED", "DOCUMENTS", "Document", doc_id, {"title": updated.get("title")})
    return {"success": True, "document": updated}


@router.post("/documents/{doc_id}/reject")
async def reject_document(doc_id: str, request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    reason = body.get("reason")
    if not truthy(reason):
        raise ApiError(400, "Rejection reason is required.")
    updated = db_store.update_document(doc_id, {
        "status": "REJECTED",
        "rejectionReason": reason,
        "verifiedBy": f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})",
        "verifiedAt": now_iso(),
    })
    if not updated:
        raise ApiError(404, "Document not found.")
    audit(user, "DOCUMENT_REJECTED", "DOCUMENTS", "Document", doc_id, {"title": updated.get("title"), "reason": reason})
    return {"success": True, "document": updated}


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(require_auth)):
    doc = db_store.documents.get(doc_id)
    if not doc:
        raise ApiError(404, "Document not found.")
    if user.get("role") not in ("ADMIN", "HR") and doc.get("employeeId") != user.get("employeeId"):
        raise ApiError(403, "Unauthorized to delete this document.")

    db_store.update_document(doc_id, {
        "isDeleted": True,
        "deletedAt": now_iso(),
        "deletedBy": f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})",
    })
    audit(user, "DOCUMENT_DELETED", "DOCUMENTS", "Document", doc_id, {"title": doc.get("title")})
    return {"success": True, "message": "Document archived to soft-deleted vault."}


@router.post("/documents/{doc_id}/restore")
async def restore_document(doc_id: str, user: dict = Depends(require_role("ADMIN"))):
    doc = db_store.documents.get(doc_id)
    if not doc:
        raise ApiError(404, "Document not found.")
    db_store.update_document(doc_id, {"isDeleted": False, "deletedAt": None, "deletedBy": None})
    audit(user, "DOCUMENT_RESTORED", "DOCUMENTS", "Document", doc_id, {"title": doc.get("title")})
    return {"success": True, "message": "Document restored successfully."}


# ------------------------------------------------------------- lifecycle

@router.get("/lifecycle/events")
async def lifecycle_events(eventType: Optional[str] = None, employeeId: Optional[str] = None, user: dict = Depends(require_auth)):
    events = db_store.get_lifecycle_events_for_user(user, event_type=eventType, employee_id=employeeId)
    return {"total": len(events), "events": events}


@router.post("/lifecycle/events")
async def create_lifecycle_event(request: Request, user: dict = Depends(require_role("ADMIN"))):
    body = await read_body(request)
    employee_id = body.get("employeeId")
    event_type = body.get("eventType")
    effective_date = body.get("effectiveDate")
    new_value = body.get("newValue")
    reason = body.get("reason")
    if not all(truthy(v) for v in (employee_id, event_type, effective_date, new_value, reason)):
        raise ApiError(400, "employeeId, eventType, effectiveDate, newValue, and reason are required.")

    emp = db_store.get_employee_by_id(employee_id)
    if not emp:
        raise ApiError(404, "Employee not found.")

    new_event = db_store.create_lifecycle_event({
        "employeeId": emp["_id"],
        "employeeName": f"{emp.get('firstName')} {emp.get('lastName')}",
        "employeeCode": emp.get("employeeCode"),
        "department": emp.get("department"),
        "eventType": event_type,
        "effectiveDate": effective_date,
        "previousValue": body.get("previousValue") or "Current",
        "newValue": new_value,
        "reason": reason,
        "initiatedBy": f"{user.get('firstName')} {user.get('lastName')} ({user.get('role')})",
        "approvalStatus": "APPROVED",
        "notes": body.get("notes"),
    })

    if event_type in ("PROMOTION", "DESIGNATION_CHANGE"):
        db_store.update_employee(emp["_id"], {"designation": new_value})
    elif event_type == "TRANSFER":
        db_store.update_employee(emp["_id"], {"department": new_value})
    elif event_type == "CONFIRMATION":
        db_store.update_employee(emp["_id"], {"status": "ACTIVE"})
    elif event_type == "STATUS_CHANGE":
        db_store.update_employee(emp["_id"], {"status": new_value})

    if emp.get("userId"):
        db_store.notifications.insert(0, {
            "_id": f"notif_{now_ms()}",
            "recipientUserId": emp["userId"],
            "title": f"Career Lifecycle Update: {event_type}",
            "message": f"Your profile has been updated ({event_type}): {new_value}. Effective {effective_date}.",
            "type": "SYSTEM",
            "isRead": False,
            "createdAt": now_iso(),
        })

    details = {k: v for k, v in {
        "previousValue": body.get("previousValue"), "newValue": new_value, "effectiveDate": effective_date, "reason": reason,
    }.items() if v is not None}
    audit(user, f"LIFECYCLE_{event_type}", "LIFECYCLE", "Employee", emp["_id"], details)
    return JSONResponse(
        {"success": True, "event": new_event, "updatedEmployee": db_store.get_employee_by_id(emp["_id"])},
        status_code=201,
    )
