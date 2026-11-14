# pyright: strict
from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Path
from fastapi import Query
from pydantic import BaseModel

from adrobot.httpserver.dependencies import get_keitaro_service
from adrobot.httpserver.schemas import SuccessResponse
from adrobot.services.keitaro.exceptions import CampaignNotFoundError
from adrobot.services.keitaro.exceptions import InvalidCampaignPush
from adrobot.services.keitaro.models import Campaign
from adrobot.services.keitaro.models import CampaignDetails
from adrobot.services.keitaro.push_models import CampaignPushRequest
from adrobot.services.keitaro.push_models import CampaignPushResult
from adrobot.services.keitaro.service import KeitaroService

router = APIRouter(tags=["Keitaro"])


@router.post("/{campaign_id}/push")
async def push_campaign(
    campaign_id: Annotated[int, Path(ge=1)],
    proposed: CampaignPushRequest,
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
) -> SuccessResponse[CampaignPushResult]:
    try:
        return SuccessResponse(data=await service.push_campaign(campaign_id, proposed))
    except CampaignNotFoundError as exc:
        raise HTTPException(404, "Campaign not found") from exc
    except InvalidCampaignPush as exc:
        raise HTTPException(422, str(exc)) from exc


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


@router.get("/{campaign_id}")
async def get_campaign_details(
    campaign_id: Annotated[int, Path(ge=1)],
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
) -> SuccessResponse[CampaignDetails]:
    try:
        return SuccessResponse(data=await service.get_campaign_details(campaign_id))
    except CampaignNotFoundError as exc:
        raise HTTPException(404, "Campaign not found") from exc
