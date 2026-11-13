# pyright: strict
from .types import HttpResponse
from adrobot.exceptions import AdRobotException


class NetworkError(AdRobotException):
    pass


class ConnectionTimeoutError(NetworkError):
    pass


class HttpStatusError(NetworkError):
    def __init__(self, response: HttpResponse) -> None:
        super().__init__(f"HTTP {response.status_code}: {response.reason_phrase}")
        self.response = response


class TooManyRequestsError(HttpStatusError):
    pass
