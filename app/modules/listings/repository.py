"""Acceso a datos de `listings`. NINGUN otro modulo consulta esta tabla."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.listings.models import Listing


def insert(
    session: Session,
    *,
    address: str,
    listing_broker_account_id: uuid.UUID,
    listing_broker_bps: int,
    selling_broker_bps: int,
    platform_bps: int,
) -> Listing:
    listing = Listing(
        id=uuid.uuid4(),
        address=address,
        listing_broker_account_id=listing_broker_account_id,
        listing_broker_bps=listing_broker_bps,
        selling_broker_bps=selling_broker_bps,
        platform_bps=platform_bps,
    )
    session.add(listing)
    session.flush()
    return listing


def get(session: Session, listing_id: uuid.UUID) -> Listing | None:
    return session.get(Listing, listing_id)


def list_all(session: Session) -> list[Listing]:
    return list(session.scalars(select(Listing).order_by(Listing.created_at)))
