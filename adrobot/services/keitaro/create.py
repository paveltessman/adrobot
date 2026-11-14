# pyright: strict
import json
from collections.abc import Awaitable
from collections.abc import Callable
from uuid import uuid4

from sqlalchemy.exc import SQLAlchemyError

from .api_client import KeitaroApiClient
from .create_models import CampaignCreateRequest
from .create_models import CampaignCreateResult
from .exceptions import InvalidCampaignCreation
from .exceptions import KeitaroApiError
from .models import CampaignDetails
from .models import CampaignStream
from adrobot.log import Logger
from adrobot.services.network.http import HttpStatusError
from adrobot.services.network.http import NetworkError
from adrobot.services.network.http.types import JsonValue


def stream_payloads(
    campaign_id: int, proposed: CampaignCreateRequest
) -> list[dict[str, JsonValue]]:
    common: dict[str, JsonValue] = {
        "campaign_id": campaign_id,
        "type": "regular",
        "state": "active",
        "action_type": "http",
        "collect_clicks": True,
        "filter_or": False,
        "landings": [],
    }
    return [
        {
            **common,
            "name": "Country redirect",
            "position": 1,
            "schema": "redirect",
            "action_payload": "https://www.google.com",
            "filters": [
                {
                    "name": "country",
                    "mode": "accept",
                    "payload": list(proposed.country_codes),
                }
            ],
            "offers": [],
        },
        {
            **common,
            "name": "Offers",
            "position": 2,
            "schema": "landings",
            "action_payload": "",
            "filters": [],
            "offers": [
                {"offer_id": proposed.offer_id, "share": 100, "state": "active"}
            ],
        },
    ]


class CampaignCreator:
    def __init__(
        self,
        client: KeitaroApiClient,
        load: Callable[[int], Awaitable[CampaignDetails]],
    ) -> None:
        self._client = client
        self._load = load

    async def create(self, proposed: CampaignCreateRequest) -> CampaignCreateResult:
        await self._validate_resources(proposed)
        alias = f"adrobot-{uuid4().hex}"
        try:
            campaign_id = await self._client.create_campaign(proposed, alias)
        except (NetworkError, KeitaroApiError) as exc:
            return self._campaign_failure(exc)
        await self._write_streams(campaign_id, proposed)
        return await self._confirm(campaign_id, alias, proposed)

    async def _write_streams(
        self, campaign_id: int, proposed: CampaignCreateRequest
    ) -> None:
        try:
            for payload in stream_payloads(campaign_id, proposed):
                await self._client.create_stream(campaign_id, payload)
        except (NetworkError, KeitaroApiError) as exc:
            Logger().exception("Campaign stream creation failed", exc)

    async def _validate_resources(self, proposed: CampaignCreateRequest) -> None:
        try:
            offer = await self._client.get_offer(proposed.offer_id)
            if offer.state not in {"active", "disabled"}:
                raise InvalidCampaignCreation("Selected offer is unavailable")
            await self._validate_optional_resources(proposed)
        except HttpStatusError as exc:
            if exc.response.status_code == 404:
                raise InvalidCampaignCreation(
                    "Selected resource is unavailable"
                ) from exc
            raise

    async def _validate_optional_resources(
        self, proposed: CampaignCreateRequest
    ) -> None:
        if proposed.domain_id is not None:
            domain = await self._client.get_domain(proposed.domain_id)
            self._validate_resource_state(domain.state, {"active"}, "domain")
        if proposed.traffic_source_id is not None:
            source = await self._client.get_traffic_source(proposed.traffic_source_id)
            self._validate_resource_state(
                source.state, {"active", "disabled"}, "traffic source"
            )
        await self._validate_group(proposed.group_id)

    async def _validate_group(self, group_id: int | None) -> None:
        if group_id is None:
            return
        groups = await self._client.get_campaign_groups()
        if group_id not in {group.id for group in groups}:
            raise InvalidCampaignCreation("Selected campaign group is unavailable")

    @staticmethod
    def _validate_resource_state(state: str, allowed: set[str], label: str) -> None:
        if state not in allowed:
            raise InvalidCampaignCreation(f"Selected {label} is unavailable")

    @staticmethod
    def _campaign_failure(exc: NetworkError | KeitaroApiError) -> CampaignCreateResult:
        Logger().exception("Campaign creation failed", exc)
        rejected = isinstance(exc, HttpStatusError) and (
            exc.response.status_code
            in {400, 401, 402, 403, 404, 405, 406, 409, 422, 429}
        )
        return CampaignCreateResult(
            status="failed" if rejected else "unknown",
            campaign_id=None,
            message=(
                "Campaign creation was rejected. Review the selected resources."
                if rejected
                else (
                    "The campaign creation outcome is unknown. "
                    "Check Keitaro before creating again."
                )
            ),
        )

    async def _confirm(
        self, campaign_id: int, alias: str, proposed: CampaignCreateRequest
    ) -> CampaignCreateResult:
        try:
            campaign = await self._load(campaign_id)
        except (NetworkError, KeitaroApiError, SQLAlchemyError) as exc:
            Logger().exception("Campaign creation confirmation failed", exc)
            return CampaignCreateResult(
                status="unknown",
                campaign_id=campaign_id,
                message=(
                    "Could not confirm the created campaign. "
                    "Check it before creating again."
                ),
            )
        complete = self._matches(campaign, alias, proposed)
        return CampaignCreateResult(
            status="created" if complete else "partial",
            campaign_id=campaign_id,
            campaign=campaign,
            message=(
                None
                if complete
                else (
                    "The campaign exists but its configuration is incomplete. "
                    "Review it in Keitaro; creating again would create "
                    "another campaign."
                )
            ),
        )

    @staticmethod
    def _matches(
        campaign: CampaignDetails, alias: str, proposed: CampaignCreateRequest
    ) -> bool:
        configuration = {
            "name": proposed.name,
            "alias": alias,
            "type": "position",
            "state": "active",
            "domain_id": proposed.domain_id,
            "group_id": proposed.group_id,
            "traffic_source_id": proposed.traffic_source_id,
        }
        actual = campaign.model_dump()
        if any(
            not CampaignCreator._configuration_matches(actual.get(k), v)
            for k, v in configuration.items()
        ):
            return False
        streams = sorted(campaign.streams, key=lambda stream: stream.position)
        expected = stream_payloads(campaign.id, proposed)
        return len(streams) == 2 and all(
            CampaignCreator._stream_matches(stream, payload)
            for stream, payload in zip(streams, expected)
        )

    @staticmethod
    def _configuration_matches(actual: object, expected: object) -> bool:
        if expected is None:
            return actual is None or actual == 0
        return actual == expected

    @staticmethod
    def _stream_matches(stream: CampaignStream, expected: dict[str, JsonValue]) -> bool:
        actual = stream.model_dump(by_alias=True)
        actual["filters"] = [CampaignCreator._filter(item) for item in stream.filters]
        return stream.id > 0 and all(actual.get(k) == v for k, v in expected.items())

    @staticmethod
    def _filter(item: dict[str, JsonValue]) -> dict[str, JsonValue]:
        payload = item.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                pass
        if item.get("name") == "country":
            payload = CampaignCreator._countries(payload)
        return {"name": item.get("name"), "mode": item.get("mode"), "payload": payload}

    @staticmethod
    def _countries(payload: JsonValue) -> JsonValue:
        if isinstance(payload, list):
            countries = [value for value in payload if isinstance(value, str)]
            if len(countries) == len(payload):
                return list[JsonValue](sorted(set(countries)))
        return payload
