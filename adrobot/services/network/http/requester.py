# pyright: strict
import asyncio
from types import TracebackType
from typing import Self

import aiohttp
from yarl import URL

from .exceptions import ConnectionTimeoutError
from .exceptions import HttpStatusError
from .exceptions import NetworkError
from .exceptions import TooManyRequestsError
from .types import HeadersDict
from .types import HttpMethod
from .types import HttpResponse
from .types import JsonValue
from .types import QueryParams
from adrobot.log import Logger

_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


class AsyncHttpRequester:
    def __init__(
        self,
        base_url: str,
        *,
        headers: HeadersDict | None = None,
        timeout: float = 60,
        max_attempts: int = 5,
        logger: Logger | None = None,
    ) -> None:

        url = URL(base_url)

        if url.scheme not in {"http", "https"} or not url.host:
            raise ValueError("base_url must be an absolute HTTP or HTTPS URL")

        if url.user is not None or url.query_string or url.fragment:
            raise ValueError(
                "base_url must not contain credentials, query, or fragment"
            )

        if timeout <= 0 or max_attempts < 1:
            raise ValueError("timeout must be positive and max_attempts must be >= 1")

        self.base_url = base_url.rstrip("/") + "/"
        self._headers = dict(headers or {})
        self._timeout = aiohttp.ClientTimeout(total=timeout, sock_read=20)
        self._max_attempts = max_attempts
        self._logger = logger or Logger()
        self._client: aiohttp.ClientSession | None = None
        self._closed = False

    @property
    def client(self) -> aiohttp.ClientSession:
        if self._closed:
            raise RuntimeError("HTTP requester is closed")
        if self._client is None:
            self._client = aiohttp.ClientSession(
                base_url=self.base_url, headers=self._headers, timeout=self._timeout
            )
        return self._client

    async def __aenter__(self) -> Self:
        _ = self.client
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        _, _, _ = exc_type, exc, traceback
        await self.close()

    async def close(self) -> None:
        self._closed = True
        if self._client is not None:
            await self._client.close()

    async def get(
        self,
        path: str,
        *,
        params: QueryParams | None,
        headers: HeadersDict | None,
    ) -> HttpResponse:
        return await self._request("GET", path, params, headers, None)

    async def post(
        self,
        path: str,
        *,
        json_data: JsonValue,
        params: QueryParams | None,
        headers: HeadersDict | None,
    ) -> HttpResponse:
        return await self._request("POST", path, params, headers, json_data)

    async def put(
        self,
        path: str,
        *,
        json_data: JsonValue,
        params: QueryParams | None,
        headers: HeadersDict | None,
    ) -> HttpResponse:
        return await self._request("PUT", path, params, headers, json_data)

    async def delete(
        self,
        path: str,
        *,
        params: QueryParams | None,
        headers: HeadersDict | None,
    ) -> HttpResponse:
        return await self._request("DELETE", path, params, headers, None)

    async def _request(
        self,
        method: HttpMethod,
        path: str,
        params: QueryParams | None,
        headers: HeadersDict | None,
        json_data: JsonValue,
    ) -> HttpResponse:
        if URL(path).is_absolute() or path.startswith("//"):
            raise ValueError("path must be relative to base_url")
        for attempt in range(1, self._max_attempts + 1):
            response = await self._send(method, path, params, headers, json_data)
            if not self._should_retry(method, response.status_code, attempt):
                return self._check_status(response)
            delay = 2**attempt
            self._logger.debug(
                f"Retrying {method}: status {response.status_code}, "
                f"attempt {attempt}/{self._max_attempts}, sleeping {delay}s"
            )
            await asyncio.sleep(delay)
        raise AssertionError("unreachable")

    def _should_retry(self, method: HttpMethod, status: int, attempt: int) -> bool:
        return (
            method == "GET"
            and status in _RETRY_STATUSES
            and attempt < self._max_attempts
        )

    async def _send(
        self,
        method: HttpMethod,
        path: str,
        params: QueryParams | None,
        headers: HeadersDict | None,
        json_data: JsonValue,
    ) -> HttpResponse:
        try:
            async with self.client.request(
                method,
                path.lstrip("/"),
                params=params,
                headers=headers,
                json=json_data,
                allow_redirects=False,
            ) as response:
                return HttpResponse(
                    response.status,
                    response.reason,
                    await response.text(errors="replace"),
                )
        except TimeoutError as exc:
            raise ConnectionTimeoutError(f"HTTP {method} timed out") from exc
        except aiohttp.ClientError as exc:
            raise NetworkError(f"HTTP {method} transport failed") from exc

    @staticmethod
    def _check_status(response: HttpResponse) -> HttpResponse:
        if response.status_code == 429:
            raise TooManyRequestsError(response)
        if response.status_code >= 400:
            raise HttpStatusError(response)
        return response
