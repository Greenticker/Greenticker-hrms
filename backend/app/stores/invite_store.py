"""Storage for onboarding invite / password-setup tokens."""

from typing import Optional

from app.stores.db_store import merge
from app.utils.jsutil import iso_from_ms, now_iso, now_ms, rand_int

INVITE_TTL_HOURS = 48

password_setup_tokens: dict = {}


class InviteStore:
    def create_setup_token(self, user_id: str, employee_id: str, token_hash: str, created_by: str) -> dict:
        now = now_ms()
        token_id = f"pst_{now}_{rand_int(100000)}"
        doc = {
            "_id": token_id,
            "userId": user_id,
            "employeeId": employee_id,
            "tokenHash": token_hash,
            "purpose": "ONBOARDING_INVITE",
            "expiresAt": iso_from_ms(now + INVITE_TTL_HOURS * 60 * 60 * 1000),
            "createdBy": created_by,
            "createdAt": iso_from_ms(now),
        }
        password_setup_tokens[token_id] = doc
        return doc

    def find_setup_token_by_hash(self, token_hash: str) -> Optional[dict]:
        for t in password_setup_tokens.values():
            if t.get("tokenHash") == token_hash:
                return t
        return None

    def find_setup_token_by_id(self, token_id: str) -> Optional[dict]:
        return password_setup_tokens.get(token_id)

    def get_pending_setup_token_for_user(self, user_id: str) -> Optional[dict]:
        pending = [
            t for t in password_setup_tokens.values()
            if t.get("userId") == user_id and not t.get("usedAt") and not t.get("revokedAt")
        ]
        pending.sort(key=lambda t: t.get("createdAt") or "", reverse=True)
        return pending[0] if pending else None

    def revoke_active_tokens_for_user(self, user_id: str) -> None:
        now = now_iso()
        for token_id, t in list(password_setup_tokens.items()):
            if t.get("userId") == user_id and not t.get("usedAt") and not t.get("revokedAt"):
                password_setup_tokens[token_id] = {**t, "revokedAt": now}

    def update_setup_token(self, token_id: str, partial: dict) -> None:
        t = password_setup_tokens.get(token_id)
        if t:
            password_setup_tokens[token_id] = merge(t, partial)


invite_store = InviteStore()
