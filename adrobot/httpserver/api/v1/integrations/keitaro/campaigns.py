# pyright: strict
from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import Query
from pydantic import BaseModel

from adrobot.httpserver.dependencies import get_keitaro_service
from adrobot.httpserver.schemas import SuccessResponse
from adrobot.services.keitaro.models import Campaign
from adrobot.services.keitaro.service import KeitaroService

router = APIRouter(tags=["Keitaro"])


class CampaignPage(BaseModel):
    items: list[Campaign]
    limit: int
    offset: int
    has_more: bool


@router.get("")
async def get_campaigns(
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SuccessResponse[CampaignPage]:

    campaigns = await service.get_campaigns(limit=limit + 1, offset=offset)

    r = SuccessResponse(
        data=CampaignPage(
            items=campaigns[:limit],
            limit=limit,
            offset=offset,
            has_more=len(campaigns) > limit,
        )
    )
    return r
