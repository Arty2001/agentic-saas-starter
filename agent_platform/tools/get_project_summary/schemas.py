"""Schemas for the get_project_summary tool."""
from __future__ import annotations

from pydantic import BaseModel, Field


class InputSchema(BaseModel):
    """Input schema for get_project_summary."""

    projectName: str = Field(
        min_length=1,
        description=(
            "Project to summarize. Fuzzy-matched against the workspace's "
            "projects — pass through whatever the user said."
        ),
    )
