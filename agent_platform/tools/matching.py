"""Shared fuzzy name matching for tools.

Users type "sam" and "website"; your SaaS knows "Sam Torres" and "Website
Redesign". Tools resolve names with this matcher and turn misses into
clarification responses instead of errors — the agent's clarification loop
does the rest.

Matching order: exact → case-insensitive → substring → accent/spacing
normalized. `candidates` returns every plausible hit so callers can
distinguish "no match" from "ambiguous".
"""
from __future__ import annotations

import re
import unicodedata

_WORD_SEPS = re.compile(r"[\s\-_]+")


def normalize(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    return _WORD_SEPS.sub(" ", stripped.lower().strip())


def candidates(query: str, canonicals: list[str]) -> list[str]:
    """All plausible canonical matches for a query, best tier first."""
    q = query.strip()
    if not q:
        return []
    if q in canonicals:
        return [q]

    q_lower = q.lower()
    ci = [c for c in canonicals if c.lower() == q_lower]
    if ci:
        return ci

    sub = [c for c in canonicals if q_lower in c.lower() or c.lower() in q_lower]
    if sub:
        return sub

    q_norm = normalize(q)
    norm_exact = [c for c in canonicals if normalize(c) == q_norm]
    if norm_exact:
        return norm_exact
    return [c for c in canonicals if q_norm in normalize(c) or normalize(c) in q_norm]


def resolve(query: str, canonicals: list[str]) -> tuple[str | None, list[str]]:
    """Resolve a query to exactly one canonical name.

    Returns (match, suggestions): a unique hit gives (name, []); an
    ambiguous or missing one gives (None, options-to-ask-about).
    """
    hits = candidates(query, canonicals)
    if len(hits) == 1:
        return hits[0], []
    if not hits:
        return None, list(canonicals)
    return None, hits
