from typing import Literal

from pydantic import BaseModel

from .catalog import Game


class GamePage(BaseModel):
    items: list[Game]
    total: int
    page: int
    pageSize: int


class Capabilities(BaseModel):
    systems: list[str]
    engine: str
    engineVersion: str
    runtimeInstalled: bool
    saveMode: str
    statesExperimental: bool
    hardwareValidated: bool
    warnings: list[str]


class SaveMetadata(BaseModel):
    gameId: str
    slot: str
    kind: Literal["sram", "state"]
    coreId: str
    coreVersion: str
    coreBuild: str | None = None
    updatedAt: str
    sha256: str
    sizeBytes: int
    version: str
