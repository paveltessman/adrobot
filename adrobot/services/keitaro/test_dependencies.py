# pyright: strict
import asyncio
from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass
from unittest.mock import AsyncMock

import pytest

from .api_client import KeitaroApiClient
from .create import CampaignCreator
from .create_models import CampaignCreateRequest
from .create_models import CampaignCreateResult
from .models import CampaignDetails
from .push import CampaignPusher
from .push_models import CampaignPushRequest
from .push_models import CampaignPushResult
from .push_models import ProposedOffer
from .push_models import StreamChange
from .service import KeitaroService


@dataclass
class Dependencies:
    service: KeitaroService
    load: AsyncMock
    creator: AsyncMock
    pusher: AsyncMock


@pytest.fixture
def dependencies() -> Dependencies:
    load = AsyncMock()
    creator = AsyncMock(spec=CampaignCreator)
    pusher = AsyncMock(spec=CampaignPusher)
    service = KeitaroService(
        api_client=AsyncMock(spec=KeitaroApiClient),
        load=load,
        creator=creator,
        pusher=pusher,
    )
    return Dependencies(service, load, creator, pusher)


def create_request() -> CampaignCreateRequest:
    return CampaignCreateRequest(name="Campaign", country_codes=["US"], offer_id=9)


def push_request() -> CampaignPushRequest:
    return CampaignPushRequest(
        streams=[
            StreamChange(
                stream_id=2,
                offers=[ProposedOffer(offer_id=9, share=100, state="active")],
                pinned_offer_ids=[],
            )
        ]
    )


async def test_facade_delegates_to_injected_dependencies(
    dependencies: Dependencies,
) -> None:
    details = CampaignDetails(id=7, name="Campaign", streams=[])
    created = CampaignCreateResult(status="created", campaign_id=7, campaign=details)
    pushed = CampaignPushResult(status="applied", campaign=details, pending_streams=[])
    dependencies.load.return_value = details
    dependencies.creator.create.return_value = created
    dependencies.pusher.push.return_value = pushed
    create = create_request()
    push = push_request()

    assert await dependencies.service.get_campaign_details(7) is details
    assert await dependencies.service.create_campaign(create) is created
    assert await dependencies.service.push_campaign(7, push) is pushed
    dependencies.load.assert_awaited_once_with(7)
    dependencies.creator.create.assert_awaited_once_with(create)
    dependencies.pusher.push.assert_awaited_once_with(7, push)


def operations(service: KeitaroService) -> dict[str, Callable[[], Awaitable[object]]]:
    return {
        "refresh": lambda: service.get_campaign_details(7),
        "create": lambda: service.create_campaign(create_request()),
        "push": lambda: service.push_campaign(7, push_request()),
    }


@pytest.mark.parametrize("first", ["refresh", "create", "push"])
@pytest.mark.parametrize("second", ["refresh", "create", "push"])
async def test_operations_share_one_lock(
    dependencies: Dependencies, first: str, second: str
) -> None:
    entered = asyncio.Event()
    release = asyncio.Event()
    calls: list[tuple[object, ...]] = []

    async def block(*args: object) -> None:
        calls.append(args)
        entered.set()
        await release.wait()

    dependencies.load.side_effect = block
    dependencies.creator.create.side_effect = block
    dependencies.pusher.push.side_effect = block
    actions = operations(dependencies.service)

    async def invoke(name: str) -> None:
        await actions[name]()

    async with asyncio.timeout(2):
        async with asyncio.TaskGroup() as tasks:
            tasks.create_task(invoke(first))
            await entered.wait()
            tasks.create_task(invoke(second))
            try:
                await asyncio.sleep(0)
                assert len(calls) == 1
            finally:
                release.set()
    assert len(calls) == 2


@pytest.mark.parametrize("operation", ["refresh", "create", "push"])
async def test_failed_operation_releases_lock(
    dependencies: Dependencies, operation: str
) -> None:
    workflows = {
        "refresh": dependencies.load,
        "create": dependencies.creator.create,
        "push": dependencies.pusher.push,
    }
    workflows[operation].side_effect = RuntimeError("operation failed")
    with pytest.raises(RuntimeError, match="operation failed"):
        await operations(dependencies.service)[operation]()

    details = CampaignDetails(id=7, name="Campaign", streams=[])
    dependencies.load.side_effect = None
    dependencies.load.return_value = details
    assert (
        await asyncio.wait_for(dependencies.service.get_campaign_details(7), timeout=2)
        is details
    )
