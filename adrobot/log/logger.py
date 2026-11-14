# pyright: strict
from __future__ import annotations

import traceback

import loguru
from pydantic import ValidationError


class Logger:
    def __init__(self) -> None:
        self._logger = loguru.logger

    def debug(self, message: str) -> None:
        self._logger.opt(depth=1).debug(message)

    def info(self, message: str) -> None:
        self._logger.opt(depth=1).info(message)

    def warning(self, message: str) -> None:
        self._logger.opt(depth=1).warning(message)

    def error(self, message: str) -> None:
        self._logger.opt(depth=1).error(message)

    def exception(self, message: str, exception: Exception) -> None:
        """Render chained frames without locals or raw upstream error values."""
        parts = [message, f"{type(exception).__name__}: {exception}"]
        current: BaseException | None = exception
        seen: set[int] = set()
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            parts.append(f"{type(current).__name__} traceback:")
            for frame in traceback.extract_tb(current.__traceback__):
                parts.append(
                    f'  File "{frame.filename}", line {frame.lineno}, in {frame.name}'
                )
            parts.extend(getattr(current, "__notes__", []))
            if isinstance(current, ValidationError):
                for error in current.errors(
                    include_input=False, include_context=False, include_url=False
                ):
                    location = ".".join(str(item) for item in error["loc"]) or "$"
                    parts.append(f"  {location}: {error['type']}")
            current = current.__cause__ or (
                None if current.__suppress_context__ else current.__context__
            )
        self._logger.opt(depth=1).error("\n".join(parts))
