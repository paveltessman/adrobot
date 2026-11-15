# pyright: strict
from .api_client import KeitaroApiClient
from .campaigns.create import CampaignCreator
from .campaigns.push import CampaignPusher
from .campaigns.push_models import StreamChange
from .campaigns.reader import CampaignReader
from .campaigns.state import CampaignStateService
from .models import CampaignDetails
from .service import KeitaroService
from adrobot.storage.database import Database


def create_keitaro_service(
    api_client: KeitaroApiClient,
    database: Database,
    instance: str,
) -> KeitaroService:

    reader = CampaignReader(api_client)
    state = CampaignStateService(database.campaign_state_transaction, instance)

    # The facade holds the shared lock for the entire operation, including
    # these callbacks. They must not acquire it again during create or push.
    async def load(campaign_id: int) -> CampaignDetails:
        details = await reader.fetch(campaign_id)
        await state.record(details, {})
        return details

    async def reconcile(
        campaign_id: int,
        attempted: dict[int, StreamChange],
    ) -> CampaignDetails:
        details = await reader.fetch(campaign_id)
        await state.reconcile(details, attempted)
        return details

    return KeitaroService(
        api_client=api_client,
        load=load,
        creator=CampaignCreator(api_client, load),
        pusher=CampaignPusher(api_client, load, reconcile),
    )
