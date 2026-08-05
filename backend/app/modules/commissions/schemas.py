from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.commissions.state_machine import CommissionStatus


class ReportCommissionRequest(BaseModel):
    listing_id: uuid.UUID
    reported_by_account_id: uuid.UUID
    selling_broker_account_id: uuid.UUID
    gross_amount: int = Field(gt=0, description="Comision bruta en centavos.")
    evidence: str = Field(
        min_length=1, max_length=500, description="Contrato, comprobante o referencia."
    )


class ApproveCommissionRequest(BaseModel):
    approved_by: str = Field(min_length=1, max_length=120)


class RejectCommissionRequest(BaseModel):
    rejected_by: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=500)


class CommissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    listing_id: uuid.UUID
    reported_by_account_id: uuid.UUID
    listing_broker_account_id: uuid.UUID
    selling_broker_account_id: uuid.UUID

    gross_amount: int
    listing_broker_bps: int
    selling_broker_bps: int
    platform_bps: int

    status: CommissionStatus
    evidence: str

    listing_broker_share: int | None
    selling_broker_share: int | None
    platform_share: int | None
    movement_id: uuid.UUID | None

    approved_by: str | None
    approved_at: datetime | None
    rejected_by: str | None
    rejected_at: datetime | None
    rejection_reason: str | None

    created_at: datetime
