from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.modules.accounts.models import SETTLEABLE_COMPANION_COMMENT

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
        PgUUID(as_uuid=True), nullable=False
    )

    # Acompañante del patron de FK PARCIAL VIA COLUMNA GENERADA (ver el comentario
    # extenso en `accounts.models.Account.is_settleable`).
    #
    # Esta columna esta clavada en `true` por un CHECK y forma, junto con
    # `listing_broker_account_id`, una FK compuesta contra `accounts (id,
    # is_settleable)`. Como la cuenta externa tiene `is_settleable = false`, no
    # existe fila del otro lado que satisfaga la FK: es imposible que un inmueble
    # quede captado por la cuenta externa, venga la escritura de donde venga.
    listing_broker_is_settleable: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
        comment=SETTLEABLE_COMPANION_COMMENT,
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
        CheckConstraint(
            "listing_broker_is_settleable",
            name="ck_listings_broker_is_settleable",
        ),
        ForeignKeyConstraint(
            ["listing_broker_account_id", "listing_broker_is_settleable"],
            ["accounts.id", "accounts.is_settleable"],
            name="fk_listings_broker_settleable",
        ),
    )
