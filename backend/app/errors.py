from typing import Any


class ApiError(Exception):
    """Raised anywhere in a request to send `{"error": message, ...extra}` with the given status."""

    def __init__(self, status: int, error: str, **extra: Any):
        super().__init__(error)
        self.status = status
        self.body = {"error": error, **extra}
