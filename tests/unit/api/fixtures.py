from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from agent_platform.api.app import app


@pytest.fixture(scope="function")
def test_client() -> Iterator[TestClient]:
    """Authenticated client: logs in through the dev auth flow (IS_DEV=true,
    no AUTH_SERVICE_URL) so the auth cookies ride along on every request."""
    with TestClient(app=app) as client:
        response = client.post(
            "/api/auth/login",
            json={"username": "pytest", "password": "pytest"},
        )
        assert response.status_code == 200, f"dev login failed: {response.text}"
        yield client
