# pyright: strict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column


class Base(DeclarativeBase):
    pass


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


class MembershipRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(self, scope: MembershipScope) -> list[Membership]:
        rows = await self._session.scalars(
            select(ObservedMembership)
            .where(
                ObservedMembership.instance == scope.instance,
                ObservedMembership.campaign_id == scope.campaign_id,
                ObservedMembership.stream_id == scope.stream_id,
            )
            .order_by(ObservedMembership.offer_id)
        )
        return [
            Membership(row.offer_id, row.name, row.state, row.attached) for row in rows
        ]

    async def save(self, scope: MembershipScope, membership: Membership) -> None:
        await self._session.merge(
            ObservedMembership(
                instance=scope.instance,
                campaign_id=scope.campaign_id,
                stream_id=scope.stream_id,
                offer_id=membership.offer_id,
                name=membership.name,
                state=membership.state,
                attached=membership.attached,
            )
        )
