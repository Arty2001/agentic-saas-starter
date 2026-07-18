from __future__ import annotations

import logging
from typing import Any

from langgraph.config import get_stream_writer

logger = logging.getLogger(__name__)


def emit_message(type: str, node: str, label: str, **extra: Any) -> None:
    try:
        writer = get_stream_writer()
    except Exception:
        return
    try:
        if type == "text_delta":
             writer({
                "type": type,
                "data": {"node": node, "content": label, **extra},
            })
        else:
            writer({
                "type": type,
                "data": {"node": node, "label": label, **extra},
            })
    except Exception:
        logger.debug("emit_message: writer call failed", exc_info=True)