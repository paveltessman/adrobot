import asyncio
import socket
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated
from unittest.mock import patch

import aiohttp
import pytest
import uvicorn
from fastapi import Depends
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request

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
            assert not session.closed
        assert session.closed
    assert not hasattr(app.state, "keitaro_service")


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
