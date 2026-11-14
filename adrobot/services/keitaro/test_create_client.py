# pyright: strict
import pytest
from aiohttp import web

from .api_client import create_keitaro_http_requester
from .api_client import KeitaroApiClient
from .create import stream_payloads
from .exceptions import KeitaroApiError
from .test_api_client import api_server
from .test_create import proposed
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import HttpStatusError


async def test_creation_sends_campaign_and_fixed_stream_payloads() -> None:
    calls: list[str] = []
    payloads = stream_payloads(7, proposed())

    async def handler(request: web.Request) -> web.Response:
        calls.append(request.path)
        assert request.method == "POST"
        assert request.headers["Api-Key"] == "test-key"
        assert not request.query
        body = await request.json()
        if request.path.endswith("/campaigns"):
            assert body == {
                "name": "Example",
                "alias": "example-alias",
                "type": "position",
                "state": "active",
                "domain_id": 2,
                "group_id": "3",
                "traffic_source_id": 4,
            }
            return web.json_response({"id": 7})
        assert request.path.endswith("/streams")
        assert body == payloads[len(calls) - 2]
        return web.json_response({"id": len(calls), **body})

    async with api_server(handler) as base_url:
        async with create_keitaro_http_requester(base_url, "test-key") as requester:
            client = KeitaroApiClient(requester)
            assert await client.create_campaign(proposed(), "example-alias") == 7
            for payload in payloads:
                await client.create_stream(7, payload)
    assert calls == [
        "/admin_api/v1/campaigns",
        "/admin_api/v1/streams",
        "/admin_api/v1/streams",
    ]
    assert payloads[0]["filters"] == [
        {"name": "country", "mode": "accept", "payload": ["AU"]}
    ]
    assert payloads[0]["action_payload"] == "https://www.google.com"
    assert payloads[1]["offers"] == [{"offer_id": 9, "share": 100, "state": "active"}]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("status", [400, 403, 422, 429, 500, 503])
async def test_creation_posts_never_retry(stream: bool, status: int) -> None:
    calls = 0

    async def handler(request: web.Request) -> web.Response:
        nonlocal calls
        calls += 1
        return web.Response(status=status)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            client = KeitaroApiClient(requester)
            with pytest.raises(HttpStatusError):
                if stream:
                    await client.create_stream(7, stream_payloads(7, proposed())[0])
                else:
                    await client.create_campaign(proposed(), "alias")
    assert calls == 1


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize(
    "body", ["invalid", "{}", '{"id":0}', '{"id":"7"}', '{"id":true}']
)
async def test_creation_rejects_malformed_responses(stream: bool, body: str) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(text=body)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            client = KeitaroApiClient(requester)
            with pytest.raises(KeitaroApiError):
                if stream:
                    await client.create_stream(7, stream_payloads(7, proposed())[0])
                else:
                    await client.create_campaign(proposed(), "alias")


async def test_created_stream_must_belong_to_campaign() -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.json_response({"id": 1, **stream_payloads(99, proposed())[0]})

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            client = KeitaroApiClient(requester)
            with pytest.raises(KeitaroApiError, match="identity"):
                await client.create_stream(7, stream_payloads(7, proposed())[0])
            with pytest.raises(ValueError):
                await client.create_stream(7, stream_payloads(8, proposed())[0])


@pytest.mark.parametrize("resource", ["domains", "traffic_sources"])
async def test_creation_resource_lookups(resource: str) -> None:
    async def handler(request: web.Request) -> web.Response:
        assert request.method == "GET"
        assert request.path == f"/admin_api/v1/{resource}/2"
        assert request.headers["Api-Key"] == "test-key"
        assert not request.query
        return web.json_response({"id": 2, "name": "Example", "state": "active"})

    async with api_server(handler) as base_url:
        async with create_keitaro_http_requester(base_url, "test-key") as requester:
            client = KeitaroApiClient(requester)
            load = (
                client.get_domain
                if resource == "domains"
                else client.get_traffic_source
            )
            result = await load(2)
            assert result.id == 2
            assert result.state == "active"
            with pytest.raises(ValueError):
                await load(0)


@pytest.mark.parametrize("resource", ["domains", "traffic_sources"])
@pytest.mark.parametrize(
    "body", ["null", "{}", '{"id":99,"state":"active"}', '{"id":2}']
)
async def test_creation_resource_validation(resource: str, body: str) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(text=body)

    async with api_server(handler) as base_url:
        async with AsyncHttpRequester(base_url) as requester:
            client = KeitaroApiClient(requester)
            load = (
                client.get_domain
                if resource == "domains"
                else client.get_traffic_source
            )
            with pytest.raises(KeitaroApiError):
                await load(2)
