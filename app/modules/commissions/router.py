from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.events import Event, event_bus
from app.core.idempotency import execute_idempotent, require_idempotency_key
from app.modules.commissions import service
from app.modules.commissions.schemas import (
    ApproveCommissionRequest,
    CommissionResponse,
    RejectCommissionRequest,
    ReportCommissionRequest,
)
from app.modules.commissions.state_machine import CommissionStatus

router = APIRouter(prefix="/commissions", tags=["commissions"])


def _serialize(commission) -> dict:
    return CommissionResponse.model_validate(commission).model_dump(mode="json")


@router.post("", response_model=CommissionResponse, status_code=status.HTTP_201_CREATED)
def report_commission(
    body: ReportCommissionRequest,
    idempotency_key: str = Depends(require_idempotency_key),
) -> dict:
    """Reporta una comision cobrada. Queda PENDIENTE; no mueve plata todavia.

    Lleva Idempotency-Key aunque no mueva saldo: un reintento no debe crear dos
    comisiones pendientes por el mismo cobro, porque despues alguien las aprobaria
    las dos y ahi si se pagaria dos veces.
    """
    return execute_idempotent(
        key=idempotency_key,
        endpoint="POST /commissions",
        payload=body.model_dump(mode="json"),
        handler=lambda session: _serialize(
            service.report_commission(
                session,
                listing_id=body.listing_id,
                reported_by_account_id=body.reported_by_account_id,
                selling_broker_account_id=body.selling_broker_account_id,
                gross_amount=body.gross_amount,
                evidence=body.evidence,
            )
        ),
    )


@router.post("/{commission_id}/approve", response_model=CommissionResponse)
def approve_commission(
    commission_id: uuid.UUID,
    body: ApproveCommissionRequest,
    idempotency_key: str = Depends(require_idempotency_key),
) -> dict:
    """Aprueba y ejecuta el split, atomicamente.

    Saldo insuficiente -> 409 y la comision sigue PENDING (reintentable).
    """
    result = execute_idempotent(
        key=idempotency_key,
        endpoint=f"POST /commissions/{commission_id}/approve",
        payload=body.model_dump(mode="json"),
        handler=lambda session: _serialize(
            service.approve_commission(
                session, commission_id=commission_id, approved_by=body.approved_by
            )
        ),
        success_status=200,
    )

    # El evento se publica DESPUES del commit, nunca dentro de la transaccion.
    # Publicar antes seria anunciar un split que todavia puede hacer rollback:
    # un suscriptor (mañana, un mail o un webhook) estaria reaccionando a plata
    # que nunca se movio.
    event_bus.publish(
        Event(name="commission.executed", payload={"commission_id": str(commission_id)})
    )
    return result


@router.post("/{commission_id}/reject", response_model=CommissionResponse)
def reject_commission(
    commission_id: uuid.UUID,
    body: RejectCommissionRequest,
    db: Session = Depends(get_db),
) -> CommissionResponse:
    """Rechaza una comision pendiente. No mueve plata, no necesita Idempotency-Key:
    rechazar dos veces deja el mismo estado que rechazar una."""
    commission = service.reject_commission(
        db,
        commission_id=commission_id,
        rejected_by=body.rejected_by,
        reason=body.reason,
    )
    return CommissionResponse.model_validate(commission)


@router.get("", response_model=list[CommissionResponse])
def list_commissions(
    status_filter: CommissionStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> list[CommissionResponse]:
    return [
        CommissionResponse.model_validate(c)
        for c in service.list_commissions(db, status=status_filter)
    ]


@router.get("/{commission_id}", response_model=CommissionResponse)
def get_commission(
    commission_id: uuid.UUID, db: Session = Depends(get_db)
) -> CommissionResponse:
    return CommissionResponse.model_validate(service.get_commission(db, commission_id))
