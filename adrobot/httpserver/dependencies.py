# pyright: strict
from fastapi import Request

from adrobot.services.keitaro.service import KeitaroService


def get_keitaro_service(request: Request) -> KeitaroService:
    service: KeitaroService = request.app.state.keitaro_service
    return service
