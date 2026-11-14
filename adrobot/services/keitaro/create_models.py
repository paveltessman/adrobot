# pyright: strict
from typing import Annotated
from typing import cast
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import field_validator
from pydantic import model_validator
from pydantic import StringConstraints

from .models import CampaignDetails


type CountryCode = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{2}$")
]


class CampaignCreateRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    country_codes: list[CountryCode] = Field(min_length=1)
    offer_id: int = Field(gt=0)
    domain_id: int | None = Field(default=None, gt=0)
    group_id: int | None = Field(default=None, gt=0)
    traffic_source_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_country(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        fields = cast(dict[str, object], value)
        if "country_code" not in fields:
            return fields
        if "country_codes" in fields:
            raise ValueError("Provide country_codes or country_code, not both")
        fields = dict(fields)
        fields["country_codes"] = [fields.pop("country_code")]
        return fields

    @field_validator("country_codes")
    @classmethod
    def unique_countries(cls, value: list[str]) -> list[str]:
        return sorted(set(value))


class CreatedIdentity(BaseModel):
    model_config = ConfigDict(strict=True)

    id: int = Field(gt=0)


class CreationResource(CreatedIdentity):
    state: str


class CampaignCreateResult(BaseModel):
    status: Literal["created", "partial", "failed", "unknown"]
    campaign_id: int | None
    campaign: CampaignDetails | None = None
    message: str | None = None
