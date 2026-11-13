# pyright: strict
from fastapi import APIRouter

from .integrations.router import router as integrations_router

router = APIRouter()
router.include_router(integrations_router, prefix="/integrations")
