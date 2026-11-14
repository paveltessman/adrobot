# pyright: strict
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import JsonValue


class _Base(BaseModel):
    model_config = ConfigDict(strict=True)


class Campaign(_Base):
    id: int
    name: str


class CampaignConfiguration(Campaign):
    alias: str | None = None
    state: str | None = None
    domain_id: int | None = None
    group_id: int | None = None
    traffic_source_id: int | None = None
    notes: str | None = None
    updated_at: str | None = None


class Offer(_Base):
    id: int
    name: str
    state: str


class StreamOffer(_Base):
    offer_id: int
    share: int
    state: str


class Stream(_Base):
    id: int
    campaign_id: int
    name: str
    type: str
    state: str
    position: int
    action_type: str
    action_payload: str | dict[str, JsonValue]
    routing_schema: str = Field(alias="schema")
    filters: list[dict[str, JsonValue]]
    offers: list[StreamOffer]
    updated_at: str | None = None


class RemovedOffer(_Base):
    id: int
    name: str
    last_known_state: str


class CampaignStream(Stream):
    offer_details: list[Offer]
    removed_offers: list[RemovedOffer]


class CampaignDetails(CampaignConfiguration):
    streams: list[CampaignStream]
