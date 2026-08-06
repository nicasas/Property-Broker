from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.idempotency import execute_idempotent, require_idempotency_key
from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID
from app.modules.ledger import service
from app.modules.ledger.schemas import (
    AccountReconciliationResponse,
    DepositRequest,
    GlobalReconciliationResponse,
    LedgerEntryResponse,
    MovementResponse,
    TransferRequest,
)

router = APIRouter(tags=["ledger"])


def _serialize(movement: service.Movement) -> dict:
    """A dict JSON-serializable: lo devolvemos al cliente Y lo guardamos en la fila
    de idempotencia, asi que un replay entrega byte por byte lo mismo."""
    return MovementResponse(
        movement_id=movement.movement_id,
        operation_type=movement.operation_type,
        entries=[LedgerEntryResponse.model_validate(e) for e in movement.entries],
    ).model_dump(mode="json")


# --------------------------------------------------------------------------
# Operaciones que mueven plata: exigen Idempotency-Key y son las duenas de su
# propia transaccion (via execute_idempotent). Por eso NO usan `get_db`.
# --------------------------------------------------------------------------


@router.post(
    "/deposits", response_model=MovementResponse, status_code=status.HTTP_201_CREATED
)
def create_deposit(
    body: DepositRequest,
    idempotency_key: str = Depends(require_idempotency_key),
) -> dict:
    """Carga saldo desde fuera del sistema (la comision bruta ya cobrada por el broker).

    Doble partida: la contrapartida sale de la cuenta externa, que va a negativo.
    """
    return execute_idempotent(
        key=idempotency_key,
        endpoint="POST /deposits",
        payload=body.model_dump(mode="json"),
        handler=lambda session: _serialize(
            service.deposit(
                session,
                account_id=body.account_id,
                amount=body.amount,
                external_account_id=EXTERNAL_ACCOUNT_ID,
                reference=body.reference,
            )
        ),
    )


@router.post(
    "/transfers", response_model=MovementResponse, status_code=status.HTTP_201_CREATED
)
def create_transfer(
    body: TransferRequest,
    idempotency_key: str = Depends(require_idempotency_key),
) -> dict:
    return execute_idempotent(
        key=idempotency_key,
        endpoint="POST /transfers",
        payload=body.model_dump(mode="json"),
        handler=lambda session: _serialize(
            service.transfer(
                session,
                from_account_id=body.from_account_id,
                to_account_id=body.to_account_id,
                amount=body.amount,
                reference=body.reference,
            )
        ),
    )


# --------------------------------------------------------------------------
# Consultas
# --------------------------------------------------------------------------


@router.get("/accounts/{account_id}/ledger", response_model=list[LedgerEntryResponse])
def list_ledger(
    account_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[LedgerEntryResponse]:
    """Historial de movimientos de una cuenta."""
    entries = service.list_entries(db, account_id, limit=limit, offset=offset)
    return [LedgerEntryResponse.model_validate(e) for e in entries]


@router.get(
    "/accounts/{account_id}/reconciliation",
    response_model=AccountReconciliationResponse,
)
def reconcile_account(
    account_id: uuid.UUID, db: Session = Depends(get_db)
) -> AccountReconciliationResponse:
    """Reconstruye el saldo desde el ledger y lo compara con la columna materializada."""
    result = service.reconcile_account(db, account_id)
    return AccountReconciliationResponse(
        account_id=result.account_id,
        materialized_balance=result.materialized_balance,
        ledger_balance=result.ledger_balance,
        matches=result.matches,
    )


@router.get(
    "/ledger/movements/{movement_id}", response_model=list[LedgerEntryResponse]
)
def get_movement(
    movement_id: uuid.UUID, db: Session = Depends(get_db)
) -> list[LedgerEntryResponse]:
    """Las patas de un movimiento, para poder ver la contraparte.

    El historial de una cuenta solo trae sus propias filas. Con esto se puede
    responder de donde salio un pago o entre quienes se repartio una comision,
    leyendo el mismo `movement_id` que ya agrupa los asientos.
    """
    entries = service.get_movement_entries(db, movement_id)
    return [LedgerEntryResponse.model_validate(e) for e in entries]


@router.get("/ledger/reconciliation", response_model=GlobalReconciliationResponse)
def reconcile_all(db: Session = Depends(get_db)) -> GlobalReconciliationResponse:
    """Salud del sistema completo: SUM(ledger) == 0 y cada saldo cuadra con su ledger."""
    result = service.reconcile_all(db)
    return GlobalReconciliationResponse(
        ledger_total=result.ledger_total,
        accounts_checked=result.accounts_checked,
        is_balanced=result.is_balanced,
        mismatches=[
            AccountReconciliationResponse(
                account_id=m.account_id,
                materialized_balance=m.materialized_balance,
                ledger_balance=m.ledger_balance,
                matches=m.matches,
            )
            for m in result.mismatches
        ],
    )
