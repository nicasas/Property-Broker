"""Las defensas de la base de datos, probadas SALTANDOSE la aplicacion.

Los demas tests verifican que la logica de negocio se comporta. Estos verifican
que si la logica de negocio estuviera rota, la base de datos igual no dejaria
pasar el dano. Por eso van en SQL crudo: si pasaran por los services, estarian
midiendo la capa equivocada.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.database import transaction
from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID, PLATFORM_ACCOUNT_ID
from app.modules.ledger import repository as ledger_repository
from app.tests.conftest import assert_system_is_balanced


def test_la_base_rechaza_fisicamente_un_saldo_negativo(make_broker, balance_of):
    """ULTIMA LINEA DE DEFENSA: el CHECK, con la app fuera del camino.

    Un UPDATE directo, sin pasar por `accounts.service`. Si un bug, una migracion
    futura o un script a mano intentara dejar un broker en negativo, Postgres
    revienta la transaccion.
    """
    broker = make_broker(balance=1_000)

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(
                text("UPDATE accounts SET balance = -1 WHERE id = :id"),
                {"id": broker},
            )

    assert "ck_accounts_balance_non_negative" in str(exc.value)
    assert balance_of(broker) == 1_000


def test_la_plataforma_tampoco_puede_ir_a_negativo():
    """El CHECK cubre a la plataforma igual que a los brokers."""
    with pytest.raises(IntegrityError):
        with transaction() as session:
            session.execute(
                text("UPDATE accounts SET balance = -1 WHERE id = :id"),
                {"id": PLATFORM_ACCOUNT_ID},
            )


def test_la_cuenta_externa_si_puede_ir_a_negativo(balance_of):
    """La excepcion al CHECK, y es intencional.

    La cuenta externa representa el dinero que ENTRO desde afuera. Su saldo es
    negativo por construccion, y ese negativo es la medida del dinero vivo dentro
    del sistema. Si tuviera CHECK (>= 0), ningun deposito seria posible.
    """
    with transaction() as session:
        session.execute(
            text("UPDATE accounts SET balance = -999 WHERE id = :id"),
            {"id": EXTERNAL_ACCOUNT_ID},
        )

    assert balance_of(EXTERNAL_ACCOUNT_ID) == -999


def test_no_puede_existir_una_segunda_cuenta_externa():
    """Dos cuentas externas serian dos verdades sobre cuanta plata entro."""
    with pytest.raises(IntegrityError):
        with transaction() as session:
            session.execute(
                text(
                    "INSERT INTO accounts (id, name, account_type, balance) "
                    "VALUES (gen_random_uuid(), 'Otro mundo', 'EXTERNAL', 0)"
                )
            )


def test_el_ledger_no_se_puede_actualizar(make_broker):
    """APPEND-ONLY, garantizado por trigger y no por buena voluntad.

    Poder editar un asiento es poder reescribir la historia del dinero. El trigger
    lo bloquea venga de donde venga: la app, una migracion o un psql a mano.
    """
    make_broker(balance=1_000)

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(text("UPDATE ledger_entries SET amount = 999999"))

    assert "append-only" in str(exc.value)


def test_el_ledger_no_se_puede_borrar(make_broker):
    make_broker(balance=1_000)

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(text("DELETE FROM ledger_entries"))

    assert "append-only" in str(exc.value)


def test_un_asiento_de_monto_cero_se_rechaza(make_broker):
    broker = make_broker()

    with pytest.raises(IntegrityError) as exc:
        with transaction() as session:
            session.execute(
                text(
                    "INSERT INTO ledger_entries "
                    "(id, movement_id, account_id, amount, balance_after, operation_type) "
                    "VALUES (gen_random_uuid(), gen_random_uuid(), :id, 0, 0, 'TRANSFER')"
                ),
                {"id": broker},
            )

    assert "ck_ledger_amount_not_zero" in str(exc.value)


# --------------------------------------------------------------------------
# El invariante de partida doble
# --------------------------------------------------------------------------


def test_el_ledger_completo_suma_cero_despues_de_operar(make_broker, balance_of):
    """SUM(amount) == 0 sobre TODA la tabla.

    Es la afirmacion mas fuerte que hace el sistema: no creo ni destruyo un peso.
    Un numero distinto de cero significa plata inventada o desaparecida, sin
    importar que los saldos individuales se vean razonables.
    """
    from app.modules.ledger import service as ledger_service

    a = make_broker(balance=777_777)
    b = make_broker(balance=123_456)

    with transaction() as session:
        ledger_service.transfer(session, from_account_id=a, to_account_id=b, amount=77)
        ledger_service.transfer(session, from_account_id=b, to_account_id=a, amount=13)
        ledger_service.deposit(
            session,
            account_id=b,
            amount=1,
            external_account_id=EXTERNAL_ACCOUNT_ID,
        )

    with transaction() as session:
        assert ledger_repository.sum_all(session) == 0

    # Lo que entro desde afuera es exactamente lo que hay adentro.
    assert -balance_of(EXTERNAL_ACCOUNT_ID) == balance_of(a) + balance_of(b)
    assert_system_is_balanced()


def test_la_reconciliacion_detecta_una_desincronizacion_forzada(make_broker):
    """El detector tiene que detectar. Control positivo.

    Se corrompe a mano el saldo materializado (imposible por los caminos normales)
    para probar que `reconcile_all` no devuelve "todo bien" pase lo que pase.
    """
    from app.modules.ledger import service as ledger_service

    broker = make_broker(balance=50_000)

    with transaction() as session:
        session.execute(
            text("UPDATE accounts SET balance = balance + 1 WHERE id = :id"),
            {"id": broker},
        )

    with transaction() as session:
        reporte = ledger_service.reconcile_all(session)

    assert reporte.is_balanced is False
    assert [m.account_id for m in reporte.mismatches] == [broker]
    assert reporte.mismatches[0].materialized_balance == 50_001
    assert reporte.mismatches[0].ledger_balance == 50_000
    # El ledger sigue cuadrado: la mentira esta en la columna materializada,
    # y la reconciliacion sabe distinguir las dos cosas.
    assert reporte.ledger_total == 0

    # Se deshace para no ensuciar la verificacion final de la corrida.
    with transaction() as session:
        session.execute(
            text("UPDATE accounts SET balance = balance - 1 WHERE id = :id"),
            {"id": broker},
        )
