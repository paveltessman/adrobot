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
from .models import Stream
from .models import StreamOffer
from .service import KeitaroService
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import HttpResponse
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError


@dataclass
class ServiceCase:
    service: KeitaroService
    campaigns: AsyncMock
    configuration: AsyncMock
    streams: AsyncMock
    offer: AsyncMock


@pytest.fixture
async def case(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[ServiceCase]:
    requester = AsyncHttpRequester("https://example.com/admin_api/v1/")
    client = KeitaroApiClient(requester)
    mocks = ServiceCase(
        service=KeitaroService(client),
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
        else [{**stream(1, []).model_dump(by_alias=True), "offer_details": []}]
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
