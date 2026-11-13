# pyright: strict
from fastapi import APIRouter

from .keitaro.router import router as keitaro_router

router = APIRouter()
router.include_router(keitaro_router, prefix="/keitaro")
