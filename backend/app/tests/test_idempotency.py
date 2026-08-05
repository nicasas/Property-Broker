"""Idempotencia: un reintento no puede mover plata dos veces.

El escenario real: el cliente manda POST /transfers, la red se cae antes de que
vuelva la respuesta, el cliente reintenta con la misma key. Un sistema sin esto
acaba de transferir dos veces y nadie se entera hasta la conciliacion.
"""

from __future__ import annotations

import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import transaction
from app.core.errors import IdempotencyConflict, InsufficientFunds
from app.core.idempotency import execute_idempotent
from app.main import app
from app.modules.ledger import repository as ledger_repository
from app.modules.ledger import service as ledger_service
from app.tests.conftest import assert_system_is_balanced, run_concurrently, successes


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _new_key() -> str:
    return str(uuid.uuid4())


# --------------------------------------------------------------------------
# Nivel HTTP
# --------------------------------------------------------------------------


def test_reintento_con_la_misma_key_no_transfiere_dos_veces(
    client, make_broker, balance_of
):
    origen = make_broker(balance=100_000)
    destino = make_broker()
    key = _new_key()
    body = {
        "from_account_id": str(origen),
        "to_account_id": str(destino),
        "amount": 30_000,
    }

    primera = client.post("/transfers", json=body, headers={"Idempotency-Key": key})
    segunda = client.post("/transfers", json=body, headers={"Idempotency-Key": key})

    assert primera.status_code == 201
    assert segunda.status_code == 201
    # No es "una respuesta parecida": es exactamente la misma, con el mismo
    # movement_id y los mismos ids de asiento. El cliente no puede distinguir
    # si su reintento se ejecuto o se reprodujo, que es justo el punto.
    assert segunda.json() == primera.json()

    assert balance_of(origen) == 70_000
    assert balance_of(destino) == 30_000
    assert_system_is_balanced()


def test_misma_key_con_payload_distinto_es_conflicto(client, make_broker, balance_of):
    """Comportamiento Stripe: reusar una key para otra operacion es un error del cliente.

    Devolver la respuesta vieja en silencio seria peor que fallar: el cliente
    creeria que su segunda transferencia, la de 90.000, se ejecuto.
    """
    origen = make_broker(balance=100_000)
    destino = make_broker()
    key = _new_key()

    primera = client.post(
        "/transfers",
        json={
            "from_account_id": str(origen),
            "to_account_id": str(destino),
            "amount": 10_000,
        },
        headers={"Idempotency-Key": key},
    )
    assert primera.status_code == 201

    segunda = client.post(
        "/transfers",
        json={
            "from_account_id": str(origen),
            "to_account_id": str(destino),
            "amount": 90_000,
        },
        headers={"Idempotency-Key": key},
    )

    assert segunda.status_code == 409
    assert segunda.json()["error"] == "idempotency_conflict"

    # La segunda no movio nada.
    assert balance_of(origen) == 90_000
    assert_system_is_balanced()


def test_las_operaciones_de_plata_exigen_la_key(client, make_broker):
    origen = make_broker(balance=1_000)
    destino = make_broker()

    respuesta = client.post(
        "/transfers",
        json={
            "from_account_id": str(origen),
            "to_account_id": str(destino),
            "amount": 500,
        },
    )
    assert respuesta.status_code == 422  # falta el header


def test_una_operacion_fallida_no_quema_la_key(client, make_broker, balance_of):
    """Si el movimiento hace rollback, la fila de idempotencia se va con el.

    Es la consecuencia de escribir la key en la MISMA transaccion que el
    movimiento. Si se guardara aparte, un fallo por saldo insuficiente dejaria la
    key marcada como usada y el cliente no podria reintentar nunca, ni despues de
    recargar saldo.
    """
    origen = make_broker(balance=1_000)
    destino = make_broker()
    key = _new_key()
    body = {
        "from_account_id": str(origen),
        "to_account_id": str(destino),
        "amount": 5_000,
    }

    fallida = client.post("/transfers", json=body, headers={"Idempotency-Key": key})
    assert fallida.status_code == 409
    assert fallida.json()["error"] == "insufficient_funds"

    # Llega la plata y el cliente reintenta con LA MISMA key.
    client.post(
        "/deposits",
        json={"account_id": str(origen), "amount": 10_000},
        headers={"Idempotency-Key": _new_key()},
    )

    reintento = client.post("/transfers", json=body, headers={"Idempotency-Key": key})
    assert reintento.status_code == 201, "La key quedo quemada por una operacion que nunca ocurrio"

    assert balance_of(destino) == 5_000
    assert_system_is_balanced()


def test_keys_distintas_si_ejecutan_dos_veces(client, make_broker, balance_of):
    """Control negativo: la idempotencia no puede convertirse en deduplicacion ciega.

    Dos transferencias identicas con keys distintas son dos intenciones distintas
    del cliente, y ambas deben ejecutarse.
    """
    origen = make_broker(balance=100_000)
    destino = make_broker()
    body = {
        "from_account_id": str(origen),
        "to_account_id": str(destino),
        "amount": 10_000,
    }

    client.post("/transfers", json=body, headers={"Idempotency-Key": _new_key()})
    client.post("/transfers", json=body, headers={"Idempotency-Key": _new_key()})

    assert balance_of(destino) == 20_000
    assert_system_is_balanced()


# --------------------------------------------------------------------------
# Concurrencia sobre la misma key
# --------------------------------------------------------------------------


def test_diez_requests_simultaneos_con_la_misma_key_ejecutan_una_sola_vez(
    make_broker, balance_of
):
    """El caso que justifica el INSERT-FIRST.

    Diez threads con la misma key arrancan a la vez. El primero inserta la fila y
    se queda con el lock del indice de clave primaria; los otros nueve se frenan
    ahi mismo, ANTES de tocar un solo saldo. Cuando el primero comitea, revientan
    con IntegrityError y devuelven su respuesta cacheada.

    Con la fila de idempotencia escrita al final, los diez habrian ejecutado la
    transferencia y solo despues habrian descubierto el conflicto.
    """
    origen = make_broker(balance=100_000)
    destino = make_broker()

    key = _new_key()
    payload = {
        "from_account_id": str(origen),
        "to_account_id": str(destino),
        "amount": 10_000,
    }

    ejecuciones = 0
    contador_lock = threading.Lock()
    respuestas: list[dict] = []
    respuestas_lock = threading.Lock()

    def handler(session: Session) -> dict:
        nonlocal ejecuciones
        with contador_lock:
            ejecuciones += 1
        movimiento = ledger_service.transfer(
            session,
            from_account_id=origen,
            to_account_id=destino,
            amount=10_000,
        )
        return {"movement_id": str(movimiento.movement_id)}

    def worker(_: int) -> None:
        resultado = execute_idempotent(
            key=key,
            endpoint="POST /transfers",
            payload=payload,
            handler=handler,
        )
        with respuestas_lock:
            respuestas.append(resultado)

    resultados = run_concurrently(worker, times=10)

    assert successes(resultados) == 10, "Todos deben recibir una respuesta valida"
    assert ejecuciones == 1, f"El handler corrio {ejecuciones} veces, debia correr 1"

    # Los diez recibieron literalmente la misma respuesta.
    assert len({r["movement_id"] for r in respuestas}) == 1

    # Y sobre todo: la plata se movio UNA vez.
    assert balance_of(origen) == 90_000
    assert balance_of(destino) == 10_000

    with transaction() as session:
        asientos = ledger_repository.list_by_account(session, destino, limit=100)
    assert len(asientos) == 1

    assert_system_is_balanced()


def test_misma_key_distinto_payload_en_concurrencia(make_broker, balance_of):
    """Mitad y mitad, todos a la vez: uno gana y los del otro payload reciben 409."""
    origen = make_broker(balance=100_000)
    destino = make_broker()
    key = _new_key()

    def worker(index: int) -> None:
        amount = 1_000 if index % 2 == 0 else 2_000
        execute_idempotent(
            key=key,
            endpoint="POST /transfers",
            payload={"amount": amount},
            handler=lambda session: {
                "movement_id": str(
                    ledger_service.transfer(
                        session,
                        from_account_id=origen,
                        to_account_id=destino,
                        amount=amount,
                    ).movement_id
                )
            },
        )

    resultados = run_concurrently(worker, times=10)

    conflictos = sum(1 for r in resultados if isinstance(r, IdempotencyConflict))
    ok = successes(resultados)

    # Gana un payload; sus companeros de payload reproducen la respuesta y los
    # cinco del otro payload chocan.
    assert ok == 5
    assert conflictos == 5
    assert ok + conflictos == 10

    # Se movio exactamente una transferencia, de uno de los dos montos.
    assert balance_of(destino) in (1_000, 2_000)
    assert_system_is_balanced()


def test_insufficient_funds_no_se_confunde_con_conflicto_de_key(make_broker):
    """Un IntegrityError del CHECK de saldo y uno de la key repetida son cosas
    distintas y no se pueden mezclar: se distinguen por el nombre del constraint."""
    origen = make_broker(balance=100)
    destino = make_broker()

    with pytest.raises(InsufficientFunds):
        execute_idempotent(
            key=_new_key(),
            endpoint="POST /transfers",
            payload={"amount": 999_999},
            handler=lambda session: {
                "movement_id": str(
                    ledger_service.transfer(
                        session,
                        from_account_id=origen,
                        to_account_id=destino,
                        amount=999_999,
                    ).movement_id
                )
            },
        )

    assert_system_is_balanced()
