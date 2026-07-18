"""Schemas for the create_task tool."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class InputSchema(BaseModel):
    """Input schema for create_task."""

    title: str = Field(
        min_length=1,
        description="Short imperative task title, e.g. 'Draft the launch announcement'.",
    )
    projectName: str | None = Field(
        default=None,
        description=(
            "Project to create the task in. Fuzzy-matched against the "
            "workspace's projects — pass through whatever the user said. "
            "Omit to use the workspace default."
        ),
    )
    assigneeName: str | None = Field(
        default=None,
        description=(
            "Team member to assign. Fuzzy-matched against the workspace "
            "roster — pass through whatever the user said ('sam' is fine). "
            "Omit to leave unassigned."
        ),
    )
    dueDate: str | None = Field(
        default=None,
        description="Due date as the user phrased it, e.g. '2026-08-01' or 'next Friday'.",
    )
    priority: Literal["low", "medium", "high", "urgent"] | None = Field(
        default=None,
        description="Task priority. Omit for the default (medium).",
    )
