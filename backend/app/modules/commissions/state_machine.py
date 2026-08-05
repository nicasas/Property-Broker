"""Maquina de estados de una comision.

    PENDING ──approve──> EXECUTED   (terminal)
       └─────reject───-> REJECTED   (terminal)

APPROVED no existe como estado persistido, y es una decision deliberada.

Aprobar y ejecutar el split ocurren en la MISMA transaccion atomica: una comision
nunca queda "aprobada, esperando que le muevan la plata". Ese estado intermedio
seria una ventana donde el sistema ya se comprometio con un pago que todavia no
ocurrio — exactamente el hueco por donde se pierde o se duplica plata cuando algo
se cae en el medio.

Los dos estados finales son terminales: una comision ejecutada no se revierte
cambiandole el estado. Se revierte, si hiciera falta, con una comision de signo
contrario — igual que el ledger, que es append-only por la misma razon.
"""

from __future__ import annotations

import enum

from app.core.errors import InvalidTransition


class CommissionStatus(str, enum.Enum):
    PENDING = "PENDING"
    EXECUTED = "EXECUTED"
    REJECTED = "REJECTED"


_ALLOWED_TRANSITIONS: dict[CommissionStatus, frozenset[CommissionStatus]] = {
    CommissionStatus.PENDING: frozenset(
        {CommissionStatus.EXECUTED, CommissionStatus.REJECTED}
    ),
    CommissionStatus.EXECUTED: frozenset(),
    CommissionStatus.REJECTED: frozenset(),
}


def is_terminal(status: CommissionStatus) -> bool:
    return not _ALLOWED_TRANSITIONS[status]


def ensure_can_transition(
    current: CommissionStatus, target: CommissionStatus
) -> None:
    if target not in _ALLOWED_TRANSITIONS[current]:
        raise InvalidTransition(
            f"Una comision en {current.value} no puede pasar a {target.value}",
            current_status=current.value,
            target_status=target.value,
        )
