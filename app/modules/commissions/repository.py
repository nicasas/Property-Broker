"""Acceso a datos de `commissions`. NINGUN otro modulo consulta esta tabla."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.commissions.models import Commission
from app.modules.commissions.state_machine import CommissionStatus


def insert(session: Session, commission: Commission) -> Commission:
    session.add(commission)
    session.flush()
    return commission


def get(session: Session, commission_id: uuid.UUID) -> Commission | None:
    return session.get(Commission, commission_id)


def get_for_update(session: Session, commission_id: uuid.UUID) -> Commission | None:
    """SELECT ... FOR UPDATE sobre la fila de la comision.

    Es el lock que hace imposible que dos aprobaciones simultaneas ejecuten el
    mismo split dos veces. El chequeo de `status` solo es confiable si se hace
    BAJO este lock: leer el estado sin el es leer una foto que puede quedar vieja
    entre el SELECT y el UPDATE.

    `populate_existing=True` por la misma razon que en accounts: sin el, una
    instancia ya presente en la sesion se devolveria desde la identity map con el
    estado viejo, con el lock puesto y todo.
    """
    return session.scalars(
        select(Commission)
        .where(Commission.id == commission_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()


def list_all(
    session: Session, *, status: CommissionStatus | None = None
) -> list[Commission]:
    query = select(Commission).order_by(Commission.created_at.desc())
    if status is not None:
        query = query.where(Commission.status == status)
    return list(session.scalars(query))
