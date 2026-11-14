# pyright: strict
from asyncio import Lock
from dataclasses import replace

from .api_client import KeitaroApiClient
from .exceptions import CampaignNotFoundError
from .models import Campaign
from .models import CampaignConfiguration
from .models import CampaignDetails
from .models import CampaignStream
from .models import Offer
from .models import Stream
from adrobot.services.network.http import HttpStatusError
from adrobot.storage.database import Database
from adrobot.storage.memberships import Membership
from adrobot.storage.memberships import MembershipRepository
from adrobot.storage.memberships import MembershipScope


class KeitaroService:
    def __init__(
        self, api_client: KeitaroApiClient, database: Database, instance: str
    ) -> None:
        self._api_client = api_client
        self._database = database
        self._instance = instance
        self._refresh_lock = Lock()

    async def get_campaigns(self, *, limit: int, offset: int) -> list[Campaign]:
        return await self._api_client.get_campaigns(limit=limit, offset=offset)

    async def get_campaign_details(self, campaign_id: int) -> CampaignDetails:
        # Keep overlapping refreshes from persisting snapshots out of order.
        async with self._refresh_lock:
            return await self._load_campaign_details(campaign_id)

    async def _load_campaign_details(self, campaign_id: int) -> CampaignDetails:

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
        await self._record_history(details)
        return details

    async def _record_history(self, details: CampaignDetails) -> None:
        async with self._database.transaction() as session:
            repository = MembershipRepository(session)
            for stream in details.streams:
                scope = MembershipScope(self._instance, details.id, stream.id)
                current_ids = {item.offer_id for item in stream.offers}
                for previous in await repository.list(scope):
                    if previous.attached and previous.offer_id not in current_ids:
                        await repository.save(scope, replace(previous, attached=False))
                for offer in stream.offer_details:
                    await repository.save(
                        scope, Membership(offer.id, offer.name, offer.state, True)
                    )

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
