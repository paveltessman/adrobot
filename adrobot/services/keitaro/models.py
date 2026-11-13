# pyright: strict
from pydantic import BaseModel
from pydantic import ConfigDict


class Campaign(BaseModel):
    model_config = ConfigDict(strict=True)

    id: int
    name: str
