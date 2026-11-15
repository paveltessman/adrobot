# pyright: strict
from pathlib import Path

import pytest

from .campaign_state import CampaignStateRepository
from .campaign_state import Membership
from .campaign_state import MembershipScope
from .database import Database


async def test_history_survives_reopen_and_updates_existing_entry(
    tmp_path: Path,
) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'history.sqlite3'}"
    scope = MembershipScope("https://tracker.example/admin_api/v1/", 7, 2)
    database = Database(url)
    try:
        await database.initialize()
        async with database.transaction() as session:
            await CampaignStateRepository(session).save_membership(
                scope, Membership(9, "Original", "active", True)
            )
    finally:
        await database.close()
    database = Database(url)
    try:
        await database.initialize()
        async with database.transaction() as session:
            repository = CampaignStateRepository(session)
            assert await repository.list_memberships(scope) == [
                Membership(9, "Original", "active", True)
            ]
            await repository.save_membership(
                scope, Membership(9, "Renamed", "disabled", False)
            )
        async with database.transaction() as session:
            assert await CampaignStateRepository(session).list_memberships(scope) == [
                Membership(9, "Renamed", "disabled", False)
            ]
    finally:
        await database.close()


async def test_scopes_are_isolated_and_failed_transactions_roll_back() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    scopes = [
        MembershipScope("first", 7, 2),
        MembershipScope("second", 7, 2),
        MembershipScope("first", 8, 2),
        MembershipScope("first", 7, 3),
    ]
    try:
        await database.initialize()
        async with database.transaction() as session:
            repository = CampaignStateRepository(session)
            for index, scope in enumerate(scopes):
                await repository.save_membership(
                    scope, Membership(9, str(index), "active", True)
                )
        with pytest.raises(RuntimeError, match="abort"):
            async with database.transaction() as session:
                repository = CampaignStateRepository(session)
                await repository.save_membership(
                    scopes[0], Membership(9, "Lost", "active", False)
                )
                await repository.save_membership(
                    scopes[0], Membership(10, "Lost", "active", True)
                )
                await session.flush()
                raise RuntimeError("abort")
        async with database.transaction() as session:
            repository = CampaignStateRepository(session)
            for index, scope in enumerate(scopes):
                assert await repository.list_memberships(scope) == [
                    Membership(9, str(index), "active", True)
                ]
            assert (
                await repository.list_memberships(MembershipScope("unknown", 7, 2))
                == []
            )
    finally:
        await database.close()


async def test_pins_survive_reopen_and_remain_scoped(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'pins.sqlite3'}"
    scopes = [
        MembershipScope("first", 7, 2),
        MembershipScope("second", 7, 2),
        MembershipScope("first", 8, 2),
        MembershipScope("first", 7, 3),
    ]
    database = Database(url)
    try:
        await database.initialize()
        async with database.transaction() as session:
            repository = CampaignStateRepository(session)
            for index, scope in enumerate(scopes):
                await repository.replace_pins(scope, {9, 10 + index})
    finally:
        await database.close()
    database = Database(url)
    try:
        await database.initialize()
        with pytest.raises(RuntimeError, match="abort"):
            async with database.transaction() as session:
                await CampaignStateRepository(session).replace_pins(scopes[0], {99})
                await session.flush()
                raise RuntimeError("abort")
        async with database.transaction() as session:
            repository = CampaignStateRepository(session)
            for index, scope in enumerate(scopes):
                assert await repository.list_pins(scope) == [9, 10 + index]
            await repository.replace_pins(scopes[0], set())
        async with database.transaction() as session:
            assert await CampaignStateRepository(session).list_pins(scopes[0]) == []
            assert await CampaignStateRepository(session).list_pins(scopes[1]) == [
                9,
                11,
            ]
    finally:
        await database.close()


async def test_membership_and_pin_changes_roll_back_together() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    scope = MembershipScope("tracker", 7, 2)
    original = Membership(9, "Original", "active", True)
    try:
        await database.initialize()
        async with database.transaction() as session:
            repository = CampaignStateRepository(session)
            await repository.save_membership(scope, original)
            await repository.replace_pins(scope, {9})
        with pytest.raises(RuntimeError, match="abort"):
            async with database.transaction() as session:
                repository = CampaignStateRepository(session)
                await repository.save_membership(
                    scope, Membership(9, "Renamed", "disabled", False)
                )
                await repository.replace_pins(scope, {10})
                await session.flush()
                raise RuntimeError("abort")
        async with database.transaction() as session:
            repository = CampaignStateRepository(session)
            assert await repository.list_memberships(scope) == [original]
            assert await repository.list_pins(scope) == [9]
    finally:
        await database.close()
