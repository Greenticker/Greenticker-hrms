from pathlib import Path
from typing import List

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

# Only ever used for local development so tokens issued by the legacy Express
# server (which falls back to the same value) can still be verified.
_DEV_JWT_SECRET = "zenith-hrms-enterprise-jwt-super-secret-key-2026"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        # .env is shared with the Node server (PORT, SMTP_*, ...); ignore keys we don't model.
        extra="ignore",
    )

    PROJECT_NAME: str = "RHYA HRMS API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    APP_ENV: str = "development"  # development | production

    # JWT
    JWT_SECRET: str = _DEV_JWT_SECRET
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # MongoDB
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "zenith_hrms"

    # Gemini
    GEMINI_API_KEY: str = ""

    # Comma-separated list of allowed browser origins, e.g. "https://hr.example.com"
    CORS_ORIGINS: str = "http://localhost:3000"

    @property
    def ACCESS_TOKEN_EXPIRE_MINUTES(self) -> int:  # kept for existing callers
        return self.JWT_EXPIRE_MINUTES

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() == "production"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @model_validator(mode="after")
    def _refuse_insecure_production(self) -> "Settings":
        if self.is_production:
            if self.JWT_SECRET == _DEV_JWT_SECRET or len(self.JWT_SECRET) < 32:
                raise ValueError(
                    "JWT_SECRET must be set to a unique value of at least 32 characters "
                    "when APP_ENV=production."
                )
            if "*" in self.cors_origins_list:
                raise ValueError("CORS_ORIGINS must list explicit origins in production (no '*').")
        return self


settings = Settings()
