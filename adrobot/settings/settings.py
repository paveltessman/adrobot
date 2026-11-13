# pyright: strict
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    ADROBOT_KEITARO_API_KEY: str

    def __init__(self) -> None:
        super().__init__()
