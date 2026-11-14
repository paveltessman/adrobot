# pyright: strict
from collections.abc import Awaitable
from collections.abc import Callable

from sqlalchemy.exc import SQLAlchemyError

from .api_client import KeitaroApiClient
from .exceptions import InvalidCampaignPush
from .exceptions import KeitaroApiError
from .models import CampaignDetails
from .models import CampaignStream
from .push_models import CampaignPushRequest
from .push_models import CampaignPushResult
from .push_models import StreamChange
from adrobot.log import Logger
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError

type LoadCampaign = Callable[[int], Awaitable[CampaignDetails]]
type ReconcileCampaign = Callable[
    [int, dict[int, StreamChange]], Awaitable[CampaignDetails]
]


class CampaignPusher:
    def __init__(
        self,
        client: KeitaroApiClient,
        load: LoadCampaign,
        reconcile: ReconcileCampaign,
    ) -> None:
        self._client = client
        self._load = load
        self._reconcile = reconcile

    async def push(
        self, campaign_id: int, proposed: CampaignPushRequest
    ) -> CampaignPushResult:
        baseline = await self._load(campaign_id)
        streams = {stream.id: stream for stream in baseline.streams}
        self._validate_streams(proposed, streams)
        await self._validate_offers(proposed)
        attempted = await self._write(proposed, streams)
        try:
            confirmed = await self._reconcile(campaign_id, attempted)
        except (NetworkError, KeitaroApiError, SQLAlchemyError) as exc:
            Logger().exception("Campaign Push reconciliation failed", exc)
            return CampaignPushResult(
                status="unknown",
                campaign=None,
                pending_streams=proposed.streams,
                message="Could not confirm the outcome. Reload before retrying.",
            )
        return self._result(proposed, baseline, confirmed)

    @staticmethod
    def _validate_streams(
        proposed: CampaignPushRequest, streams: dict[int, CampaignStream]
    ) -> None:
        for change in proposed.streams:
            stream = streams.get(change.stream_id)
            if stream is None:
                raise InvalidCampaignPush("Stream does not belong to this campaign")
            if stream.routing_schema != "landings":
                raise InvalidCampaignPush("Only offer-routing streams can be edited")
            CampaignPusher._validate_states(change, stream)

    @staticmethod
    def _validate_states(change: StreamChange, stream: CampaignStream) -> None:
        states = {offer.offer_id: offer.state for offer in stream.offers}
        for offer in change.offers:
            expected = states.get(offer.offer_id, "active")
            if offer.state != expected:
                raise InvalidCampaignPush("Offer membership states must be preserved")

    async def _validate_offers(self, proposed: CampaignPushRequest) -> None:
        identities = {offer.offer_id for s in proposed.streams for offer in s.offers}
        for offer_id in sorted(identities):
            await self._validate_offer(offer_id)

    async def _validate_offer(self, offer_id: int) -> None:
        try:
            offer = await self._client.get_offer(offer_id)
        except HttpStatusError as exc:
            if exc.response.status_code == 404:
                raise InvalidCampaignPush("Selected offer is unavailable") from exc
            raise
        if offer.state not in {"active", "disabled"}:
            raise InvalidCampaignPush("Selected offer is archived or unavailable")

    async def _write(
        self, proposed: CampaignPushRequest, streams: dict[int, CampaignStream]
    ) -> dict[int, StreamChange]:
        attempted: dict[int, StreamChange] = {}
        for change in proposed.streams:
            attempted[change.stream_id] = change
            try:
                await self._write_stream(change, streams[change.stream_id])
            except (NetworkError, KeitaroApiError) as exc:
                Logger().exception("Campaign Push upstream write failed", exc)
                break
        return attempted

    async def _write_stream(self, change: StreamChange, stream: CampaignStream) -> None:
        # Pin-only changes and retries whose remote outcome is already present
        # need no remote write. PUT itself is never automatically retried.
        if not change.matches(stream):
            await self._client.update_stream_offers(change.stream_id, change.offers)

    @staticmethod
    def _pending(
        proposed: CampaignPushRequest, confirmed: CampaignDetails
    ) -> list[StreamChange]:
        streams = {stream.id: stream for stream in confirmed.streams}
        return [
            change
            for change in proposed.streams
            if not CampaignPusher._matches(change, streams.get(change.stream_id))
        ]

    @staticmethod
    def _matches(change: StreamChange, stream: CampaignStream | None) -> bool:
        if stream is None:
            return False
        return change.matches(stream) and set(change.pinned_offer_ids) == set(
            stream.pinned_offer_ids
        )

    @staticmethod
    def _result(
        proposed: CampaignPushRequest,
        baseline: CampaignDetails,
        confirmed: CampaignDetails,
    ) -> CampaignPushResult:
        pending = CampaignPusher._pending(proposed, confirmed)
        if not pending:
            return CampaignPushResult(
                status="applied", campaign=confirmed, pending_streams=[]
            )
        progressed = CampaignPusher._configuration(baseline, proposed) != (
            CampaignPusher._configuration(confirmed, proposed)
        )
        return CampaignPushResult(
            status="partial" if progressed else "failed",
            campaign=confirmed,
            pending_streams=pending,
            message=(
                "Some changes remain unapplied. "
                "Review confirmed state before retrying."
            ),
        )

    @staticmethod
    def _configuration(
        campaign: CampaignDetails, proposed: CampaignPushRequest
    ) -> dict[int, tuple[list[tuple[int, int, str]], list[int]]]:
        requested = {change.stream_id for change in proposed.streams}
        return {
            stream.id: (
                sorted(
                    (item.offer_id, item.share, item.state) for item in stream.offers
                ),
                sorted(stream.pinned_offer_ids),
            )
            for stream in campaign.streams
            if stream.id in requested
        }
