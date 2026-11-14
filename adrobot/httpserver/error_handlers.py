# pyright: strict
from http import HTTPStatus

from fastapi import FastAPI
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from .schemas import ApiError
from .schemas import ErrorResponse
from adrobot.log import Logger
from adrobot.services.keitaro.exceptions import KeitaroApiError
from adrobot.services.network.http import ConnectionTimeoutError
from adrobot.services.network.http import NetworkError


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=ErrorResponse(error=ApiError(code=code, message=message)).model_dump(),
    )


async def handle_http_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, HTTPException)
    try:
        code = HTTPStatus(exc.status_code).name
    except ValueError:
        code = f"HTTP_{exc.status_code}"
    response = error_response(exc.status_code, code, str(exc.detail))
    response.headers.update(exc.headers or {})
    return response


async def handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    return error_response(422, "VALIDATION_ERROR", "Request validation failed")


async def handle_upstream_error(request: Request, exc: Exception) -> JSONResponse:
    Logger().exception(f"Upstream failure at {request.method} {request.url.path}", exc)
    if isinstance(exc, ConnectionTimeoutError):
        return error_response(504, "UPSTREAM_TIMEOUT", "Upstream request timed out")
    return error_response(502, "UPSTREAM_ERROR", "Upstream request failed")


async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    Logger().error(f"Unexpected failure: {type(exc).__name__} at {request.url.path}")
    return error_response(500, "INTERNAL_ERROR", "Internal server error")


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, handle_http_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(NetworkError, handle_upstream_error)
    app.add_exception_handler(KeitaroApiError, handle_upstream_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
