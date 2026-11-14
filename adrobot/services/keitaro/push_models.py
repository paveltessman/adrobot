# pyright: strict
from typing import Literal
from typing import Self

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

from .models import CampaignDetails
from .models import Stream


class ProposedOffer(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    offer_id: int = Field(gt=0)
    share: int = Field(ge=0, le=100)
    state: Literal["active", "disabled"]


class StreamChange(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    stream_id: int = Field(gt=0)
    offers: list[ProposedOffer] = Field(min_length=1)
    pinned_offer_ids: list[int]

    @model_validator(mode="after")
    def validate_distribution(self) -> Self:
        identities = {offer.offer_id for offer in self.offers}
        if len(identities) != len(self.offers):
            raise ValueError("Offer identities must be unique")
        if sum(offer.share for offer in self.offers) != 100:
            raise ValueError("Offer percentages must total 100")
        self._validate_pins(identities)
        return self

    def _validate_pins(self, identities: set[int]) -> None:
        pins = set(self.pinned_offer_ids)
        if len(pins) != len(self.pinned_offer_ids):
            raise ValueError("Pin identities must be unique")
        if not pins.issubset(identities):
            raise ValueError("Only proposed attached offers can be pinned")

    def matches(self, stream: Stream) -> bool:
        expected = {offer.offer_id: (offer.share, offer.state) for offer in self.offers}
        actual = {offer.offer_id: (offer.share, offer.state) for offer in stream.offers}
        return expected == actual


class CampaignPushRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    streams: list[StreamChange] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_streams(self) -> Self:
        if len({stream.stream_id for stream in self.streams}) != len(self.streams):
            raise ValueError("Stream identities must be unique")
        return self


class CampaignPushResult(BaseModel):
    status: Literal["applied", "partial", "failed", "unknown"]
    campaign: CampaignDetails | None
    pending_streams: list[StreamChange]
    message: str | None = None
