# pyright: strict
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import pytest

from ..models import CampaignDetails
from ..models import CampaignStream
from ..models import Offer
from ..models import RemovedOffer
from ..models import StreamOffer
from .state import CampaignStateService
from .state import CampaignStateTransaction
from adrobot.storage.campaign_state import CampaignStateRepository
from adrobot.storage.campaign_state import Membership
from adrobot.storage.campaign_state import MembershipScope
from adrobot.storage.database import Database


def campaign() -> CampaignDetails:
    return CampaignDetails(
        id=7,
        name="Campaign",
        streams=[
            CampaignStream(
                id=stream_id,
                campaign_id=7,
                name=f"Stream {stream_id}",
                type="regular",
                state="active",
                position=stream_id,
                schema="landings",
                action_type="http",
                action_payload=None,
                filters=[],
                offers=[StreamOffer(offer_id=10, share=100, state="active")],
                offer_details=[Offer(id=10, name="Current", state="active")],
                removed_offers=[],
            )
            for stream_id in (1, 2)
        ],
    )


@pytest.mark.parametrize("fail_commit", [False, True])
async def test_injected_transaction_commits_or_rolls_back_all_campaign_state(
    fail_commit: bool,
) -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    original = Membership(9, "Previous", "active", True)
    scopes = [MembershipScope("tracker", 7, stream_id) for stream_id in (1, 2)]

    try:
        await database.initialize()
        async with database.campaign_state_transaction() as repository:
            for scope in scopes:
                await repository.save_membership(scope, original)
                await repository.replace_pins(scope, {9})
        service = CampaignStateService(
            state_transaction(database, fail_commit), "tracker"
        )
        details = campaign()
        if fail_commit:
            with pytest.raises(RuntimeError, match="commit failed"):
                await service.record(details, {1: {10}, 2: {10}})
        else:
            await service.record(details, {1: {10}, 2: {10}})
            for stream in details.streams:
                assert stream.pinned_offer_ids == [10]
                assert stream.removed_offers == [
                    RemovedOffer(id=9, name="Previous", last_known_state="active")
                ]
        await assert_persisted_state(database, scopes, fail_commit)
    finally:
        await database.close()


async def assert_persisted_state(
    database: Database, scopes: list[MembershipScope], rolled_back: bool
) -> None:
    expected = (
        [Membership(9, "Previous", "active", True)]
        if rolled_back
        else [
            Membership(9, "Previous", "active", False),
            Membership(10, "Current", "active", True),
        ]
    )
    expected_pins = [9] if rolled_back else [10]
    async with database.campaign_state_transaction() as repository:
        for scope in scopes:
            assert await repository.list_pins(scope) == expected_pins
            assert await repository.list_memberships(scope) == expected


def state_transaction(
    database: Database, fail_commit: bool
) -> CampaignStateTransaction:
    @asynccontextmanager
    async def transaction() -> AsyncGenerator[CampaignStateRepository]:
        async with database.campaign_state_transaction() as repository:
            yield repository
            if fail_commit:
                raise RuntimeError("commit failed")

    return transaction
