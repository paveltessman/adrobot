# pyright: strict
from .api_client import KeitaroApiClient
from .exceptions import CampaignNotFoundError
from .models import Campaign
from .models import CampaignConfiguration
from .models import CampaignDetails
from .models import CampaignStream
from .models import Offer
from .models import Stream
from adrobot.services.network.http import HttpStatusError


class KeitaroService:
    def __init__(self, api_client: KeitaroApiClient) -> None:
        self._api_client = api_client

    async def get_campaigns(self, *, limit: int, offset: int) -> list[Campaign]:
        return await self._api_client.get_campaigns(limit=limit, offset=offset)

    async def get_campaign_details(self, campaign_id: int) -> CampaignDetails:

        campaign = await self._get_campaign_configuration(campaign_id)
        streams = await self._api_client.get_streams(campaign_id)
        offers = await self._get_stream_offers(streams)

        details = CampaignDetails(
            **campaign.model_dump(),
            streams=[
                CampaignStream(
                    **stream.model_dump(by_alias=True),
                    offer_details=[offers[item.offer_id] for item in stream.offers],
                )
                for stream in streams
            ],
        )
        return details

    async def _get_campaign_configuration(
        self,
        campaign_id: int,
    ) -> CampaignConfiguration:

        try:
            return await self._api_client.get_campaign_configuration(campaign_id)
        except HttpStatusError as exc:
            if exc.response.status_code == 404:
                raise CampaignNotFoundError("Campaign not found") from exc
            raise

    async def _get_stream_offers(self, streams: list[Stream]) -> dict[int, Offer]:
        offers: dict[int, Offer] = {}
        for stream in streams:
            for membership in stream.offers:
                if membership.offer_id not in offers:
                    offers[membership.offer_id] = await self._api_client.get_offer(
                        membership.offer_id
                    )
        return offers
