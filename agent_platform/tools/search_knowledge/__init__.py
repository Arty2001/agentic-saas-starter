"""Search the built-in product knowledge base.

Unlike the planner tools, this one never talks to the SaaS API — it searches
the markdown docs shipped under agent_platform/knowledge/. It exists to show
a second kind of tool: model-driven (the support agent's LLM decides when and
what to search, ReAct-style) rather than plan-driven.

The scoring is deliberately simple keyword overlap. Swap in your vector
store here if you have one; the tool contract doesn't change.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_KNOWLEDGE_DIR = Path(__file__).resolve().parents[2] / "knowledge"

_WORD_RE = re.compile(r"[a-z0-9]+")

# Words too common to signal relevance in this corpus.
_STOPWORDS = {
    "a", "an", "and", "are", "can", "do", "does", "for", "how", "i", "in",
    "is", "it", "my", "of", "on", "or", "the", "to", "what", "when", "why",
    "with", "you",
}


def _tokenize(text: str) -> set[str]:
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOPWORDS}


@lru_cache(maxsize=1)
def _load_sections() -> list[dict[str, str]]:
    """Split every knowledge doc into (source, heading, body) sections."""
    sections: list[dict[str, str]] = []
    for doc in sorted(_KNOWLEDGE_DIR.glob("*.md")):
        heading = doc.stem
        body_lines: list[str] = []
        for line in doc.read_text(encoding="utf-8").splitlines():
            if line.startswith("#"):
                if body_lines:
                    sections.append(
                        {"source": doc.name, "heading": heading, "content": "\n".join(body_lines).strip()}
                    )
                    body_lines = []
                heading = line.lstrip("# ").strip()
            else:
                body_lines.append(line)
        if body_lines:
            sections.append(
                {"source": doc.name, "heading": heading, "content": "\n".join(body_lines).strip()}
            )
    return [s for s in sections if s["content"]]


async def run(query: str, top_k: int = 3) -> dict[str, Any]:
    query_tokens = _tokenize(query)
    if not query_tokens:
        return {"error": True, "message": "Query is empty after normalization."}

    scored: list[tuple[float, dict[str, str]]] = []
    for section in _load_sections():
        section_tokens = _tokenize(f"{section['heading']} {section['content']}")
        overlap = query_tokens & section_tokens
        if not overlap:
            continue
        # Overlap weighted toward covering the query, with a small boost
        # for heading hits.
        score = len(overlap) / len(query_tokens)
        if query_tokens & _tokenize(section["heading"]):
            score += 0.5
        scored.append((score, section))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    results = [
        {**section, "score": round(score, 3)}
        for score, section in scored[: max(1, top_k)]
    ]

    if not results:
        return {
            "results": [],
            "message": "No matching documentation found for this query.",
        }
    return {"results": results}
