# pyright: strict
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from adrobot.services.keitaro.api_client import create_keitaro_http_requester
from adrobot.services.keitaro.api_client import KeitaroApiClient
from adrobot.services.keitaro.service import KeitaroService
from adrobot.settings.settings import Settings
from adrobot.storage.database import Database


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings: Settings = app.state.settings
    database = Database(settings.ADROBOT_DATABASE_URL)
    try:
        await database.initialize()
        app.state.database = database
        async with keitaro_lifespan(app, settings):
            yield
    finally:
        if hasattr(app.state, "database"):
            del app.state.database
        await database.close()


@asynccontextmanager
async def keitaro_lifespan(app: FastAPI, settings: Settings) -> AsyncGenerator[None]:
    async with create_keitaro_http_requester(
        str(settings.ADROBOT_KEITARO_BASE_URL), settings.ADROBOT_KEITARO_API_KEY
    ) as requester:
        app.state.keitaro_service = KeitaroService(KeitaroApiClient(requester))
        try:
            yield
        finally:
            del app.state.keitaro_service
