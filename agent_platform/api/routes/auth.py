import logging

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from agent_platform.auth import (
    clear_auth_cookies,
    create_token_from_credentials,
    rate_limit_login,
    require_auth,
    set_auth_cookies,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    user_id: str
    expires: int | None = None


class MeResponse(BaseModel):
    user_id: str


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request, response: Response) -> LoginResponse:
    ip = _client_ip(request)
    rate_limit_login(ip)
    issued = await create_token_from_credentials(body.username, body.password, ip)
    set_auth_cookies(response, issued)
    logger.info("login_success: user=%s", issued.user_id)
    return LoginResponse(user_id=issued.user_id, expires=issued.expires)


@router.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    clear_auth_cookies(response)


@router.get("/me", response_model=MeResponse)
async def me(user_id: str = Depends(require_auth)) -> MeResponse:
    return MeResponse(user_id=user_id)
