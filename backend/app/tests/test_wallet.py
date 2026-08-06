"""El nucleo bancario como wallet generico: crear, cargar, transferir, consultar.

Nada de comisiones aqui. Si estos tests pasan, el nucleo se sostiene solo.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.database import transaction
from app.core.errors import AccountNotFound, InsufficientFunds, InvalidMovement
from app.main import app
from app.modules.accounts import service as accounts_service
from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID, PLATFORM_ACCOUNT_ID
from app.modules.accounts.models import AccountType
from app.modules.ledger import service as ledger_service
from app.modules.ledger.models import OperationType
from app.modules.ledger.service import Leg
from app.tests.conftest import assert_system_is_balanced


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_las_cuentas_de_sistema_vienen_sembradas():
    with transaction() as session:
        plataforma = accounts_service.get_account(session, PLATFORM_ACCOUNT_ID)
        externa = accounts_service.get_account(session, EXTERNAL_ACCOUNT_ID)

        assert plataforma.account_type == AccountType.PLATFORM
        assert externa.account_type == AccountType.EXTERNAL

        # Solo la externa puede ir a negativo.
        assert externa.allows_negative_balance is True
        assert plataforma.allows_negative_balance is False


def test_una_cuenta_nace_en_cero(make_broker, balance_of):
    assert balance_of(make_broker()) == 0


def test_deposito_carga_saldo_y_hunde_la_cuenta_externa(make_broker, balance_of):
    """No se crea plata: el deposito tiene contrapartida.

    El saldo de la cuenta externa, cambiado de signo, es exactamente el total de
    dinero vivo dentro del sistema.
    """
    broker = make_broker()

    with transaction() as session:
        ledger_service.deposit(
            session,
            account_id=broker,
            amount=250_000,
            external_account_id=EXTERNAL_ACCOUNT_ID,
            reference="comision bruta venta #1",
        )

    assert balance_of(broker) == 250_000
    assert balance_of(EXTERNAL_ACCOUNT_ID) == -250_000
    assert_system_is_balanced()


def test_transferencia_mueve_el_saldo_completo(make_broker, balance_of):
    a = make_broker(balance=100_000)
    b = make_broker(balance=20_000)

    with transaction() as session:
        ledger_service.transfer(
            session, from_account_id=a, to_account_id=b, amount=35_000
        )

    assert balance_of(a) == 65_000
    assert balance_of(b) == 55_000
    assert_system_is_balanced()


def test_transferir_mas_de_lo_que_hay_falla_y_no_mueve_nada(make_broker, balance_of):
    a = make_broker(balance=1_000)
    b = make_broker()

    with pytest.raises(InsufficientFunds):
        with transaction() as session:
            ledger_service.transfer(
                session, from_account_id=a, to_account_id=b, amount=1_001
            )

    assert balance_of(a) == 1_000
    assert balance_of(b) == 0
    assert_system_is_balanced()


def test_el_rollback_deshace_el_movimiento_entero(make_broker, balance_of):
    """Atomicidad: si algo revienta despues del debito, el debito tampoco queda.

    Es el modo de falla que mas silenciosamente destruye plata — el origen queda
    debitado y el destino nunca acreditado.
    """
    a = make_broker(balance=100_000)
    b = make_broker()

    with pytest.raises(RuntimeError):
        with transaction() as session:
            ledger_service.transfer(
                session, from_account_id=a, to_account_id=b, amount=40_000
            )
            raise RuntimeError("fallo despues de mover el saldo")

    assert balance_of(a) == 100_000
    assert balance_of(b) == 0

    # Queda solo el deposito inicial: la transferencia abortada no dejo asientos.
    with transaction() as session:
        entries = ledger_service.list_entries(session, a)
    assert [e.amount for e in entries] == [100_000]

    assert_system_is_balanced()


def test_historial_de_movimientos(make_broker):
    a = make_broker(balance=100_000)
    b = make_broker()

    with transaction() as session:
        ledger_service.transfer(session, from_account_id=a, to_account_id=b, amount=1)
        ledger_service.transfer(session, from_account_id=a, to_account_id=b, amount=2)

    with transaction() as session:
        entries = ledger_service.list_entries(session, a)

    assert len(entries) == 3  # el deposito inicial + las dos transferencias
    assert entries[0].operation_type == OperationType.TRANSFER
    assert {e.amount for e in entries} == {100_000, -1, -2}
    # `balance_after` deja el historial legible sin tener que sumar la columna.
    assert min(e.balance_after for e in entries) == 99_997


def test_una_cuenta_inexistente_es_404(balance_of):
    with pytest.raises(AccountNotFound):
        balance_of(uuid.uuid4())


# --------------------------------------------------------------------------
# La primitiva de movimiento
# --------------------------------------------------------------------------


def test_un_movimiento_cuyas_patas_no_suman_cero_se_rechaza(make_broker):
    """La validacion que impide inventar plata a nivel de API interna."""
    a = make_broker(balance=100_000)
    b = make_broker()

    with pytest.raises(InvalidMovement, match="no suman cero"):
        with transaction() as session:
            ledger_service.post_movement(
                session,
                legs=[Leg(a, -1_000), Leg(b, 1_500)],  # aparecen 500 de la nada
                operation_type=OperationType.TRANSFER,
            )

    assert_system_is_balanced()


def test_un_movimiento_de_tres_patas_funciona(make_broker, balance_of):
    """La forma que va a usar el split de comisiones en la Fase 3.

    El nucleo ya la soporta: el motor no sabe cuantas patas son ni de que tipo
    son las cuentas, solo que suman cero.
    """
    reportante = make_broker(balance=1_000_000)
    otro_broker = make_broker()

    with transaction() as session:
        ledger_service.post_movement(
            session,
            legs=[
                Leg(reportante, -300_000),
                Leg(PLATFORM_ACCOUNT_ID, 90_000),
                Leg(otro_broker, 210_000),
            ],
            operation_type=OperationType.TRANSFER,
            reference="ensayo de split",
        )

    assert balance_of(reportante) == 700_000
    assert balance_of(PLATFORM_ACCOUNT_ID) == 90_000
    assert balance_of(otro_broker) == 210_000
    assert_system_is_balanced()


def test_monto_cero_y_cuenta_repetida_se_rechazan(make_broker):
    a = make_broker(balance=1_000)
    b = make_broker()

    with transaction() as session:
        with pytest.raises(InvalidMovement, match="monto cero"):
            ledger_service.post_movement(
                session,
                legs=[Leg(a, 0), Leg(b, 0)],
                operation_type=OperationType.TRANSFER,
            )

        with pytest.raises(InvalidMovement, match="dos veces"):
            ledger_service.post_movement(
                session,
                legs=[Leg(a, -100), Leg(a, 100)],
                operation_type=OperationType.TRANSFER,
            )


def test_no_se_puede_transferir_a_la_misma_cuenta(make_broker):
    a = make_broker(balance=1_000)
    with pytest.raises(InvalidMovement):
        with transaction() as session:
            ledger_service.transfer(
                session, from_account_id=a, to_account_id=a, amount=100
            )


# --------------------------------------------------------------------------
# Extremo a extremo por HTTP
# --------------------------------------------------------------------------


def test_flujo_completo_por_http(client):
    a = client.post("/accounts", json={"name": "Broker A"}).json()
    b = client.post("/accounts", json={"name": "Broker B"}).json()

    client.post(
        "/deposits",
        json={"account_id": a["id"], "amount": 500_000, "reference": "venta #42"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    client.post(
        "/transfers",
        json={
            "from_account_id": a["id"],
            "to_account_id": b["id"],
            "amount": 125_000,
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )

    assert client.get(f"/accounts/{a['id']}/balance").json()["balance"] == 375_000
    assert client.get(f"/accounts/{b['id']}/balance").json()["balance"] == 125_000

    historial = client.get(f"/accounts/{a['id']}/ledger").json()
    assert len(historial) == 2

    salud = client.get("/ledger/reconciliation").json()
    assert salud["is_balanced"] is True
    assert salud["ledger_total"] == 0
    assert salud["mismatches"] == []


# --------------------------------------------------------------------------
# Las patas de un movimiento
# --------------------------------------------------------------------------


def test_las_patas_de_una_transferencia_revelan_la_contraparte(client, make_broker):
    """El historial de una cuenta trae solo SUS filas, asi que quien recibe un
    pago ve su pata y nunca la del otro lado.

    La contraparte no se pierde: la contabilidad de partida doble la registra en
    la otra pata del mismo `movement_id`. Este endpoint es lo que permite leerla,
    sin duplicar el dato en `reference` —que ya significa otra cosa: el hecho de
    negocio que origino el movimiento.
    """
    origen = make_broker(balance=100_000)
    destino = make_broker()

    movimiento = client.post(
        "/transfers",
        json={
            "from_account_id": str(origen),
            "to_account_id": str(destino),
            "amount": 40_000,
            "reference": "adelanto de comision",
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    ).json()

    patas = client.get(f"/ledger/movements/{movimiento['movement_id']}").json()

    assert len(patas) == 2
    por_cuenta = {p["account_id"]: p["amount"] for p in patas}
    assert por_cuenta[str(origen)] == -40_000
    assert por_cuenta[str(destino)] == 40_000
    # La propiedad que hace confiable la respuesta: las patas suman cero.
    assert sum(p["amount"] for p in patas) == 0
    # El concepto sigue en `reference`, sin mezclarse con la contraparte.
    assert all(p["reference"] == "adelanto de comision" for p in patas)


def test_las_patas_de_un_deposito_incluyen_la_cuenta_externa(client, make_broker):
    broker = make_broker()
    movimiento = client.post(
        "/deposits",
        json={"account_id": str(broker), "amount": 75_000},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    ).json()

    patas = client.get(f"/ledger/movements/{movimiento['movement_id']}").json()

    assert len(patas) == 2
    assert sum(p["amount"] for p in patas) == 0
    assert str(EXTERNAL_ACCOUNT_ID) in {p["account_id"] for p in patas}


def test_un_movimiento_inexistente_es_404(client):
    respuesta = client.get(f"/ledger/movements/{uuid.uuid4()}")
    assert respuesta.status_code == 404
    assert respuesta.json()["error"] == "movement_not_found"
