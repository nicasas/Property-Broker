"""La cuenta externa no es una cuenta como las demas.

Es la unica sin `CHECK (balance >= 0)`, porque representa el dinero que entro
desde afuera y por construccion vive en negativo. Esa excepcion solo es segura si
nadie mas que `deposit()` puede tocarla.

Estos tests cubren un hueco que `SUM(ledger) == 0` NO detecta: usando la cuenta
externa como contraparte de una transferencia normal, la partida doble sigue
cuadrando perfecto mientras el sistema acuña plata de la nada.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.database import transaction
from app.core.errors import RestrictedAccount
from app.main import app
from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID, PLATFORM_ACCOUNT_ID
from app.modules.commissions import service as commissions_service
from app.modules.ledger import service as ledger_service
from app.modules.listings import service as listings_service
from app.tests.conftest import assert_system_is_balanced


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_no_se_puede_transferir_desde_la_cuenta_externa(make_broker, balance_of):
    """Este era el agujero: acuñar plata con una transferencia ordinaria.

    La cuenta externa no tiene CHECK (>= 0), asi que nada la frenaba: se hundia en
    negativo y el destino recibia dinero que nunca entro al sistema. El ledger
    seguia sumando cero —las dos patas se compensan— y la reconciliacion global
    daba "todo bien".
    """
    destino = make_broker()

    with pytest.raises(RestrictedAccount):
        with transaction() as session:
            ledger_service.transfer(
                session,
                from_account_id=EXTERNAL_ACCOUNT_ID,
                to_account_id=destino,
                amount=999_999_999,
            )

    assert balance_of(destino) == 0
    assert balance_of(EXTERNAL_ACCOUNT_ID) == 0
    assert_system_is_balanced()


def test_no_se_puede_transferir_hacia_la_cuenta_externa(make_broker, balance_of):
    """El reverso: sacar plata del sistema sin dejar rastro de a donde fue."""
    origen = make_broker(balance=100_000)

    with pytest.raises(RestrictedAccount):
        with transaction() as session:
            ledger_service.transfer(
                session,
                from_account_id=origen,
                to_account_id=EXTERNAL_ACCOUNT_ID,
                amount=100_000,
            )

    assert balance_of(origen) == 100_000
    assert_system_is_balanced()


def test_el_deposito_si_puede_tocar_la_cuenta_externa(make_broker, balance_of):
    """`deposit()` es el unico con ese permiso, y es lo que la hace util."""
    broker = make_broker()

    with transaction() as session:
        ledger_service.deposit(
            session,
            account_id=broker,
            amount=750_000,
            external_account_id=EXTERNAL_ACCOUNT_ID,
        )

    assert balance_of(broker) == 750_000
    assert balance_of(EXTERNAL_ACCOUNT_ID) == -750_000
    assert_system_is_balanced()


def test_la_plataforma_si_es_contraparte_valida(make_broker, balance_of):
    """La restriccion es sobre la EXTERNA, no sobre las cuentas de sistema en general.

    La plataforma tiene CHECK (>= 0) como cualquier broker y participa en los
    splits: prohibirla seria confundir dos cosas distintas.
    """
    broker = make_broker(balance=50_000)

    with transaction() as session:
        ledger_service.transfer(
            session,
            from_account_id=broker,
            to_account_id=PLATFORM_ACCOUNT_ID,
            amount=20_000,
        )

    assert balance_of(PLATFORM_ACCOUNT_ID) == 20_000
    assert_system_is_balanced()


def test_la_cuenta_externa_no_puede_ser_broker_de_una_comision(
    make_broker, make_listing
):
    """Acreditar a la externa en un split seria sacar plata por la puerta de atras."""
    a = make_broker(balance=1_000_000)
    listing = make_listing(listing_broker_account_id=a)

    with pytest.raises(RestrictedAccount):
        with transaction() as session:
            commissions_service.report_commission(
                session,
                listing_id=listing,
                reported_by_account_id=a,
                selling_broker_account_id=EXTERNAL_ACCOUNT_ID,
                gross_amount=500_000,
                evidence="contrato.pdf",
            )

    assert_system_is_balanced()


def test_la_cuenta_externa_no_puede_captar_un_inmueble(make_broker):
    with pytest.raises(RestrictedAccount):
        with transaction() as session:
            listings_service.create_listing(
                session,
                address="Calle falsa 123",
                listing_broker_account_id=EXTERNAL_ACCOUNT_ID,
                listing_broker_bps=4_000,
                selling_broker_bps=4_000,
                platform_bps=2_000,
            )


def test_por_http_devuelve_422(client, make_broker):
    destino = make_broker()

    respuesta = client.post(
        "/transfers",
        json={
            "from_account_id": str(EXTERNAL_ACCOUNT_ID),
            "to_account_id": str(destino),
            "amount": 1_000,
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )

    assert respuesta.status_code == 422
    assert respuesta.json()["error"] == "restricted_account"
    assert_system_is_balanced()
