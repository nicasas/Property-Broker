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


# --------------------------------------------------------------------------
# CAPA DE BASE DE DATOS: FK parcial via columna generada
#
# Las cuatro columnas que alimentan un movimiento de plata no pueden apuntar a la
# cuenta externa, y no por un guard de aplicacion sino porque no existe fila del
# otro lado de la FK. Estos tests se saltan la app a proposito: prueban la
# garantia estructural, no la validacion.
# --------------------------------------------------------------------------


def test_la_base_bloquea_un_listing_con_la_externa_como_broker(make_broker):
    """El INSERT directo que antes abria la fuga, ahora imposible.

    Esta fila —anterior al guard, sembrada, o metida por un script— era el camino
    que llevaba una cuenta externa hasta el split. Hoy la FK compuesta no tiene
    contra que resolver: la externa tiene `is_settleable = false`.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(
                text(
                    "INSERT INTO listings (id, address, listing_broker_account_id,"
                    " listing_broker_bps, selling_broker_bps, platform_bps)"
                    " VALUES (:id, 'Fila insertada a mano', :lb, 4000, 4000, 2000)"
                ),
                {"id": uuid.uuid4(), "lb": EXTERNAL_ACCOUNT_ID},
            )

    assert "fk_listings_broker_settleable" in str(exc.value)
    assert_system_is_balanced()


def test_la_base_bloquea_un_insert_directo_a_commissions_con_la_externa(
    make_broker, make_listing
):
    """LA AFIRMACION FUERTE.

    `commissions.listing_broker_account_id` es el snapshot: la columna que
    `approve_commission` lee para construir los legs. Blindar solo `listings`
    habria dejado este INSERT como camino abierto, porque es justo donde el
    snapshot deja de depender del listing.

    Con la FK sobre esta tabla, no queda ningun camino —ni preexistente, ni
    futuro, ni saltandose la aplicacion— para meter la cuenta externa en un leg.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(
                text(
                    "INSERT INTO commissions (id, listing_id, reported_by_account_id,"
                    " selling_broker_account_id, listing_broker_account_id,"
                    " gross_amount, listing_broker_bps, selling_broker_bps,"
                    " platform_bps, evidence, status)"
                    " VALUES (:id, :listing, :rep, :sell, :lb,"
                    " 1000000, 4000, 4000, 2000, 'sonda', 'PENDING')"
                ),
                {
                    "id": uuid.uuid4(),
                    "listing": listing,
                    "rep": a,
                    "sell": b,
                    "lb": EXTERNAL_ACCOUNT_ID,  # el snapshot envenenado
                },
            )

    assert "fk_commissions_listing_broker_settleable" in str(exc.value)
    assert_system_is_balanced()


def test_no_se_puede_convertir_en_externa_una_cuenta_ya_referenciada(
    make_broker, make_listing
):
    """DIRECCION INVERSA, la que un trigger sobre listings no habria cubierto.

    Con un trigger, nada impediria tomar una cuenta que ya es listing_broker y
    convertirla en EXTERNAL despues: el trigger vigila las escrituras a `listings`,
    no a `accounts`. La FK cubre las dos puntas con una sola pieza.

    Nota sobre el aislamiento: el indice singleton (una sola cuenta EXTERNAL) se
    dispara ANTES que la FK y taparia lo que queremos observar. Se quita DENTRO de
    la transaccion —el DDL en Postgres es transaccional— asi que el rollback lo
    restituye y la base queda como estaba.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    broker = make_broker()
    make_listing(listing_broker_account_id=broker)

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(text("DROP INDEX uq_accounts_singleton_system_types"))
            session.execute(
                text("UPDATE accounts SET account_type = 'EXTERNAL' WHERE id = :id"),
                {"id": broker},
            )

    assert "fk_listings_broker_settleable" in str(exc.value)

    # El indice volvio con el rollback y la cuenta sigue siendo un broker.
    with transaction() as session:
        vive = session.execute(
            text("SELECT account_type FROM accounts WHERE id = :id"), {"id": broker}
        ).scalar_one()
    assert vive == "BROKER"
    assert_system_is_balanced()


def test_report_commission_revalida_el_listing_broker(make_broker, make_listing):
    """CAPA DE APLICACION, aislada de la capa de base de datos.

    Ahora que la FK impide que exista un listing con la externa como broker, el
    guard de `report_commission` ya no se puede provocar con datos reales. Se
    simula el listing envenenado para verificar que la validacion existe y corta.

    Las dos capas se prueban por separado a proposito: si mañana alguien relaja la
    FK, este test sigue exigiendo que la aplicacion no deje pasar el valor.
    """
    from types import SimpleNamespace

    from app.modules.listings import service as listings_service

    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing_id = make_listing(listing_broker_account_id=a)

    envenenado = SimpleNamespace(
        id=listing_id,
        listing_broker_account_id=EXTERNAL_ACCOUNT_ID,
        listing_broker_bps=4_000,
        selling_broker_bps=4_000,
        platform_bps=2_000,
    )

    import app.modules.commissions.service as commissions_module

    original = listings_service.get_listing
    commissions_module.listings_service.get_listing = lambda *_a, **_k: envenenado
    try:
        with pytest.raises(RestrictedAccount):
            with transaction() as session:
                commissions_service.report_commission(
                    session,
                    listing_id=listing_id,
                    reported_by_account_id=a,
                    selling_broker_account_id=b,
                    gross_amount=1_000_000,
                    evidence="contrato.pdf",
                )
    finally:
        commissions_module.listings_service.get_listing = original

    assert_system_is_balanced()


def test_no_se_puede_depositar_hacia_la_cuenta_externa(balance_of):
    """El guard del deposito es INTENCIONAL, no incidental.

    Antes esto se rechazaba igual, pero por la regla de "cuenta repetida" de
    `post_movement` (origen y destino habrian sido la misma cuenta). El error decia
    `invalid_movement`, que describe un movimiento mal formado y no la razon real.

    Que el error sea `restricted_account` es lo que prueba que hay un guard que
    sabe lo que esta protegiendo.
    """
    with pytest.raises(RestrictedAccount):
        with transaction() as session:
            ledger_service.deposit(
                session,
                account_id=EXTERNAL_ACCOUNT_ID,
                amount=5_000,
                external_account_id=EXTERNAL_ACCOUNT_ID,
            )

    assert balance_of(EXTERNAL_ACCOUNT_ID) == 0
    assert_system_is_balanced()


def test_si_se_puede_depositar_a_la_plataforma(balance_of):
    """La restriccion del deposito es sobre la externa, no sobre cuentas de sistema."""
    with transaction() as session:
        ledger_service.deposit(
            session,
            account_id=PLATFORM_ACCOUNT_ID,
            amount=5_000,
            external_account_id=EXTERNAL_ACCOUNT_ID,
        )

    assert balance_of(PLATFORM_ACCOUNT_ID) == 5_000
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
