# pyright: strict
from asyncio import Lock

from .api_client import KeitaroApiClient
from .create import CampaignCreator
from .create_models import CampaignCreateRequest
from .create_models import CampaignCreateResult
from .exceptions import OfferNotFoundError
from .models import Campaign
from .models import CampaignDetails
from .models import CampaignGroup
from .models import Domain
from .models import Offer
from .models import TrafficSource
from .push import CampaignPusher
from .push_models import CampaignPushRequest
from .push_models import CampaignPushResult
from .push_models import StreamChange
from .reader import CampaignReader
from .state import CampaignStateService
from adrobot.services.network.http import HttpStatusError
from adrobot.storage.database import Database


class KeitaroService:
    def __init__(
        self, api_client: KeitaroApiClient, database: Database, instance: str
    ) -> None:
        self._api_client = api_client
        self._reader = CampaignReader(api_client)
        self._state = CampaignStateService(
            database.campaign_state_transaction, instance
        )
        self._refresh_lock = Lock()

    async def create_campaign(
        self, proposed: CampaignCreateRequest
    ) -> CampaignCreateResult:
        async with self._refresh_lock:
            return await CampaignCreator(
                self._api_client, self._load_campaign_details
            ).create(proposed)

    async def get_domains(self) -> list[Domain]:
        return await self._api_client.get_domains()

    async def get_campaign_groups(self) -> list[CampaignGroup]:
        return await self._api_client.get_campaign_groups()

    async def get_traffic_sources(self) -> list[TrafficSource]:
        return await self._api_client.get_traffic_sources()

    async def get_campaigns(self, *, limit: int, offset: int) -> list[Campaign]:
        return await self._api_client.get_campaigns(limit=limit, offset=offset)

    async def search_offers(self, query: str) -> list[Offer]:
        query = query.strip().casefold()
        offers = await self._api_client.get_offers()
        return [
            offer
            for offer in offers
            if query in offer.name.casefold() or query == str(offer.id)
        ]

    async def get_offer(self, offer_id: int) -> Offer:
        try:
            return await self._api_client.get_offer(offer_id)
        except HttpStatusError as exc:
            if exc.response.status_code == 404:
                raise OfferNotFoundError("Offer not found") from exc
            raise

    async def get_campaign_details(self, campaign_id: int) -> CampaignDetails:
        # Keep overlapping refreshes from persisting snapshots out of order.
        async with self._refresh_lock:
            return await self._load_campaign_details(campaign_id)

    async def _load_campaign_details(self, campaign_id: int) -> CampaignDetails:
        details = await self._reader.fetch(campaign_id)
        await self._state.record(details, {})
        return details

    async def push_campaign(
        self, campaign_id: int, proposed: CampaignPushRequest
    ) -> CampaignPushResult:
        async with self._refresh_lock:
            pusher = CampaignPusher(
                self._api_client, self._load_campaign_details, self._reconcile_push
            )
            return await pusher.push(campaign_id, proposed)

    async def _reconcile_push(
        self, campaign_id: int, attempted: dict[int, StreamChange]
    ) -> CampaignDetails:
        details = await self._reader.fetch(campaign_id)
        await self._state.reconcile(details, attempted)
        return details
