from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.listings import service
from app.modules.listings.schemas import CreateListingRequest, ListingResponse

router = APIRouter(prefix="/listings", tags=["listings"])


@router.post("", response_model=ListingResponse, status_code=status.HTTP_201_CREATED)
def create_listing(
    body: CreateListingRequest, db: Session = Depends(get_db)
) -> ListingResponse:
    """Registra un inmueble con su acuerdo de reparto.

    No mueve plata, asi que no exige Idempotency-Key.
    """
    listing = service.create_listing(
        db,
        address=body.address,
        listing_broker_account_id=body.listing_broker_account_id,
        listing_broker_bps=body.listing_broker_bps,
        selling_broker_bps=body.selling_broker_bps,
        platform_bps=body.platform_bps,
    )
    return ListingResponse.model_validate(listing)


@router.get("", response_model=list[ListingResponse])
def list_listings(db: Session = Depends(get_db)) -> list[ListingResponse]:
    return [ListingResponse.model_validate(x) for x in service.list_listings(db)]


@router.get("/{listing_id}", response_model=ListingResponse)
def get_listing(listing_id: uuid.UUID, db: Session = Depends(get_db)) -> ListingResponse:
    return ListingResponse.model_validate(service.get_listing(db, listing_id))
