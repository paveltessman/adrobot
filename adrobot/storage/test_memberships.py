# pyright: strict
from pathlib import Path

import pytest

from .database import Database
from .memberships import Membership
from .memberships import MembershipRepository
from .memberships import MembershipScope


async def test_history_survives_reopen_and_updates_existing_entry(
    tmp_path: Path,
) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'history.sqlite3'}"
    scope = MembershipScope("https://tracker.example/admin_api/v1/", 7, 2)
    database = Database(url)
    try:
        await database.initialize()
        async with database.transaction() as session:
            await MembershipRepository(session).save(
                scope, Membership(9, "Original", "active", True)
            )
    finally:
        await database.close()
    database = Database(url)
    try:
        await database.initialize()
        async with database.transaction() as session:
            repository = MembershipRepository(session)
            assert await repository.list(scope) == [
                Membership(9, "Original", "active", True)
            ]
            await repository.save(scope, Membership(9, "Renamed", "disabled", False))
        async with database.transaction() as session:
            assert await MembershipRepository(session).list(scope) == [
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
            repository = MembershipRepository(session)
            for index, scope in enumerate(scopes):
                await repository.save(scope, Membership(9, str(index), "active", True))
        with pytest.raises(RuntimeError, match="abort"):
            async with database.transaction() as session:
                repository = MembershipRepository(session)
                await repository.save(scopes[0], Membership(9, "Lost", "active", False))
                await repository.save(scopes[0], Membership(10, "Lost", "active", True))
                await session.flush()
                raise RuntimeError("abort")
        async with database.transaction() as session:
            repository = MembershipRepository(session)
            for index, scope in enumerate(scopes):
                assert await repository.list(scope) == [
                    Membership(9, str(index), "active", True)
                ]
            assert await repository.list(MembershipScope("unknown", 7, 2)) == []
    finally:
        await database.close()
