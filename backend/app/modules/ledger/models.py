from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, EnumAsString


class OperationType(str, enum.Enum):
    DEPOSIT = "DEPOSIT"
    TRANSFER = "TRANSFER"
    COMMISSION_SPLIT = "COMMISSION_SPLIT"


class LedgerEntry(Base):
    """Asiento contable. APPEND-ONLY: nunca UPDATE, nunca DELETE.

    Contabilidad de PARTIDA DOBLE. Un movimiento no es una fila, es un conjunto de
    filas que comparten `movement_id` y cuyos montos SUMAN CERO. De ahi sale el
    invariante global del sistema:

        SELECT SUM(amount) FROM ledger_entries;  -->  0, siempre

    Un cero ahi significa que el sistema no creo ni destruyo un solo peso. Un
    numero distinto de cero es plata inventada o desaparecida.

    La regla append-only no depende de la disciplina del programador: la migracion
    instala un TRIGGER que aborta cualquier UPDATE o DELETE sobre esta tabla.
    """

    __tablename__ = "ledger_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Agrupa las patas de UN movimiento. Las filas con el mismo movement_id
    # suman cero entre si.
    movement_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)

    account_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )

    # Firmado y en unidad minima (centavos). Negativo debita, positivo acredita.
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Saldo de la cuenta DESPUES de aplicar este asiento. Redundante a proposito:
    # hace el historial legible y permite detectar una desincronizacion sin
    # recorrer la tabla entera.
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False)

    operation_type: Mapped[OperationType] = mapped_column(
        EnumAsString(OperationType, 24), nullable=False
    )

    # Referencia libre al hecho de negocio que origino el movimiento
    # (en la Fase 3: el id de la comision liquidada).
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Un asiento de monto cero no es un hecho contable, es ruido.
        CheckConstraint("amount <> 0", name="ck_ledger_amount_not_zero"),
        CheckConstraint(
            "operation_type IN ('DEPOSIT', 'TRANSFER', 'COMMISSION_SPLIT')",
            name="ck_ledger_valid_operation_type",
        ),
        Index("ix_ledger_entries_movement_id", "movement_id"),
        Index("ix_ledger_entries_account_id_created_at", "account_id", "created_at"),
    )
