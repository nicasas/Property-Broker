from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.accounts import service
from app.modules.accounts.schemas import (
    AccountResponse,
    BalanceResponse,
    CreateAccountRequest,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    body: CreateAccountRequest, db: Session = Depends(get_db)
) -> AccountResponse:
    """Crea una cuenta de broker. Siempre nace en cero: el saldo solo entra por el ledger."""
    account = service.create_account(db, name=body.name)
    return AccountResponse.model_validate(account)


@router.get("", response_model=list[AccountResponse])
def list_accounts(db: Session = Depends(get_db)) -> list[AccountResponse]:
    return [AccountResponse.model_validate(a) for a in service.list_accounts(db)]


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: uuid.UUID, db: Session = Depends(get_db)) -> AccountResponse:
    return AccountResponse.model_validate(service.get_account(db, account_id))


@router.get("/{account_id}/balance", response_model=BalanceResponse)
def get_balance(account_id: uuid.UUID, db: Session = Depends(get_db)) -> BalanceResponse:
    return BalanceResponse(
        account_id=account_id, balance=service.get_balance(db, account_id)
    )
