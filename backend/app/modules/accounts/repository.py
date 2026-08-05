"""Acceso a datos de `accounts`. NINGUN otro modulo consulta esta tabla."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounts.models import Account, AccountType


def insert(
    session: Session, *, name: str, account_type: AccountType, account_id: uuid.UUID | None = None
) -> Account:
    account = Account(
        id=account_id or uuid.uuid4(),
        name=name,
        account_type=account_type,
        balance=0,
    )
    session.add(account)
    session.flush()
    return account


def get(session: Session, account_id: uuid.UUID) -> Account | None:
    return session.get(Account, account_id)


def get_for_update(session: Session, account_id: uuid.UUID) -> Account | None:
    """SELECT ... FOR UPDATE: toma el lock de fila y lo sostiene hasta el fin de la transaccion.

    Bloqueo PESIMISTA, elegido a proposito. En dinero la contencion real es baja
    pero el costo de equivocarse es maximo: preferimos que el segundo request
    espere su turno a que descubra tarde que perdio una carrera.

    `populate_existing=True` es obligatorio: sin el, si la instancia ya esta en la
    identity map de la sesion, SQLAlchemy devuelve el objeto cacheado y descarta
    los valores frescos que acaba de traer el SELECT — leeriamos un saldo viejo
    con el lock puesto, que es exactamente el bug que este lock viene a evitar.
    """
    return session.scalars(
        select(Account)
        .where(Account.id == account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()


def list_all(session: Session) -> list[Account]:
    return list(session.scalars(select(Account).order_by(Account.created_at)))
