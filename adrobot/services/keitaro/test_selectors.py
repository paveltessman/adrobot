# pyright: strict
from collections.abc import Awaitable
from collections.abc import Callable
from unittest.mock import patch

import aiohttp
import pytest
from aiohttp import web

from .api_client import create_keitaro_http_requester
from .api_client import KeitaroApiClient
from .exceptions import KeitaroApiError
from .models import CreationOption
from .test_api_client import api_server
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError


def selector_loader(
    client: KeitaroApiClient, resource: str
) -> Callable[[], Awaitable[list[CreationOption]]]:
    async def load() -> list[CreationOption]:
        if resource == "domains":
            return list(await client.get_domains())
        if resource == "groups":
            return list(await client.get_campaign_groups())
        return list(await client.get_traffic_sources())

    return load


@pytest.mark.parametrize("resource", ["domains", "groups", "traffic_sources"])
@pytest.mark.parametrize("empty", [False, True])
async def test_selectors_request_and_parse(resource: str, empty: bool) -> None:
    async def handler(request: web.Request) -> web.Response:
        assert request.method == "GET"
        assert request.path == f"/admin_api/v1/{resource}"
        assert request.headers["Api-Key"] == "test-key"
        assert request.headers["Accept"] == "application/json"
        assert dict(request.query) == (
            {"type": "campaigns"} if resource == "groups" else {}
        )
        return web.json_response(
            [] if empty else [{"id": 7, "name": "Example", "notes": "ignored"}]
        )

    async with api_server(handler) as base_url:
        async with create_keitaro_http_requester(base_url, "test-key") as requester:
            options = await selector_loader(KeitaroApiClient(requester), resource)()
            assert [option.model_dump() for option in options] == (
                [] if empty else [{"id": 7, "name": "Example"}]
            )


@pytest.mark.parametrize("resource", ["domains", "groups", "traffic_sources"])
@pytest.mark.parametrize(
    "body",
    [
        "not json",
        "null",
        "{}",
        '[{"id":1}]',
        '[{"id":"1","name":"A"}]',
        '[{"id":true,"name":"A"}]',
        '[{"id":0,"name":"A"}]',
        '[{"id":-1,"name":"A"}]',
        '[{"id":1,"name":null}]',
        '[{"id":1,"name":"A"},{"id":1,"name":"B"}]',
    ],
)
async def test_selectors_reject_invalid_catalog(resource: str, body: str) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(text=body)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            with pytest.raises(KeitaroApiError):
                await selector_loader(KeitaroApiClient(requester), resource)()


@pytest.mark.parametrize("resource", ["domains", "groups", "traffic_sources"])
@pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
async def test_selectors_propagate_http_failures(resource: str, status: int) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(status=status)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url, max_attempts=1) as requester:
            with pytest.raises(HttpStatusError) as error:
                await selector_loader(KeitaroApiClient(requester), resource)()
            assert error.value.response.status_code == status


@pytest.mark.parametrize("resource", ["domains", "groups", "traffic_sources"])
async def test_selectors_propagate_transport_failures(resource: str) -> None:
    async with AsyncHttpRequester("https://example.com/admin_api/v1/") as requester:
        with patch.object(
            requester.client, "request", side_effect=aiohttp.ClientConnectionError()
        ):
            with pytest.raises(NetworkError):
                await selector_loader(KeitaroApiClient(requester), resource)()
