"""Schemas for the search_knowledge tool."""
from __future__ import annotations

from pydantic import BaseModel, Field


class InputSchema(BaseModel):
    """Input schema for search_knowledge."""

    query: str = Field(
        min_length=1,
        description=(
            "Search terms describing what to look up in the product "
            "documentation, e.g. 'plan approval interrupt' or 'tool clarification'."
        ),
    )
    top_k: int = Field(
        default=3,
        ge=1,
        le=8,
        description="Maximum number of documentation sections to return.",
    )
