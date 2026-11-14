# pyright: strict
import asyncio
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from .api_client import KeitaroApiClient
from .exceptions import InvalidCampaignPush
from .models import CampaignConfiguration
from .models import Offer
from .models import Stream
from .models import StreamOffer
from .push_models import CampaignPushRequest
from .push_models import ProposedOffer
from .push_models import StreamChange
from .service import KeitaroService
from .test_service import history
from .test_service import ServiceCase
from .test_service import stream
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import HttpResponse
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError
from adrobot.storage.database import Database
from adrobot.storage.memberships import MembershipScope
from adrobot.storage.memberships import PinRepository


@pytest.fixture(name="case")
async def push_case(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[ServiceCase]:
    client = KeitaroApiClient(AsyncHttpRequester("https://example.com/admin_api/v1/"))
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.initialize()
    result = ServiceCase(
        service=KeitaroService(client, database, "https://example.com/admin_api/v1/"),
        database=database,
        campaigns=AsyncMock(return_value=[]),
        configuration=AsyncMock(
            return_value=CampaignConfiguration(id=7, name="Campaign")
        ),
        streams=AsyncMock(return_value=[]),
        offer=AsyncMock(side_effect=available_offer),
    )
    monkeypatch.setattr(client, "get_campaign_configuration", result.configuration)
    monkeypatch.setattr(client, "get_streams", result.streams)
    monkeypatch.setattr(client, "get_offer", result.offer)
    try:
        yield result
    finally:
        await database.close()


def change(stream_id: int = 1, offer_id: int = 10, *, pin: bool = True) -> StreamChange:
    return StreamChange(
        stream_id=stream_id,
        offers=[ProposedOffer(offer_id=offer_id, share=100, state="active")],
        pinned_offer_ids=[offer_id] if pin else [],
    )


def available_offer(offer_id: int) -> Offer:
    return Offer(id=offer_id, name=f"Offer {offer_id}", state="active")


def membership(offer_id: int = 9) -> StreamOffer:
    return StreamOffer(offer_id=offer_id, share=100, state="active")


@pytest.mark.parametrize(
    "updates",
    [
        {"offers": []},
        {"offers": [{"offer_id": 9, "share": 99, "state": "active"}]},
        {"offers": [{"offer_id": 9, "share": True, "state": "active"}]},
        {"offers": [{"offer_id": 9, "share": 100.0, "state": "active"}]},
        {"offers": [{"offer_id": 9, "share": 101, "state": "active"}]},
        {"offers": [{"offer_id": 9, "share": -1, "state": "active"}]},
        {"offers": [{"offer_id": 0, "share": 100, "state": "active"}]},
        {"offers": [{"offer_id": 9, "share": 100, "state": "deleted"}]},
        {"offers": [{"offer_id": 9, "share": 50, "state": "active"}] * 2},
        {"pinned_offer_ids": [10, 10]},
        {"pinned_offer_ids": [9]},
        {"pinned_offer_ids": [True]},
        {"stream_id": 0},
        {"name": "Cannot edit configuration"},
    ],
)
def test_invalid_drafts_are_rejected(updates: dict[str, object]) -> None:
    payload: dict[str, object] = change().model_dump()
    payload.update(updates)
    with pytest.raises(ValidationError):
        StreamChange.model_validate(payload)


def test_duplicate_and_empty_stream_requests_are_rejected() -> None:
    for streams in [[], [change(), change()]]:
        with pytest.raises(ValidationError):
            CampaignPushRequest(streams=streams)


async def test_success_reconciles_history_pins_and_preserves_google(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = [stream(1, [membership()]), stream(2, [])]
    confirmed = [stream(1, [membership(10)]), baseline[1]]
    case.streams.side_effect = [baseline, confirmed]
    case.offer.side_effect = available_offer
    update = AsyncMock()
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    result = await case.service.push_campaign(
        7, CampaignPushRequest(streams=[change()])
    )
    assert result.status == "applied"
    assert result.pending_streams == []
    assert result.campaign is not None
    assert result.campaign.streams[1].action_payload == "https://google.com"
    assert result.campaign.streams[0].pinned_offer_ids == [10]
    update.assert_awaited_once_with(1, change().offers)
    observed = await history(case, 1)
    assert [(item.offer_id, item.attached) for item in observed] == [
        (9, False),
        (10, True),
    ]
    assert await saved_pins(case, 1) == [10]
    case.streams.side_effect = None
    case.streams.return_value = confirmed
    reloaded = await case.service.get_campaign_details(7)
    assert reloaded.streams[0].pinned_offer_ids == [10]


async def saved_pins(case: ServiceCase, stream_id: int) -> list[int]:
    async with case.database.transaction() as session:
        return await PinRepository(session).list(
            MembershipScope("https://example.com/admin_api/v1/", 7, stream_id)
        )


@pytest.mark.parametrize(
    "kind", ["foreign", "redirect", "state", "archived", "missing"]
)
async def test_validation_of_entire_request_precedes_all_writes(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    case.streams.return_value = [stream(1, [membership()]), stream(2, [membership()])]
    second = change(2)
    if kind == "foreign":
        second = change(999)
    if kind == "redirect":
        case.streams.return_value = [stream(1, [membership()]), stream(2, [])]
    if kind == "state":
        second.offers[0].state = "disabled"
    case.offer.return_value = Offer(id=10, name="New", state="active")
    if kind == "archived":
        case.offer.side_effect = [
            Offer(id=9, name="Old", state="active"),
            Offer(id=10, name="Archived", state="deleted"),
        ]
    set_missing_offer(case, kind)
    update = AsyncMock()
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    with pytest.raises(InvalidCampaignPush):
        await case.service.push_campaign(
            7, CampaignPushRequest(streams=[change(), second])
        )
    update.assert_not_awaited()
    assert await saved_pins(case, 1) == []


def set_missing_offer(case: ServiceCase, kind: str) -> None:
    if kind == "missing":
        case.offer.side_effect = [
            Offer(id=9, name="Old", state="active"),
            HttpStatusError(HttpResponse(404, "Missing", "private")),
        ]


@pytest.mark.parametrize("committed", [True, False])
async def test_timeout_is_reconciled_without_retrying_the_write(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch, committed: bool
) -> None:
    original = stream(1, [membership()])
    case.streams.side_effect = [
        [original],
        [stream(1, [membership(10)]) if committed else original],
    ]
    case.offer.side_effect = available_offer
    update = AsyncMock(side_effect=NetworkError("private timeout details"))
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    result = await case.service.push_campaign(
        7, CampaignPushRequest(streams=[change()])
    )
    assert result.status == ("applied" if committed else "failed")
    assert result.pending_streams == ([] if committed else [change()])
    assert await saved_pins(case, 1) == ([10] if committed else [])
    assert "private" not in result.model_dump_json()
    assert update.await_count == 1


async def test_partial_push_stops_and_commits_only_confirmed_preferences(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = [stream(i, [membership()]) for i in [1, 2, 3]]
    case.streams.side_effect = [original, [stream(1, [membership(10)]), *original[1:]]]
    case.offer.side_effect = available_offer
    update = AsyncMock(side_effect=[None, NetworkError("failed")])
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    request = CampaignPushRequest(streams=[change(1), change(2), change(3, 9)])
    result = await case.service.push_campaign(7, request)
    assert result.status == "partial"
    assert result.pending_streams == request.streams[1:]
    assert update.await_count == 2
    assert await saved_pins(case, 1) == [10]
    assert await saved_pins(case, 2) == []
    assert await saved_pins(case, 3) == []


async def test_pin_only_push_does_not_write_keitaro(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    case.streams.return_value = [stream(1, [membership()])]
    update = AsyncMock()
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    result = await case.service.push_campaign(
        7, CampaignPushRequest(streams=[change(1, 9)])
    )
    assert result.status == "applied"
    update.assert_not_awaited()
    assert await saved_pins(case, 1) == [9]
    result = await case.service.push_campaign(
        7, CampaignPushRequest(streams=[change(1, 9, pin=False)])
    )
    assert result.status == "applied"
    assert await saved_pins(case, 1) == []


@pytest.mark.parametrize("storage_failure", [False, True])
async def test_unknown_outcome_retains_all_proposals_and_last_confirmed_pins(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch, storage_failure: bool
) -> None:
    original = stream(1, [membership()])
    case.streams.side_effect = [
        [original],
        (
            [stream(1, [membership(10)])]
            if storage_failure
            else NetworkError("reload failed")
        ),
    ]
    case.offer.side_effect = available_offer
    update = AsyncMock()
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    if storage_failure:
        monkeypatch.setattr(
            PinRepository,
            "replace",
            AsyncMock(side_effect=SQLAlchemyError("database failed")),
        )
    result = await case.service.push_campaign(
        7, CampaignPushRequest(streams=[change()])
    )
    assert result.status == "unknown"
    assert result.campaign is None
    assert result.pending_streams == [change()]
    assert await saved_pins(case, 1) == []
    assert [(item.offer_id, item.attached) for item in await history(case, 1)] == [
        (9, True)
    ]


async def test_refresh_cannot_interleave_with_push(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    entered = asyncio.Event()
    release = asyncio.Event()
    current = [stream(1, [membership()])]

    def get_streams(campaign_id: int) -> list[Stream]:
        return current

    case.streams.side_effect = get_streams
    case.offer.side_effect = available_offer

    async def update(stream_id: int, offers: list[ProposedOffer]) -> None:
        entered.set()
        await release.wait()
        current[:] = [stream(1, [membership(10)])]

    monkeypatch.setattr(
        KeitaroApiClient, "update_stream_offers", AsyncMock(side_effect=update)
    )
    push = asyncio.create_task(
        case.service.push_campaign(7, CampaignPushRequest(streams=[change()]))
    )
    await asyncio.wait_for(entered.wait(), timeout=2)
    refresh = asyncio.create_task(case.service.get_campaign_details(7))
    await asyncio.sleep(0)
    assert not refresh.done()
    release.set()
    result, details = await asyncio.gather(push, refresh)
    assert result.status == "applied"
    assert details.streams[0].pinned_offer_ids == [10]


async def test_preserves_disabled_membership_and_accepts_zero_share(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = stream(1, [StreamOffer(offer_id=9, share=100, state="disabled")])
    target = StreamChange(
        stream_id=1,
        offers=[
            ProposedOffer(offer_id=9, share=100, state="disabled"),
            ProposedOffer(offer_id=10, share=0, state="active"),
        ],
        pinned_offer_ids=[9],
    )
    final = stream(1, [StreamOffer(**item.model_dump()) for item in target.offers])
    case.streams.side_effect = [[first], [final]]
    update = AsyncMock()
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    result = await case.service.push_campaign(7, CampaignPushRequest(streams=[target]))
    assert result.status == "applied"
    update.assert_awaited_once_with(1, target.offers)


async def test_partial_stream_outcome_keeps_proposal_and_does_not_commit_new_pins(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = stream(1, [membership()])
    normalized = stream(1, [StreamOffer(offer_id=10, share=80, state="active")])
    case.streams.side_effect = [[baseline], [normalized]]
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", AsyncMock())
    result = await case.service.push_campaign(
        7, CampaignPushRequest(streams=[change()])
    )
    assert result.status == "partial"
    assert result.pending_streams == [change()]
    assert result.campaign is not None
    assert result.campaign.streams[0].offers[0].share == 80
    assert await saved_pins(case, 1) == []


async def test_permission_failure_during_validation_never_writes(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    case.streams.return_value = [stream(1, [membership()])]
    case.offer.side_effect = [
        available_offer(9),
        HttpStatusError(HttpResponse(403, "Forbidden", "private")),
    ]
    update = AsyncMock()
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    with pytest.raises(HttpStatusError):
        await case.service.push_campaign(7, CampaignPushRequest(streams=[change()]))
    update.assert_not_awaited()


async def test_refresh_failure_before_push_prevents_any_writes(
    case: ServiceCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    case.streams.side_effect = NetworkError("incomplete baseline")
    update = AsyncMock()
    monkeypatch.setattr(KeitaroApiClient, "update_stream_offers", update)
    with pytest.raises(NetworkError):
        await case.service.push_campaign(7, CampaignPushRequest(streams=[change()]))
    update.assert_not_awaited()
