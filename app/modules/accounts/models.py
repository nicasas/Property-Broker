from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, EnumAsString


class AccountType(str, enum.Enum):
    BROKER = "BROKER"
    PLATFORM = "PLATFORM"
    EXTERNAL = "EXTERNAL"


class Account(Base):
    """Cuenta con saldo materializado.

    `balance` es una columna materializada por velocidad y, sobre todo, para poder
    colgarle el CHECK a nivel de tabla. La verdad historica vive en el ledger; los
    dos se escriben en la misma transaccion y existe una funcion de reconciliacion
    que prueba que cuadran.
    """

    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(
        EnumAsString(AccountType, 16), nullable=False, default=AccountType.BROKER
    )
    balance: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        # ULTIMA LINEA DE DEFENSA. Aunque toda la logica de aplicacion falle, Postgres
        # rechaza fisicamente el saldo negativo y revienta la transaccion completa.
        #
        # La excepcion es la cuenta EXTERNAL: representa el dinero que entro desde
        # afuera del sistema, y por construccion su saldo es negativo. El CHECK
        # aplica a brokers y plataforma; el motor de transferencia NO sabe nada de
        # esto (ver `accounts.service.apply_delta`).
        CheckConstraint(
            "account_type = 'EXTERNAL' OR balance >= 0",
            name="ck_accounts_balance_non_negative",
        ),
        CheckConstraint(
            "account_type IN ('BROKER', 'PLATFORM', 'EXTERNAL')",
            name="ck_accounts_valid_type",
        ),
        # Solo puede existir UNA plataforma y UNA cuenta externa. Dos cuentas externas
        # serian dos origenes de verdad para "cuanta plata entro al sistema".
        Index(
            "uq_accounts_singleton_system_types",
            "account_type",
            unique=True,
            postgresql_where=text("account_type IN ('PLATFORM', 'EXTERNAL')"),
        ),
    )

    @property
    def allows_negative_balance(self) -> bool:
        """Espejo en Python del CHECK de la tabla. Un solo criterio, dos capas."""
        return self.account_type == AccountType.EXTERNAL
