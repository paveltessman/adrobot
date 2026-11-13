# pyright: strict
from fastapi import APIRouter

from .campaigns import router as campaigns_router

router = APIRouter()
router.include_router(campaigns_router, prefix="/campaigns")
