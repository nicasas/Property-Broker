from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

Bps = Field(ge=0, le=10_000, description="Basis points enteros. 10.000 bps = 100%.")


class CreateListingRequest(BaseModel):
    """Los tres bps deben sumar exactamente 10.000. Lo valida el service y, como
    ultima linea, un CHECK en la tabla."""

    address: str = Field(min_length=1, max_length=200)
    listing_broker_account_id: uuid.UUID
    listing_broker_bps: int = Bps
    selling_broker_bps: int = Bps
    platform_bps: int = Bps


class ListingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    address: str
    listing_broker_account_id: uuid.UUID
    listing_broker_bps: int
    selling_broker_bps: int
    platform_bps: int
    created_at: datetime
