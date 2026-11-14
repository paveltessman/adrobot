# pyright: strict
from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Path
from fastapi import Query

from adrobot.httpserver.dependencies import get_keitaro_service
from adrobot.httpserver.schemas import SuccessResponse
from adrobot.services.keitaro.exceptions import OfferNotFoundError
from adrobot.services.keitaro.models import Offer
from adrobot.services.keitaro.service import KeitaroService

router = APIRouter(tags=["Keitaro"])


@router.get("")
async def search_offers(
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
    q: Annotated[str, Query()] = "",
) -> SuccessResponse[list[Offer]]:
    return SuccessResponse(data=await service.search_offers(q))


@router.get("/{offer_id}")
async def get_offer(
    offer_id: Annotated[int, Path(ge=1)],
    service: Annotated[KeitaroService, Depends(get_keitaro_service)],
) -> SuccessResponse[Offer]:
    try:
        return SuccessResponse(data=await service.get_offer(offer_id))
    except OfferNotFoundError as exc:
        raise HTTPException(404, "Offer not found") from exc
