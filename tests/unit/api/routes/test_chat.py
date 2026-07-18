from fastapi.testclient import TestClient

from tests import test_id
from tests.conftest import requires_db
from tests.unit.api.fixtures import test_client  # noqa: F401 — pytest fixture

pytestmark = requires_db


def test_chat_endpoint(test_client: TestClient) -> None:
    payload = {
        "message": "This is a test to see if the chat endpoint is working.",
        "session_id": f"test-{test_id}",
    }
    response = test_client.post("/api/chat", json=payload)
    assert response.status_code == 200
