# pyright: strict
from __future__ import annotations

import loguru


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
