"""
MongoDB persistence for the in-memory stores.

- MongoDB is the source of truth. On first boot the seed data is written to it;
  on every later boot the data is loaded from it (seed data is NOT re-applied).
- The stores (db_store / modules_store) stay as an in-process cache, so route code
  works on plain dicts.
- After each write request (and every 15s as a safety net) the collections are
  diffed against what was last saved, and only changed documents are written.
  This also catches in-place edits such as `emp["status"] = "X"`.
- data/hrms_store.json is always written as a local copy and is loaded first.

The collection layout and document format match the previous Express server, so
existing data is picked up unchanged.
"""

import asyncio
import json
import os
import random
import string
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from pymongo import AsyncMongoClient, DeleteOne, ReplaceOne

from app.config import DATA_FILE
from app.stores.db_store import db_store
from app.stores.invite_store import password_setup_tokens
from app.stores.modules_store import modules_store
from app.stores.pms_store import pms_store
from app.utils.jsutil import iso, now_iso


class Binding:
    def __init__(self, name: str, kind: str, container: Callable[[], Any], newest_first: bool = False):
        self.name = name  # MongoDB collection name
        self.kind = kind  # 'map' | 'array'
        self.newest_first = newest_first  # arrays only: True if new items are inserted at index 0
        self.container = container


def _map(name: str, container: Callable[[], dict]) -> Binding:
    return Binding(name, "map", container)


def _list(name: str, container: Callable[[], list], newest_first: bool) -> Binding:
    return Binding(name, "array", container, newest_first)


BINDINGS = [
    # core store
    _map("users", lambda: db_store.users),
    _map("employees", lambda: db_store.employees),
    _map("organizations", lambda: db_store.organizations),
    _map("departments", lambda: db_store.departments),
    _map("designations", lambda: db_store.designations),
    _map("locations", lambda: db_store.locations),
    _map("onboardingSubmissions", lambda: db_store.onboardingSubmissions),
    _map("passwordSetupTokens", lambda: password_setup_tokens),
    _map("documents", lambda: db_store.documents),
    _map("shifts", lambda: db_store.shifts),
    _map("attendanceRecords", lambda: db_store.attendanceRecords),
    _list("lifecycleEvents", lambda: db_store.lifecycleEvents, True),
    _list("auditLogs", lambda: db_store.auditLogs, True),
    _list("notifications", lambda: db_store.notifications, True),
    # modules store
    _map("leaveBalances", lambda: modules_store.leaveBalances),
    _map("leaveRequests", lambda: modules_store.leaveRequests),
    _map("expenseClaims", lambda: modules_store.expenseClaims),
    _map("payslips", lambda: modules_store.payslips),
    _map("taxDeclarations", lambda: modules_store.taxDeclarations),
    _map("policies", lambda: modules_store.policies),
    _list("policyAcknowledgements", lambda: modules_store.policyAcknowledgements, False),
    _map("poshCases", lambda: modules_store.poshCases),
    _map("holidays", lambda: modules_store.holidays),
    _map("announcements", lambda: modules_store.announcements),
    _map("performanceReviews", lambda: modules_store.performanceReviews),
    _map("jobOpenings", lambda: modules_store.jobOpenings),
    _map("jobCandidates", lambda: modules_store.jobCandidates),
    _map("requirements", lambda: modules_store.requirements),
    _map("referrals", lambda: modules_store.referrals),
    _map("assets", lambda: modules_store.assets),
    _map("hrRequests", lambda: modules_store.hrRequests),
    _map("fullFinalSettlements", lambda: modules_store.fullFinalSettlements),
    _map("insuranceEnrollments", lambda: modules_store.insuranceEnrollments),
    _map("insuranceClaims", lambda: modules_store.insuranceClaims),
    # performance management store
    _map("pmsCycles", lambda: pms_store.pmsCycles),
    _map("pmsTemplates", lambda: pms_store.pmsTemplates),
    _map("pmsKpiLibrary", lambda: pms_store.pmsKpiLibrary),
    _map("pmsCompetencies", lambda: pms_store.pmsCompetencies),
    _map("pmsGoalSheets", lambda: pms_store.pmsGoalSheets),
    _map("pmsSettings", lambda: pms_store.pmsSettings),
    _map("pmsCheckins", lambda: pms_store.pmsCheckins),
    _map("pms360Questions", lambda: pms_store.pms360Questions),
    _map("pms360Nominations", lambda: pms_store.pms360Nominations),
    _map("pms360Assignments", lambda: pms_store.pms360Assignments),
    _map("pms360Responses", lambda: pms_store.pms360Responses),
    _map("pmsAppraisals", lambda: pms_store.pmsAppraisals),
    _map("pmsPips", lambda: pms_store.pmsPips),
    _map("pmsNotes", lambda: pms_store.pmsNotes),
]


class _State:
    def __init__(self) -> None:
        self.snapshot: dict = {}  # key -> JSON of what is saved (without __seq)
        self.seq: dict = {}  # arrays only: key -> position used to restore order


_states: dict = {}
# Stable Mongo _id for array items, by object identity. Holds a reference so ids stay valid.
_key_of: dict = {}
_seq_counter = 0

_client: Optional[AsyncMongoClient] = None
_db = None
_lock = asyncio.Lock()
_pending: Optional[asyncio.TimerHandle] = None
_interval_task: Optional[asyncio.Task] = None


def _state(name: str) -> _State:
    if name not in _states:
        _states[name] = _State()
    return _states[name]


def _dumps(body: dict) -> str:
    return json.dumps(body, ensure_ascii=False, default=str)


def _rand36(n: int) -> str:
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(n))


# --------------------------------------------------------------------------
# Document <-> Mongo body conversion
# --------------------------------------------------------------------------

def _to_body(key: str, v: dict) -> dict:
    rest = {k: val for k, val in v.items() if k != "_id"}
    body = {"_id": key, **rest}
    if "_id" not in v or v["_id"] is None:
        body["__noId"] = True
    elif v["_id"] != key:
        body["__origId"] = v["_id"]
    return body


def _plain(v: Any) -> Any:
    """BSON-only values (ObjectId, datetime, ...) -> JSON-friendly strings."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    if isinstance(v, datetime):
        return iso(v if v.tzinfo else v.replace(tzinfo=timezone.utc))
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _from_body(d: dict) -> tuple:
    d = _plain(d)
    rest = {k: v for k, v in d.items() if k not in ("_id", "__origId", "__noId", "__seq")}
    if d.get("__noId"):
        value = rest
    else:
        value = {"_id": d.get("__origId", d.get("_id")), **rest}
    return str(d.get("_id")), value, d.get("__seq")


def _entries_of(b: Binding) -> list:
    c = b.container()
    if isinstance(c, dict):
        return [(str(k), v) for k, v in c.items()]

    used: set = set()
    out = []
    for v in c:
        entry = _key_of.get(id(v))
        key = entry[1] if entry and entry[0] is v else None
        if not key or key in used:
            key = str(v.get("_id") if v.get("_id") is not None else f"auto_{_rand36(11)}")
            if key in used:
                key = f"{key}~{_rand36(6)}"
            _key_of[id(v)] = (v, key)
        used.add(key)
        out.append((key, v))
    return out


def _fill(b: Binding, loaded: list) -> None:
    """Replace a container's contents (in place) with loaded (key, value, seq) tuples."""
    global _seq_counter
    st = _state(b.name)
    st.snapshot = {}
    st.seq = {}
    for _, _, seq in loaded:
        if isinstance(seq, (int, float)) and seq > _seq_counter:
            _seq_counter = int(seq)

    c = b.container()
    if isinstance(c, dict):
        c.clear()
        for key, value, _ in loaded:
            c[key] = value
            st.snapshot[key] = _dumps(_to_body(key, value))
    else:
        loaded = sorted(loaded, key=lambda x: x[2] if isinstance(x[2], (int, float)) else 0, reverse=b.newest_first)
        c.clear()
        for key, value, seq in loaded:
            c.append(value)
            _key_of[id(value)] = (value, key)
            st.snapshot[key] = _dumps(_to_body(key, value))
            if isinstance(seq, (int, float)):
                st.seq[key] = seq


# --------------------------------------------------------------------------
# Local JSON file
# --------------------------------------------------------------------------

def _save_to_file() -> None:
    try:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        store_data = {}
        for b in BINDINGS:
            st = _state(b.name)
            items = []
            for key, value in _entries_of(b):
                item = {"key": key, "value": value}
                if key in st.seq:
                    item["seq"] = st.seq[key]
                items.append(item)
            store_data[b.name] = items
        tmp = DATA_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(store_data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        os.replace(tmp, DATA_FILE)
    except Exception as err:  # noqa: BLE001 - persistence must never crash a request
        print("[fileStore] failed to save data:", err)


def _load_from_file() -> bool:
    try:
        if not DATA_FILE.exists():
            return False
        store_data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        for b in BINDINGS:
            loaded_list = store_data.get(b.name)
            if not isinstance(loaded_list, list):
                continue
            _fill(b, [(item.get("key"), item.get("value"), item.get("seq")) for item in loaded_list])
        print("[fileStore] Loaded data from local JSON file.")
        return True
    except Exception as err:  # noqa: BLE001
        print("[fileStore] failed to load data:", err)
        return False


# --------------------------------------------------------------------------
# Sync: memory -> Mongo (only changed documents)
# --------------------------------------------------------------------------

async def _sync_now() -> None:
    global _seq_counter
    if _db is not None:
        for b in BINDINGS:
            st = _state(b.name)
            entries = _entries_of(b)
            next_snapshot = {}
            changed = []
            new_keys = []

            for key, value in entries:
                body = _to_body(key, value)
                text = _dumps(body)
                next_snapshot[key] = text
                if b.kind == "array" and key not in st.seq:
                    new_keys.append(key)
                if st.snapshot.get(key) != text:
                    changed.append((key, body))

            # Order for arrays: newest-first lists give index 0 the highest sequence number.
            if b.kind == "array" and new_keys:
                ordered = list(reversed(new_keys)) if b.newest_first else new_keys
                for key in ordered:
                    _seq_counter += 1
                    st.seq[key] = _seq_counter

            ops = []
            for key, body in changed:
                replacement = {**body, "__seq": st.seq.get(key)} if b.kind == "array" else body
                ops.append(ReplaceOne({"_id": key}, replacement, upsert=True))
            for key in list(st.snapshot):
                if key not in next_snapshot:
                    ops.append(DeleteOne({"_id": key}))
                    st.seq.pop(key, None)

            if ops:
                await _db[b.name].bulk_write(ops, ordered=False)
            st.snapshot = next_snapshot
    else:
        # Keep sequence numbers for new array items even without MongoDB, so file order survives.
        for b in BINDINGS:
            if b.kind != "array":
                continue
            st = _state(b.name)
            new_keys = [k for k, _ in _entries_of(b) if k not in st.seq]
            for key in (list(reversed(new_keys)) if b.newest_first else new_keys):
                _seq_counter += 1
                st.seq[key] = _seq_counter
    _save_to_file()


async def enqueue_sync() -> None:
    async with _lock:
        try:
            await _sync_now()
        except Exception as err:  # noqa: BLE001
            print("[mongo] sync failed:", err)


def schedule_sync(delay_s: float = 0.25) -> None:
    """Persist shortly after a write request (calls within the delay are coalesced)."""
    global _pending
    if _pending is not None:
        return
    loop = asyncio.get_running_loop()

    def fire() -> None:
        global _pending
        _pending = None
        loop.create_task(enqueue_sync())

    _pending = loop.call_later(delay_s, fire)


async def _interval_loop() -> None:
    while True:
        await asyncio.sleep(15)
        await enqueue_sync()


# --------------------------------------------------------------------------
# Load: Mongo -> memory
# --------------------------------------------------------------------------

async def _load_from_mongo(database) -> None:
    for b in BINDINGS:
        docs = await database[b.name].find({}).to_list(None)
        _fill(b, [_from_body(d) for d in docs])


async def _ensure_indexes(database) -> None:
    try:
        await database["users"].create_index(
            [("email", 1)], unique=True, partialFilterExpression={"email": {"$type": "string"}}
        )
        try:
            await database["employees"].drop_index("employeeCode_1")
        except Exception:  # noqa: BLE001 - index may not exist
            pass
        await database["employees"].create_index(
            [("employeeCode", 1)], partialFilterExpression={"employeeCode": {"$type": "string"}}
        )
        await database["employees"].create_index([("workEmail", 1)])
        await database["documents"].create_index([("employeeId", 1)])
        await database["notifications"].create_index([("recipientUserId", 1)])
    except Exception as err:  # noqa: BLE001
        print("[mongo] index creation skipped:", err)


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

def is_connected() -> bool:
    return _db is not None


async def connect() -> None:
    global _client, _db, _interval_task
    # Always try the local JSON file first so previously created data is retained.
    _load_from_file()
    _interval_task = asyncio.get_running_loop().create_task(_interval_loop())

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        print("[mongo] MONGODB_URI not set. Operating with local file persistence.")
        return
    db_name = os.environ.get("MONGODB_DB_NAME") or "zenith_hrms"
    print("[mongo] target:", uri.split("@")[-1].split("?")[0] if "@" in uri else uri.split("?")[0])
    print("[mongo] db name:", db_name)

    try:
        _client = AsyncMongoClient(uri, serverSelectionTimeoutMS=5000)
        _db = _client[db_name]
        await _db.command("ping")

        meta = _db["_meta"]
        seeded = await meta.find_one({"_id": "seeded"})
        if not seeded:
            # First run: the stores hold the data (seed or loaded from the local file), so save it.
            await _sync_now()
            await meta.update_one({"_id": "seeded"}, {"$set": {"at": now_iso()}}, upsert=True)
            print(f'[mongo] First run - data saved to MongoDB ("{db_name}").')
        else:
            await _load_from_mongo(_db)
            print(f'[mongo] Loaded existing data from MongoDB ("{db_name}").')

        await _ensure_indexes(_db)
    except Exception as err:  # noqa: BLE001
        print("[mongo] WARNING: Could not connect to MongoDB. Operating with local file persistence:", err)
        if _client is not None:
            await _client.close()
        _client = None
        _db = None


async def flush_and_close() -> None:
    global _client, _db, _pending
    if _pending is not None:
        _pending.cancel()
        _pending = None
    if _interval_task is not None:
        _interval_task.cancel()
    await enqueue_sync()
    if _client is not None:
        await _client.close()
    _client = None
    _db = None
