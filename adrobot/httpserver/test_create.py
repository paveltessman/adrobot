# pyright: strict
from dataclasses import dataclass
from dataclasses import field
from unittest.mock import AsyncMock

import pytest
from aiohttp import web
from fastapi import FastAPI
from pydantic import HttpUrl
from pydantic import JsonValue
from pydantic import TypeAdapter

from .dependencies import get_keitaro_service
from .server import create_app
from .test_server import http_client
from adrobot.services.keitaro.create_models import CampaignCreateResult
from adrobot.services.keitaro.exceptions import InvalidCampaignCreation
from adrobot.services.keitaro.models import CampaignDetails
from adrobot.services.keitaro.service import KeitaroService
from adrobot.services.keitaro.test_api_client import api_server
from adrobot.services.keitaro.test_create import proposed
from adrobot.services.network.http import NetworkError
from adrobot.settings.settings import Settings

_PATH = "/api/v1/integrations/keitaro/campaigns"


@pytest.fixture(name="settings")
def creation_settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("ADROBOT_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("ADROBOT_KEITARO_BASE_URL", "https://example.com/admin_api/v1/")
    monkeypatch.setenv("ADROBOT_KEITARO_API_KEY", "test-key")
    return Settings()


def creation_app(
    settings: Settings, result: CampaignCreateResult | Exception
) -> tuple[FastAPI, AsyncMock]:
    service = AsyncMock(spec=KeitaroService)
    create = service.create_campaign
    if isinstance(result, Exception):
        create.side_effect = result
    else:
        create.return_value = result
    app = create_app(settings)
    app.dependency_overrides[get_keitaro_service] = lambda: service
    return app, create


@pytest.mark.parametrize("status", ["created", "partial", "failed", "unknown"])
async def test_creation_result_envelope(settings: Settings, status: str) -> None:
    result = CampaignCreateResult.model_validate(
        {
            "status": status,
            "campaign_id": 7 if status in {"created", "partial"} else None,
            "campaign": (
                CampaignDetails(id=7, name="Example", streams=[])
                if status == "created"
                else None
            ),
        }
    )
    app, create = creation_app(settings, result)
    async with http_client(app) as client:
        response = await client.post(_PATH, json=proposed().model_dump())
        assert response.status == 200
        assert await response.json() == {"data": result.model_dump(), "error": None}
    create.assert_awaited_once_with(proposed())


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [
        (
            InvalidCampaignCreation("Selected resource is unavailable"),
            422,
            "UNPROCESSABLE_CONTENT",
        ),
        (NetworkError("private"), 502, "UPSTREAM_ERROR"),
    ],
)
async def test_creation_preflight_errors(
    settings: Settings, failure: Exception, status: int, code: str
) -> None:
    app, _ = creation_app(settings, failure)
    async with http_client(app) as client:
        response = await client.post(_PATH, json=proposed().model_dump())
        assert response.status == status
        body = await response.json()
        assert body["data"] is None
        assert body["error"]["code"] == code
        assert "private" not in str(body)


@pytest.mark.parametrize(
    "update",
    [
        {"name": " "},
        {"country_code": "USA"},
        {"offer_id": 0},
        {"domain_id": True},
        {"group_id": "3"},
        {"traffic_source_id": -1},
        {"streams": []},
    ],
)
async def test_invalid_creation_never_calls_service(
    settings: Settings, update: dict[str, JsonValue]
) -> None:
    app, create = creation_app(settings, InvalidCampaignCreation("must not run"))
    payload = proposed().model_dump()
    payload.update(update)
    async with http_client(app) as client:
        response = await client.post(_PATH, json=payload)
        assert response.status == 422
        assert (await response.json())["error"]["code"] == "VALIDATION_ERROR"
    create.assert_not_awaited()


@dataclass
class Tracker:
    reject_offer_stream: bool
    configuration: dict[str, JsonValue] = field(default_factory=dict[str, JsonValue])
    streams: list[dict[str, JsonValue]] = field(
        default_factory=list[dict[str, JsonValue]]
    )
    writes: list[str] = field(default_factory=list[str])

    async def post_campaign(self, request: web.Request) -> web.Response:
        payload = TypeAdapter(dict[str, JsonValue]).validate_json(await request.text())
        assert payload["group_id"] == "3"
        self.configuration.update({**payload, "id": 7, "group_id": 3})
        return web.json_response(self.configuration)

    async def post_stream(self, request: web.Request) -> web.Response:
        payload = TypeAdapter(dict[str, JsonValue]).validate_json(await request.text())
        if self.reject_offer_stream and payload["position"] == 2:
            return web.Response(status=422, text="private tracker details")
        stream: dict[str, JsonValue] = {"id": len(self.streams) + 1, **payload}
        self.streams.append(stream)
        return web.json_response(stream)

    async def handler(self, request: web.Request) -> web.Response:
        assert request.headers["Api-Key"] == "test-key"
        if request.method == "POST":
            self.writes.append(request.path)
            return await (
                self.post_campaign(request)
                if request.path.endswith("/campaigns")
                else self.post_stream(request)
            )
        resources: dict[str, JsonValue] = {
            "offers/9": {"id": 9, "name": "Offer", "state": "active"},
            "domains/2": {"id": 2, "state": "active"},
            "traffic_sources/4": {"id": 4, "state": "active"},
            "groups": [{"id": 3, "name": "Group", "type": "campaigns"}],
            "campaigns/7": self.configuration,
            "campaigns/7/streams": list(self.streams),
        }
        if request.path.endswith("/groups"):
            assert dict(request.query) == {"type": "campaigns"}
        return web.json_response(resources[request.path.removeprefix("/admin_api/v1/")])


@pytest.mark.parametrize("reject_offer_stream", [False, True])
async def test_creation_through_real_service_and_client(
    settings: Settings, reject_offer_stream: bool
) -> None:
    tracker = Tracker(reject_offer_stream)
    async with api_server(tracker.handler) as base_url:
        configured = settings.model_copy(
            update={"ADROBOT_KEITARO_BASE_URL": HttpUrl(base_url)}
        )
        async with http_client(create_app(configured)) as client:
            response = await client.post(_PATH, json=proposed().model_dump())
            assert response.status == 200
            body = await response.json()
            assert body["error"] is None
            assert body["data"]["status"] == (
                "partial" if reject_offer_stream else "created"
            )
            assert body["data"]["campaign_id"] == 7
            assert len(body["data"]["campaign"]["streams"]) == (
                1 if reject_offer_stream else 2
            )
            assert "private" not in str(body)
            reloaded = await client.get(f"{_PATH}/7")
            assert reloaded.status == 200
            assert (await reloaded.json())["data"] == body["data"]["campaign"]
    assert tracker.writes == [
        "/admin_api/v1/campaigns",
        "/admin_api/v1/streams",
        "/admin_api/v1/streams",
    ]
