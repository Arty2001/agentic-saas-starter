"""Session-related API routes."""

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.api.dependencies import get_session_factory
from agent_platform.api.schemas import (
    TenantConfigCreate,
    TenantConfigResponse,
    TenantConfigUpdate,
)
from agent_platform.db.models import TenantConfig

router = APIRouter(tags=["client", "config"])


async def get_tenant_config(tenant_id: str, session_factory: async_sessionmaker[AsyncSession]) -> TenantConfig | None:
    stmt = (
        select(TenantConfig)
        .where(TenantConfig.code == tenant_id)
    )
    async with session_factory() as session:
        result = await session.execute(stmt)
        row = result.first()
    if row is not None:
        row, = row
    return row

@router.get("/tenant/{tenant_id}/config", response_model=TenantConfigResponse)
async def get_tenant_config_endpoint(
    tenant_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> TenantConfigResponse:

    config = await get_tenant_config(
        tenant_id=tenant_id,
        session_factory=session_factory
    )
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"Config for client: '{tenant_id}' not found"
        )
    return TenantConfigResponse(
            code=config.code,
            model=config.model,
            provider=cast(Any, config.provider),
        )


@router.post("/tenant/{tenant_id}/config", response_model=TenantConfigResponse)
async def post_tenant_config_endpoint(
    tenant_id: str,
    body: TenantConfigCreate,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> TenantConfigResponse:

    async with session_factory() as session:
        session.add(TenantConfig(
            code=tenant_id,
            model=body.model,
            provider=body.provider,
        ))
        await session.commit()

    return TenantConfigResponse(
            code=tenant_id,
            model=body.model,
            provider=body.provider,
        )


@router.put("/tenant/{tenant_id}/config", response_model=TenantConfigResponse)
async def put_tenant_config_endpoint(
    tenant_id: str,
    body: TenantConfigUpdate,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> TenantConfigResponse:

    async with session_factory() as session:
        await session.execute(update(TenantConfig).where(TenantConfig.code == tenant_id).values(
            model=body.model,
            provider=body.provider,
        ))
        await session.commit()

    return TenantConfigResponse(
            code=tenant_id,
            model=body.model,
            provider=body.provider,
        )
