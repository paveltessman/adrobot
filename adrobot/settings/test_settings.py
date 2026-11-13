# pyright: strict
from pathlib import Path

import pytest
from pydantic import ValidationError

from .settings import Settings


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ADROBOT_KEITARO_API_KEY", raising=False)


def test_loads_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADROBOT_KEITARO_API_KEY", "environment-key")

    assert Settings().ADROBOT_KEITARO_API_KEY == "environment-key"


def test_loads_dotenv_file(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text(
        "ADROBOT_KEITARO_API_KEY=dotenv-key\n", encoding="utf-8"
    )

    settings = Settings()

    assert settings.ADROBOT_KEITARO_API_KEY == "dotenv-key"


def test_requires_api_key() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings()

    assert any(
        error["loc"] == ("ADROBOT_KEITARO_API_KEY",) and error["type"] == "missing"
        for error in exc_info.value.errors()
    )
