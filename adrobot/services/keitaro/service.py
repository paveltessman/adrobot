# pyright: strict
from asyncio import Lock
from dataclasses import replace

from .api_client import KeitaroApiClient
from .create import CampaignCreator
from .create_models import CampaignCreateRequest
from .create_models import CampaignCreateResult
from .exceptions import CampaignNotFoundError
from .exceptions import OfferNotFoundError
from .models import Campaign
from .models import CampaignConfiguration
from .models import CampaignDetails
from .models import CampaignGroup
from .models import CampaignStream
from .models import Domain
from .models import Offer
from .models import RemovedOffer
from .models import Stream
from .models import TrafficSource
from .push import CampaignPusher
from .push_models import CampaignPushRequest
from .push_models import CampaignPushResult
from .push_models import StreamChange
from adrobot.services.network.http import HttpStatusError
from adrobot.storage.database import Database
from adrobot.storage.memberships import Membership
from adrobot.storage.memberships import MembershipRepository
from adrobot.storage.memberships import MembershipScope
from adrobot.storage.memberships import PinRepository


class KeitaroService:
    def __init__(
        self, api_client: KeitaroApiClient, database: Database, instance: str
    ) -> None:
        self._api_client = api_client
        self._database = database
        self._instance = instance
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
        details = await self._fetch_campaign_details(campaign_id)
        await self._record_history(details, {})
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
        details = await self._fetch_campaign_details(campaign_id)
        updates = {
            stream.id: set(attempted[stream.id].pinned_offer_ids)
            for stream in details.streams
            if stream.id in attempted and attempted[stream.id].matches(stream)
        }
        await self._record_history(details, updates)
        return details

    async def _fetch_campaign_details(self, campaign_id: int) -> CampaignDetails:

        campaign = await self._get_campaign_configuration(campaign_id)
        streams = await self._api_client.get_streams(campaign_id)
        offers = await self._get_stream_offers(streams)

        details = CampaignDetails(
            **campaign.model_dump(),
            streams=[
                CampaignStream(
                    **stream.model_dump(by_alias=True),
                    offer_details=[offers[item.offer_id] for item in stream.offers],
                    removed_offers=[],
                )
                for stream in streams
            ],
        )
        return details

    async def _record_history(
        self, details: CampaignDetails, pin_updates: dict[int, set[int]]
    ) -> None:
        async with self._database.transaction() as session:
            repository = MembershipRepository(session)
            pins = PinRepository(session)
            for stream in details.streams:
                scope = MembershipScope(self._instance, details.id, stream.id)
                await self._save_pins(pins, scope, pin_updates)
                current_ids = {item.offer_id for item in stream.offers}
                stream.pinned_offer_ids = await self._reconcile_pins(
                    pins, scope, current_ids
                )
                history = await repository.list(scope)
                stream.removed_offers = [
                    RemovedOffer(
                        id=previous.offer_id,
                        name=previous.name,
                        last_known_state=previous.state,
                    )
                    for previous in history
                    if previous.offer_id not in current_ids
                ]
                for previous in history:
                    if previous.attached and previous.offer_id not in current_ids:
                        await repository.save(scope, replace(previous, attached=False))
                for offer in stream.offer_details:
                    await repository.save(
                        scope, Membership(offer.id, offer.name, offer.state, True)
                    )

    @staticmethod
    async def _save_pins(
        pins: PinRepository, scope: MembershipScope, updates: dict[int, set[int]]
    ) -> None:
        if scope.stream_id in updates:
            await pins.replace(scope, updates[scope.stream_id])

    @staticmethod
    async def _reconcile_pins(
        pins: PinRepository, scope: MembershipScope, current_ids: set[int]
    ) -> list[int]:
        committed_ids = await pins.list(scope)
        retained = [offer_id for offer_id in committed_ids if offer_id in current_ids]
        if retained != committed_ids:
            await pins.replace(scope, set(retained))
        return retained

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
