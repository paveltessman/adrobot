# pyright: strict
from adrobot.exceptions import AdRobotException


class KeitaroApiError(AdRobotException):
    """Keitaro returned an invalid API response."""


class CampaignNotFoundError(KeitaroApiError):
    """The requested campaign does not exist in Keitaro."""
