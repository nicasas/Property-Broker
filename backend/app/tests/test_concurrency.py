"""Concurrencia: el sistema no puede gastar dos veces el mismo peso.

Todos los tests de este archivo siguen la misma forma:

    1. se prepara un estado con saldo EXACTO y conocido,
    2. N threads arrancan a la vez (barrera) y compiten por la misma cuenta,
       CADA UNO con su propia sesion,
    3. se cuenta cuantos ganaron y cuantos fueron rechazados,
    4. se verifica el saldo final al peso Y que el ledger siga cuadrando.

El paso 4 es el que no se puede saltar: un saldo final correcto con un ledger
corrupto sigue siendo un sistema roto, solo que todavia no se nota.
"""

from __future__ import annotations

import uuid

from app.core.database import transaction
from app.core.errors import InsufficientFunds
from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID
from app.modules.ledger import repository as ledger_repository
from app.modules.ledger import service as ledger_service
from app.tests.conftest import (
    assert_system_is_balanced,
    failures,
    run_concurrently,
    successes,
    unexpected,
)


def _transfer(from_id: uuid.UUID, to_id: uuid.UUID, amount: int) -> None:
    """Una transferencia completa, con sesion propia.

    `transaction()` construye una Session NUEVA sobre una conexion nueva del pool.
    Es la pieza que hace legitimo el test: las sesiones de SQLAlchemy no son
    thread-safe, y si los threads compartieran una, no estarian compitiendo por
    el lock de fila de Postgres — estarian pisandose en memoria y el resultado
    no probaria nada.
    """
    with transaction() as session:
        ledger_service.transfer(
            session, from_account_id=from_id, to_account_id=to_id, amount=amount
        )


def test_solo_una_de_veinte_transferencias_gana_el_ultimo_peso(
    make_broker, balance_of
):
    """EL DOBLE GASTO. Veinte requests simultaneos por una plata que alcanza para uno.

    Sin `SELECT ... FOR UPDATE` los veinte leen saldo=50000, los veinte concluyen
    "alcanza", y el destino termina con 1.000.000 que nunca existieron.
    """
    origen = make_broker(balance=50_000)
    destino = make_broker()

    resultados = run_concurrently(
        lambda _: _transfer(origen, destino, 50_000), times=20
    )

    assert unexpected(resultados, InsufficientFunds) == []
    assert successes(resultados) == 1, "Se gasto el mismo saldo mas de una vez"
    assert failures(resultados, InsufficientFunds) == 19

    assert balance_of(origen) == 0
    assert balance_of(destino) == 50_000
    assert_system_is_balanced()


def test_el_saldo_alcanza_para_exactamente_diez_de_veinticinco(
    make_broker, balance_of
):
    """El corte tiene que caer donde dice la aritmetica, no donde caiga la carrera."""
    origen = make_broker(balance=10 * 1_000)
    destino = make_broker()

    resultados = run_concurrently(lambda _: _transfer(origen, destino, 1_000), times=25)

    assert unexpected(resultados, InsufficientFunds) == []
    assert successes(resultados) == 10
    assert failures(resultados, InsufficientFunds) == 15

    assert balance_of(origen) == 0
    assert balance_of(destino) == 10_000
    assert_system_is_balanced()


def test_transferencias_concurrentes_no_pierden_actualizaciones(
    make_broker, balance_of
):
    """Lost update: cincuenta debitos que SI caben. Ninguno se puede evaporar.

    Es el reverso del doble gasto. Alli el riesgo era gastar de mas; aqui es que
    dos threads lean el mismo saldo, escriban encima el uno del otro y una de las
    transferencias desaparezca dejando plata que nadie descontó.
    """
    origen = make_broker(balance=1_000_000)
    destino = make_broker()

    resultados = run_concurrently(lambda _: _transfer(origen, destino, 100), times=50)

    assert unexpected(resultados) == []
    assert successes(resultados) == 50

    assert balance_of(origen) == 1_000_000 - 50 * 100
    assert balance_of(destino) == 50 * 100

    with transaction() as session:
        entries = ledger_repository.list_by_account(session, destino, limit=500)
    assert len(entries) == 50, "Falta o sobra un asiento en el ledger"

    assert_system_is_balanced()


def test_transferencias_cruzadas_no_producen_deadlock(make_broker, balance_of):
    """A->B y B->A al mismo tiempo, veinte veces.

    Este es el test del ORDEN DE BLOQUEO. Si `post_movement` bloqueara las cuentas
    en el orden en que llegan las patas, la mitad de los threads tomaria primero
    el lock de A pidiendo B y la otra mitad al reves: abrazo mortal, y Postgres
    mata una de las dos transacciones con un DeadlockDetected.

    Como se bloquea siempre por account_id ascendente, todos piden los locks en la
    misma secuencia y el que llega segundo simplemente espera su turno.

    Ambas cuentas arrancan con saldo de sobra para que la unica causa posible de
    fallo sea un deadlock, no un saldo insuficiente.
    """
    a = make_broker(balance=500_000)
    b = make_broker(balance=500_000)

    def cruzar(index: int) -> None:
        if index % 2 == 0:
            _transfer(a, b, 1_000)
        else:
            _transfer(b, a, 1_000)

    resultados = run_concurrently(cruzar, times=20)

    assert unexpected(resultados) == [], "Un deadlock aborto alguna transaccion"
    assert successes(resultados) == 20

    # Diez idas y diez vueltas del mismo monto: cada cuenta vuelve a donde empezo.
    assert balance_of(a) == 500_000
    assert balance_of(b) == 500_000
    assert_system_is_balanced()


def test_depositos_concurrentes_a_la_misma_cuenta_suman_exacto(
    make_broker, balance_of
):
    """Treinta ingresos simultaneos. El total tiene que ser la suma exacta.

    Aqui la cuenta caliente es la EXTERNA: los treinta depositos la debitan a la
    vez. Es la unica cuenta sin CHECK (>= 0), asi que ninguno puede ser rechazado
    y cualquier diferencia en el total seria plata perdida en una carrera.
    """
    cuenta = make_broker()

    resultados = run_concurrently(
        lambda _: _deposit(cuenta, 12_345),
        times=30,
    )

    assert unexpected(resultados) == []
    assert balance_of(cuenta) == 30 * 12_345
    assert balance_of(EXTERNAL_ACCOUNT_ID) == -(30 * 12_345)
    assert_system_is_balanced()


def _deposit(account_id: uuid.UUID, amount: int) -> None:
    with transaction() as session:
        ledger_service.deposit(
            session,
            account_id=account_id,
            amount=amount,
            external_account_id=EXTERNAL_ACCOUNT_ID,
        )


def test_cadena_de_transferencias_concurrentes_conserva_el_total(
    make_broker, balance_of
):
    """Cinco cuentas moviendose entre si a la vez. Lo que importa es el TOTAL.

    Ningun saldo individual es predecible aqui, y ese es el punto: la propiedad
    que el sistema debe garantizar no es "cada cuenta termina en X" sino que la
    plata solo se mueve, nunca aparece ni desaparece.
    """
    cuentas = [make_broker(balance=100_000) for _ in range(5)]
    total_inicial = sum(balance_of(c) for c in cuentas)

    def mover(index: int) -> None:
        origen = cuentas[index % 5]
        destino = cuentas[(index + 1) % 5]
        _transfer(origen, destino, 5_000)

    resultados = run_concurrently(mover, times=40)

    assert unexpected(resultados, InsufficientFunds) == []
    assert sum(balance_of(c) for c in cuentas) == total_inicial
    assert all(balance_of(c) >= 0 for c in cuentas)
    assert_system_is_balanced()
