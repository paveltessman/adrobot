# pyright: strict
from adrobot.exceptions import AdRobotException


class KeitaroApiError(AdRobotException):
    """Keitaro returned an invalid API response."""
