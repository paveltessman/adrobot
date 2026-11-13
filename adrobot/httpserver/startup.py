# pyright: strict
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from adrobot.services.keitaro.api_client import create_keitaro_http_requester
from adrobot.services.keitaro.api_client import KeitaroApiClient
from adrobot.services.keitaro.service import KeitaroService
from adrobot.settings.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings: Settings = app.state.settings
    async with create_keitaro_http_requester(
        str(settings.ADROBOT_KEITARO_BASE_URL), settings.ADROBOT_KEITARO_API_KEY
    ) as requester:
        app.state.keitaro_service = KeitaroService(KeitaroApiClient(requester))
        try:
            yield
        finally:
            del app.state.keitaro_service
