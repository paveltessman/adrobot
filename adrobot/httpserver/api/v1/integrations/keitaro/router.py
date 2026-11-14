# pyright: strict
from fastapi import APIRouter

from .campaigns import router as campaigns_router
from .offers import router as offers_router
from .selectors import router as selectors_router

router = APIRouter()
router.include_router(campaigns_router, prefix="/campaigns")
router.include_router(offers_router, prefix="/offers")
router.include_router(selectors_router)
