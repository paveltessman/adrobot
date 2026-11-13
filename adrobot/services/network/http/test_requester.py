import asyncio
from collections.abc import AsyncGenerator
from collections.abc import Awaitable
from collections.abc import Callable
from contextlib import asynccontextmanager
from unittest.mock import patch

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from . import AsyncHttpRequester
from . import ConnectionTimeoutError
from . import HttpResponse
from . import HttpStatusError
from . import NetworkError
from . import TooManyRequestsError

type Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]


@asynccontextmanager
async def server(handler: Handler) -> AsyncGenerator[str]:
    app = web.Application()
    app.router.add_route("*", "/{path:.*}", handler)
    async with TestServer(app) as test_server:
        yield str(test_server.make_url("/admin_api/v1/"))


def test_methods_headers_queries_and_json() -> None:
    async def scenario() -> None:
        seen: list[str] = []

        async def handler(request: web.Request) -> web.Response:
            seen.append(request.method)
            assert request.path == "/admin_api/v1/campaigns"
            assert request.query["limit"] == "10"
            assert request.headers["Api-Key"] == "secret"
            assert request.headers["X-Request"] == "override"
            expected_body = {
                "GET": "",
                "DELETE": "",
                "POST": '{"name": "campaign"}',
                "PUT": '{"name": "campaign"}',
            }
            assert await request.text() == expected_body[request.method]
            return web.Response(text='[{"id": 1}]', content_type="application/json")

        async with server(handler) as base_url:
            async with AsyncHttpRequester(
                base_url, headers={"Api-Key": "secret", "X-Request": "default"}
            ) as requester:
                session = requester.client
                for method in (requester.get, requester.delete):
                    response = await method(
                        "/campaigns",
                        params={"limit": "10"},
                        headers={"X-Request": "override"},
                    )
                    assert response.json() == [{"id": 1}]
                for method in (requester.post, requester.put):
                    await method(
                        "campaigns",
                        json_data={"name": "campaign"},
                        params={"limit": "10"},
                        headers={"X-Request": "override"},
                    )
                assert requester.client is session
            assert session.closed
            await requester.close()
        assert seen == ["GET", "DELETE", "POST", "PUT"]

    asyncio.run(scenario())


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_get_retries_then_succeeds(status: int) -> None:
    async def scenario() -> None:
        calls = 0

        async def handler(request: web.Request) -> web.Response:
            _ = request
            nonlocal calls
            calls += 1
            return web.Response(status=status if calls < 3 else 200, text="result")

        async with server(handler) as base_url:
            async with AsyncHttpRequester(base_url) as requester:
                with patch(
                    "adrobot.services.network.http.requester.asyncio.sleep"
                ) as sleep:
                    response = await requester.get(
                        "campaigns",
                        params=None,
                        headers=None,
                    )
                    assert [call.args for call in sleep.call_args_list] == [(2,), (4,)]
            assert response.body == "result"
            assert calls == 3

    asyncio.run(scenario())


@pytest.mark.parametrize("status", [400, 401, 404, 405, 429, 500])
def test_errors_preserve_response_and_respect_retry_limit(status: int) -> None:
    async def scenario() -> None:
        calls = 0

        async def handler(request: web.Request) -> web.Response:
            _ = request
            nonlocal calls
            calls += 1
            return web.Response(status=status, text='{"error":"failed"}')

        async with server(handler) as base_url:
            async with AsyncHttpRequester(base_url, max_attempts=2) as requester:
                with patch("adrobot.services.network.http.requester.asyncio.sleep"):
                    with pytest.raises(HttpStatusError) as error:
                        await requester.get("campaigns", params=None, headers=None)
                assert error.value.response.status_code == status
                assert error.value.response.json() == {"error": "failed"}
                assert isinstance(error.value, TooManyRequestsError) == (status == 429)
        assert calls == (2 if status in {429, 500} else 1)

    asyncio.run(scenario())


def test_empty_response_and_redirects() -> None:
    async def scenario() -> None:
        async def handler(request: web.Request) -> web.Response:
            if request.path.endswith("redirect"):
                return web.Response(status=302, headers={"Location": "/target"})
            assert request.path.endswith("empty")
            return web.Response(status=204)

        async with server(handler) as base_url:
            async with AsyncHttpRequester(base_url) as requester:
                assert (
                    await requester.delete(
                        "empty",
                        params=None,
                        headers=None,
                    )
                ).body == ""
                assert (
                    await requester.get(
                        "redirect",
                        params=None,
                        headers=None,
                    )
                ).status_code == 302

    asyncio.run(scenario())


def test_timeout_includes_body_reading() -> None:
    async def scenario() -> None:
        async def handler(request: web.Request) -> web.StreamResponse:
            response = web.StreamResponse()
            await response.prepare(request)
            await asyncio.sleep(0.05)
            return response

        async with server(handler) as base_url:
            async with AsyncHttpRequester(base_url, timeout=0.01) as requester:
                with pytest.raises(ConnectionTimeoutError) as error:
                    await requester.get("campaigns", params=None, headers=None)
                assert isinstance(error.value.__cause__, TimeoutError)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "failure", [aiohttp.ClientConnectionError(), asyncio.CancelledError()]
)
def test_transport_error_and_cancellation(failure: BaseException) -> None:
    async def scenario() -> None:
        async with AsyncHttpRequester("https://example.com") as requester:
            with patch.object(requester.client, "request", side_effect=failure):
                expected = (
                    asyncio.CancelledError
                    if isinstance(failure, asyncio.CancelledError)
                    else NetworkError
                )
                with pytest.raises(expected):
                    await requester.get("campaigns", params=None, headers=None)

    asyncio.run(scenario())


def test_context_closes_after_error() -> None:
    async def scenario() -> None:
        requester = AsyncHttpRequester("https://example.com")
        session: aiohttp.ClientSession | None = None
        with pytest.raises(ValueError):
            async with requester:
                session = requester.client
                raise ValueError("application error")
        assert session is not None and session.closed
        with pytest.raises(RuntimeError, match="closed"):
            await requester.get("campaigns", params=None, headers=None)

    asyncio.run(scenario())


@pytest.mark.parametrize("path", ["https://other.example/path", "//other.example/path"])
def test_rejects_absolute_paths(path: str) -> None:
    async def scenario() -> None:
        async with AsyncHttpRequester("https://example.com") as requester:
            with pytest.raises(ValueError, match="relative"):
                await requester.get(path, params=None, headers=None)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "base_url",
    [
        "relative",
        "ftp://example.com",
        "https://user:pass@example.com",
        "https://example.com?key=secret",
        "https://example.com/#fragment",
    ],
)
def test_rejects_invalid_base_url(base_url: str) -> None:
    with pytest.raises(ValueError):
        AsyncHttpRequester(base_url)


@pytest.mark.parametrize("timeout, attempts", [(0, 1), (-1, 1), (1, 0)])
def test_rejects_invalid_limits(timeout: float, attempts: int) -> None:
    with pytest.raises(ValueError):
        AsyncHttpRequester(
            "https://example.com", timeout=timeout, max_attempts=attempts
        )


@pytest.mark.parametrize(
    "body, expected", [("[]", []), ("null", None), ("42", 42), ('"value"', "value")]
)
def test_json_response_values(body: str, expected: object) -> None:
    assert HttpResponse(200, "OK", body).json() == expected


def test_invalid_json_is_reported() -> None:
    with pytest.raises(ValueError):
        HttpResponse(200, "OK", "not json").json()
