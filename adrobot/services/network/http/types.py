# pyright: strict
import json
from dataclasses import dataclass
from typing import cast
from typing import Literal

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[
    str,
    JsonValue,
]
type HeadersDict = dict[str, str]
type QueryParams = dict[str, str]
type HttpMethod = Literal["GET", "POST", "PUT", "DELETE"]


@dataclass(frozen=True)
class HttpResponse:
    status_code: int
    reason_phrase: str | None
    body: str

    def json(self) -> JsonValue:
        return cast(JsonValue, json.loads(self.body))
