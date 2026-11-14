# pyright: strict
from pydantic import TypeAdapter
from pydantic import ValidationError

from .exceptions import KeitaroApiError
from .models import Campaign
from .models import CampaignConfiguration
from .models import Offer
from .models import Stream
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

    async def get_campaign_configuration(
        self,
        campaign_id: int,
    ) -> CampaignConfiguration:

        if campaign_id < 1:
            raise ValueError("campaign_id must be positive")

        response = await self._requester.get(
            f"campaigns/{campaign_id}",
            params=None,
            headers=None,
        )

        try:
            campaign = CampaignConfiguration.model_validate_json(response.body)

            if campaign.id != campaign_id:
                raise KeitaroApiError("Campaign identity mismatch")

            return campaign

        except ValidationError as exc:
            raise KeitaroApiError("Invalid campaign response") from exc

    async def get_streams(self, campaign_id: int) -> list[Stream]:

        if campaign_id < 1:
            raise ValueError("campaign_id must be positive")

        response = await self._requester.get(
            f"campaigns/{campaign_id}/streams",
            params=None,
            headers=None,
        )

        try:
            streams = TypeAdapter(list[Stream]).validate_json(response.body)
        except ValidationError as exc:
            raise KeitaroApiError("Invalid streams response") from exc

        self._validate_streams(streams, campaign_id)
        return streams

    @staticmethod
    def _validate_streams(streams: list[Stream], campaign_id: int) -> None:

        if any(stream.campaign_id != campaign_id for stream in streams):
            raise KeitaroApiError("Stream campaign identity mismatch")

        if len({stream.id for stream in streams}) != len(streams):
            raise KeitaroApiError("Duplicate stream identity")

    async def get_offer(self, offer_id: int) -> Offer:

        if offer_id < 1:
            raise ValueError("offer_id must be positive")

        response = await self._requester.get(
            f"offers/{offer_id}",
            params=None,
            headers=None,
        )

        try:
            offer = Offer.model_validate_json(response.body)

            if offer.id != offer_id:
                raise KeitaroApiError("Offer identity mismatch")

            return offer

        except ValidationError as exc:
            raise KeitaroApiError("Invalid offer response") from exc
