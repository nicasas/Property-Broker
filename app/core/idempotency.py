"""Idempotencia de operaciones que mueven plata.

El problema real: el cliente manda un POST /transfers, la red se cae antes de que
llegue la respuesta, el cliente reintenta. Sin idempotencia acaba de transferir
dos veces. Un reintento NO puede mover plata dos veces.

Contrato (comportamiento Stripe):

  - Toda operacion que mueve plata exige el header `Idempotency-Key` (UUID del cliente).
  - Se persiste: key + endpoint + hash(payload) + status HTTP + response body.
  - Key repetida con el MISMO payload -> se devuelve la respuesta guardada, sin re-ejecutar.
  - Key repetida con OTRO payload     -> 409 Conflict.

Dos detalles de diseno que son los que realmente lo hacen seguro:

  1. INSERT-FIRST. La fila de la key se inserta AL PRINCIPIO de la transaccion,
     antes de tocar un solo saldo. Si dos requests con la misma key llegan a la
     vez, el segundo choca contra el UNIQUE en el INSERT: se queda esperando en
     el indice (todavia sin haber movido nada), y cuando el primero comitea
     revienta con IntegrityError. Ahi devolvemos la respuesta cacheada.
     Con insert-last, los dos habrian ejecutado el movimiento antes de descubrir
     el conflicto.

  2. MISMA TRANSACCION que el movimiento. Si el movimiento falla y hace rollback,
     la fila de la key se va con el: la key NO queda quemada y el cliente puede
     reintentar de verdad. Solo las operaciones que efectivamente ocurrieron
     dejan rastro de idempotencia.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from fastapi import Header
from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.database import Base, transaction
from app.core.errors import IdempotencyConflict, InsufficientFunds

# Nombres de constraints que necesitamos distinguir al interpretar un IntegrityError.
_IDEMPOTENCY_PK = "idempotency_keys_pkey"
_BALANCE_CHECK = "ck_accounts_balance_non_negative"


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    # La key es la PK: el UNIQUE que serializa los requests concurrentes es el
    # propio indice de clave primaria.
    key: Mapped[str] = mapped_column(String(64), primary_key=True)

    endpoint: Mapped[str] = mapped_column(String(120), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def require_idempotency_key(
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        description="UUID generado por el cliente. Obligatorio en toda operacion que mueve plata.",
    ),
) -> str:
    """Dependencia de FastAPI: exige y valida el header."""
    try:
        uuid.UUID(idempotency_key)
    except ValueError as exc:
        raise IdempotencyConflict(
            "Idempotency-Key debe ser un UUID valido", provided=idempotency_key
        ) from exc
    return idempotency_key


def hash_payload(payload: dict[str, Any]) -> str:
    """Hash estable del payload. `sort_keys` para que el orden de las claves no importe."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def execute_idempotent(
    *,
    key: str,
    endpoint: str,
    payload: dict[str, Any],
    handler: Callable[[Session], dict[str, Any]],
    success_status: int = 201,
) -> dict[str, Any]:
    """Ejecuta `handler` a lo sumo UNA vez para esta key.

    Este es el caller mas externo: es el UNICO que abre la transaccion. El handler
    recibe la sesion y compone services dentro de esa misma unidad atomica.
    """
    request_hash = hash_payload(payload)

    try:
        with transaction() as session:
            # PASO 1, antes de tocar plata: reclamar la key.
            session.add(
                IdempotencyKey(
                    key=key, endpoint=endpoint, request_hash=request_hash
                )
            )
            session.flush()  # <-- el UNIQUE pega AQUI, con los saldos todavia intactos

            # PASO 2: el movimiento, en la misma transaccion.
            result = handler(session)

            # PASO 3: guardar la respuesta para poder repetirla sin re-ejecutar.
            # (`status_code` se guarda para auditoria: el codigo que se devuelve en
            # un replay lo fija la ruta, no esta columna.)
            record = session.get(IdempotencyKey, key)
            if record is None:  # pragma: no cover - lo acabamos de insertar
                raise IdempotencyConflict(
                    "La fila de idempotencia desaparecio dentro de la transaccion",
                    idempotency_key=key,
                )
            record.status_code = success_status
            record.response_body = result
            session.flush()

            return result

    except IntegrityError as exc:
        constraint = _constraint_name(exc)

        if constraint == _BALANCE_CHECK:
            # La red de seguridad de la BD se activo: la logica de aplicacion dejo
            # pasar algo que habria dejado un saldo negativo. La transaccion ya
            # hizo rollback; no se movio nada.
            raise InsufficientFunds(
                "Saldo insuficiente (rechazado por la restriccion de la base de datos)"
            ) from exc

        if constraint != _IDEMPOTENCY_PK:
            raise

        # Key repetida: el primer request ya comiteo. Devolvemos SU resultado.
        # Nada de este request llego a mover saldo: el rollback se lo llevo.
        pass

    return _replay(key=key, endpoint=endpoint, request_hash=request_hash)


def _replay(*, key: str, endpoint: str, request_hash: str) -> dict[str, Any]:
    with transaction() as session:
        stored = session.get(IdempotencyKey, key)

        if stored is None:
            # El duenio original hizo rollback despues de que chocamos. Es carreta
            # rarisima y no vale la pena adivinar: que el cliente reintente.
            raise IdempotencyConflict(
                "La operacion con esta Idempotency-Key no se completo. Reintenta.",
                idempotency_key=key,
            )

        if stored.endpoint != endpoint or stored.request_hash != request_hash:
            raise IdempotencyConflict(
                "Esta Idempotency-Key ya se uso con un payload distinto",
                idempotency_key=key,
            )

        if stored.response_body is None:
            raise IdempotencyConflict(
                "Hay una operacion en curso con esta Idempotency-Key",
                idempotency_key=key,
            )

        return stored.response_body


def _constraint_name(exc: IntegrityError) -> str | None:
    """Nombre del constraint que provoco el error, segun psycopg.

    Sin esto tendriamos que adivinar por substring del mensaje: un IntegrityError
    puede venir de la key repetida o del CHECK de saldo, y significan cosas
    completamente distintas.
    """
    diag = getattr(getattr(exc, "orig", None), "diag", None)
    return getattr(diag, "constraint_name", None)


__all__ = [
    "IdempotencyKey",
    "execute_idempotent",
    "hash_payload",
    "require_idempotency_key",
]
