# pyright: strict
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import replace

from .models import CampaignDetails
from .models import RemovedOffer
from .push_models import StreamChange
from adrobot.storage.campaign_state import CampaignStateRepository
from adrobot.storage.campaign_state import Membership
from adrobot.storage.campaign_state import MembershipScope

type CampaignStateTransaction = Callable[
    [], AbstractAsyncContextManager[CampaignStateRepository]
]


class CampaignStateService:
    def __init__(self, transaction: CampaignStateTransaction, instance: str) -> None:
        self._transaction = transaction
        self._instance = instance

    async def reconcile(
        self,
        details: CampaignDetails,
        attempted: dict[int, StreamChange],
    ) -> None:
        updates = {
            stream.id: set(attempted[stream.id].pinned_offer_ids)
            for stream in details.streams
            if stream.id in attempted and attempted[stream.id].matches(stream)
        }
        await self.record(details, updates)

    async def record(
        self, details: CampaignDetails, pin_updates: dict[int, set[int]]
    ) -> None:

        async with self._transaction() as repo:

            for stream in details.streams:
                scope = MembershipScope(self._instance, details.id, stream.id)

                await self._save_pins(repo, scope, pin_updates)

                current_ids = stream.get_offer_ids()

                pinned = await self._reconcile_pins(
                    repo,
                    scope,
                    current_ids,
                )
                stream.pinned_offer_ids = pinned

                history = await repo.list_memberships(scope)

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
                        await repo.save_membership(
                            scope, replace(previous, attached=False)
                        )
                for offer in stream.offer_details:
                    await repo.save_membership(
                        scope, Membership(offer.id, offer.name, offer.state, True)
                    )

    @staticmethod
    async def _save_pins(
        pins: CampaignStateRepository,
        scope: MembershipScope,
        updates: dict[int, set[int]],
    ) -> None:
        if scope.stream_id in updates:
            await pins.replace_pins(scope, updates[scope.stream_id])

    @staticmethod
    async def _reconcile_pins(
        pins: CampaignStateRepository,
        scope: MembershipScope,
        current_ids: set[int],
    ) -> list[int]:
        committed_ids = await pins.list_pins(scope)
        retained = [offer_id for offer_id in committed_ids if offer_id in current_ids]
        if retained != committed_ids:
            await pins.replace_pins(scope, set(retained))
        return retained
