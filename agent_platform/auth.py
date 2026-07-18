"""Token validation against your SaaS's identity service.

The pattern demonstrated here: the agent layer never owns identity. It
accepts the same token your SaaS already issues (header or cookie),
validates it against your existing auth endpoint, and forwards it on
tool calls so the SaaS API enforces its own permissions.

Three modes:
- **Identity service configured** (`AUTH_SERVICE_URL`): tokens are
  validated remotely; login proxies to the service's createToken route.
- **Service token** (`APPLICATION_TOKEN`): a static token for
  service-to-service callers (CI, internal jobs).
- **Dev mode** (`IS_DEV=true`, no identity service): any username /
  password logs in and a locally issued token is accepted. This is what
  makes the starter runnable with zero external services — never enable
  it in production (`assert_auth_configured` guards this).
"""

import logging
import secrets
import time
from collections import deque
from dataclasses import dataclass

import httpx
from fastapi import HTTPException, Request, Response

from agent_platform.config import get_settings

logger = logging.getLogger(__name__)

TOKEN_HEADER = "X-HTTP-AUTH-TOKEN"
USER_HEADER = "X-HTTP-AUTH-USER"
AUTH_TIMEOUT = 15.0

LOGIN_WINDOW = 60.0
LOGIN_MAX = 10
_login_attempts: dict[str, deque[float]] = {}

# Dev-mode tokens issued by this process (token -> user_id).
_dev_tokens: dict[str, str] = {}


def _cookie_suffix() -> str:
    settings = get_settings()
    return "" if settings.env == "production" else settings.env


def token_cookie_name() -> str:
    return f"authToken{_cookie_suffix()}"


def user_cookie_name() -> str:
    return f"authUser{_cookie_suffix()}"


def _get_user_and_token(request: Request) -> tuple[str | None, str | None]:
    token = request.headers.get(TOKEN_HEADER) or request.cookies.get(token_cookie_name())
    user_id = request.headers.get(USER_HEADER) or request.cookies.get(user_cookie_name())
    return user_id, token


@dataclass(frozen=True)
class IssuedToken:
    token: str
    user_id: str
    expires: int | None


def _dev_mode_active() -> bool:
    settings = get_settings()
    return settings.is_dev and not settings.auth_service_url


async def _validate_token_remote(user_id: str, token: str) -> None:
    settings = get_settings()
    url = f"{settings.auth_service_url.rstrip('/')}/validateToken"
    headers = {
        "Content-Type": "application/json",
        TOKEN_HEADER: token,
        USER_HEADER: user_id,
    }
    try:
        async with httpx.AsyncClient(timeout=AUTH_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
    except httpx.RequestError as exc:
        logger.error("auth_validate_unreachable: %s", type(exc).__name__)
        raise HTTPException(503, "Authentication service unavailable.") from None

    if resp.status_code == 401:
        raise HTTPException(401, "Invalid token.")
    if resp.status_code == 403:
        raise HTTPException(403, "Access denied.")
    if resp.status_code >= 500:
        logger.error("auth_validate_5xx: status=%s", resp.status_code)
        raise HTTPException(503, "Authentication service unavailable.")
    if not (200 <= resp.status_code < 300):
        logger.warning("auth_validate_unexpected: status=%s", resp.status_code)
        raise HTTPException(401, "Token validation failed.")


async def create_token_from_credentials(
    username: str, password: str, remote_ip: str | None
) -> IssuedToken:
    if _dev_mode_active():
        token = secrets.token_urlsafe(32)
        _dev_tokens[token] = username
        logger.warning("dev_login: issuing local token for %s (no identity service)", username)
        return IssuedToken(token=token, user_id=username, expires=None)

    # 401/419/423 collapse to one generic 401 so failures don't leak account state.
    settings = get_settings()
    url = f"{settings.auth_service_url.rstrip('/')}/createToken"
    headers = {"Content-Type": "application/json"}
    body = {"username": username, "password": password, "remoteAddress": remote_ip or ""}

    try:
        async with httpx.AsyncClient(timeout=AUTH_TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=body)
    except httpx.RequestError as exc:
        logger.error("auth_createToken_unreachable: %s user=%s", type(exc).__name__, username)
        raise HTTPException(503, "Authentication service unavailable.") from None

    if resp.status_code in (401, 419, 423):
        logger.info("login_rejected: status=%s user=%s", resp.status_code, username)
        raise HTTPException(401, "Invalid username or password.")
    if resp.status_code == 403:
        logger.warning("login_forbidden_ip: user=%s ip=%s", username, remote_ip)
        raise HTTPException(403, "This IP is not authorized for this account.")
    if resp.status_code >= 500:
        logger.error("auth_createToken_5xx: status=%s", resp.status_code)
        raise HTTPException(503, "Authentication service unavailable.")
    if not (200 <= resp.status_code < 300):
        logger.warning("auth_createToken_unexpected: status=%s", resp.status_code)
        raise HTTPException(401, "Invalid username or password.")

    try:
        data = resp.json().get("data") or {}
        token = data["token"]
        user_id = data["username"]
        raw = data.get("tokenExpires")
        expires = int(raw) if raw is not None else None
    except (ValueError, KeyError, TypeError):
        logger.error("auth_createToken_malformed_response")
        raise HTTPException(502, "Invalid response from authentication service.") from None

    return IssuedToken(token=token, user_id=user_id, expires=expires)


def _cookie_attrs() -> dict:
    # secure=True everywhere except local dev over plain http.
    return {
        "httponly": True,
        "secure": not get_settings().is_dev,
        "samesite": "lax",
        "path": "/",
    }


def set_auth_cookies(response: Response, issued: IssuedToken) -> None:
    attrs = _cookie_attrs()
    response.set_cookie(token_cookie_name(), issued.token, **attrs)
    response.set_cookie(user_cookie_name(), issued.user_id, **attrs)


def clear_auth_cookies(response: Response) -> None:
    attrs = _cookie_attrs()
    response.delete_cookie(token_cookie_name(), **attrs)
    response.delete_cookie(user_cookie_name(), **attrs)


def rate_limit_login(client_ip: str) -> None:
    now = time.monotonic()
    bucket = _login_attempts.setdefault(client_ip, deque())
    while bucket and bucket[0] < now - LOGIN_WINDOW:
        bucket.popleft()
    if len(bucket) >= LOGIN_MAX:
        raise HTTPException(429, "Too many login attempts. Try again later.")
    bucket.append(now)


def assert_auth_configured() -> None:
    settings = get_settings()
    if settings.env == "production" and settings.is_dev:
        raise RuntimeError("IS_DEV must not be true when ENV=production")
    if settings.env == "production" and not settings.auth_service_url:
        raise RuntimeError("AUTH_SERVICE_URL must be configured in production")
    if _dev_mode_active():
        logger.warning(
            "auth running in DEV MODE: any credentials are accepted. "
            "Set AUTH_SERVICE_URL to validate against your identity service."
        )


async def require_auth(request: Request) -> str:
    settings = get_settings()
    user_id, token = _get_user_and_token(request)

    if (
        token
        and settings.application_token
        and secrets.compare_digest(token, settings.application_token)
    ):
        return user_id or "service-account"

    if not user_id or not token:
        raise HTTPException(401, "Missing authentication credentials.")

    if _dev_mode_active():
        if _dev_tokens.get(token) == user_id:
            return user_id
        raise HTTPException(401, "Invalid token.")

    await _validate_token_remote(user_id, token)
    return user_id
