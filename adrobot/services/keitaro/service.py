# pyright: strict
from .api_client import KeitaroApiClient
from .models import Campaign


class KeitaroService:
    def __init__(self, api_client: KeitaroApiClient) -> None:
        self._api_client = api_client

    async def get_campaigns(self, *, limit: int, offset: int) -> list[Campaign]:
        return await self._api_client.get_campaigns(limit=limit, offset=offset)
