# pyright: strict
from io import StringIO
from unittest.mock import patch

import aiohttp
import loguru
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from starlette.requests import Request

from .error_handlers import handle_upstream_error
from adrobot.services.keitaro.api_client import create_keitaro_http_requester
from adrobot.services.keitaro.api_client import KeitaroApiClient
from adrobot.services.keitaro.exceptions import KeitaroApiError
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import ConnectionTimeoutError
from adrobot.services.network.http import NetworkError


@pytest.mark.parametrize(
    ("body", "status", "expected"),
    [
        ('{"id":7,"name":null,"notes":"private-value"}', 200, "name: string_type"),
        ("private-value invalid JSON", 200, "$: json_invalid"),
        ("private-value", 401, "HTTP 401"),
    ],
)
async def test_upstream_logs_include_context_without_response_values(
    body: str, status: int, expected: str
) -> None:
    async def handler(request: web.Request) -> web.Response:
        assert request.headers["Api-Key"] == "private-key"
        return web.Response(status=status, text=body)

    upstream = web.Application()
    upstream.router.add_get("/campaigns/7", handler)
    output = StringIO()
    sink = loguru.logger.add(output, format="{message}")
    try:
        async with TestServer(upstream) as server:
            async with create_keitaro_http_requester(
                str(server.make_url("/")), "private-key"
            ) as requester:
                with pytest.raises((KeitaroApiError, NetworkError)) as error:
                    await KeitaroApiClient(requester).get_campaign_configuration(7)
                response = await handle_upstream_error(
                    Request(
                        {
                            "type": "http",
                            "method": "GET",
                            "path": "/details/7",
                            "headers": [],
                        }
                    ),
                    error.value,
                )
        assert response.status_code == 502
        logged = output.getvalue()
        assert "GET /details/7" in logged
        assert "GET campaigns/7" in logged
        assert expected in logged
        assert "traceback:" in logged
        assert "api_client.py" in logged
        assert "private-value" not in logged
        assert "private-key" not in logged
        assert "private-value" not in bytes(response.body).decode()
    finally:
        loguru.logger.remove(sink)


@pytest.mark.parametrize("timeout", [False, True])
async def test_transport_logs_keep_frames_and_omit_raw_cause(timeout: bool) -> None:
    output = StringIO()
    sink = loguru.logger.add(output, format="{message}")
    failure = (
        TimeoutError("private-url")
        if timeout
        else aiohttp.ClientConnectionError("private-url")
    )
    try:
        async with AsyncHttpRequester("https://example.com") as requester:
            with patch.object(requester.client, "request", side_effect=failure):
                with pytest.raises(NetworkError) as error:
                    await requester.get(
                        "offers/9?token=private-query", params=None, headers=None
                    )
            response = await handle_upstream_error(
                Request(
                    {
                        "type": "http",
                        "method": "GET",
                        "path": "/details/7",
                        "headers": [],
                    }
                ),
                error.value,
            )
        logged = output.getvalue()
        assert "Upstream request: GET offers/9" in logged
        assert type(failure).__name__ in logged
        assert "requester.py" in logged
        assert "private-url" not in logged
        assert "private-query" not in logged
        assert response.status_code == (504 if timeout else 502)
        assert isinstance(error.value, ConnectionTimeoutError) == timeout
    finally:
        loguru.logger.remove(sink)
