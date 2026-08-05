from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.ledger.models import OperationType

# Todos los montos van en la unidad minima (centavos) y como entero.
# `gt=0` en las peticiones: la direccion del dinero la decide el endpoint,
# no el signo que mande el cliente.
Amount = Field(gt=0, description="Monto en centavos. Entero positivo.")


class DepositRequest(BaseModel):
    account_id: uuid.UUID
    amount: int = Amount
    reference: str | None = Field(default=None, max_length=120)


class TransferRequest(BaseModel):
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    amount: int = Amount
    reference: str | None = Field(default=None, max_length=120)


class LedgerEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movement_id: uuid.UUID
    account_id: uuid.UUID
    amount: int
    balance_after: int
    operation_type: OperationType
    reference: str | None
    created_at: datetime


class MovementResponse(BaseModel):
    movement_id: uuid.UUID
    operation_type: OperationType
    entries: list[LedgerEntryResponse]


class AccountReconciliationResponse(BaseModel):
    account_id: uuid.UUID
    materialized_balance: int
    ledger_balance: int
    matches: bool


class GlobalReconciliationResponse(BaseModel):
    ledger_total: int
    accounts_checked: int
    is_balanced: bool
    mismatches: list[AccountReconciliationResponse]
