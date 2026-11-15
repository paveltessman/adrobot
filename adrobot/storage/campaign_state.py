# pyright: strict
from dataclasses import dataclass

from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column

from .base import Base


@dataclass(frozen=True)
class MembershipScope:
    instance: str
    campaign_id: int
    stream_id: int


@dataclass(frozen=True)
class Membership:
    offer_id: int
    name: str
    state: str
    attached: bool


class ObservedMembership(Base):
    __tablename__ = "observed_memberships"

    instance: Mapped[str] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(primary_key=True)
    stream_id: Mapped[int] = mapped_column(primary_key=True)
    offer_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    state: Mapped[str]
    attached: Mapped[bool]


class CommittedPin(Base):
    __tablename__ = "committed_pins"

    instance: Mapped[str] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(primary_key=True)
    stream_id: Mapped[int] = mapped_column(primary_key=True)
    offer_id: Mapped[int] = mapped_column(primary_key=True)


class CampaignStateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_memberships(self, scope: MembershipScope) -> list[Membership]:
        rows = await self._session.scalars(
            select(ObservedMembership)
            .where(
                ObservedMembership.instance == scope.instance,
                ObservedMembership.campaign_id == scope.campaign_id,
                ObservedMembership.stream_id == scope.stream_id,
            )
            .order_by(ObservedMembership.offer_id)
        )

        result = [
            Membership(
                row.offer_id,
                row.name,
                row.state,
                row.attached,
            )
            for row in rows
        ]
        return result

    async def save_membership(
        self, scope: MembershipScope, membership: Membership
    ) -> None:
        observed_membership = ObservedMembership(
            instance=scope.instance,
            campaign_id=scope.campaign_id,
            stream_id=scope.stream_id,
            offer_id=membership.offer_id,
            name=membership.name,
            state=membership.state,
            attached=membership.attached,
        )
        await self._session.merge(observed_membership)

    async def list_pins(self, scope: MembershipScope) -> list[int]:
        rows = await self._session.scalars(
            select(CommittedPin.offer_id)
            .where(
                CommittedPin.instance == scope.instance,
                CommittedPin.campaign_id == scope.campaign_id,
                CommittedPin.stream_id == scope.stream_id,
            )
            .order_by(CommittedPin.offer_id)
        )
        return list(rows)

    async def replace_pins(self, scope: MembershipScope, offer_ids: set[int]) -> None:

        await self._session.execute(
            delete(CommittedPin).where(
                CommittedPin.instance == scope.instance,
                CommittedPin.campaign_id == scope.campaign_id,
                CommittedPin.stream_id == scope.stream_id,
            )
        )
        self._session.add_all(
            CommittedPin(
                instance=scope.instance,
                campaign_id=scope.campaign_id,
                stream_id=scope.stream_id,
                offer_id=offer_id,
            )
            for offer_id in sorted(offer_ids)
        )
