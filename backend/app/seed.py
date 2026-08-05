"""Datos de demostracion.

    docker compose exec api python -m app.seed
    docker compose exec api python -m app.seed --reset

REGLA: siembra SOLO por las rutas de servicio (`accounts.service`,
`listings.service`, `ledger.service`), nunca con INSERT directo a las tablas.

No es preferencia de estilo. Un INSERT directo se saltaria los guards y las
validaciones que el sistema construyo —el filtro de la cuenta externa, el CHECK
de que los bps suman 10.000, la partida doble de los depositos— y podria dejar
sembrado un estado que la API jamas habria permitido crear. El estado inicial de
la demo tiene que ser un estado LEGAL, alcanzable por las puertas normales.

Por eso los saldos entran con `ledger.service.deposit`: cada peso sembrado tiene
su asiento de contrapartida y el sistema arranca cuadrado.
"""

from __future__ import annotations

import sys

from sqlalchemy import text

from app.core.database import transaction
from app.modules.accounts import service as accounts_service
from app.modules.accounts.constants import EXTERNAL_ACCOUNT_ID
from app.modules.accounts.models import AccountType
from app.modules.ledger import service as ledger_service
from app.modules.listings import service as listings_service

# Broker, saldo inicial en centavos.
BROKERS: list[tuple[str, int]] = [
    ("Ana Restrepo", 12_000_000_00),
    ("Bruno Salgado", 4_500_000_00),
    ("Camila Ortiz", 0),
    ("Daniel Mejia", 850_000_00),
]

# Inmueble, broker que capta (indice en BROKERS), bps de listing / selling / plataforma.
LISTINGS: list[tuple[str, int, int, int, int]] = [
    ("Cra 7 # 71-21, Chapinero", 0, 4_000, 4_000, 2_000),
    ("Cl 85 # 12-40, El Retiro", 0, 5_000, 3_500, 1_500),
    ("Cra 15 # 93-60, Chico", 1, 3_333, 3_333, 3_334),
    ("Cl 116 # 7-15, Santa Barbara", 1, 4_500, 4_500, 1_000),
    ("Tv 4 # 45-12, La Macarena", 3, 6_000, 3_000, 1_000),
]


def _already_seeded() -> bool:
    with transaction() as session:
        return any(
            a.account_type == AccountType.BROKER
            for a in accounts_service.list_accounts(session)
        )


def _reset() -> None:
    """Vacia los datos de demo dejando en pie las cuentas de sistema.

    Unico lugar del proyecto con SQL directo, y solo para BORRAR. `ledger_entries`
    se limpia con TRUNCATE porque el trigger append-only bloquea el DELETE: el
    trigger es `FOR EACH ROW` y TRUNCATE no lo dispara. Es una herramienta de
    demostracion, no un camino de la aplicacion.
    """
    with transaction() as session:
        session.execute(text("TRUNCATE ledger_entries, idempotency_keys, commissions, listings"))
        session.execute(text("DELETE FROM accounts WHERE account_type = 'BROKER'"))
        session.execute(text("UPDATE accounts SET balance = 0"))
    print("Datos de demo eliminados.")


def seed() -> None:
    broker_ids = []

    for name, balance in BROKERS:
        with transaction() as session:
            account = accounts_service.create_account(session, name=name)
            broker_ids.append(account.id)
        if balance:
            # Por `deposit`, no por UPDATE: el saldo entra con su contrapartida en
            # la cuenta externa y el ledger arranca sumando cero.
            with transaction() as session:
                ledger_service.deposit(
                    session,
                    account_id=broker_ids[-1],
                    amount=balance,
                    external_account_id=EXTERNAL_ACCOUNT_ID,
                    reference="saldo inicial de demostracion",
                )
        print(f"  broker  {name:<18} {balance / 100:>14,.0f}")

    for address, broker_index, listing_bps, selling_bps, platform_bps in LISTINGS:
        with transaction() as session:
            listings_service.create_listing(
                session,
                address=address,
                listing_broker_account_id=broker_ids[broker_index],
                listing_broker_bps=listing_bps,
                selling_broker_bps=selling_bps,
                platform_bps=platform_bps,
            )
        print(
            f"  inmueble {address:<30} "
            f"{listing_bps / 100:.0f}/{selling_bps / 100:.0f}/{platform_bps / 100:.0f}"
        )

    with transaction() as session:
        report = ledger_service.reconcile_all(session)
    print(f"\nSistema cuadrado: {report.is_balanced} (ledger suma {report.ledger_total})")


def main() -> None:
    if "--reset" in sys.argv:
        _reset()
    elif _already_seeded():
        print(
            "Ya hay brokers en el sistema. Usa --reset para empezar de cero:\n"
            "  docker compose exec api python -m app.seed --reset"
        )
        return

    print("Sembrando datos de demostracion...\n")
    seed()


if __name__ == "__main__":
    main()
