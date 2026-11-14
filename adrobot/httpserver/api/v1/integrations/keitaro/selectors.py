# pyright: strict
from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends

from adrobot.httpserver.dependencies import get_keitaro_service
from adrobot.httpserver.schemas import SuccessResponse
from adrobot.services.keitaro.models import CampaignGroup
from adrobot.services.keitaro.models import Domain
from adrobot.services.keitaro.models import TrafficSource
from adrobot.services.keitaro.service import KeitaroService

router = APIRouter(tags=["Keitaro"])


@router.get("/domains")
async def get_domains(
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
) -> SuccessResponse[list[Domain]]:
    return SuccessResponse(data=await service.get_domains())


@router.get("/campaign-groups")
async def get_campaign_groups(
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
) -> SuccessResponse[list[CampaignGroup]]:
    return SuccessResponse(data=await service.get_campaign_groups())


@router.get("/traffic-sources")
async def get_traffic_sources(
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
) -> SuccessResponse[list[TrafficSource]]:
    return SuccessResponse(data=await service.get_traffic_sources())
