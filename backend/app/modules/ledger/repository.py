"""Acceso a datos de `ledger_entries`. NINGUN otro modulo consulta esta tabla."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.ledger.models import LedgerEntry, OperationType


def insert(
    session: Session,
    *,
    movement_id: uuid.UUID,
    account_id: uuid.UUID,
    amount: int,
    balance_after: int,
    operation_type: OperationType,
    reference: str | None,
) -> LedgerEntry:
    entry = LedgerEntry(
        id=uuid.uuid4(),
        movement_id=movement_id,
        account_id=account_id,
        amount=amount,
        balance_after=balance_after,
        operation_type=operation_type,
        reference=reference,
    )
    session.add(entry)
    return entry


def list_by_account(
    session: Session, account_id: uuid.UUID, *, limit: int = 100, offset: int = 0
) -> list[LedgerEntry]:
    return list(
        session.scalars(
            select(LedgerEntry)
            .where(LedgerEntry.account_id == account_id)
            .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )


def list_by_movement(session: Session, movement_id: uuid.UUID) -> list[LedgerEntry]:
    return list(
        session.scalars(
            select(LedgerEntry).where(LedgerEntry.movement_id == movement_id)
        )
    )


def sum_for_account(session: Session, account_id: uuid.UUID) -> int:
    """Reconstruye el saldo de una cuenta desde la fuente de verdad."""
    total = session.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.account_id == account_id
        )
    )
    return int(total or 0)


def sum_all(session: Session) -> int:
    """Invariante global de partida doble. Debe dar 0."""
    total = session.scalar(select(func.coalesce(func.sum(LedgerEntry.amount), 0)))
    return int(total or 0)


def sums_by_account(session: Session) -> dict[uuid.UUID, int]:
    rows = session.execute(
        select(LedgerEntry.account_id, func.sum(LedgerEntry.amount)).group_by(
            LedgerEntry.account_id
        )
    ).all()
    return {row[0]: int(row[1]) for row in rows}
