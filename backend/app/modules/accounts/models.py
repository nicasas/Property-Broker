from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, EnumAsString


# Texto de las columnas acompañantes del patron de FK parcial. Vive aqui, junto a
# `Account.is_settleable`, para que las cuatro columnas que lo usan digan lo mismo.
SETTLEABLE_COMPANION_COMMENT = (
    "Clavada en true por CHECK. Junto a la columna de cuenta forma una FK compuesta "
    "contra accounts(id, is_settleable): hace estructuralmente imposible referenciar "
    "la cuenta externa."
)


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
    # ------------------------------------------------------------------
    # PATRON: FK PARCIAL VIA COLUMNA GENERADA
    #
    # Postgres no permite subconsultas en un CHECK ni claves foraneas contra una
    # vista, asi que otra tabla no puede exigir por si sola "esta cuenta no es la
    # externa". Este par de piezas lo consigue de forma declarativa:
    #
    #   1. `is_settleable` se deriva del tipo de cuenta. GENERATED ... STORED, no
    #      VIRTUAL: una FK no puede referenciar una columna generada virtual.
    #   2. `UNIQUE (id, is_settleable)` da el par al que puede apuntar una FK.
    #
    # Del otro lado, cada tabla que referencia una cuenta que va a mover plata
    # lleva una columna acompañante clavada en `true` y una FK compuesta contra
    # este par. Resultado: una cuenta EXTERNAL es ESTRUCTURALMENTE inalcanzable
    # desde esas columnas — no por un guard que corre, sino porque la fila no
    # existe del otro lado de la FK.
    #
    # Ventaja decisiva sobre un trigger: al crear la FK, Postgres valida la tabla
    # entera. Si hay una fila preexistente que la viola, la MIGRACION FALLA. Un
    # trigger solo dispara en escrituras futuras y dejaria esa fila viva, en
    # silencio. Y esta FK cubre ademas la direccion inversa: no se puede convertir
    # en EXTERNAL una cuenta que ya esta referenciada.
    #
    # Ver el mismo patron en `listings.models` y `commissions.models`.
    # ------------------------------------------------------------------
    is_settleable: Mapped[bool] = mapped_column(
        Boolean,
        Computed("account_type <> 'EXTERNAL'", persisted=True),
        nullable=False,
        comment=(
            "Derivada del tipo de cuenta. Destino de las FK compuestas que impiden "
            "que la cuenta externa sea referenciada por columnas que mueven plata."
        ),
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
        # Destino de las FK compuestas que impiden referenciar la cuenta externa.
        # Redundante frente a la PK, pero una FK exige un unique sobre el PAR exacto
        # de columnas que referencia.
        UniqueConstraint("id", "is_settleable", name="uq_accounts_id_is_settleable"),
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
