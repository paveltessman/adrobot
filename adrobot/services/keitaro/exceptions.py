# pyright: strict
from adrobot.exceptions import AdRobotException


class KeitaroApiError(AdRobotException):
    """Keitaro returned an invalid API response."""


class CampaignNotFoundError(KeitaroApiError):
    """The requested campaign does not exist in Keitaro."""


class OfferNotFoundError(KeitaroApiError):
    """The requested offer does not exist or is inaccessible in Keitaro."""


class InvalidCampaignPush(AdRobotException):
    """The proposed campaign changes cannot be applied."""


class InvalidCampaignCreation(AdRobotException):
    """The proposed campaign cannot be created."""
