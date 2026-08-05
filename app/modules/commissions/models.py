from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, EnumAsString
from app.modules.commissions.state_machine import CommissionStatus


class Commission(Base):
    """Una comision reportada por un broker, pendiente de aprobacion.

    SNAPSHOT DEL ACUERDO: los bps se copian del listing AL REPORTAR y viven aqui.
    No se leen del listing al aprobar.

    Es una decision de negocio, no una optimizacion. Si alguien edita el acuerdo
    de reparto de un inmueble entre el reporte y la aprobacion, la comision debe
    liquidarse con los porcentajes que estaban pactados CUANDO se reporto. Leerlos
    tarde significaria que un cambio administrativo puede mover plata que ya fue
    reportada bajo otras condiciones.

    Efecto lateral util: aprobar es deterministico y no depende del modulo listings.
    """

    __tablename__ = "commissions"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    listing_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("listings.id"), nullable=False
    )

    # El broker que cobro la comision bruta y la reporta. Es de SU saldo que sale
    # el split (modelo (a): el que tiene la plata paga hacia afuera).
    reported_by_account_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )

    # Broker que trajo al cliente.
    selling_broker_account_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )

    # Broker que publico el inmueble, copiado del listing al reportar.
    listing_broker_account_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )

    gross_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Snapshot del acuerdo (basis points enteros).
    listing_broker_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    selling_broker_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    platform_bps: Mapped[int] = mapped_column(Integer, nullable=False)

    # Evidencia del cobro (contrato, comprobante). Texto libre: el sistema no la
    # interpreta, solo la conserva junto al hecho que la origino.
    evidence: Mapped[str] = mapped_column(String(500), nullable=False)

    status: Mapped[CommissionStatus] = mapped_column(
        EnumAsString(CommissionStatus, 16),
        nullable=False,
        default=CommissionStatus.PENDING,
    )

    # Montos efectivamente liquidados. Se llenan al ejecutar y quedan como registro
    # de lo que realmente se movio, sin tener que recalcular nada despues.
    listing_broker_share: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    selling_broker_share: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    platform_share: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Movimiento del ledger que ejecuto el split. NULL mientras esta PENDING, y
    # tambien en el caso degenerado en que el split no mueve plata (ver
    # `service.approve_commission`).
    movement_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), nullable=True
    )

    # Trazabilidad de la aprobacion. Texto libre: no hay auth compleja en este reto.
    approved_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    rejected_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("gross_amount > 0", name="ck_commissions_gross_positive"),
        CheckConstraint(
            "status IN ('PENDING', 'EXECUTED', 'REJECTED')",
            name="ck_commissions_valid_status",
        ),
        CheckConstraint(
            "listing_broker_bps + selling_broker_bps + platform_bps = 10000",
            name="ck_commissions_bps_sum_to_total",
        ),
        # Una comision ejecutada tiene que tener sus tres montos liquidados. Impide
        # que exista una fila EXECUTED sin registro de que se repartio.
        CheckConstraint(
            "status <> 'EXECUTED' OR ("
            " listing_broker_share IS NOT NULL"
            " AND selling_broker_share IS NOT NULL"
            " AND platform_share IS NOT NULL)",
            name="ck_commissions_executed_has_shares",
        ),
        Index("ix_commissions_status", "status"),
        Index("ix_commissions_listing_id", "listing_id"),
    )
