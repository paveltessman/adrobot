# pyright: strict
from collections.abc import AsyncGenerator
from collections.abc import Awaitable
from collections.abc import Callable
from contextlib import asynccontextmanager
from unittest.mock import patch

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from pydantic import ValidationError

from .api_client import create_keitaro_http_requester
from .api_client import KeitaroApiClient
from .exceptions import KeitaroApiError
from .models import Campaign
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError


@asynccontextmanager
async def api_server(
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> AsyncGenerator[str]:
    app = web.Application()
    app.router.add_route("*", "/{path:.*}", handler)
    async with TestServer(app) as server:
        yield str(server.make_url("/admin_api/v1/"))


async def test_campaign_requests_and_authentication() -> None:
    paths: list[str] = []

    async def handler(request: web.Request) -> web.Response:
        paths.append(request.path)
        assert request.method == "GET"
        assert request.headers["Api-Key"] == "test-key"
        assert request.headers["Accept"] == "application/json"
        campaign = {"id": 7, "name": "Example", "state": "active"}
        if request.path == "/admin_api/v1/campaigns":
            assert dict(request.query) == {"limit": "10", "offset": "20"}
            return web.json_response([campaign])
        assert request.path == "/admin_api/v1/campaigns/7"
        assert not request.query
        return web.json_response(campaign)

    async with api_server(handler) as base_url:
        async with create_keitaro_http_requester(base_url, "test-key") as requester:
            client = KeitaroApiClient(requester)
            expected = Campaign(id=7, name="Example")
            assert await client.get_campaigns(limit=10, offset=20) == [expected]
            assert await client.get_campaign(7) == expected
            session = requester.client
            assert not session.closed
        assert session.closed
    assert paths == ["/admin_api/v1/campaigns", "/admin_api/v1/campaigns/7"]


@pytest.mark.parametrize("single", [False, True])
@pytest.mark.parametrize(
    "body",
    [
        "not json",
        "null",
        '{"error":"failed"}',
        '[{"id":1}]',
        '{"id":"1","name":"Example"}',
        '[{"id":"1","name":"Example"}]',
    ],
)
async def test_invalid_responses(single: bool, body: str) -> None:
    async def handler(request: web.Request) -> web.Response:
        _ = request
        return web.Response(text=body)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            client = KeitaroApiClient(requester)
            with pytest.raises(KeitaroApiError) as error:
                if single:
                    await client.get_campaign(1)
                else:
                    await client.get_campaigns(limit=100, offset=0)
            assert isinstance(error.value.__cause__, ValidationError)


@pytest.mark.parametrize("single", [False, True])
@pytest.mark.parametrize("status", [401, 404, 429, 500])
async def test_http_errors_propagate(single: bool, status: int) -> None:
    async def handler(request: web.Request) -> web.Response:
        _ = request
        return web.Response(status=status, text='{"error":"failed"}')

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url, max_attempts=1) as requester:
            client = KeitaroApiClient(requester)
            with pytest.raises(HttpStatusError) as error:
                if single:
                    await client.get_campaign(1)
                else:
                    await client.get_campaigns(limit=100, offset=0)
            assert error.value.response.status_code == status
            assert error.value.response.body == '{"error":"failed"}'


@pytest.mark.parametrize("single", [False, True])
async def test_transport_errors_propagate(single: bool) -> None:
    async with AsyncHttpRequester("https://example.com/admin_api/v1/") as requester:
        client = KeitaroApiClient(requester)
        with patch.object(
            requester.client, "request", side_effect=aiohttp.ClientConnectionError()
        ):
            with pytest.raises(NetworkError):
                if single:
                    await client.get_campaign(1)
                else:
                    await client.get_campaigns(limit=100, offset=0)


async def test_invalid_arguments_are_rejected() -> None:
    async with AsyncHttpRequester("https://example.com/admin_api/v1/") as requester:
        client = KeitaroApiClient(requester)
        for limit, offset in [(0, 0), (-1, 0), (1, -1)]:
            with pytest.raises(ValueError, match="limit"):
                await client.get_campaigns(limit=limit, offset=offset)
        for campaign_id in [0, -1]:
            with pytest.raises(ValueError, match="campaign_id"):
                await client.get_campaign(campaign_id)


@pytest.mark.parametrize("resource", ["configuration", "streams", "offer"])
@pytest.mark.parametrize(
    "body", ["null", "{}", '{"id":99,"name":"Wrong","state":"active"}']
)
async def test_details_reject_invalid_or_mismatched_resources(
    resource: str, body: str
) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(text=body)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            client = KeitaroApiClient(requester)
            with pytest.raises(KeitaroApiError):
                if resource == "configuration":
                    await client.get_campaign_configuration(7)
                elif resource == "streams":
                    await client.get_streams(7)
                else:
                    await client.get_offer(7)


async def test_details_accept_campaign_without_streams() -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.json_response([])

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            assert await KeitaroApiClient(requester).get_streams(7) == []


async def test_new_campaign_stream_with_null_action_payload() -> None:
    body = (
        '[{"id":1301207,"type":"regular","name":"Flow 1",'
        '"campaign_id":210022,"position":1,"action_options":null,'
        '"comments":"","state":"active","created_at":"2026-11-14 10:47:52",'
        '"action_type":"http","action_payload":null,"schema":"landings",'
        '"collect_clicks":true,"filter_or":false,"weight":100,'
        '"offer_selection":"before_click","filters":[],"triggers":[], '
        '"landings":[],"offers":[]}]'
    )

    async def handler(request: web.Request) -> web.Response:
        assert request.path.endswith("/campaigns/210022/streams")
        return web.Response(text=body, content_type="application/json")

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            streams = await KeitaroApiClient(requester).get_streams(210022)
    assert len(streams) == 1
    assert streams[0].id == 1301207
    assert streams[0].action_payload is None
    assert streams[0].offers == []


async def test_details_reject_invalid_ids_before_requesting() -> None:
    async with AsyncHttpRequester("https://example.com/admin_api/v1/") as requester:
        client = KeitaroApiClient(requester)
        for resource in [
            client.get_campaign_configuration,
            client.get_streams,
            client.get_offer,
        ]:
            for identifier in [0, -1]:
                with pytest.raises(ValueError):
                    await resource(identifier)


@pytest.mark.parametrize(
    "body",
    [
        "not json",
        "null",
        "{}",
        '[{"id":"1","name":"Offer","state":"active"}]',
        '[{"id":1,"name":"Offer"}]',
        '[{"id":0,"name":"Offer","state":"active"}]',
        '[{"id":1,"name":"A","state":"active"},'
        '{"id":1,"name":"B","state":"active"}]',
    ],
)
async def test_offer_catalog_rejects_invalid_responses(body: str) -> None:
    async def handler(request: web.Request) -> web.Response:
        assert request.path.endswith("/offers")
        return web.Response(text=body)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            with pytest.raises(KeitaroApiError):
                await KeitaroApiClient(requester).get_offers()
