"""El motor de movimientos. Aqui se mueve la plata.

Una sola primitiva: `post_movement(session, legs, ...)`.

Un movimiento es un conjunto de PATAS (`Leg`) que suman cero. Todo lo demas del
sistema se expresa con esa primitiva:

    deposito          2 patas   externa -X          , broker +X
    transferencia     2 patas   origen  -X          , destino +X
    split de comision 3 patas   reportante -X       , plataforma +a, broker B +b   (Fase 3)

Esto no es abstraccion por gusto: es lo que hace que el split de la Fase 3 herede
sin escribir una linea nueva el locking, la atomicidad y el invariante de partida
doble ya probados aqui.

REGLA DE COMPOSICION: `post_movement` recibe `session` y NUNCA abre transaccion ni
comitea. El caller mas externo es el dueno de la transaccion.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.errors import InvalidMovement
from app.modules.accounts import service as accounts_service
from app.modules.ledger import repository
from app.modules.ledger.models import LedgerEntry, OperationType


@dataclass(frozen=True)
class Leg:
    """Una pata del movimiento. `amount` firmado: negativo debita, positivo acredita."""

    account_id: uuid.UUID
    amount: int


@dataclass(frozen=True)
class Movement:
    movement_id: uuid.UUID
    operation_type: OperationType
    entries: list[LedgerEntry]


def post_movement(
    session: Session,
    *,
    legs: list[Leg],
    operation_type: OperationType,
    reference: str | None = None,
) -> Movement:
    """Asienta un movimiento completo: valida, bloquea, mueve saldos y escribe el ledger.

    Todo dentro de la transaccion del caller. Si algo falla, ROLLBACK de todo: no
    existe un estado intermedio donde el debito ocurrio y el credito no.
    """
    _validate(legs)

    movement_id = uuid.uuid4()
    entries: list[LedgerEntry] = []

    # ORDEN DE BLOQUEO DETERMINISTA: siempre por account_id ascendente.
    #
    # Sin esto el sistema tiene deadlocks reales: A->B toma el lock de A y pide el
    # de B mientras B->A toma el de B y pide el de A, y Postgres mata a una de las
    # dos. Ordenando, todas las transacciones piden los locks en la misma secuencia
    # y la que llega segunda simplemente espera. La prueba esta en
    # `test_concurrency.py::test_transferencias_cruzadas_no_producen_deadlock`.
    for leg in sorted(legs, key=lambda leg: leg.account_id):
        # apply_delta hace el SELECT ... FOR UPDATE y decide si el saldo resultante
        # es admisible. El motor es CIEGO al tipo de cuenta: no pregunta si es
        # broker, plataforma o externa; solo mueve saldo entre IDs.
        account = accounts_service.apply_delta(session, leg.account_id, leg.amount)

        entries.append(
            repository.insert(
                session,
                movement_id=movement_id,
                account_id=leg.account_id,
                amount=leg.amount,
                balance_after=account.balance,
                operation_type=operation_type,
                reference=reference,
            )
        )

    # Los asientos se escriben en la MISMA transaccion que movio los saldos.
    # El ledger y la columna materializada no pueden desincronizarse porque no
    # existe un punto en el tiempo, visible para nadie, donde uno este sin el otro.
    session.flush()

    return Movement(
        movement_id=movement_id, operation_type=operation_type, entries=entries
    )


def _validate(legs: list[Leg]) -> None:
    if len(legs) < 2:
        raise InvalidMovement(
            "Un movimiento de partida doble necesita al menos dos patas",
            legs=len(legs),
        )

    if any(leg.amount == 0 for leg in legs):
        raise InvalidMovement("Ninguna pata puede tener monto cero")

    account_ids = [leg.account_id for leg in legs]
    if len(set(account_ids)) != len(account_ids):
        # Con una cuenta repetida el `balance_after` de cada asiento seria ambiguo
        # y el orden de bloqueo dejaria de estar bien definido. El caller debe
        # consolidar sus patas antes de llamar.
        raise InvalidMovement("Una cuenta no puede aparecer dos veces en el mismo movimiento")

    total = sum(leg.amount for leg in legs)
    if total != 0:
        # Si esto se dispara, alguien intento crear o destruir plata.
        raise InvalidMovement(
            "Las patas del movimiento no suman cero", imbalance=total
        )


# --------------------------------------------------------------------------
# Operaciones del nucleo bancario, expresadas sobre la primitiva
# --------------------------------------------------------------------------


def deposit(
    session: Session,
    *,
    account_id: uuid.UUID,
    amount: int,
    external_account_id: uuid.UUID,
    reference: str | None = None,
) -> Movement:
    """Ingreso de plata desde afuera del sistema (comision bruta ya cobrada).

    No se crea plata de la nada: la contrapartida sale de la cuenta externa, que
    se hunde en negativo. Su saldo, cambiado de signo, es el total de dinero vivo
    dentro del sistema.
    """
    _require_positive(amount)

    # El ORIGEN es la cuenta externa por diseño; el DESTINO no puede serlo.
    #
    # Hoy `post_movement` ya rechazaria un deposito de la externa hacia si misma por
    # la regla de cuenta repetida, pero esa es una defensa incidental: protege sin
    # saber que esta protegiendo. Si esa regla cambiara, o si un caller pasara un
    # `external_account_id` distinto (es un parametro, no una constante), el sistema
    # se quedaria sin nada. Este guard es explicito y dice por que existe.
    accounts_service.require_settleable_account(session, account_id)

    return post_movement(
        session,
        legs=[
            Leg(account_id=external_account_id, amount=-amount),
            Leg(account_id=account_id, amount=amount),
        ],
        operation_type=OperationType.DEPOSIT,
        reference=reference,
    )


def transfer(
    session: Session,
    *,
    from_account_id: uuid.UUID,
    to_account_id: uuid.UUID,
    amount: int,
    reference: str | None = None,
) -> Movement:
    _require_positive(amount)
    if from_account_id == to_account_id:
        raise InvalidMovement("No se puede transferir a la misma cuenta")

    # La cuenta externa no es contraparte de una transferencia ordinaria: mover
    # plata "desde el mundo" es un deposito y tiene su propia operacion. Permitirlo
    # aqui seria acuñar dinero, porque esa cuenta no tiene CHECK (balance >= 0).
    accounts_service.require_settleable_account(session, from_account_id)
    accounts_service.require_settleable_account(session, to_account_id)

    return post_movement(
        session,
        legs=[
            Leg(account_id=from_account_id, amount=-amount),
            Leg(account_id=to_account_id, amount=amount),
        ],
        operation_type=OperationType.TRANSFER,
        reference=reference,
    )


def _require_positive(amount: int) -> None:
    if amount <= 0:
        raise InvalidMovement("El monto debe ser un entero positivo", amount=amount)


# --------------------------------------------------------------------------
# Historial y reconciliacion
# --------------------------------------------------------------------------


def list_entries(
    session: Session, account_id: uuid.UUID, *, limit: int = 100, offset: int = 0
) -> list[LedgerEntry]:
    # Valida que la cuenta exista antes de devolver una lista vacia enganosa.
    accounts_service.get_account(session, account_id)
    return repository.list_by_account(session, account_id, limit=limit, offset=offset)


@dataclass(frozen=True)
class AccountReconciliation:
    account_id: uuid.UUID
    materialized_balance: int
    ledger_balance: int

    @property
    def matches(self) -> bool:
        return self.materialized_balance == self.ledger_balance


def reconcile_account(session: Session, account_id: uuid.UUID) -> AccountReconciliation:
    """Reconstruye el saldo desde el ledger y lo compara con la columna materializada.

    Es la prueba de que el atajo de performance no mintio.
    """
    account = accounts_service.get_account(session, account_id)
    return AccountReconciliation(
        account_id=account_id,
        materialized_balance=account.balance,
        ledger_balance=repository.sum_for_account(session, account_id),
    )


@dataclass(frozen=True)
class GlobalReconciliation:
    ledger_total: int
    accounts_checked: int
    mismatches: list[AccountReconciliation]

    @property
    def is_balanced(self) -> bool:
        return self.ledger_total == 0 and not self.mismatches


def reconcile_all(session: Session) -> GlobalReconciliation:
    """Chequeo de salud del sistema completo.

    Verifica las dos cosas a la vez:
      1. SUM(ledger.amount) == 0  -> no se creo ni destruyo plata
      2. para cada cuenta, saldo materializado == suma de su ledger
    """
    ledger_sums = repository.sums_by_account(session)
    accounts = accounts_service.list_accounts(session)

    mismatches = [
        AccountReconciliation(
            account_id=account.id,
            materialized_balance=account.balance,
            ledger_balance=ledger_sums.get(account.id, 0),
        )
        for account in accounts
        if account.balance != ledger_sums.get(account.id, 0)
    ]

    return GlobalReconciliation(
        ledger_total=repository.sum_all(session),
        accounts_checked=len(accounts),
        mismatches=mismatches,
    )
