"""Pydantic-settings configuration for the agent platform.

Everything is read from environment variables (or a local `.env` file).
This is intentionally the only place configuration enters the system —
swap in your own secret manager or service discovery here if you have one.
"""

import logging
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


def bootstrap_config() -> None:
    """Hook for loading configuration from an external source at startup.

    The starter reads everything from env vars / .env, so this is a no-op.
    If your deployment uses a secret manager or service discovery (Vault,
    Consul, SSM, ...), resolve those values into os.environ here before
    Settings is constructed.
    """


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database (LangGraph checkpoints + observability tables) -----------
    agent_db: str = "postgresql+psycopg://postgres:postgres@localhost:5432/agent_platform"

    # --- LLM ----------------------------------------------------------------
    # Any OpenAI-compatible endpoint works (openai, vllm, deepseek) plus
    # anthropic. See agent_platform/llm/client.py.
    default_llm_provider: str = "openai"
    default_llm_model: str = "gpt-4o"
    default_llm_base_url: str | None = None

    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    deepseek_api_key: str | None = None

    # --- Server -------------------------------------------------------------
    server_host: str = "0.0.0.0"
    server_port: int = 8080
    log_level: str = "INFO"

    is_dev: bool = False
    env: str = "dev"

    # --- Your SaaS backend ---------------------------------------------------
    # The REST API of the SaaS product this agent layer is being added to.
    # When unset, tools fall back to their in-process mock backend so the
    # whole demo runs with zero external services.
    saas_api_url: str = ""

    # Identity service of your SaaS (token validation / login). When unset
    # and is_dev is true, auth falls back to an accept-anything dev mode.
    auth_service_url: str = ""

    # Static service-to-service token accepted as an alternative to user
    # tokens (e.g. for internal callers / CI), and the user the platform
    # acts as when running with that token (scheduled regression runs).
    application_token: str = ""
    service_account_user: str = ""

    @property
    def checkpoint_conn_string(self) -> str:
        """Plain libpq URI for the LangGraph checkpointer.

        SQLAlchemy needs the ``postgresql+psycopg://`` dialect prefix;
        psycopg itself wants a bare ``postgresql://`` URI. Same database,
        two spellings.
        """
        return self.agent_db.replace("postgresql+psycopg://", "postgresql://")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
