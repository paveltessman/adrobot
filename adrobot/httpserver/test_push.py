# pyright: strict
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from pydantic import JsonValue

from .dependencies import get_keitaro_service
from .server import create_app
from .test_server import http_client
from adrobot.services.keitaro.exceptions import CampaignNotFoundError
from adrobot.services.keitaro.exceptions import InvalidCampaignPush
from adrobot.services.keitaro.models import CampaignDetails
from adrobot.services.keitaro.push_models import CampaignPushRequest
from adrobot.services.keitaro.push_models import CampaignPushResult
from adrobot.services.keitaro.service import KeitaroService
from adrobot.services.keitaro.test_push import change
from adrobot.settings.settings import Settings

_PATH = "/api/v1/integrations/keitaro/campaigns/7/push"


@pytest.fixture(name="settings")
def push_settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("ADROBOT_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("ADROBOT_KEITARO_BASE_URL", "https://example.com/admin_api/v1/")
    monkeypatch.setenv("ADROBOT_KEITARO_API_KEY", "test-key")
    return Settings()


def push_app(
    settings: Settings, result: CampaignPushResult | Exception
) -> tuple[FastAPI, AsyncMock]:
    service = AsyncMock(spec=KeitaroService)
    push = service.push_campaign
    if isinstance(result, Exception):
        push.side_effect = result
    else:
        push.return_value = result
    app = create_app(settings)
    app.dependency_overrides[get_keitaro_service] = lambda: service
    return app, push


@pytest.mark.parametrize("status", ["applied", "partial", "failed", "unknown"])
async def test_push_endpoint_returns_reconciliation_result(
    settings: Settings, status: str
) -> None:
    result = CampaignPushResult.model_validate(
        {
            "status": status,
            "campaign": (
                None
                if status == "unknown"
                else CampaignDetails(id=7, name="Campaign", streams=[])
            ),
            "pending_streams": [] if status == "applied" else [change()],
        }
    )
    app, push = push_app(settings, result)
    proposed = CampaignPushRequest(streams=[change()])
    async with http_client(app) as client:
        response = await client.post(_PATH, json=proposed.model_dump())
        assert response.status == 200
        assert await response.json() == {"data": result.model_dump(), "error": None}
    push.assert_awaited_once_with(7, proposed)


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (CampaignNotFoundError("missing"), 404),
        (InvalidCampaignPush("Invalid pin"), 422),
    ],
)
async def test_push_validation_errors(
    settings: Settings, failure: Exception, status: int
) -> None:
    app, _ = push_app(settings, failure)
    async with http_client(app) as client:
        response = await client.post(
            _PATH, json=CampaignPushRequest(streams=[change()]).model_dump()
        )
        assert response.status == status
        assert (await response.json())["data"] is None


_INVALID_PAYLOADS: list[dict[str, JsonValue]] = [
    {},
    {"streams": []},
    {"streams": [{"stream_id": 1, "offers": [], "pinned_offer_ids": []}]},
]


@pytest.mark.parametrize("payload", _INVALID_PAYLOADS)
async def test_invalid_payload_never_calls_service(
    settings: Settings, payload: dict[str, JsonValue]
) -> None:
    app, push = push_app(settings, InvalidCampaignPush("should not run"))
    async with http_client(app) as client:
        response = await client.post(_PATH, json=payload)
        assert response.status == 422
        assert (await response.json())["error"]["code"] == "VALIDATION_ERROR"
    push.assert_not_awaited()
