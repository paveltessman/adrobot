# pyright: strict
from typing import Annotated
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import StringConstraints

from .models import CampaignDetails


class CampaignCreateRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    country_code: Annotated[
        str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{2}$")
    ]
    offer_id: int = Field(gt=0)
    domain_id: int = Field(gt=0)
    group_id: int = Field(gt=0)
    traffic_source_id: int = Field(gt=0)


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
