"""Infraestructura de tests.

Los tests corren contra POSTGRES REAL (servicio `postgres-test`, base separada).
No es una preferencia: SQLite no implementa `SELECT ... FOR UPDATE`, lo acepta y
lo ignora. Un test de concurrencia contra SQLite pasa siempre — y pasaria igual
si el locking estuviera roto. Seria un falso verde sobre justo lo que este
sistema tiene que garantizar.
"""

from __future__ import annotations

import os
import threading
import uuid
from collections.abc import Callable, Iterator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

import app.core.database as database
from app.core.config import settings

# --------------------------------------------------------------------------
# Engine de tests: reemplaza el de la app ANTES de que nadie abra una sesion.
# --------------------------------------------------------------------------

_test_engine = create_engine(
    settings.test_database_url,
    pool_pre_ping=True,
    # Los tests de concurrencia levantan decenas de threads y cada uno pide su
    # propia conexion. Con el pool por defecto (5 + 10) se quedarian esperando
    # una conexion libre en vez de competir por el lock de fila, que es lo que
    # queremos medir.
    pool_size=40,
    max_overflow=20,
)

database.engine = _test_engine
database.SessionLocal.configure(bind=_test_engine)


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    """Esquema limpio + migraciones de Alembic, una vez por corrida.

    Se aplican las MIGRACIONES, no `Base.metadata.create_all`. Es deliberado:
    el trigger append-only del ledger y el sembrado de las cuentas de sistema
    solo existen en la migracion. Con `create_all` los tests correrian contra
    un esquema que no es el que llega a produccion.
    """
    with _test_engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    os.environ["DATABASE_URL"] = settings.test_database_url
    config = Config("alembic.ini")
    command.upgrade(config, "head")

    yield

    _test_engine.dispose()


@pytest.fixture(autouse=True)
def _clean_state() -> Iterator[None]:
    """Cada test arranca con el ledger vacio y las cuentas de sistema en cero."""
    yield
    with _test_engine.begin() as conn:
        # TRUNCATE no dispara triggers FOR EACH ROW, asi que el guardia
        # append-only no estorba aqui.
        conn.execute(
            text(
                "TRUNCATE ledger_entries, idempotency_keys, commissions, listings"
            )
        )
        conn.execute(text("DELETE FROM accounts WHERE account_type = 'BROKER'"))
        conn.execute(text("UPDATE accounts SET balance = 0"))


# --------------------------------------------------------------------------
# Helpers de dominio
# --------------------------------------------------------------------------


@pytest.fixture
def make_broker() -> Callable[..., uuid.UUID]:
    """Crea un broker y opcionalmente le carga saldo. Devuelve el id.

    Devuelve el UUID y no el objeto ORM a proposito: los tests de concurrencia
    cruzan threads, y un objeto atado a una sesion de otro thread es una bomba.
    """
    from app.modules.accounts import service as accounts_service
    from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID
    from app.modules.ledger import service as ledger_service

    counter = 0

    def _make(balance: int = 0, name: str | None = None) -> uuid.UUID:
        nonlocal counter
        counter += 1

        with database.transaction() as session:
            account = accounts_service.create_account(
                session, name=name or f"Broker {counter}"
            )
            account_id = account.id

        if balance:
            with database.transaction() as session:
                ledger_service.deposit(
                    session,
                    account_id=account_id,
                    amount=balance,
                    external_account_id=EXTERNAL_ACCOUNT_ID,
                )

        return account_id

    return _make


@pytest.fixture
def make_listing() -> Callable[..., uuid.UUID]:
    """Crea un inmueble con su acuerdo de reparto en basis points. Devuelve el id."""
    from app.modules.listings import service as listings_service

    counter = 0

    def _make(
        *,
        listing_broker_account_id: uuid.UUID,
        listing_bps: int = 4_000,
        selling_bps: int = 4_000,
        platform_bps: int = 2_000,
    ) -> uuid.UUID:
        nonlocal counter
        counter += 1

        with database.transaction() as session:
            listing = listings_service.create_listing(
                session,
                address=f"Calle {counter} # {counter}-{counter}",
                listing_broker_account_id=listing_broker_account_id,
                listing_broker_bps=listing_bps,
                selling_broker_bps=selling_bps,
                platform_bps=platform_bps,
            )
            return listing.id

    return _make


@pytest.fixture
def report_commission() -> Callable[..., uuid.UUID]:
    """Reporta una comision PENDIENTE. Devuelve el id."""
    from app.modules.commissions import service as commissions_service

    def _report(
        *,
        listing_id: uuid.UUID,
        reported_by_account_id: uuid.UUID,
        selling_broker_account_id: uuid.UUID,
        gross_amount: int,
        evidence: str = "contrato-123.pdf",
    ) -> uuid.UUID:
        with database.transaction() as session:
            commission = commissions_service.report_commission(
                session,
                listing_id=listing_id,
                reported_by_account_id=reported_by_account_id,
                selling_broker_account_id=selling_broker_account_id,
                gross_amount=gross_amount,
                evidence=evidence,
            )
            return commission.id

    return _report


@pytest.fixture
def commission_status() -> Callable[[uuid.UUID], str]:
    from app.modules.commissions import service as commissions_service

    def _status(commission_id: uuid.UUID) -> str:
        with database.transaction() as session:
            return commissions_service.get_commission(session, commission_id).status

    return _status


@pytest.fixture
def balance_of() -> Callable[[uuid.UUID], int]:
    from app.modules.accounts import service as accounts_service

    def _balance(account_id: uuid.UUID) -> int:
        with database.transaction() as session:
            return accounts_service.get_balance(session, account_id)

    return _balance


# --------------------------------------------------------------------------
# Motor de concurrencia
# --------------------------------------------------------------------------


def run_concurrently(
    worker: Callable[[int], None], *, times: int, timeout: float = 30.0
) -> list[BaseException | None]:
    """Corre `worker` en `times` threads que arrancan TODOS en el mismo instante.

    La barrera es lo que hace real al test: sin ella los threads se lanzan
    escalonados, cada uno alcanza a terminar antes de que arranque el siguiente,
    y el test pasa sin que jamas haya existido contencion.

    Devuelve una lista alineada con el indice del thread: `None` si el worker
    termino bien, la excepcion si fallo. Las excepciones se capturan en vez de
    propagarse porque en estos tests FALLAR es un resultado esperado y contable
    (p. ej. exactamente un ganador y N-1 rechazos por saldo insuficiente).

    IMPORTANTE: el worker debe abrir su PROPIA sesion (via `transaction()`).
    Las sesiones de SQLAlchemy no son thread-safe; compartir una entre threads
    invalidaria el test y probablemente lo pintaria de verde.
    """
    barrier = threading.Barrier(times, timeout=timeout)
    results: list[BaseException | None] = [None] * times

    def _run(index: int) -> None:
        try:
            barrier.wait()
        except threading.BrokenBarrierError as exc:  # pragma: no cover
            results[index] = exc
            return
        try:
            worker(index)
        except BaseException as exc:  # noqa: BLE001 - contabilizar, no propagar
            results[index] = exc

    threads = [
        threading.Thread(target=_run, args=(i,), name=f"worker-{i}")
        for i in range(times)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=timeout)

    assert not any(t.is_alive() for t in threads), (
        "Algun thread quedo colgado: probablemente un deadlock o un lock nunca liberado"
    )
    return results


def successes(results: list[BaseException | None]) -> int:
    return sum(1 for r in results if r is None)


def failures(
    results: list[BaseException | None], exc_type: type[BaseException]
) -> int:
    return sum(1 for r in results if isinstance(r, exc_type))


def unexpected(
    results: list[BaseException | None], *allowed: type[BaseException]
) -> list[BaseException]:
    """Excepciones que no estaban en el guion. Cualquiera aqui es un bug."""
    return [r for r in results if r is not None and not isinstance(r, allowed)]


def assert_system_is_balanced() -> None:
    """La verificacion que cierra TODO test que mueva plata.

    Dos cosas a la vez:
      1. SUM(ledger.amount) == 0  -> el sistema no creo ni destruyo un peso
      2. cada saldo materializado == la suma de su propio ledger

    Un test de concurrencia que solo mira el saldo final puede pasar con un
    ledger corrupto. Este cierre es el que no deja pasar eso.
    """
    from app.modules.ledger import service as ledger_service

    with database.transaction() as session:
        report = ledger_service.reconcile_all(session)

    assert report.ledger_total == 0, (
        f"Partida doble rota: el ledger suma {report.ledger_total}, deberia sumar 0. "
        "Hay plata inventada o desaparecida."
    )
    assert not report.mismatches, (
        "El saldo materializado se desincronizo del ledger: "
        + ", ".join(
            f"{m.account_id}: saldo={m.materialized_balance} ledger={m.ledger_balance}"
            for m in report.mismatches
        )
    )
