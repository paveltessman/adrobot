# pyright: strict
from fastapi import FastAPI

from .api.router import router as api_router
from .error_handlers import register_exception_handlers
from .schemas import ErrorResponse
from .startup import lifespan
from adrobot.settings.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(
        title="AdRobot API",
        lifespan=lifespan,
        responses={
            code: {"model": ErrorResponse} for code in (404, 405, 422, 500, 502, 504)
        },
    )
    app.state.settings = settings if settings is not None else Settings()
    register_exception_handlers(app)
    app.include_router(api_router, prefix="/api")
    return app
