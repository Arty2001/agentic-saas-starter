from tests.conftest import requires_db
from tests.unit.api.fixtures import test_client  # noqa: F401 — pytest fixture

pytestmark = requires_db


def test_list_agents_endpoint(test_client) -> None:
    response = test_client.get("/api/agents")
    assert response.status_code == 200
