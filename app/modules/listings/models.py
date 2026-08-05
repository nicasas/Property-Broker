from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# Los porcentajes se guardan en BASIS POINTS enteros: 10.000 bps = 100%.
# Nunca fracciones, nunca float. 33,33% es 3333 bps, un entero exacto, y no
# 0.3333 que ya viene con error de representacion desde el primer dia.
TOTAL_BPS = 10_000


class Listing(Base):
    """Un inmueble, reducido a lo unico que este sistema necesita de el:
    QUIEN lo capto y COMO se reparte la comision.

    NO es un MLS. No hay busqueda, ni fotos, ni publicacion, ni estados de venta.
    Es el portador del acuerdo de split, nada mas.
    """

    __tablename__ = "listings"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Identificador legible del inmueble. Texto libre: no se busca por el.
    address: Mapped[str] = mapped_column(String(200), nullable=False)

    # El broker que publico el inmueble.
    listing_broker_account_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )

    listing_broker_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    selling_broker_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    platform_bps: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # El acuerdo tiene que repartir el 100%, ni mas ni menos. Es lo que hace
        # que la plataforma pueda absorber el residuo sin quedar en negativo:
        # ver `commissions.service.compute_shares`.
        CheckConstraint(
            "listing_broker_bps + selling_broker_bps + platform_bps = 10000",
            name="ck_listings_bps_sum_to_total",
        ),
        CheckConstraint(
            "listing_broker_bps >= 0 AND selling_broker_bps >= 0 AND platform_bps >= 0",
            name="ck_listings_bps_non_negative",
        ),
    )
