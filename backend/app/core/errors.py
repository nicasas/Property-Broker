"""Errores de dominio y su traduccion a HTTP.

Los services levantan excepciones de dominio; NO conocen codigos HTTP. La
traduccion vive en un solo lugar, aqui, y se registra en `main.py`.
"""

from __future__ import annotations

from typing import Any

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)


class DomainError(Exception):
    status_code: int = 400
    code: str = "domain_error"

    def __init__(self, message: str, **details: Any) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class AccountNotFound(DomainError):
    status_code = 404
    code = "account_not_found"


class InsufficientFunds(DomainError):
    """El saldo no alcanza. La comision/transferencia NO se ejecuta y es reintentable."""

    status_code = 409
    code = "insufficient_funds"


class InvariantViolation(DomainError):
    """Una afirmacion que el sistema da por cierta resulto falsa.

    No es un error del cliente: es un bug. Se levanta igual —y revienta la
    transaccion— porque ante una invariante rota lo correcto es no mover plata,
    no seguir adelante con un resultado que ya sabemos que no cuadra.

    Va como excepcion y no como `assert` a proposito: `python -O` elimina los
    `assert`, y estas comprobaciones tienen que sobrevivir a cualquier forma de
    ejecutar el proceso en produccion.
    """

    status_code = 500
    code = "invariant_violation"


class RestrictedAccount(DomainError):
    """Se intento usar una cuenta de sistema donde solo cabe una cuenta operable."""

    status_code = 422
    code = "restricted_account"


class InvalidMovement(DomainError):
    """Movimiento mal formado: patas que no suman cero, monto cero, cuenta repetida."""

    status_code = 422
    code = "invalid_movement"


class ListingNotFound(DomainError):
    status_code = 404
    code = "listing_not_found"


class CommissionNotFound(DomainError):
    status_code = 404
    code = "commission_not_found"


class MovementNotFound(DomainError):
    status_code = 404
    code = "movement_not_found"


class InvalidSplitConfiguration(DomainError):
    """El acuerdo de reparto no cierra en 100%, o los bps son invalidos."""

    status_code = 422
    code = "invalid_split_configuration"


class InvalidTransition(DomainError):
    """Transicion no permitida por la maquina de estados de la comision."""

    status_code = 409
    code = "invalid_transition"


class IdempotencyConflict(DomainError):
    """Misma Idempotency-Key, distinto payload. Comportamiento Stripe."""

    status_code = 409
    code = "idempotency_conflict"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    def _handle_domain(_: Request, exc: DomainError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error("%s: %s | %s", exc.code, exc.message, exc.details)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.code,
                "message": exc.message,
                "details": exc.details,
            },
        )

    @app.exception_handler(IntegrityError)
    def _handle_integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        """Red de seguridad: una restriccion de la BD que la app no anticipo.

        Que llegue algo aqui significa que una validacion de aplicacion falto o
        quedo desactualizada respecto al esquema. La transaccion ya hizo rollback,
        asi que no se movio plata; lo que hace falta es que quede registrado con el
        nombre del constraint en vez de perderse en un 500 opaco.
        """
        constraint = getattr(getattr(exc, "orig", None), "diag", None)
        constraint_name = getattr(constraint, "constraint_name", None)
        logger.error("IntegrityError no anticipado: constraint=%s", constraint_name)
        return JSONResponse(
            status_code=409,
            content={
                "error": "constraint_violation",
                "message": "La operacion viola una restriccion de integridad",
                "details": {"constraint": constraint_name},
            },
        )
