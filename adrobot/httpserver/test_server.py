# pyright: strict
import asyncio
import socket
from collections.abc import AsyncGenerator
from collections.abc import Awaitable
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Annotated
from unittest.mock import patch

import aiohttp
import pytest
import uvicorn
from aiohttp import web
from aiohttp.test_utils import TestServer
from fastapi import Depends
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from pydantic import HttpUrl

from .dependencies import get_keitaro_service
from .schemas import SuccessResponse
from .server import create_app
from adrobot.services.keitaro.api_client import create_keitaro_http_requester
from adrobot.services.keitaro.exceptions import KeitaroApiError
from adrobot.services.keitaro.service import KeitaroService
from adrobot.services.network.http import ConnectionTimeoutError
from adrobot.services.network.http import HttpResponse
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError
from adrobot.settings.settings import Settings


@asynccontextmanager
async def http_client(app: FastAPI) -> AsyncGenerator[aiohttp.ClientSession]:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        host, port = listener.getsockname()
        server = uvicorn.Server(
            uvicorn.Config(app, log_config=None, access_log=False, lifespan="on")
        )
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(5):
                while not server.started:
                    if task.done():
                        await task
                        raise RuntimeError("Test server exited before startup")
                    await asyncio.sleep(0.01)
            async with aiohttp.ClientSession(
                base_url=f"http://{host}:{port}",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as client:
                yield client
        finally:
            server.should_exit = True
            try:
                async with asyncio.timeout(5):
                    await task
            finally:
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("ADROBOT_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("ADROBOT_KEITARO_BASE_URL", "https://example.com/admin_api/v1/")
    monkeypatch.setenv("ADROBOT_KEITARO_API_KEY", "test-key")
    return Settings()


async def test_lifespan_builds_dependencies_and_closes_requester(
    settings: Settings,
) -> None:
    app = create_app(settings)
    requester = create_keitaro_http_requester(
        str(settings.ADROBOT_KEITARO_BASE_URL), settings.ADROBOT_KEITARO_API_KEY
    )
    with patch(
        "adrobot.httpserver.startup.create_keitaro_http_requester",
        return_value=requester,
    ):
        async with app.router.lifespan_context(app):
            session = requester.client
            service = get_keitaro_service(Request({"type": "http", "app": app}))
            assert isinstance(service, KeitaroService)
            assert hasattr(app.state, "database")
            assert not session.closed
        assert session.closed
    assert not hasattr(app.state, "keitaro_service")
    assert not hasattr(app.state, "database")


async def test_startup_failure_closes_requester(settings: Settings) -> None:
    app = create_app(settings)
    requester = create_keitaro_http_requester(
        str(settings.ADROBOT_KEITARO_BASE_URL), settings.ADROBOT_KEITARO_API_KEY
    )
    with patch(
        "adrobot.httpserver.startup.create_keitaro_http_requester",
        return_value=requester,
    ):
        with patch(
            "adrobot.httpserver.startup.KeitaroService",
            side_effect=RuntimeError("setup"),
        ):
            with pytest.raises(RuntimeError, match="setup"):
                async with app.router.lifespan_context(app):
                    pytest.fail("Startup should fail")
    with pytest.raises(RuntimeError, match="closed"):
        _ = requester.client
    assert not hasattr(app.state, "database")


async def test_success_and_validation_envelopes(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/test")
    async def endpoint(
        count: int,
        service: Annotated[KeitaroService, Depends(get_keitaro_service)],
    ) -> SuccessResponse[int]:
        assert isinstance(service, KeitaroService)
        return SuccessResponse(data=count)

    async with http_client(app) as client:
        response = await client.get("/test", params={"count": "3"})
        assert response.status == 200
        assert (await response.json()) == {"data": 3, "error": None}
        response = await client.get("/test", params={"count": "secret-invalid"})
        assert response.status == 422
        assert (await response.json()) == {
            "data": None,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
            },
        }


@pytest.mark.parametrize(
    ("error", "status", "code", "message"),
    [
        (NetworkError("secret"), 502, "UPSTREAM_ERROR", "Upstream request failed"),
        (KeitaroApiError("secret"), 502, "UPSTREAM_ERROR", "Upstream request failed"),
        (
            HttpStatusError(HttpResponse(401, "Unauthorized", "secret")),
            502,
            "UPSTREAM_ERROR",
            "Upstream request failed",
        ),
        (
            ConnectionTimeoutError("secret"),
            504,
            "UPSTREAM_TIMEOUT",
            "Upstream request timed out",
        ),
        (RuntimeError("secret"), 500, "INTERNAL_ERROR", "Internal server error"),
    ],
)
async def test_failure_envelopes(
    settings: Settings, error: Exception, status: int, code: str, message: str
) -> None:
    app = create_app(settings)

    @app.get("/test")
    async def endpoint() -> None:
        raise error

    async with http_client(app) as client:
        response = await client.get("/test")
        assert response.status == status
        assert (await response.json()) == {
            "data": None,
            "error": {"code": code, "message": message},
        }


async def test_http_errors_and_headers(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/test")
    async def endpoint() -> None:
        raise HTTPException(
            401, "Authentication required", headers={"WWW-Authenticate": "Bearer"}
        )

    async with http_client(app) as client:
        response = await client.get("/missing")
        assert response.status == 404
        assert (await response.json()) == {
            "data": None,
            "error": {"code": "NOT_FOUND", "message": "Not Found"},
        }
        response = await client.post("/test")
        assert response.status == 405
        assert (await response.json())["error"]["code"] == "METHOD_NOT_ALLOWED"
        assert response.headers["allow"] == "GET"
        response = await client.get("/test")
        assert response.status == 401
        assert (await response.json())["error"]["code"] == "UNAUTHORIZED"
        assert response.headers["www-authenticate"] == "Bearer"


_CAMPAIGNS_PATH = "/api/v1/integrations/keitaro/campaigns"


@asynccontextmanager
async def campaigns_client(
    settings: Settings,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> AsyncGenerator[aiohttp.ClientSession]:
    upstream = web.Application()
    upstream.router.add_get("/admin_api/v1/{path:.*}", handler)
    async with TestServer(upstream) as server:
        configured = settings.model_copy(
            update={
                "ADROBOT_KEITARO_BASE_URL": HttpUrl(
                    str(server.make_url("/admin_api/v1/"))
                )
            }
        )
        async with http_client(create_app(configured)) as client:
            yield client


@pytest.mark.parametrize(
    ("params", "limit", "offset", "count", "has_more"),
    [
        ({}, 100, 0, 0, False),
        ({}, 100, 0, 100, False),
        ({}, 100, 0, 101, True),
        ({"limit": "2", "offset": "10"}, 2, 10, 1, False),
        ({"limit": "2", "offset": "10"}, 2, 10, 2, False),
        ({"limit": "2", "offset": "10"}, 2, 10, 3, True),
        ({"limit": "1", "offset": "0"}, 1, 0, 2, True),
    ],
)
async def test_campaigns_pagination(
    settings: Settings,
    params: dict[str, str],
    limit: int,
    offset: int,
    count: int,
    has_more: bool,
) -> None:
    calls: list[dict[str, str]] = []
    campaigns = [
        {"id": offset + index + 1, "name": f"Campaign {index}"}
        for index in range(count)
    ]

    async def handler(request: web.Request) -> web.Response:
        calls.append(dict(request.query))
        assert request.headers["Api-Key"] == "test-key"
        return web.json_response(campaigns)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(_CAMPAIGNS_PATH, params=params)
        assert response.status == 200
        assert await response.json() == {
            "data": {
                "items": campaigns[:limit],
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
            },
            "error": None,
        }
    assert calls == [{"limit": str(limit + 1), "offset": str(offset)}]


@pytest.mark.parametrize(
    "params",
    [
        {"limit": "0"},
        {"limit": "-1"},
        {"limit": "101"},
        {"limit": "1.5"},
        {"limit": "invalid"},
        {"offset": "-1"},
        {"offset": "1.5"},
        {"offset": "invalid"},
    ],
)
async def test_campaigns_invalid_pagination(
    settings: Settings, params: dict[str, str]
) -> None:
    calls: list[str] = []

    async def handler(request: web.Request) -> web.Response:
        calls.append(request.path)
        return web.json_response([])

    async with campaigns_client(settings, handler) as client:
        response = await client.get(_CAMPAIGNS_PATH, params=params)
        assert response.status == 422
        assert await response.json() == {
            "data": None,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
            },
        }
    assert not calls


@pytest.mark.parametrize(
    ("status", "body"), [(401, "secret upstream error"), (200, "invalid JSON")]
)
async def test_campaigns_upstream_failures(
    settings: Settings, status: int, body: str
) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(status=status, text=body)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(_CAMPAIGNS_PATH)
        assert response.status == 502
        assert await response.json() == {
            "data": None,
            "error": {"code": "UPSTREAM_ERROR", "message": "Upstream request failed"},
        }


@pytest.mark.parametrize("empty", [False, True])
@pytest.mark.parametrize("payload", [{}, [], None])
async def test_campaign_details(
    settings: Settings, empty: bool, payload: object
) -> None:
    calls: list[str] = []
    campaign = {
        "id": 7,
        "name": "Example",
        "group_id": 3,
        "traffic_source_id": 4,
        "domain_id": 5,
    }
    membership = {"offer_id": 9, "share": 100, "state": "active"}
    streams: list[dict[str, object]] = [
        {
            "id": stream_id,
            "campaign_id": 7,
            "name": name,
            "type": "regular",
            "state": "active",
            "position": stream_id,
            "schema": schema,
            "action_type": "http",
            "action_payload": destination,
            "filters": [],
            "offers": offers,
        }
        for stream_id, name, schema, destination, offers in [
            (1, "Google", "redirect", "https://google.com", []),
            (2, "Offers", "landings", "", [] if empty else [membership]),
            (
                3,
                "Other offers",
                "landings",
                payload,
                [] if empty else [membership],
            ),
        ]
    ]
    offer = {"id": 9, "name": "Example offer", "state": "active"}

    async def handler(request: web.Request) -> web.Response:
        calls.append(request.path)
        assert request.method == "GET"
        assert request.headers["Api-Key"] == "test-key"
        assert not request.query
        if request.path.endswith("/streams"):
            return web.json_response(streams)
        if request.path.endswith("/offers/9"):
            return web.json_response(offer)
        assert request.path.endswith("/campaigns/7")
        return web.json_response(campaign)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"{_CAMPAIGNS_PATH}/7")
        assert response.status == 200
        assert await response.json() == {
            "data": {
                **campaign,
                "type": None,
                "alias": None,
                "state": None,
                "notes": None,
                "updated_at": None,
                "streams": [
                    {
                        **stream,
                        "landings": [],
                        "collect_clicks": False,
                        "filter_or": False,
                        "updated_at": None,
                        "offer_details": [] if empty or index == 0 else [offer],
                        "removed_offers": [],
                        "pinned_offer_ids": [],
                    }
                    for index, stream in enumerate(streams)
                ],
            },
            "error": None,
        }
    assert calls == [
        "/admin_api/v1/campaigns/7",
        "/admin_api/v1/campaigns/7/streams",
    ] + ([] if empty else ["/admin_api/v1/offers/9"])


async def test_campaign_details_exposes_removed_history(settings: Settings) -> None:
    attached = True

    async def handler(request: web.Request) -> web.Response:
        assert request.method == "GET"
        if request.path.endswith("/streams"):
            return web.json_response(
                [
                    {
                        "id": 2,
                        "campaign_id": 7,
                        "name": "Offers",
                        "type": "regular",
                        "state": "active",
                        "position": 1,
                        "schema": "landings",
                        "action_type": "http",
                        "action_payload": "",
                        "filters": [],
                        "offers": (
                            [{"offer_id": 9, "share": 100, "state": "active"}]
                            if attached
                            else []
                        ),
                    }
                ]
            )
        if request.path.endswith("/offers/9"):
            assert attached
            return web.json_response({"id": 9, "name": "Old name", "state": "active"})
        return web.json_response({"id": 7, "name": "Example"})

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"{_CAMPAIGNS_PATH}/7")
        assert response.status == 200
        assert (await response.json())["data"]["streams"][0]["removed_offers"] == []
        attached = False
        for _ in range(2):
            response = await client.get(f"{_CAMPAIGNS_PATH}/7")
            assert response.status == 200
            result = (await response.json())["data"]["streams"][0]
            assert result["offers"] == []
            assert result["offer_details"] == []
            assert result["removed_offers"] == [
                {"id": 9, "name": "Old name", "last_known_state": "active"}
            ]
        attached = True
        response = await client.get(f"{_CAMPAIGNS_PATH}/7")
        assert response.status == 200
        result = (await response.json())["data"]["streams"][0]
        assert result["removed_offers"] == []
        assert len(result["offers"]) == 1


@pytest.mark.parametrize("campaign_id", ["0", "-1", "invalid", "1.5"])
async def test_campaign_details_invalid_id(
    settings: Settings, campaign_id: str
) -> None:
    async def handler(request: web.Request) -> web.Response:
        pytest.fail("Invalid IDs must not reach Keitaro")

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"{_CAMPAIGNS_PATH}/{campaign_id}")
        assert response.status == 422
        await response.read()


@pytest.mark.parametrize(
    ("failure", "status", "expected"),
    [
        ("campaign", 404, 404),
        ("campaign", 401, 502),
        ("campaign", 200, 502),
        ("streams", 200, 502),
        ("streams", 404, 502),
        ("offer", 404, 502),
        ("offer", 200, 502),
    ],
)
async def test_campaign_details_failures_are_not_partial(
    settings: Settings, failure: str, status: int, expected: int
) -> None:
    async def handler(request: web.Request) -> web.Response:
        stage = (
            "streams"
            if request.path.endswith("/streams")
            else "offer" if "/offers/" in request.path else "campaign"
        )
        if stage == failure:
            return web.Response(status=status, text="secret invalid response")
        if stage == "campaign":
            return web.json_response({"id": 7, "name": "Example"})
        return web.json_response(
            [
                {
                    "id": 1,
                    "campaign_id": 7,
                    "name": "Offers",
                    "type": "regular",
                    "state": "active",
                    "position": 1,
                    "schema": "landings",
                    "action_type": "http",
                    "action_payload": "",
                    "filters": [],
                    "offers": [{"offer_id": 9, "share": 100, "state": "active"}],
                }
            ]
        )

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"{_CAMPAIGNS_PATH}/7")
        assert response.status == expected
        assert await response.json() == {
            "data": None,
            "error": {
                "code": "NOT_FOUND" if expected == 404 else "UPSTREAM_ERROR",
                "message": (
                    "Campaign not found"
                    if expected == 404
                    else "Upstream request failed"
                ),
            },
        }


_OFFERS_PATH = "/api/v1/integrations/keitaro/offers"


@pytest.mark.parametrize(
    ("query", "expected_ids"),
    [
        ("", [9, 19, 20]),
        ("  SuMmEr  ", [9, 19]),
        ("9", [9]),
        ("20", [20]),
        ("missing", []),
        ("STRASSE", [20]),
    ],
)
async def test_offer_search(
    settings: Settings, query: str, expected_ids: list[int]
) -> None:
    offers = [
        {"id": 9, "name": "Summer", "state": "active"},
        {"id": 19, "name": "Summer two", "state": "disabled"},
        {"id": 20, "name": "Straße", "state": "active"},
    ]
    calls: list[str] = []

    async def handler(request: web.Request) -> web.Response:
        assert request.method == "GET"
        assert request.headers["Api-Key"] == "test-key"
        assert not request.query
        calls.append(request.path)
        return web.json_response(offers)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(_OFFERS_PATH, params={"q": query})
        assert response.status == 200
        assert await response.json() == {
            "data": [offer for offer in offers if offer["id"] in expected_ids],
            "error": None,
        }
    assert calls == ["/admin_api/v1/offers"]


async def test_offer_search_empty_catalog(settings: Settings) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.json_response([])

    async with campaigns_client(settings, handler) as client:
        response = await client.get(_OFFERS_PATH)
        assert response.status == 200
        assert await response.json() == {"data": [], "error": None}


async def test_offer_lookup(settings: Settings) -> None:
    offer = {"id": 9, "name": "Offer", "state": "disabled"}

    async def handler(request: web.Request) -> web.Response:
        assert request.method == "GET"
        assert request.path == "/admin_api/v1/offers/9"
        assert not request.query
        return web.json_response(offer)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"{_OFFERS_PATH}/9")
        assert response.status == 200
        assert await response.json() == {"data": offer, "error": None}


@pytest.mark.parametrize("identifier", ["0", "-1", "abc"])
async def test_offer_lookup_invalid_id(settings: Settings, identifier: str) -> None:
    async def handler(request: web.Request) -> web.Response:
        pytest.fail("Invalid IDs must not reach Keitaro")

    async with campaigns_client(settings, handler) as client:
        response = await client.get(f"{_OFFERS_PATH}/{identifier}")
        assert response.status == 422
        assert (await response.json())["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("lookup", [False, True])
@pytest.mark.parametrize(
    ("upstream_status", "body"),
    [
        (404, "private upstream error"),
        (403, "private upstream error"),
        (200, "invalid JSON"),
        (200, '{"id":99,"name":"Wrong","state":"active"}'),
    ],
)
async def test_offer_failures(
    settings: Settings, lookup: bool, upstream_status: int, body: str
) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(status=upstream_status, text=body)

    async with campaigns_client(settings, handler) as client:
        response = await client.get(_OFFERS_PATH + ("/9" if lookup else ""))
        missing = lookup and upstream_status == 404
        assert response.status == (404 if missing else 502)
        assert await response.json() == {
            "data": None,
            "error": {
                "code": "NOT_FOUND" if missing else "UPSTREAM_ERROR",
                "message": "Offer not found" if missing else "Upstream request failed",
            },
        }
