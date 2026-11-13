# pyright: strict
from pydantic import TypeAdapter
from pydantic import ValidationError

from .exceptions import KeitaroApiError
from .models import Campaign
from adrobot.services.network.http import AsyncHttpRequester

_CAMPAIGNS = TypeAdapter(list[Campaign])


def create_keitaro_http_requester(base_url: str, api_key: str) -> AsyncHttpRequester:
    requester = AsyncHttpRequester(
        base_url,
        headers={"Api-Key": api_key, "Accept": "application/json"},
    )
    return requester


class KeitaroApiClient:
    def __init__(self, requester: AsyncHttpRequester) -> None:
        self._requester = requester

    async def get_campaigns(
        self,
        *,
        limit: int,
        offset: int,
    ) -> list[Campaign]:

        if limit < 1 or offset < 0:
            raise ValueError("limit must be positive and offset must be nonnegative")

        response = await self._requester.get(
            "campaigns",
            params={"limit": str(limit), "offset": str(offset)},
            headers=None,
        )

        try:
            return _CAMPAIGNS.validate_json(response.body)
        except ValidationError as exc:
            raise KeitaroApiError("Invalid campaigns response") from exc

    async def get_campaign(self, campaign_id: int) -> Campaign:

        if campaign_id < 1:
            raise ValueError("campaign_id must be positive")

        response = await self._requester.get(
            f"campaigns/{campaign_id}",
            params=None,
            headers=None,
        )

        try:
            return Campaign.model_validate_json(response.body)
        except ValidationError as exc:
            raise KeitaroApiError("Invalid campaign response") from exc
