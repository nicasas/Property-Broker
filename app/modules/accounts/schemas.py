from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.accounts.models import AccountType


class CreateAccountRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    account_type: AccountType
    # Saldo en la unidad minima (centavos). Entero siempre; nunca float.
    balance: int
    created_at: datetime


class BalanceResponse(BaseModel):
    account_id: uuid.UUID
    balance: int
