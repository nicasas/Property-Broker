"""Reglas de negocio de listings.

Como todo service del sistema: recibe `session`, no abre transaccion, no comitea.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.errors import InvalidSplitConfiguration, ListingNotFound
from app.modules.accounts import service as accounts_service
from app.modules.listings import repository
from app.modules.listings.models import TOTAL_BPS, Listing


def create_listing(
    session: Session,
    *,
    address: str,
    listing_broker_account_id: uuid.UUID,
    listing_broker_bps: int,
    selling_broker_bps: int,
    platform_bps: int,
) -> Listing:
    # La cuenta del broker que capta tiene que existir y ser operable. Se pregunta
    # al service de accounts, no a su tabla: la frontera entre modulos se respeta
    # tambien para leer.
    accounts_service.require_settleable_account(session, listing_broker_account_id)

    _validate_split(listing_broker_bps, selling_broker_bps, platform_bps)

    return repository.insert(
        session,
        address=address,
        listing_broker_account_id=listing_broker_account_id,
        listing_broker_bps=listing_broker_bps,
        selling_broker_bps=selling_broker_bps,
        platform_bps=platform_bps,
    )


def get_listing(session: Session, listing_id: uuid.UUID) -> Listing:
    listing = repository.get(session, listing_id)
    if listing is None:
        raise ListingNotFound("El inmueble no existe", listing_id=str(listing_id))
    return listing


def list_listings(session: Session) -> list[Listing]:
    return repository.list_all(session)


def _validate_split(listing_bps: int, selling_bps: int, platform_bps: int) -> None:
    """Duplica el CHECK de la tabla, a proposito.

    La validacion en Python da un 422 con un mensaje util; el CHECK de la BD es la
    garantia de que ningun acuerdo invalido existe, venga por donde venga.
    """
    if min(listing_bps, selling_bps, platform_bps) < 0:
        raise InvalidSplitConfiguration("Los basis points no pueden ser negativos")

    total = listing_bps + selling_bps + platform_bps
    if total != TOTAL_BPS:
        raise InvalidSplitConfiguration(
            f"El acuerdo debe repartir exactamente {TOTAL_BPS} bps (100%)",
            provided_total_bps=total,
        )
