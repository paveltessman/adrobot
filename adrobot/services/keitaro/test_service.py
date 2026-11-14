# pyright: strict
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from unittest.mock import AsyncMock

import pytest

from .api_client import KeitaroApiClient
from .exceptions import CampaignNotFoundError
from .exceptions import KeitaroApiError
from .models import Campaign
from .models import CampaignConfiguration
from .models import Offer
from .models import RemovedOffer
from .models import Stream
from .models import StreamOffer
from .service import KeitaroService
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import HttpResponse
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError
from adrobot.storage.database import Database
from adrobot.storage.memberships import Membership
from adrobot.storage.memberships import MembershipRepository
from adrobot.storage.memberships import MembershipScope
from adrobot.storage.memberships import PinRepository


@dataclass
class ServiceCase:
    service: KeitaroService
    database: Database
    campaigns: AsyncMock
    configuration: AsyncMock
    streams: AsyncMock
    offer: AsyncMock


@pytest.fixture
async def case(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[ServiceCase]:
    requester = AsyncHttpRequester("https://example.com/admin_api/v1/")
    client = KeitaroApiClient(requester)
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.initialize()
    mocks = ServiceCase(
        service=KeitaroService(client, database, "https://example.com/admin_api/v1/"),
        database=database,
        campaigns=AsyncMock(return_value=[]),
        configuration=AsyncMock(
            return_value=CampaignConfiguration(
                id=7,
                name="Campaign",
                group_id=3,
                traffic_source_id=4,
                domain_id=5,
                alias="example",
                state="active",
                notes="Notes",
                updated_at="2026-11-14",
            )
        ),
        streams=AsyncMock(return_value=[]),
        offer=AsyncMock(return_value=Offer(id=9, name="Offer", state="active")),
    )
    monkeypatch.setattr(client, "get_campaigns", mocks.campaigns)
    monkeypatch.setattr(client, "get_campaign_configuration", mocks.configuration)
    monkeypatch.setattr(client, "get_streams", mocks.streams)
    monkeypatch.setattr(client, "get_offer", mocks.offer)
    try:
        yield mocks
    finally:
        await requester.close()
        await database.close()


def stream(identifier: int, offers: list[StreamOffer]) -> Stream:
    return Stream(
        id=identifier,
        campaign_id=7,
        name=f"Stream {identifier}",
        type="regular",
        state="active",
        position=identifier,
        schema="redirect" if not offers else "landings",
        action_type="http",
        action_payload="https://google.com" if not offers else {},
        filters=[{"name": "country", "mode": "accept", "payload": "US"}],
        offers=offers,
        updated_at="2026-11-14",
    )


@pytest.mark.parametrize("empty", [False, True])
async def test_campaign_list_forwards_pagination(
    case: ServiceCase, empty: bool
) -> None:
    expected = [] if empty else [Campaign(id=7, name="Campaign")]
    case.campaigns.return_value = expected
    assert await case.service.get_campaigns(limit=20, offset=40) == expected
    case.campaigns.assert_awaited_once_with(limit=20, offset=40)
    case.configuration.assert_not_awaited()


@pytest.mark.parametrize("empty", [False, True])
async def test_details_preserve_configuration_and_empty_streams(
    case: ServiceCase, empty: bool
) -> None:
    case.streams.return_value = [] if empty else [stream(1, [])]
    result = await case.service.get_campaign_details(7)
    assert result.model_dump(exclude={"streams"}) == {
        "id": 7,
        "name": "Campaign",
        "alias": "example",
        "type": None,
        "state": "active",
        "group_id": 3,
        "traffic_source_id": 4,
        "domain_id": 5,
        "notes": "Notes",
        "updated_at": "2026-11-14",
    }
    assert [item.model_dump(by_alias=True) for item in result.streams] == (
        []
        if empty
        else [
            {
                **stream(1, []).model_dump(by_alias=True),
                "offer_details": [],
                "removed_offers": [],
                "pinned_offer_ids": [],
            }
        ]
    )
    case.configuration.assert_awaited_once_with(7)
    case.streams.assert_awaited_once_with(7)
    case.offer.assert_not_awaited()


async def test_offers_stay_in_their_stream_and_are_fetched_once_per_request(
    case: ServiceCase,
) -> None:
    first = StreamOffer(offer_id=9, share=30, state="active")
    second = StreamOffer(offer_id=10, share=70, state="disabled")
    case.streams.return_value = [
        stream(1, []),
        stream(2, [first, second]),
        stream(3, [first]),
    ]

    def get_offer(identifier: int) -> Offer:
        return Offer(id=identifier, name=f"Offer {identifier}", state="active")

    case.offer.side_effect = get_offer
    result = await case.service.get_campaign_details(7)
    assert [item.offers for item in result.streams] == [[], [first, second], [first]]
    assert [[offer.id for offer in item.offer_details] for item in result.streams] == [
        [],
        [9, 10],
        [9],
    ]
    assert result.streams[1].offer_details[0].name == "Offer 9"
    assert case.offer.await_count == 2
    case.offer.assert_any_await(9)
    case.offer.assert_any_await(10)
    await case.service.get_campaign_details(7)
    assert case.offer.await_count == 4


async def test_missing_campaign_is_translated_and_stops_loading(
    case: ServiceCase,
) -> None:
    original = HttpStatusError(HttpResponse(404, "Not Found", "private"))
    case.configuration.side_effect = original
    with pytest.raises(CampaignNotFoundError, match="Campaign not found") as error:
        await case.service.get_campaign_details(7)
    assert error.value.__cause__ is original
    case.streams.assert_not_awaited()
    case.offer.assert_not_awaited()


@pytest.mark.parametrize("stage", ["campaigns", "configuration", "streams", "offer"])
@pytest.mark.parametrize("failure", ["http", "network", "malformed"])
async def test_upstream_errors_propagate_without_partial_results(
    case: ServiceCase, stage: str, failure: str
) -> None:
    case.streams.return_value = [
        stream(2, [StreamOffer(offer_id=9, share=100, state="active")])
    ]
    await case.service.get_campaign_details(7)
    before = await history(case, 2)
    for mock in (case.campaigns, case.configuration, case.streams, case.offer):
        mock.reset_mock()
    errors = {
        "http": HttpStatusError(HttpResponse(401, "Unauthorized", "private")),
        "network": NetworkError("Transport failure"),
        "malformed": KeitaroApiError("Invalid response"),
    }
    original = errors[failure]
    target: AsyncMock = getattr(case, stage)
    target.side_effect = original
    case.streams.return_value = [
        stream(2, [StreamOffer(offer_id=9, share=100, state="active")])
    ]
    with pytest.raises(type(original)) as error:
        if stage == "campaigns":
            await case.service.get_campaigns(limit=20, offset=0)
        else:
            await case.service.get_campaign_details(7)
    assert error.value is original
    assert await history(case, 2) == before
    if stage == "configuration":
        case.streams.assert_not_awaited()
    if stage != "offer":
        case.offer.assert_not_awaited()


@pytest.mark.parametrize("stage", ["streams", "offer"])
async def test_missing_related_resource_is_not_a_missing_campaign(
    case: ServiceCase, stage: str
) -> None:
    original = HttpStatusError(HttpResponse(404, "Not Found", "private"))
    target: AsyncMock = getattr(case, stage)
    target.side_effect = original
    case.streams.return_value = [
        stream(2, [StreamOffer(offer_id=9, share=100, state="active")])
    ]
    with pytest.raises(HttpStatusError) as error:
        await case.service.get_campaign_details(7)
    assert error.value is original


async def history(case: ServiceCase, stream_id: int) -> list[Membership]:
    async with case.database.transaction() as session:
        return await MembershipRepository(session).list(
            MembershipScope("https://example.com/admin_api/v1/", 7, stream_id)
        )


async def test_refresh_tracks_removal_renaming_and_reattachment(
    case: ServiceCase,
) -> None:
    membership = StreamOffer(offer_id=9, share=100, state="disabled")
    case.streams.return_value = [stream(2, [membership]), stream(3, [membership])]
    await case.service.get_campaign_details(7)
    await case.service.get_campaign_details(7)
    assert await history(case, 2) == [Membership(9, "Offer", "active", True)]

    case.streams.return_value = [stream(2, []), stream(3, [membership])]
    case.offer.return_value = Offer(id=9, name="Renamed", state="disabled")
    result = await case.service.get_campaign_details(7)
    assert result.streams[0].offer_details == []
    assert result.streams[0].removed_offers == [
        RemovedOffer(id=9, name="Offer", last_known_state="active")
    ]
    assert result.streams[1].removed_offers == []
    assert await history(case, 2) == [Membership(9, "Offer", "active", False)]
    assert await history(case, 3) == [Membership(9, "Renamed", "disabled", True)]

    case.streams.return_value = [stream(2, [membership]), stream(3, [])]
    result = await case.service.get_campaign_details(7)
    assert result.streams[0].removed_offers == []
    assert result.streams[0].offer_details == [
        Offer(id=9, name="Renamed", state="disabled")
    ]
    assert result.streams[1].removed_offers == [
        RemovedOffer(id=9, name="Renamed", last_known_state="disabled")
    ]
    assert await history(case, 2) == [Membership(9, "Renamed", "disabled", True)]
    assert await history(case, 3) == [Membership(9, "Renamed", "disabled", False)]


async def test_later_offer_failure_does_not_persist_partial_observations(
    case: ServiceCase,
) -> None:
    original = StreamOffer(offer_id=9, share=100, state="active")
    case.streams.return_value = [stream(2, [original]), stream(3, [original])]
    await case.service.get_campaign_details(7)
    case.streams.return_value = [
        stream(2, []),
        stream(3, [original, StreamOffer(offer_id=10, share=0, state="active")]),
    ]
    case.offer.side_effect = [
        Offer(id=9, name="Unconfirmed rename", state="active"),
        NetworkError("incomplete"),
    ]
    with pytest.raises(NetworkError, match="incomplete"):
        await case.service.get_campaign_details(7)
    for stream_id in (2, 3):
        assert await history(case, stream_id) == [
            Membership(9, "Offer", "active", True)
        ]

    case.offer.side_effect = None
    case.streams.return_value = [stream(2, [original]), stream(3, [original])]
    result = await case.service.get_campaign_details(7)
    assert all(not item.removed_offers for item in result.streams)


async def test_removed_history_is_scoped_and_retained_across_refreshes(
    case: ServiceCase,
) -> None:
    instance = "https://example.com/admin_api/v1/"
    async with case.database.transaction() as session:
        repository = MembershipRepository(session)
        for scope, membership in [
            (MembershipScope(instance, 7, 2), Membership(9, "Old", "active", False)),
            (MembershipScope(instance, 7, 2), Membership(10, "Gone", "deleted", True)),
            (
                MembershipScope(instance, 8, 2),
                Membership(11, "Other campaign", "active", False),
            ),
            (
                MembershipScope("other", 7, 2),
                Membership(12, "Other tracker", "active", False),
            ),
            (
                MembershipScope(instance, 7, 3),
                Membership(13, "Other stream", "active", False),
            ),
        ]:
            await repository.save(scope, membership)
    case.streams.return_value = [stream(2, []), stream(4, [])]
    expected = [
        RemovedOffer(id=9, name="Old", last_known_state="active"),
        RemovedOffer(id=10, name="Gone", last_known_state="deleted"),
    ]
    for _ in range(2):
        result = await case.service.get_campaign_details(7)
        assert result.streams[0].removed_offers == expected
        assert result.streams[0].offer_details == []
        assert result.streams[0].offers == []
        assert result.streams[1].removed_offers == []
    case.offer.assert_not_awaited()


async def test_history_transaction_rolls_back_all_streams_on_storage_failure(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    membership = StreamOffer(offer_id=9, share=100, state="active")
    case.streams.return_value = [stream(2, [membership]), stream(3, [membership])]
    await case.service.get_campaign_details(7)
    case.streams.return_value = [stream(2, []), stream(3, [])]
    save = MembershipRepository.save

    async def failing_save(
        repository: MembershipRepository,
        scope: MembershipScope,
        membership: Membership,
    ) -> None:
        if scope.stream_id == 3:
            raise RuntimeError("storage failure")
        await save(repository, scope, membership)

    monkeypatch.setattr(MembershipRepository, "save", failing_save)
    with pytest.raises(RuntimeError, match="storage failure"):
        await case.service.get_campaign_details(7)
    for stream_id in (2, 3):
        assert await history(case, stream_id) == [
            Membership(9, "Offer", "active", True)
        ]


async def test_refresh_loads_pins_and_removal_permanently_releases_them(
    case: ServiceCase,
) -> None:
    scope = MembershipScope("https://example.com/admin_api/v1/", 7, 1)
    membership = StreamOffer(offer_id=9, share=100, state="active")
    case.streams.return_value = [stream(1, [membership]), stream(2, [membership])]
    async with case.database.transaction() as session:
        await PinRepository(session).replace(scope, {9})
    result = await case.service.get_campaign_details(7)
    assert result.streams[0].pinned_offer_ids == [9]
    assert result.streams[1].pinned_offer_ids == []

    case.streams.return_value = [stream(1, []), stream(2, [membership])]
    case.offer.side_effect = NetworkError("unavailable")
    with pytest.raises(NetworkError):
        await case.service.get_campaign_details(7)
    async with case.database.transaction() as session:
        assert await PinRepository(session).list(scope) == [9]
    case.offer.side_effect = None
    case.streams.return_value = [stream(1, [])]
    result = await case.service.get_campaign_details(7)
    assert result.streams[0].pinned_offer_ids == []
    async with case.database.transaction() as session:
        assert await PinRepository(session).list(scope) == []
    case.streams.return_value = [stream(1, [membership])]
    result = await case.service.get_campaign_details(7)
    assert result.streams[0].pinned_offer_ids == []
