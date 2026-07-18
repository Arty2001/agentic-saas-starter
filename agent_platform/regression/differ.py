"""Structural snapshot diffing with volatile-key normalization.

Hard-fail signal comes from structure: turn count, termination state,
routing decision, tool calls (name + args), plan items, clarifications,
items_completed. Free text (final_text, human-readable `message` strings
inside payloads) is excluded here — the LLM judge covers final_text.

Tool-call ORDER is not signal: parallel fan-out branches interleave
nondeterministically run-to-run, so each turn's tool_calls are canonically
sorted before diffing (count and argument changes still surface).
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any

# Keys whose values legitimately change run-to-run (ids, timestamps, timings).
DEFAULT_VOLATILE_KEYS = {
    "taskId",
    "id",
    "run_id",
    "thread_id",
    "session_id",
    "timestamp",
    "created_at",
    "started_at",
    "ended_at",
    "duration_ms",
    "requestId",
    "remaining",
}

# TurnSnapshot fields that are display/debug only — never diffed.
DISPLAY_ONLY_TURN_FIELDS = {"tool_results", "final_text", "run_id", "duration_ms", "input"}

# Human-readable strings inside interrupt/result payloads — judge territory, not
# structure. "name" is the LLM-authored item label (plan items, task titles,
# item results) — cosmetic and flappy even at temp 0;
# real regression signal lives in categoryNames/metricNames/params, which stay diffed.
TEXT_KEYS = {"message", "name"}

# Snapshot meta keys that participate in the structural diff (environment mismatch
# like mock-vs-real is a hard fail; the rest of meta is informational).
_DIFFED_META_KEYS = {"mock_mode"}

_INDEX_RE = re.compile(r"\[(\d+)\]")


def _parse_path(path: str) -> list[Any]:
    """'turns[0].tool_calls[1].arguments.name' -> ['turns', 0, 'tool_calls', 1, 'arguments', 'name']"""
    tokens: list[Any] = []
    for part in path.split("."):
        m = _INDEX_RE.search(part)
        if m:
            key = part[: m.start()]
            if key:
                tokens.append(key)
            for idx in _INDEX_RE.findall(part):
                tokens.append(int(idx))
        elif part:
            tokens.append(part)
    return tokens


def _delete_path(tree: Any, tokens: list[Any]) -> None:
    """Best-effort delete of a dotted/indexed path; silently ignores misses."""
    if not tokens:
        return
    node = tree
    for tok in tokens[:-1]:
        if isinstance(node, dict) and tok in node or isinstance(node, list) and isinstance(tok, int) and 0 <= tok < len(node):
            node = node[tok]
        else:
            return
    last = tokens[-1]
    if isinstance(node, dict) and last in node:
        del node[last]
    elif isinstance(node, list) and isinstance(last, int) and 0 <= last < len(node):
        node.pop(last)


def _strip_keys_deep(node: Any, keys: set[str]) -> None:
    if isinstance(node, dict):
        for k in [k for k in node if k in keys]:
            del node[k]
        for v in node.values():
            _strip_keys_deep(v, keys)
    elif isinstance(node, list):
        for item in node:
            _strip_keys_deep(item, keys)


def _sort_tool_calls(turns: list[Any]) -> None:
    """Canonically order each turn's tool_calls (post-normalization).

    Runs after key stripping and ignore paths so cosmetic/ignored fields
    can't influence the sort, and after index-based ignore paths so those
    still refer to the execution order shown in the UI.
    """
    for turn in turns:
        if isinstance(turn, dict) and isinstance(turn.get("tool_calls"), list):
            turn["tool_calls"].sort(
                key=lambda call: (
                    str((call or {}).get("tool_name") or ""),
                    json.dumps((call or {}).get("arguments"), sort_keys=True, default=str),
                )
            )


def normalize_snapshot(snapshot: dict[str, Any], extra_ignore_paths: list[str] | None = None) -> dict[str, Any]:
    """Reduce a TestSnapshot dict to the fields the structural diff compares."""
    snap = copy.deepcopy(snapshot)
    meta = snap.get("meta") or {}
    normalized: dict[str, Any] = {
        "meta": {k: meta.get(k) for k in _DIFFED_META_KEYS},
        "turns": snap.get("turns") or [],
    }

    for turn in normalized["turns"]:
        if isinstance(turn, dict):
            for field in DISPLAY_ONLY_TURN_FIELDS:
                turn.pop(field, None)

    _strip_keys_deep(normalized["turns"], DEFAULT_VOLATILE_KEYS | TEXT_KEYS)

    for raw_path in extra_ignore_paths or []:
        raw_path = (raw_path or "").strip()
        if not raw_path:
            continue
        if raw_path.startswith("**."):
            key = raw_path[3:].strip()
            if key:
                _strip_keys_deep(normalized, {key})
        else:
            _delete_path(normalized, _parse_path(raw_path))

    _sort_tool_calls(normalized["turns"])

    return normalized


def _fmt_token(tok: Any) -> str:
    return f"[{tok}]" if isinstance(tok, int) else f".{tok}"


def _join_path(tokens: list[Any]) -> str:
    out = ""
    for tok in tokens:
        out += _fmt_token(tok)
    return out.lstrip(".")


def _short(value: Any, limit: int = 500) -> Any:
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "…"
    if isinstance(value, (dict, list)):
        s = repr(value)
        if len(s) > limit:
            return s[:limit] + "…"
    return value


def diff_snapshots(baseline: dict[str, Any], actual: dict[str, Any]) -> list[dict[str, Any]]:
    """Recursive structural diff of two normalized snapshots → list of DiffEntry dicts."""
    entries: list[dict[str, Any]] = []
    _diff(baseline, actual, [], entries)
    return entries


def _diff(base: Any, act: Any, path: list[Any], out: list[dict[str, Any]]) -> None:
    if isinstance(base, dict) and isinstance(act, dict):
        for key in sorted(set(base) | set(act), key=str):
            if key not in act:
                out.append({"path": _join_path(path + [key]), "kind": "removed",
                            "baseline": _short(base[key]), "actual": None})
            elif key not in base:
                out.append({"path": _join_path(path + [key]), "kind": "added",
                            "baseline": None, "actual": _short(act[key])})
            else:
                _diff(base[key], act[key], path + [key], out)
        return

    if isinstance(base, list) and isinstance(act, list):
        if len(base) != len(act):
            out.append({"path": _join_path(path) + ".length", "kind": "changed",
                        "baseline": len(base), "actual": len(act)})
        for i in range(min(len(base), len(act))):
            _diff(base[i], act[i], path + [i], out)
        for i in range(len(act), len(base)):
            out.append({"path": _join_path(path + [i]), "kind": "removed",
                        "baseline": _short(base[i]), "actual": None})
        for i in range(len(base), len(act)):
            out.append({"path": _join_path(path + [i]), "kind": "added",
                        "baseline": None, "actual": _short(act[i])})
        return

    if base != act:
        out.append({"path": _join_path(path), "kind": "changed",
                    "baseline": _short(base), "actual": _short(act)})


def text_pairs(baseline: dict[str, Any], actual: dict[str, Any]) -> list[tuple[int, str, str]]:
    """Per-turn (index, baseline_text, actual_text) where the texts meaningfully differ.

    Only called when the structural diff is empty, which guarantees equal turn
    counts. Whitespace-normalized comparison filters trivial formatting churn.
    """
    pairs: list[tuple[int, str, str]] = []
    base_turns = baseline.get("turns") or []
    act_turns = actual.get("turns") or []
    for i in range(min(len(base_turns), len(act_turns))):
        base_text = (base_turns[i] or {}).get("final_text") or ""
        act_text = (act_turns[i] or {}).get("final_text") or ""
        if " ".join(base_text.split()) != " ".join(act_text.split()):
            pairs.append((i, base_text, act_text))
    return pairs
