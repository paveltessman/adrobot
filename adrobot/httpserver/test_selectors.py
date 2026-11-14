# pyright: strict
import pytest
from aiohttp import web

from .test_server import campaigns_client
from adrobot.settings.settings import Settings


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("ADROBOT_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("ADROBOT_KEITARO_BASE_URL", "https://example.com/admin_api/v1/")
    monkeypatch.setenv("ADROBOT_KEITARO_API_KEY", "test-key")
    return Settings()


_RESOURCES = [
    ("domains", "domains"),
    ("campaign-groups", "groups"),
    ("traffic-sources", "traffic_sources"),
]


@pytest.mark.parametrize(("resource", "upstream"), _RESOURCES)
@pytest.mark.parametrize("empty", [False, True])
async def test_creation_selectors(
    settings: Settings, resource: str, upstream: str, empty: bool
) -> None:
    options = [] if empty else [{"id": 7, "name": "Example"}]

    async def handler(request: web.Request) -> web.Response:
        assert request.method == "GET"
        assert request.path == f"/admin_api/v1/{upstream}"
        assert request.headers["Api-Key"] == "test-key"
        assert dict(request.query) == (
            {"type": "campaigns"} if upstream == "groups" else {}
        )
        return web.json_response(options)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"/api/v1/integrations/keitaro/{resource}")
        assert response.status == 200
        assert await response.json() == {"data": options, "error": None}


@pytest.mark.parametrize(("resource", "upstream"), _RESOURCES)
@pytest.mark.parametrize(
    ("status", "body"),
    [
        (403, "private details"),
        (404, "private details"),
        (200, "invalid JSON"),
        (200, '[{"id":1,"name":"A"},{"id":1,"name":"B"}]'),
    ],
)
async def test_creation_selector_failures(
    settings: Settings, resource: str, upstream: str, status: int, body: str
) -> None:
    async def handler(request: web.Request) -> web.Response:
        assert request.path == f"/admin_api/v1/{upstream}"
        return web.Response(status=status, text=body)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"/api/v1/integrations/keitaro/{resource}")
        assert response.status == 502
        assert await response.json() == {
            "data": None,
            "error": {"code": "UPSTREAM_ERROR", "message": "Upstream request failed"},
        }
