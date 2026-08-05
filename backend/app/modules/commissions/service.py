"""Motor de liquidacion de comisiones.

    report  ->  PENDING
    approve ->  EXECUTED   (valida, reparte y mueve la plata, todo en UNA transaccion)
    reject  ->  REJECTED

Este modulo NO mueve plata por su cuenta. No hay aqui un solo UPDATE de saldo ni
un solo INSERT en el ledger: calcula CUANTO le toca a cada quien y se lo entrega
a `ledger.post_movement`, que ya trae probados el locking por orden determinista,
la atomicidad y la partida doble.

Un split es, literalmente, un movimiento de a lo sumo tres patas.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.errors import CommissionNotFound, InvalidMovement, InvariantViolation
from app.modules.accounts import service as accounts_service
from app.modules.accounts.constants import PLATFORM_ACCOUNT_ID
from app.modules.commissions import repository
from app.modules.commissions.models import Commission
from app.modules.commissions.state_machine import (
    CommissionStatus,
    ensure_can_transition,
)
from app.modules.ledger import service as ledger_service
from app.modules.ledger.models import OperationType
from app.modules.ledger.service import Leg
from app.modules.listings import service as listings_service
from app.modules.listings.models import TOTAL_BPS


@dataclass(frozen=True)
class Shares:
    """El reparto, al centavo. Los tres montos suman SIEMPRE el bruto."""

    listing_broker: int
    selling_broker: int
    platform: int

    @property
    def total(self) -> int:
        return self.listing_broker + self.selling_broker + self.platform


# --------------------------------------------------------------------------
# Aritmetica del reparto
# --------------------------------------------------------------------------


def compute_shares(
    *, gross_amount: int, listing_broker_bps: int, selling_broker_bps: int
) -> Shares:
    """Reparte `gross_amount` sin perder ni inventar un centavo.

    Todo es aritmetica entera. Ningun float toca la plata en ningun momento:
    0.1 + 0.2 != 0.3 en punto flotante, y ese error acumulado sobre miles de
    liquidaciones es plata real que no cuadra.

    LA PLATAFORMA ABSORBE EL RESIDUO POR CONSTRUCCION. Las dos partes de los
    brokers se calculan con division entera (redondeo hacia abajo), y la parte de
    la plataforma NO se calcula: es lo que sobra.

        platform = gross - listing - selling

    Por eso la suma cierra exacta siempre, sin repartir centavos sueltos a mano.
    Repartir 10.001 en tercios da 3.333 + 3.333 + 3.335: la plataforma se queda
    con los 2 centavos del residuo.

    `platform_bps` no entra en la cuenta: es documentacion del acuerdo. El CHECK
    de que los tres bps suman 10.000 es lo que garantiza que el residuo que
    absorbe la plataforma nunca sea negativo, porque

        listing + selling <= gross * (10000 - platform_bps) / 10000 <= gross
    """
    if gross_amount <= 0:
        raise InvalidMovement(
            "El monto bruto debe ser un entero positivo", gross_amount=gross_amount
        )

    listing_share = gross_amount * listing_broker_bps // TOTAL_BPS
    selling_share = gross_amount * selling_broker_bps // TOTAL_BPS
    platform_share = gross_amount - listing_share - selling_share

    shares = Shares(
        listing_broker=listing_share,
        selling_broker=selling_share,
        platform=platform_share,
    )

    # No es programacion defensiva decorativa: es LA invariante del reparto.
    # Si alguna vez falla, es preferible que la transaccion muera aqui a que el
    # sistema liquide una comision que no cuadra.
    #
    # Excepcion y no `assert`: `python -O` borra los assert, y esta comprobacion
    # tiene que existir sin importar como se arranque el proceso.
    if shares.total != gross_amount:
        raise InvariantViolation(
            "El reparto no cuadra con el monto bruto",
            total=shares.total,
            gross_amount=gross_amount,
        )
    if shares.platform < 0:
        raise InvariantViolation(
            "El residuo de la plataforma quedo negativo",
            platform_share=shares.platform,
        )

    return shares


def build_split_legs(
    *,
    gross_amount: int,
    reported_by_account_id: uuid.UUID,
    listing_broker_account_id: uuid.UUID,
    selling_broker_account_id: uuid.UUID,
    platform_account_id: uuid.UUID,
    shares: Shares,
) -> list[Leg]:
    """Arma las patas del movimiento POR NETO, no por rol.

    Este es el punto donde se caen la mitad de las implementaciones de un split.
    La tentacion es escribir una pata por rol —una para el listing broker, otra
    para el selling broker, otra para la plataforma— y despues llenar el codigo de
    `if` para los casos en que dos roles caen sobre la misma persona.

    Aqui no hay casos especiales. Se acumula el delta NETO de cada cuenta y se
    descartan las que quedan en cero:

      - el reportante entrega el bruto:          -gross
      - cada rol recibe lo suyo:                 +share

    Si el reportante ES el listing broker, su neto colapsa solo a
    -(platform + selling), que es exactamente el modelo "el que tiene la plata
    paga hacia afuera". Si el listing broker y el selling broker son el mismo, sus
    dos partes se suman en una sola pata. Si la plataforma cobra 0%, su pata
    desaparece. Ninguno de esos tres casos necesita una linea de codigo propia.

    Ademas es lo que hace que el resultado sea siempre valido para
    `post_movement`, que rechaza patas en cero y cuentas repetidas.
    """
    deltas: dict[uuid.UUID, int] = {}

    def add(account_id: uuid.UUID, amount: int) -> None:
        deltas[account_id] = deltas.get(account_id, 0) + amount

    add(reported_by_account_id, -gross_amount)
    add(listing_broker_account_id, shares.listing_broker)
    add(selling_broker_account_id, shares.selling_broker)
    add(platform_account_id, shares.platform)

    # Orden estable por id: el mismo split produce siempre las mismas patas en el
    # mismo orden, lo que hace los tests y el historial reproducibles.
    legs = [
        Leg(account_id=account_id, amount=amount)
        for account_id, amount in sorted(deltas.items())
        if amount != 0
    ]

    # No puede quedar exactamente una pata: los deltas suman cero, asi que si una
    # cuenta quedo con saldo distinto de cero, otra tuvo que compensarla. O hay
    # dos o mas, o no hay ninguna.
    if len(legs) == 1:
        raise InvariantViolation(
            "El split produjo una sola pata, lo que implica que los deltas no suman cero",
            legs=[(str(leg.account_id), leg.amount) for leg in legs],
        )

    return legs


# --------------------------------------------------------------------------
# Casos de uso
# --------------------------------------------------------------------------


def report_commission(
    session: Session,
    *,
    listing_id: uuid.UUID,
    reported_by_account_id: uuid.UUID,
    selling_broker_account_id: uuid.UUID,
    gross_amount: int,
    evidence: str,
) -> Commission:
    """Registra una comision cobrada. Queda PENDIENTE: todavia no mueve un peso."""
    if gross_amount <= 0:
        raise InvalidMovement(
            "El monto bruto debe ser un entero positivo", gross_amount=gross_amount
        )

    # Fronteras: se pregunta a los services de los otros modulos, nunca a sus tablas.
    listing = listings_service.get_listing(session, listing_id)

    # LOS TRES ROLES se validan aqui, incluido el que NO viene del request.
    #
    # `listing_broker_account_id` se copia del listing, y por un tiempo esa fue su
    # unica defensa: se validaba al CREAR el listing y nunca mas. Cualquier fila que
    # no hubiera pasado por ese service —anterior al guard, sembrada, insertada por
    # un script— llegaba hasta aca sin revisar y terminaba acreditando a la cuenta
    # externa en el split. La fuga estaba demostrada: 400.000 salieron del sistema
    # con `SUM(ledger) == 0` y la reconciliacion diciendo "todo bien".
    #
    # Se revalida en el momento de CONGELAR el snapshot, que es cuando este valor
    # deja de pertenecer al listing y pasa a ser el que va a mover plata.
    accounts_service.require_settleable_account(session, reported_by_account_id)
    accounts_service.require_settleable_account(session, selling_broker_account_id)
    accounts_service.require_settleable_account(
        session, listing.listing_broker_account_id
    )

    commission = Commission(
        id=uuid.uuid4(),
        listing_id=listing.id,
        reported_by_account_id=reported_by_account_id,
        selling_broker_account_id=selling_broker_account_id,
        # Snapshot del acuerdo vigente AL REPORTAR (ver el docstring del modelo).
        listing_broker_account_id=listing.listing_broker_account_id,
        listing_broker_bps=listing.listing_broker_bps,
        selling_broker_bps=listing.selling_broker_bps,
        platform_bps=listing.platform_bps,
        gross_amount=gross_amount,
        evidence=evidence,
        status=CommissionStatus.PENDING,
    )
    return repository.insert(session, commission)


def approve_commission(
    session: Session, *, commission_id: uuid.UUID, approved_by: str
) -> Commission:
    """Aprueba y ejecuta el split. Atomico: aprobar ES mover la plata.

    Si el saldo del reportante no alcanza, `InsufficientFunds` sube sin capturarse:
    la transaccion entera hace ROLLBACK, la comision se queda en PENDING y el
    cliente puede reintentar cuando haya saldo. No existe un estado FAILED porque
    un fallo aqui no cambia nada — literalmente no paso nada.
    """
    # EL LOCK. Toma la fila de la comision y la sostiene hasta el commit.
    commission = repository.get_for_update(session, commission_id)
    if commission is None:
        raise CommissionNotFound(
            "La comision no existe", commission_id=str(commission_id)
        )

    # IDEMPOTENCIA A NIVEL DE DOMINIO, complementaria al Idempotency-Key.
    #
    # El header protege contra el mismo request repetido. Esto protege contra DOS
    # requests distintos —dos operadores, dos keys diferentes— aprobando la misma
    # comision a la vez. El segundo se queda esperando en el lock de la fila; cuando
    # el primero comitea, se despierta, lee EXECUTED y devuelve el resultado ya
    # liquidado sin ejecutar nada.
    #
    # El chequeo solo vale BAJO el lock: leer el estado sin el es leer una foto que
    # puede envejecer entre el SELECT y el UPDATE.
    if commission.status == CommissionStatus.EXECUTED:
        return commission

    ensure_can_transition(commission.status, CommissionStatus.EXECUTED)

    shares = compute_shares(
        gross_amount=commission.gross_amount,
        listing_broker_bps=commission.listing_broker_bps,
        selling_broker_bps=commission.selling_broker_bps,
    )

    legs = build_split_legs(
        gross_amount=commission.gross_amount,
        reported_by_account_id=commission.reported_by_account_id,
        listing_broker_account_id=commission.listing_broker_account_id,
        selling_broker_account_id=commission.selling_broker_account_id,
        platform_account_id=PLATFORM_ACCOUNT_ID,
        shares=shares,
    )

    movement_id: uuid.UUID | None = None
    if legs:
        # UNICO punto donde se mueve plata, y es codigo de la Fase 2.
        movement = ledger_service.post_movement(
            session,
            legs=legs,
            operation_type=OperationType.COMMISSION_SPLIT,
            reference=str(commission.id),
        )
        movement_id = movement.movement_id
    # Si `legs` quedo vacio, el reparto entero se resolvio dentro de una sola
    # cuenta (el reportante es a la vez listing y selling broker, y la plataforma
    # cobra 0%). No hay plata que mover: la comision se ejecuta sin movimiento.
    # Forzar un asiento aqui seria escribir ruido en el ledger.

    commission.status = CommissionStatus.EXECUTED
    commission.listing_broker_share = shares.listing_broker
    commission.selling_broker_share = shares.selling_broker
    commission.platform_share = shares.platform
    commission.movement_id = movement_id
    commission.approved_by = approved_by
    commission.approved_at = datetime.now(timezone.utc)
    session.flush()

    return commission


def reject_commission(
    session: Session, *, commission_id: uuid.UUID, rejected_by: str, reason: str
) -> Commission:
    """Rechaza una comision pendiente. No mueve plata, por definicion."""
    commission = repository.get_for_update(session, commission_id)
    if commission is None:
        raise CommissionNotFound(
            "La comision no existe", commission_id=str(commission_id)
        )

    if commission.status == CommissionStatus.REJECTED:
        return commission

    ensure_can_transition(commission.status, CommissionStatus.REJECTED)

    commission.status = CommissionStatus.REJECTED
    commission.rejected_by = rejected_by
    commission.rejection_reason = reason
    commission.rejected_at = datetime.now(timezone.utc)
    session.flush()

    return commission


def get_commission(session: Session, commission_id: uuid.UUID) -> Commission:
    commission = repository.get(session, commission_id)
    if commission is None:
        raise CommissionNotFound(
            "La comision no existe", commission_id=str(commission_id)
        )
    return commission


def list_commissions(
    session: Session,
    *,
    status: CommissionStatus | None = None,
    reported_by_account_id: uuid.UUID | None = None,
) -> list[Commission]:
    return repository.list_all(
        session, status=status, reported_by_account_id=reported_by_account_id
    )
