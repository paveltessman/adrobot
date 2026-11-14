# pyright: strict
from pydantic import TypeAdapter
from pydantic import ValidationError

from .exceptions import KeitaroApiError
from .models import Campaign
from .models import CampaignConfiguration
from .models import CampaignGroup
from .models import CreationOption
from .models import Domain
from .models import Offer
from .models import Stream
from .models import TrafficSource
from .push_models import ProposedOffer
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http.types import QueryParams

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

    async def get_domains(self) -> list[Domain]:
        return await self._get_creation_options("domains", TypeAdapter(list[Domain]))

    async def get_campaign_groups(self) -> list[CampaignGroup]:
        return await self._get_creation_options(
            "groups", TypeAdapter(list[CampaignGroup]), params={"type": "campaigns"}
        )

    async def get_traffic_sources(self) -> list[TrafficSource]:
        return await self._get_creation_options(
            "traffic_sources", TypeAdapter(list[TrafficSource])
        )

    async def _get_creation_options[T: CreationOption](
        self,
        path: str,
        adapter: TypeAdapter[list[T]],
        *,
        params: QueryParams | None = None,
    ) -> list[T]:
        response = await self._requester.get(path, params=params, headers=None)
        try:
            options = adapter.validate_json(response.body)
        except ValidationError as exc:
            raise KeitaroApiError(f"GET {path}: Invalid selector response") from exc
        if len({option.id for option in options}) != len(options):
            raise KeitaroApiError(f"GET {path}: Duplicate selector identity")
        return options

    async def update_stream_offers(
        self, stream_id: int, offers: list[ProposedOffer]
    ) -> None:
        if stream_id < 1:
            raise ValueError("stream_id must be positive")
        response = await self._requester.put(
            f"streams/{stream_id}",
            json_data={
                "offers": [
                    {
                        "offer_id": item.offer_id,
                        "share": item.share,
                        "state": item.state,
                    }
                    for item in offers
                ]
            },
            params=None,
            headers=None,
        )
        try:
            stream = Stream.model_validate_json(response.body)
        except ValidationError as exc:
            raise KeitaroApiError("Invalid updated stream response") from exc
        if stream.id != stream_id:
            raise KeitaroApiError("Updated stream identity mismatch")

    async def get_offers(self) -> list[Offer]:
        response = await self._requester.get("offers", params=None, headers=None)
        try:
            offers = TypeAdapter(list[Offer]).validate_json(response.body)
        except ValidationError as exc:
            raise KeitaroApiError("GET offers: Invalid offers response") from exc
        if any(offer.id < 1 for offer in offers) or len(
            {offer.id for offer in offers}
        ) != len(offers):
            raise KeitaroApiError("GET offers: Invalid offer identities")
        return offers

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
            raise KeitaroApiError("GET campaigns: Invalid campaigns response") from exc

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
            raise KeitaroApiError(
                f"GET campaigns/{campaign_id}: Invalid campaign response"
            ) from exc

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
                raise KeitaroApiError(
                    f"GET campaigns/{campaign_id}: Campaign identity mismatch"
                )

            return campaign

        except ValidationError as exc:
            raise KeitaroApiError(
                f"GET campaigns/{campaign_id}: Invalid campaign response"
            ) from exc

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
            raise KeitaroApiError(
                f"GET campaigns/{campaign_id}/streams: Invalid streams response"
            ) from exc

        self._validate_streams(streams, campaign_id)
        return streams

    @staticmethod
    def _validate_streams(streams: list[Stream], campaign_id: int) -> None:

        if any(stream.campaign_id != campaign_id for stream in streams):
            raise KeitaroApiError(
                f"GET campaigns/{campaign_id}/streams: "
                "Stream campaign identity mismatch"
            )

        if len({stream.id for stream in streams}) != len(streams):
            raise KeitaroApiError(
                f"GET campaigns/{campaign_id}/streams: Duplicate stream identity"
            )

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
                raise KeitaroApiError(f"GET offers/{offer_id}: Offer identity mismatch")

            return offer

        except ValidationError as exc:
            raise KeitaroApiError(
                f"GET offers/{offer_id}: Invalid offer response"
            ) from exc
