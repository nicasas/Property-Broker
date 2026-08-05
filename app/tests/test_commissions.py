"""Ciclo de vida de una comision: reporte, aprobacion, rechazo, y la concurrencia.

El split en si (aritmetica y ejecucion) esta en `test_split.py`.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.database import transaction
from app.core.errors import (
    CommissionNotFound,
    InvalidSplitConfiguration,
    InvalidTransition,
)
from app.main import app
from app.modules.accounts.constants import PLATFORM_ACCOUNT_ID
from app.modules.commissions import service as commissions_service
from app.modules.ledger import repository as ledger_repository
from app.tests.conftest import (
    assert_system_is_balanced,
    run_concurrently,
    successes,
    unexpected,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


# --------------------------------------------------------------------------
# Listings: solo el acuerdo de reparto
# --------------------------------------------------------------------------


def test_un_acuerdo_que_no_suma_cien_por_ciento_se_rechaza(make_broker, make_listing):
    broker = make_broker()

    with pytest.raises(InvalidSplitConfiguration):
        make_listing(
            listing_broker_account_id=broker,
            listing_bps=4_000,
            selling_bps=4_000,
            platform_bps=1_000,  # falta 10%
        )


def test_la_base_tambien_rechaza_un_acuerdo_invalido(make_broker):
    """El CHECK de la tabla, saltandose el service."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    broker = make_broker()

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(
                text(
                    "INSERT INTO listings (id, address, listing_broker_account_id, "
                    "listing_broker_bps, selling_broker_bps, platform_bps) "
                    "VALUES (gen_random_uuid(), 'Calle falsa', :b, 5000, 5000, 5000)"
                ),
                {"b": broker},
            )

    assert "ck_listings_bps_sum_to_total" in str(exc.value)


# --------------------------------------------------------------------------
# Reporte y maquina de estados
# --------------------------------------------------------------------------


def test_una_comision_reportada_queda_pendiente_y_no_mueve_plata(
    make_broker, make_listing, report_commission, balance_of, commission_status
):
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)

    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=500_000,
    )

    assert commission_status(commission) == "PENDING"
    assert balance_of(a) == 1_000_000  # intacto
    assert balance_of(b) == 0
    assert_system_is_balanced()


def test_el_acuerdo_se_congela_al_reportar(
    make_broker, make_listing, report_commission, balance_of
):
    """SNAPSHOT: cambiar el acuerdo del inmueble no toca comisiones ya reportadas.

    La comision se liquida con los porcentajes que estaban pactados cuando se
    reporto. Si se leyeran del listing al aprobar, una edicion administrativa
    podria mover plata que ya fue reportada bajo otras condiciones.
    """
    from sqlalchemy import text

    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(
        listing_broker_account_id=a,
        listing_bps=4_000,
        selling_bps=4_000,
        platform_bps=2_000,
    )
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )

    # Alguien cambia el acuerdo DESPUES del reporte.
    with transaction() as session:
        session.execute(
            text(
                "UPDATE listings SET listing_broker_bps = 1000, "
                "selling_broker_bps = 1000, platform_bps = 8000 WHERE id = :id"
            ),
            {"id": listing},
        )

    with transaction() as session:
        commissions_service.approve_commission(
            session, commission_id=commission, approved_by="ops@habi.co"
        )

    # Se liquido 40/40/20, el acuerdo vigente al reportar.
    assert balance_of(b) == 400_000
    assert balance_of(PLATFORM_ACCOUNT_ID) == 200_000
    assert_system_is_balanced()


def test_rechazar_una_comision_pendiente(
    make_broker, make_listing, report_commission, balance_of, commission_status
):
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=500_000,
    )

    with transaction() as session:
        result = commissions_service.reject_commission(
            session,
            commission_id=commission,
            rejected_by="ops@habi.co",
            reason="evidencia ilegible",
        )
        assert result.status == "REJECTED"
        assert result.rejection_reason == "evidencia ilegible"

    assert commission_status(commission) == "REJECTED"
    assert balance_of(a) == 1_000_000
    assert_system_is_balanced()


def test_una_comision_rechazada_no_se_puede_aprobar(
    make_broker, make_listing, report_commission
):
    """REJECTED es terminal. Aprobar despues seria pagar algo ya descartado."""
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=500_000,
    )

    with transaction() as session:
        commissions_service.reject_commission(
            session, commission_id=commission, rejected_by="ops", reason="no aplica"
        )

    with pytest.raises(InvalidTransition):
        with transaction() as session:
            commissions_service.approve_commission(
                session, commission_id=commission, approved_by="ops"
            )

    assert_system_is_balanced()


def test_una_comision_ejecutada_no_se_puede_rechazar(
    make_broker, make_listing, report_commission
):
    """EXECUTED tambien es terminal. La plata ya se movio; revertir se hace con un
    asiento contrario, no cambiando un estado."""
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=500_000,
    )

    with transaction() as session:
        commissions_service.approve_commission(
            session, commission_id=commission, approved_by="ops"
        )

    with pytest.raises(InvalidTransition):
        with transaction() as session:
            commissions_service.reject_commission(
                session, commission_id=commission, rejected_by="ops", reason="ups"
            )


def test_aprobar_una_comision_inexistente_es_404():
    with pytest.raises(CommissionNotFound):
        with transaction() as session:
            commissions_service.approve_commission(
                session, commission_id=uuid.uuid4(), approved_by="ops"
            )


# --------------------------------------------------------------------------
# Concurrencia: el lock de la fila de la comision
# --------------------------------------------------------------------------


def test_diez_aprobaciones_simultaneas_ejecutan_el_split_una_sola_vez(
    make_broker, make_listing, report_commission, balance_of
):
    """IDEMPOTENCIA A NIVEL DE DOMINIO, sin depender del Idempotency-Key.

    Diez operadores aprueban la misma comision a la vez, cada uno con su propia
    sesion y SIN header de idempotencia. Lo unico que los separa es el
    `SELECT ... FOR UPDATE` sobre la fila de la comision.

    El primero toma el lock, ejecuta el split y comitea. Los otros nueve estaban
    esperando en ese mismo SELECT; se despiertan, leen `status == EXECUTED` y
    devuelven el resultado ya liquidado sin mover un peso.

    Si el chequeo de estado se hiciera ANTES del lock (o sin lock), los diez
    leerian PENDING y ejecutarian diez splits: se pagaria diez veces la misma
    comision.
    """
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(
        listing_broker_account_id=a,
        listing_bps=4_000,
        selling_bps=4_000,
        platform_bps=2_000,
    )
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )

    def aprobar(index: int) -> None:
        with transaction() as session:
            commissions_service.approve_commission(
                session, commission_id=commission, approved_by=f"operador-{index}"
            )

    resultados = run_concurrently(aprobar, times=10)

    assert unexpected(resultados) == []
    assert successes(resultados) == 10, "Los diez deben recibir una respuesta valida"

    # Pero la plata se movio UNA sola vez.
    assert balance_of(a) == 400_000
    assert balance_of(b) == 400_000
    assert balance_of(PLATFORM_ACCOUNT_ID) == 200_000

    # Y hay exactamente un movimiento en el ledger, de tres patas.
    with transaction() as session:
        ejecutada = commissions_service.get_commission(session, commission)
        asientos = ledger_repository.list_by_movement(session, ejecutada.movement_id)

    assert ejecutada.status == "EXECUTED"
    assert len(asientos) == 3
    # Solo uno de los diez operadores queda registrado como el que aprobo.
    assert ejecutada.approved_by.startswith("operador-")

    assert_system_is_balanced()


def test_aprobar_y_rechazar_a_la_vez_solo_deja_ganar_a_uno(
    make_broker, make_listing, report_commission, commission_status
):
    """Carrera entre dos transiciones opuestas desde PENDING.

    Ambas toman el mismo lock de fila. La que llega segunda encuentra un estado
    terminal y la maquina de estados la frena. No puede quedar una comision
    ejecutada Y rechazada.
    """
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=500_000,
    )

    def competir(index: int) -> None:
        with transaction() as session:
            if index % 2 == 0:
                commissions_service.approve_commission(
                    session, commission_id=commission, approved_by=f"ops-{index}"
                )
            else:
                commissions_service.reject_commission(
                    session,
                    commission_id=commission,
                    rejected_by=f"ops-{index}",
                    reason="duplicada",
                )

    resultados = run_concurrently(competir, times=8)

    assert unexpected(resultados, InvalidTransition) == []
    assert commission_status(commission) in ("EXECUTED", "REJECTED")
    assert_system_is_balanced()


# --------------------------------------------------------------------------
# Extremo a extremo por HTTP
# --------------------------------------------------------------------------


def test_flujo_completo_por_http(client):
    """El recorrido del reto: cuentas -> inmueble -> comision -> aprobacion -> split."""
    a = client.post("/accounts", json={"name": "Broker A"}).json()
    b = client.post("/accounts", json={"name": "Broker B"}).json()

    # A cobro la comision bruta afuera y la ingresa al sistema.
    client.post(
        "/deposits",
        json={"account_id": a["id"], "amount": 1_000_000, "reference": "venta #7"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )

    listing = client.post(
        "/listings",
        json={
            "address": "Cra 7 # 71-21",
            "listing_broker_account_id": a["id"],
            "listing_broker_bps": 4_000,
            "selling_broker_bps": 4_000,
            "platform_bps": 2_000,
        },
    ).json()

    reportada = client.post(
        "/commissions",
        json={
            "listing_id": listing["id"],
            "reported_by_account_id": a["id"],
            "selling_broker_account_id": b["id"],
            "gross_amount": 1_000_000,
            "evidence": "contrato-7.pdf",
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert reportada.status_code == 201
    assert reportada.json()["status"] == "PENDING"
    commission_id = reportada.json()["id"]

    aprobada = client.post(
        f"/commissions/{commission_id}/approve",
        json={"approved_by": "ops@habi.co"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert aprobada.status_code == 200
    cuerpo = aprobada.json()
    assert cuerpo["status"] == "EXECUTED"
    assert cuerpo["listing_broker_share"] == 400_000
    assert cuerpo["selling_broker_share"] == 400_000
    assert cuerpo["platform_share"] == 200_000
    assert cuerpo["approved_by"] == "ops@habi.co"

    assert client.get(f"/accounts/{a['id']}/balance").json()["balance"] == 400_000
    assert client.get(f"/accounts/{b['id']}/balance").json()["balance"] == 400_000

    salud = client.get("/ledger/reconciliation").json()
    assert salud["is_balanced"] is True


def test_reintentar_el_approve_con_la_misma_key_no_paga_dos_veces(
    client, make_broker, make_listing, report_commission, balance_of
):
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )

    key = str(uuid.uuid4())
    body = {"approved_by": "ops@habi.co"}
    url = f"/commissions/{commission}/approve"

    primera = client.post(url, json=body, headers={"Idempotency-Key": key})
    segunda = client.post(url, json=body, headers={"Idempotency-Key": key})

    assert primera.status_code == 200
    assert segunda.json() == primera.json()

    assert balance_of(b) == 400_000
    assert balance_of(PLATFORM_ACCOUNT_ID) == 200_000
    assert_system_is_balanced()


def test_aprobar_de_nuevo_con_OTRA_key_tampoco_paga_dos_veces(
    client, make_broker, make_listing, report_commission, balance_of
):
    """Las dos capas trabajando juntas.

    Con una key distinta, el Idempotency-Key no puede ayudar: para el, es un
    request nuevo. Lo que frena el doble pago es el chequeo de estado bajo el lock
    de la fila. Por eso hacen falta las dos.
    """
    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )
    url = f"/commissions/{commission}/approve"

    client.post(url, json={"approved_by": "ops-1"}, headers={"Idempotency-Key": str(uuid.uuid4())})
    segunda = client.post(
        url, json={"approved_by": "ops-2"}, headers={"Idempotency-Key": str(uuid.uuid4())}
    )

    assert segunda.status_code == 200
    assert segunda.json()["status"] == "EXECUTED"
    assert segunda.json()["approved_by"] == "ops-1"  # gano el primero

    assert balance_of(b) == 400_000
    assert balance_of(PLATFORM_ACCOUNT_ID) == 200_000
    assert_system_is_balanced()


def test_saldo_insuficiente_por_http_devuelve_409_y_deja_pendiente(
    client, make_broker, make_listing, report_commission, commission_status
):
    a = make_broker(balance=100)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )

    respuesta = client.post(
        f"/commissions/{commission}/approve",
        json={"approved_by": "ops@habi.co"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )

    assert respuesta.status_code == 409
    assert respuesta.json()["error"] == "insufficient_funds"
    assert commission_status(commission) == "PENDING"
    assert_system_is_balanced()
