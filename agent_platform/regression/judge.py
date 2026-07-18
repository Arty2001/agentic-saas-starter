"""LLM judge for semantic text equivalence between baseline and new responses.

Only invoked for turns whose final_text differs after whitespace
normalization (the structural diff already passed). Judge failures never
hard-fail a test — they degrade to a 'needs_review' verdict.
"""

from __future__ import annotations

import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from agent_platform.llm.client import get_llm
from agent_platform.regression.schemas import JudgeReport, JudgeTurnVerdict, TestSnapshot

logger = logging.getLogger(__name__)

_TEXT_LIMIT = 8000

_JUDGE_SYSTEM = """You are a strict regression judge for an AI media-planning assistant.
Compare a BASELINE response with a NEW response to the same user request.
They are EQUIVALENT only if they convey the same substantive content:
- the same facts, recommendations, conclusions and caveats
- the same numeric values (any changed, added, or missing number means NOT equivalent)
- the same entities (tasks, projects, assignees, workspaces)
Differences in wording, formatting, markdown, ordering of equivalent items,
greetings, or politeness do NOT matter.
Respond with ONLY a JSON object, no prose, no code fences:
{"equivalent": true|false, "differences": "<one short sentence describing substantive differences, or empty string>"}"""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _clip(text: str) -> str:
    if len(text) <= _TEXT_LIMIT:
        return text
    return text[:_TEXT_LIMIT] + "\n...[truncated]"


def _parse_verdict(raw: str) -> dict:
    m = _JSON_RE.search(raw or "")
    if not m:
        raise ValueError(f"no JSON object in judge output: {raw[:200]!r}")
    parsed = json.loads(m.group(0))
    if not isinstance(parsed, dict) or not isinstance(parsed.get("equivalent"), bool):
        raise ValueError(f"judge output missing boolean 'equivalent': {raw[:200]!r}")
    return parsed


def _user_prompt_for_turn(snapshot: TestSnapshot, turn_index: int) -> str:
    """The nearest preceding message/edit turn's text — what the user asked for."""
    for i in range(turn_index, -1, -1):
        turn_input = snapshot.turns[i].input or {}
        if turn_input.get("type") in ("message", "edit") and turn_input.get("text"):
            return str(turn_input["text"])
    return "(no user message)"


async def judge_turn(*, user_prompt: str, baseline_text: str, actual_text: str, turn_index: int) -> JudgeTurnVerdict:
    prompt = (
        f"USER REQUEST:\n{_clip(user_prompt)}\n\n"
        f"BASELINE RESPONSE:\n{_clip(baseline_text)}\n\n"
        f"NEW RESPONSE:\n{_clip(actual_text)}"
    )
    texts = {"baseline_text": _clip(baseline_text), "actual_text": _clip(actual_text)}
    last_error: str | None = None
    for attempt in range(2):
        try:
            llm = get_llm(temperature=0.0, enable_thinking=False)
            response = await llm.ainvoke(
                [SystemMessage(content=_JUDGE_SYSTEM), HumanMessage(content=prompt)]
            )
            content = response.content if isinstance(response.content, str) else str(response.content)
            parsed = _parse_verdict(content)
            return JudgeTurnVerdict(
                turn_index=turn_index,
                equivalent=parsed["equivalent"],
                differences=str(parsed.get("differences") or "") or None,
                **texts,
            )
        except Exception as e:
            last_error = str(e)
            logger.warning("judge_attempt_failed: turn=%d attempt=%d error=%s", turn_index, attempt, e)
    return JudgeTurnVerdict(turn_index=turn_index, equivalent=None, error=last_error, **texts)


async def judge_turns(
    baseline: TestSnapshot,
    actual: TestSnapshot,
    pairs: list[tuple[int, str, str]],
) -> JudgeReport:
    """Judge each differing turn sequentially (cost control)."""
    verdicts: list[JudgeTurnVerdict] = []
    for turn_index, base_text, act_text in pairs:
        user_prompt = _user_prompt_for_turn(actual, turn_index)
        verdicts.append(
            await judge_turn(
                user_prompt=user_prompt,
                baseline_text=base_text,
                actual_text=act_text,
                turn_index=turn_index,
            )
        )
    return JudgeReport(verdicts=verdicts)
