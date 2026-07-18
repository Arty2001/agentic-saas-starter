from agent_platform.llm.client import (
    BaseChatModel,
    get_llm,
)
from tests.conftest import requires_llm_key

pytestmark = requires_llm_key


def test_get_llm() -> None:
    llm = get_llm()

    assert llm is not None
    assert isinstance(llm, BaseChatModel)