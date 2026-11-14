# pyright: strict
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from .api_client import KeitaroApiClient
from .create import stream_payloads
from .create_models import CampaignCreateRequest
from .create_models import CreationResource
from .exceptions import InvalidCampaignCreation
from .exceptions import KeitaroApiError
from .models import CampaignConfiguration
from .models import CampaignGroup
from .models import Offer
from .models import Stream
from .service import KeitaroService
from adrobot.services.network.http import AsyncHttpRequester
from adrobot.services.network.http import HttpResponse
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError
from adrobot.storage.database import Database
from adrobot.storage.memberships import MembershipRepository
from adrobot.storage.memberships import MembershipScope


def proposed() -> CampaignCreateRequest:
    return CampaignCreateRequest(
        name="Example",
        country_code="AU",
        offer_id=9,
        domain_id=2,
        group_id=3,
        traffic_source_id=4,
    )


@dataclass
class CreationCase:
    service: KeitaroService
    database: Database
    create: AsyncMock
    create_stream: AsyncMock
    configuration: AsyncMock
    streams: AsyncMock
    offer: AsyncMock
    domain: AsyncMock
    source: AsyncMock
    groups: AsyncMock


@pytest.fixture
async def case(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[CreationCase]:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.initialize()
    requester = AsyncHttpRequester("https://example.com/admin_api/v1/")
    client = KeitaroApiClient(requester)
    streams: list[Stream] = []
    configuration = CampaignConfiguration(
        id=7,
        name="Example",
        type="position",
        state="active",
        domain_id=2,
        group_id=3,
        traffic_source_id=4,
    )

    def create(request: CampaignCreateRequest, alias: str) -> int:
        configuration.alias = alias
        return 7

    def create_stream(campaign_id: int, payload: dict[str, object]) -> None:
        streams.append(Stream.model_validate({"id": len(streams) + 1, **payload}))

    result = CreationCase(
        service=KeitaroService(client, database, "instance"),
        database=database,
        create=AsyncMock(side_effect=create),
        create_stream=AsyncMock(side_effect=create_stream),
        configuration=AsyncMock(return_value=configuration),
        streams=AsyncMock(return_value=streams),
        offer=AsyncMock(return_value=Offer(id=9, name="Offer", state="active")),
        domain=AsyncMock(return_value=CreationResource(id=2, state="active")),
        source=AsyncMock(return_value=CreationResource(id=4, state="active")),
        groups=AsyncMock(return_value=[CampaignGroup(id=3, name="Group")]),
    )
    for method, mock in [
        ("create_campaign", result.create),
        ("create_stream", result.create_stream),
        ("get_campaign_configuration", result.configuration),
        ("get_streams", result.streams),
        ("get_offer", result.offer),
        ("get_domain", result.domain),
        ("get_traffic_source", result.source),
        ("get_campaign_groups", result.groups),
    ]:
        monkeypatch.setattr(client, method, mock)
    try:
        yield result
    finally:
        await requester.close()
        await database.close()


async def test_creates_and_confirms_campaign_and_history(case: CreationCase) -> None:
    result = await case.service.create_campaign(proposed())
    assert result.status == "created"
    assert result.campaign_id == 7
    assert result.campaign is not None
    assert len(result.campaign.streams) == 2
    alias: str = case.create.call_args.args[1]
    assert alias.startswith("adrobot-")
    assert len(alias) == 40
    assert [call.args for call in case.create_stream.await_args_list] == [
        (7, payload) for payload in stream_payloads(7, proposed())
    ]
    async with case.database.transaction() as session:
        observed = await MembershipRepository(session).list(
            MembershipScope("instance", 7, 2)
        )
    assert [(item.offer_id, item.attached) for item in observed] == [(9, True)]
    assert result.campaign.streams[1].pinned_offer_ids == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", ""),
        ("name", "  "),
        ("country_code", "AUS"),
        ("country_code", "au"),
        ("country_code", "12"),
        ("offer_id", 0),
        ("domain_id", -1),
        ("group_id", True),
        ("traffic_source_id", "4"),
        ("extra", "unexpected"),
    ],
)
def test_invalid_creation_request(field: str, value: object) -> None:
    payload: dict[str, object] = proposed().model_dump()
    payload[field] = value
    with pytest.raises(ValidationError):
        CampaignCreateRequest.model_validate(payload)


def test_trims_campaign_name() -> None:
    payload = proposed().model_dump()
    payload["name"] = "  Example  "
    assert CampaignCreateRequest.model_validate(payload).name == "Example"


@pytest.mark.parametrize("resource", ["offer", "domain", "source", "groups"])
async def test_unavailable_resources_prevent_writes(
    case: CreationCase, resource: str
) -> None:
    if resource == "groups":
        case.groups.return_value = []
    else:
        getattr(case, resource).return_value = CreationResource(id=9, state="deleted")
    with pytest.raises(InvalidCampaignCreation):
        await case.service.create_campaign(proposed())
    case.create.assert_not_awaited()
    case.create_stream.assert_not_awaited()


@pytest.mark.parametrize("resource", ["offer", "domain", "source"])
async def test_missing_resource_prevents_writes(
    case: CreationCase, resource: str
) -> None:
    getattr(case, resource).side_effect = HttpStatusError(
        HttpResponse(404, "Missing", "private")
    )
    with pytest.raises(InvalidCampaignCreation):
        await case.service.create_campaign(proposed())
    case.create.assert_not_awaited()


@pytest.mark.parametrize("resource", ["offer", "domain", "source", "groups"])
async def test_validation_failure_prevents_writes(
    case: CreationCase, resource: str
) -> None:
    getattr(case, resource).side_effect = NetworkError("private")
    with pytest.raises(NetworkError):
        await case.service.create_campaign(proposed())
    case.create.assert_not_awaited()


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (NetworkError("private"), "unknown"),
        (KeitaroApiError("private"), "unknown"),
        (HttpStatusError(HttpResponse(500, "Error", "private")), "unknown"),
        (HttpStatusError(HttpResponse(408, "Timeout", "private")), "unknown"),
        (HttpStatusError(HttpResponse(422, "Invalid", "private")), "failed"),
    ],
)
async def test_campaign_write_failure_does_not_retry(
    case: CreationCase, failure: Exception, status: str
) -> None:
    case.create.side_effect = failure
    result = await case.service.create_campaign(proposed())
    assert result.status == status
    assert result.campaign_id is None
    assert result.campaign is None
    assert "private" not in result.model_dump_json()
    case.create.assert_awaited_once()
    case.create_stream.assert_not_awaited()
    case.configuration.assert_not_awaited()


@pytest.mark.parametrize("failed_stream", [0, 1])
async def test_stops_and_reports_partial_creation(
    case: CreationCase, failed_stream: int
) -> None:
    successful_write = case.create_stream.side_effect
    count = 0

    def write(campaign_id: int, payload: dict[str, object]) -> None:
        nonlocal count
        if count == failed_stream:
            raise NetworkError("private")
        count += 1
        assert callable(successful_write)
        successful_write(campaign_id, payload)

    case.create_stream.side_effect = write
    result = await case.service.create_campaign(proposed())
    assert result.status == "partial"
    assert result.campaign_id == 7
    assert result.campaign is not None
    assert len(result.campaign.streams) == failed_stream
    assert case.create_stream.await_count == failed_stream + 1
    assert "private" not in result.model_dump_json()


async def test_timeout_after_final_stream_is_reconciled(case: CreationCase) -> None:
    successful_write = case.create_stream.side_effect

    def write(campaign_id: int, payload: dict[str, object]) -> None:
        assert callable(successful_write)
        successful_write(campaign_id, payload)
        if payload["position"] == 2:
            raise NetworkError("private")

    case.create_stream.side_effect = write
    result = await case.service.create_campaign(proposed())
    assert result.status == "created"
    assert case.create_stream.await_count == 2
    case.create.assert_awaited_once()


@pytest.mark.parametrize(
    "failure", [NetworkError("private"), SQLAlchemyError("private")]
)
async def test_confirmation_failure_preserves_campaign_identity(
    case: CreationCase, failure: Exception
) -> None:
    case.streams.side_effect = failure
    result = await case.service.create_campaign(proposed())
    assert result.status == "unknown"
    assert result.campaign_id == 7
    assert result.campaign is None
    assert "private" not in result.model_dump_json()
    assert case.create_stream.await_count == 2


@pytest.mark.parametrize(
    "field", ["name", "domain_id", "group_id", "traffic_source_id", "type"]
)
async def test_mismatched_configuration_is_not_success(
    case: CreationCase, field: str
) -> None:
    configuration = case.configuration.return_value
    setattr(configuration, field, "wrong" if field in {"name", "type"} else 99)
    result = await case.service.create_campaign(proposed())
    assert result.status == "partial"


@pytest.mark.parametrize(
    "field", ["filters", "offers", "position", "landings", "schema"]
)
async def test_mismatched_streams_are_not_success(
    case: CreationCase, field: str
) -> None:
    successful_write = case.create_stream.side_effect

    def write(campaign_id: int, payload: dict[str, object]) -> None:
        changed = dict(payload)
        replacements: dict[str, object] = {
            "filters": [],
            "offers": [],
            "position": 9,
            "landings": [{"landing_id": 99}],
            "schema": "action",
        }
        if payload["position"] == (2 if field == "offers" else 1):
            changed[field] = replacements[field]
        assert callable(successful_write)
        successful_write(campaign_id, changed)

    case.create_stream.side_effect = write
    result = await case.service.create_campaign(proposed())
    assert result.status == "partial"
