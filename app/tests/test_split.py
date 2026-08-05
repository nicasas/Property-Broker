"""El reparto: que cuadre al centavo, siempre, incluso cuando no divide exacto.

Dos partes:
  1. la aritmetica pura (`compute_shares`, `build_split_legs`) — sin BD, sin plata
  2. el split ejecutandose de verdad contra el ledger
"""

from __future__ import annotations

import uuid

import pytest

from app.core.database import transaction
from app.core.errors import InsufficientFunds, InvariantViolation
from app.modules.accounts.constants import PLATFORM_ACCOUNT_ID
from app.modules.commissions import service as commissions_service
from app.modules.ledger import repository as ledger_repository
from app.modules.commissions.service import Shares, build_split_legs, compute_shares
from app.tests.conftest import assert_system_is_balanced

# --------------------------------------------------------------------------
# 1. Aritmetica del reparto
# --------------------------------------------------------------------------


def test_reparto_que_divide_exacto():
    shares = compute_shares(
        gross_amount=1_000_000, listing_broker_bps=4_000, selling_broker_bps=4_000
    )
    assert shares == Shares(
        listing_broker=400_000, selling_broker=400_000, platform=200_000
    )
    assert shares.total == 1_000_000


def test_el_residuo_se_lo_queda_la_plataforma():
    """10.001 en tres tercios. 10.001 / 3 no es entero: hay residuo si o si.

    3.333 + 3.333 dejan 3.335 para la plataforma. Los 2 centavos que "sobran" no
    se pierden ni se inventan: la plataforma los absorbe por construccion, porque
    su parte no se calcula sino que es lo que queda.
    """
    shares = compute_shares(
        gross_amount=10_001, listing_broker_bps=3_333, selling_broker_bps=3_333
    )

    assert shares.listing_broker == 3_333
    assert shares.selling_broker == 3_333
    assert shares.platform == 3_335
    assert shares.total == 10_001


def test_un_centavo_no_se_puede_partir_en_tres():
    """El caso limite: 1 centavo repartido en tercios.

    Los brokers reciben cero (division entera hacia abajo) y la plataforma se
    queda con el centavo entero. Feo, pero EXACTO — que es lo unico que importa.
    Un reparto con float aqui produciria 0.33 tres veces y perderia un centavo.
    """
    shares = compute_shares(
        gross_amount=1, listing_broker_bps=3_333, selling_broker_bps=3_333
    )

    assert shares == Shares(listing_broker=0, selling_broker=0, platform=1)
    assert shares.total == 1


@pytest.mark.parametrize(
    "gross",
    [1, 2, 3, 7, 99, 100, 101, 9_999, 10_000, 10_001, 123_457, 999_999_999],
)
@pytest.mark.parametrize(
    ("listing_bps", "selling_bps"),
    [
        (3_333, 3_333),  # tercios: el peor caso de residuo
        (5_000, 5_000),  # mitades, plataforma en 0%
        (4_500, 4_500),
        (1, 1),  # la plataforma se queda con casi todo
        (0, 0),  # la plataforma se queda con todo
        (9_999, 1),  # reparto extremo
        (7_000, 2_500),
    ],
)
def test_el_reparto_siempre_suma_el_bruto_exacto(gross, listing_bps, selling_bps):
    """Barrido: 84 combinaciones de monto y acuerdo.

    La afirmacion es una sola y no admite excepciones: sumar las tres partes tiene
    que dar el bruto, al centavo, y ninguna parte puede ser negativa. Si esto se
    cumple, el split no puede crear ni destruir plata pase lo que pase.
    """
    shares = compute_shares(
        gross_amount=gross,
        listing_broker_bps=listing_bps,
        selling_broker_bps=selling_bps,
    )

    assert shares.total == gross
    assert shares.listing_broker >= 0
    assert shares.selling_broker >= 0
    assert shares.platform >= 0


def test_el_reparto_nunca_usa_float():
    """Control explicito: los tres montos son int, no float.

    Un `int` que se convierte en `float` en algun punto intermedio es como entra
    el error de redondeo. `isinstance(True, int)` es cierto en Python, pero aqui
    no hay booleanos; lo que se descarta es `float`.
    """
    shares = compute_shares(
        gross_amount=10_001, listing_broker_bps=3_333, selling_broker_bps=3_333
    )
    for value in (shares.listing_broker, shares.selling_broker, shares.platform):
        assert isinstance(value, int)
        assert not isinstance(value, float)


# --------------------------------------------------------------------------
# 2. Construccion de patas POR NETO
# --------------------------------------------------------------------------


def _ids(n: int) -> list[uuid.UUID]:
    """UUIDs deterministas y ordenados, para que los tests sean legibles."""
    return [uuid.UUID(int=i + 1_000) for i in range(n)]


def test_tres_partes_distintas_producen_tres_patas():
    reportante, selling = _ids(2)
    plataforma = PLATFORM_ACCOUNT_ID
    shares = Shares(listing_broker=400_000, selling_broker=400_000, platform=200_000)

    legs = build_split_legs(
        gross_amount=1_000_000,
        reported_by_account_id=reportante,
        listing_broker_account_id=reportante,  # el reportante capto el inmueble
        selling_broker_account_id=selling,
        platform_account_id=plataforma,
        shares=shares,
    )

    deltas = {leg.account_id: leg.amount for leg in legs}
    # El reportante entrega el bruto y recibe su parte: su neto es lo que paga
    # hacia afuera. Sin ningun `if`.
    assert deltas[reportante] == -600_000
    assert deltas[selling] == 400_000
    assert deltas[plataforma] == 200_000
    assert sum(deltas.values()) == 0


def test_si_el_listing_y_el_selling_broker_son_el_mismo_las_patas_se_fusionan():
    """Un broker que capta Y vende cobra las dos partes en UNA sola pata.

    Con patas por rol esto seria una cuenta repetida en el movimiento, que
    `post_movement` rechaza. Por neto, ni se nota.
    """
    reportante, ambos_roles = _ids(2)
    shares = Shares(listing_broker=400_000, selling_broker=400_000, platform=200_000)

    legs = build_split_legs(
        gross_amount=1_000_000,
        reported_by_account_id=reportante,
        listing_broker_account_id=ambos_roles,
        selling_broker_account_id=ambos_roles,
        platform_account_id=PLATFORM_ACCOUNT_ID,
        shares=shares,
    )

    assert len(legs) == 3
    deltas = {leg.account_id: leg.amount for leg in legs}
    assert deltas[ambos_roles] == 800_000  # 400.000 + 400.000, fusionadas
    assert deltas[reportante] == -1_000_000
    assert sum(deltas.values()) == 0


def test_una_parte_en_cero_no_genera_pata():
    """Plataforma al 0%: su pata simplemente no existe.

    `post_movement` rechaza patas de monto cero, y con razon: un asiento de cero
    no es un hecho contable. Filtrar aqui es lo que evita tener que exceptuarlo alla.
    """
    reportante, selling = _ids(2)
    shares = Shares(listing_broker=500_000, selling_broker=500_000, platform=0)

    legs = build_split_legs(
        gross_amount=1_000_000,
        reported_by_account_id=reportante,
        listing_broker_account_id=reportante,
        selling_broker_account_id=selling,
        platform_account_id=PLATFORM_ACCOUNT_ID,
        shares=shares,
    )

    assert len(legs) == 2
    assert PLATFORM_ACCOUNT_ID not in {leg.account_id for leg in legs}
    assert sum(leg.amount for leg in legs) == 0


def test_cuando_todo_se_resuelve_en_una_cuenta_no_hay_patas():
    """Caso degenerado: el reportante es listing Y selling, y la plataforma cobra 0%.

    Toda la comision se queda donde ya estaba. No hay plata que mover, asi que no
    hay movimiento: forzar un asiento seria escribir ruido en el ledger.
    """
    solo = _ids(1)[0]
    shares = Shares(listing_broker=500_000, selling_broker=500_000, platform=0)

    legs = build_split_legs(
        gross_amount=1_000_000,
        reported_by_account_id=solo,
        listing_broker_account_id=solo,
        selling_broker_account_id=solo,
        platform_account_id=PLATFORM_ACCOUNT_ID,
        shares=shares,
    )

    assert legs == []


# --------------------------------------------------------------------------
# 3. El split ejecutandose de verdad
# --------------------------------------------------------------------------


def test_split_completo_mueve_la_plata_exacta(
    make_broker, make_listing, report_commission, balance_of
):
    """De punta a punta: A cobro 1.000.000, se reparte 40/40/20."""
    a = make_broker(balance=1_000_000)  # capto el inmueble y cobro la comision
    b = make_broker()  # trajo al cliente

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

    with transaction() as session:
        result = commissions_service.approve_commission(
            session, commission_id=commission, approved_by="ops@habi.co"
        )
        assert result.status == "EXECUTED"
        assert result.listing_broker_share == 400_000
        assert result.selling_broker_share == 400_000
        assert result.platform_share == 200_000

    # A conserva su 40% y paga el 60% restante desde su propio saldo.
    assert balance_of(a) == 400_000
    assert balance_of(b) == 400_000
    assert balance_of(PLATFORM_ACCOUNT_ID) == 200_000
    assert_system_is_balanced()


def test_split_con_residuo_de_punta_a_punta(
    make_broker, make_listing, report_commission, balance_of
):
    """El residuo tambien tiene que cuadrar cuando la plata se mueve de verdad.

    10.001 en tercios: lo que salga de la cuenta de A tiene que entrar completo en
    las otras dos. Este es el test que atrapa un redondeo que "casi" cuadra.
    """
    a = make_broker(balance=10_001)
    b = make_broker()

    listing = make_listing(
        listing_broker_account_id=a,
        listing_bps=3_333,
        selling_bps=3_333,
        platform_bps=3_334,
    )
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=10_001,
    )

    with transaction() as session:
        commissions_service.approve_commission(
            session, commission_id=commission, approved_by="ops@habi.co"
        )

    assert balance_of(a) == 3_333  # conserva su parte
    assert balance_of(b) == 3_333
    assert balance_of(PLATFORM_ACCOUNT_ID) == 3_335  # +2 centavos de residuo

    # Lo que salio de A entro completo en las otras dos cuentas.
    assert balance_of(a) + balance_of(b) + balance_of(PLATFORM_ACCOUNT_ID) == 10_001
    assert_system_is_balanced()


def test_el_split_es_un_solo_movimiento_en_el_ledger(
    make_broker, make_listing, report_commission
):
    """Las tres patas comparten movement_id y suman cero entre si.

    No son tres transferencias sueltas que casualmente ocurrieron juntas: son un
    unico hecho contable, y el ledger lo refleja.
    """
    from app.modules.ledger import repository as ledger_repository
    from app.modules.ledger.models import OperationType

    a = make_broker(balance=1_000_000)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )

    with transaction() as session:
        result = commissions_service.approve_commission(
            session, commission_id=commission, approved_by="ops@habi.co"
        )
        movement_id = result.movement_id

    with transaction() as session:
        entries = ledger_repository.list_by_movement(session, movement_id)

    assert len(entries) == 3
    assert sum(e.amount for e in entries) == 0
    assert all(e.operation_type == OperationType.COMMISSION_SPLIT for e in entries)
    # La referencia amarra el asiento con el hecho de negocio que lo origino.
    assert all(e.reference == str(commission) for e in entries)


def test_saldo_insuficiente_al_aprobar_no_deja_nada_a_medias(
    make_broker, make_listing, report_commission, balance_of, commission_status
):
    """EL ROLLBACK. A reporto una comision mayor a su saldo.

    El split debita a A y acredita a plataforma y a B. Si el debito de A falla
    despues de haber acreditado a alguno, quedaria plata creada de la nada. La
    transaccion entera se deshace: ni un centavo se movio, la comision sigue
    PENDING y se puede reintentar cuando A tenga saldo.

    Ojo con el orden: las patas se bloquean por account_id ascendente, asi que la
    de A puede procesarse DESPUES de haber acreditado a otra cuenta. Que el
    resultado sea limpio no es suerte, es la atomicidad de la transaccion.
    """
    a = make_broker(balance=100)  # le falta muchisimo
    b = make_broker()

    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )

    with pytest.raises(InsufficientFunds):
        with transaction() as session:
            commissions_service.approve_commission(
                session, commission_id=commission, approved_by="ops@habi.co"
            )

    # Nada se filtro.
    assert balance_of(a) == 100
    assert balance_of(b) == 0
    assert balance_of(PLATFORM_ACCOUNT_ID) == 0

    # La comision quedo intacta y reintentable. No hay estado FAILED.
    assert commission_status(commission) == "PENDING"

    with transaction() as session:
        assert commissions_service.get_commission(session, commission).movement_id is None
        assert commissions_service.get_commission(session, commission).approved_at is None

    assert_system_is_balanced()


def test_una_invariante_rota_produce_un_rollback_limpio(
    make_broker, make_listing, report_commission, balance_of, commission_status,
    monkeypatch,
):
    """`InvariantViolation` tiene que comportarse como cualquier otro fallo: sin efectos parciales.

    Las invariantes del reparto son excepciones y no `assert` justamente para que
    existan en produccion. Pero una excepcion que se levanta a mitad de camino solo
    sirve si la transaccion se deshace entera; si dejara medio split aplicado seria
    peor que no comprobar nada.

    Se corrompe `compute_shares` para que devuelva un reparto imposible (todo en
    cero). `build_split_legs` lo detecta —quedaria una sola pata, o sea deltas que
    no suman cero— y aborta ANTES de tocar el ledger.
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

    monkeypatch.setattr(
        commissions_service,
        "compute_shares",
        lambda **_: Shares(listing_broker=0, selling_broker=0, platform=0),
    )

    with pytest.raises(InvariantViolation):
        with transaction() as session:
            commissions_service.approve_commission(
                session, commission_id=commission, approved_by="ops@habi.co"
            )

    # Ni un peso se movio.
    assert balance_of(a) == 1_000_000
    assert balance_of(b) == 0
    assert balance_of(PLATFORM_ACCOUNT_ID) == 0

    # La comision quedo intacta: nada de EXECUTED a medias.
    assert commission_status(commission) == "PENDING"
    with transaction() as session:
        intacta = commissions_service.get_commission(session, commission)
        assert intacta.movement_id is None
        assert intacta.listing_broker_share is None
        assert intacta.approved_at is None

    # Y no quedo ningun asiento de split huerfano en el ledger.
    from app.modules.ledger.models import OperationType

    with transaction() as session:
        asientos = ledger_repository.list_by_account(session, a, limit=100)
    assert not any(
        e.operation_type == OperationType.COMMISSION_SPLIT for e in asientos
    )

    assert_system_is_balanced()


def test_la_invariante_del_reparto_no_depende_de_assert():
    """Control directo: entrada que viola la invariante -> excepcion de verdad.

    `build_split_legs` con un reparto que no suma el bruto deja una sola pata, lo
    que implica deltas que no cierran en cero. Es un bug, no un error del cliente,
    y por eso corta la operacion en vez de dejarla pasar.

    Si esto fuera un `assert`, bajo `python -O` la comprobacion no existiria y el
    movimiento seguiria hasta `post_movement`.
    """
    reportante, selling = _ids(2)

    with pytest.raises(InvariantViolation, match="una sola pata"):
        build_split_legs(
            gross_amount=1_000_000,
            reported_by_account_id=reportante,
            listing_broker_account_id=reportante,
            selling_broker_account_id=selling,
            platform_account_id=PLATFORM_ACCOUNT_ID,
            shares=Shares(listing_broker=0, selling_broker=0, platform=0),
        )


def test_reintento_despues_de_un_approve_fallido_si_ejecuta(
    make_broker, make_listing, report_commission, balance_of, commission_status
):
    """La idempotencia protege exitos, no fracasos.

    Como la fila de Idempotency-Key vive en la MISMA transaccion que el
    movimiento, un approve que revienta por saldo se lleva la key con el. Cuando
    llega la plata, el mismo request se ejecuta de verdad.
    """
    a = make_broker(balance=100)
    b = make_broker()
    listing = make_listing(listing_broker_account_id=a)
    commission = report_commission(
        listing_id=listing,
        reported_by_account_id=a,
        selling_broker_account_id=b,
        gross_amount=1_000_000,
    )

    with pytest.raises(InsufficientFunds):
        with transaction() as session:
            commissions_service.approve_commission(
                session, commission_id=commission, approved_by="ops@habi.co"
            )

    # Entra la plata que faltaba.
    from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID
    from app.modules.ledger import service as ledger_service

    with transaction() as session:
        ledger_service.deposit(
            session,
            account_id=a,
            amount=999_900,
            external_account_id=EXTERNAL_ACCOUNT_ID,
        )

    with transaction() as session:
        commissions_service.approve_commission(
            session, commission_id=commission, approved_by="ops@habi.co"
        )

    assert commission_status(commission) == "EXECUTED"
    assert balance_of(b) == 400_000
    assert balance_of(PLATFORM_ACCOUNT_ID) == 200_000
    assert_system_is_balanced()
