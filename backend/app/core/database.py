"""Engine, sesion y contexto transaccional.

Deliberadamente SINCRONO. Todo el modelo de integridad del sistema descansa en
`SELECT ... FOR UPDATE` y en transacciones que envuelven varias escrituras; el
codigo sincrono hace que esas fronteras sean obvias al leerlas, y permite que
los tests de concurrencia usen threads reales contra conexiones reales.
"""

import enum
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.core.config import settings


class EnumAsString(TypeDecorator):
    """Guarda un Enum como texto y lo devuelve COMO ENUM al leer.

    Con una columna `String` pelada, un valor escrito como `CommissionStatus.PENDING`
    vuelve de la base como el str `"PENDING"`. Las comparaciones siguen funcionando
    —son enums de str— y por eso el problema pasa desapercibido, hasta que alguien
    hace `status.value` sobre un objeto recien cargado y revienta.

    Aqui la conversion es explicita en los dos sentidos: lo que entra a la tabla es
    texto (legible en SQL, sin tipos ENUM nativos que compliquen las migraciones) y
    lo que sale al dominio es siempre el Enum.
    """

    impl = String
    cache_ok = True

    def __init__(self, enum_class: type[enum.Enum], length: int = 32) -> None:
        super().__init__(length=length)
        self._enum_class = enum_class

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        return self._enum_class(value).value

    def process_result_value(self, value: Any, dialect: Any) -> enum.Enum | None:
        if value is None:
            return None
        return self._enum_class(value)


class Base(DeclarativeBase):
    """Base declarativa compartida.

    Compartir la metadata NO rompe la frontera entre modulos: es lo que permite
    que Alembic vea todas las tablas y que exista UNA sola transaccion. La
    frontera se respeta en el codigo (un modulo no consulta las tablas de otro,
    llama a su service), no escondiendo metadatas.
    """


engine = create_engine(
    settings.database_url,
    # pool_pre_ping evita entregar conexiones muertas tras un reinicio de Postgres.
    pool_pre_ping=True,
    # El pool por defecto (5 + 10) es chico para este sistema: las transferencias
    # sostienen locks de fila mientras trabajan, asi que bajo contencion hay varias
    # conexiones ocupadas ESPERANDO, no calculando. Con el pool corto, los requests
    # empiezan a fallar por timeout de conexion en vez de simplemente hacer cola.
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
    # Recicla conexiones antes de que un firewall o el propio Postgres las corte.
    pool_recycle=1800,
    echo=settings.debug,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


@contextmanager
def transaction() -> Iterator[Session]:
    """Unidad de trabajo atomica: commit al salir bien, ROLLBACK ante cualquier error.

    Es el unico lugar donde se hace commit. Los services reciben la sesion y
    nunca comitean por su cuenta, de modo que un split completo (debitos,
    creditos y asientos de ledger) vive o muere junto.
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """Dependencia de FastAPI. Misma semantica que `transaction()`."""
    with transaction() as session:
        yield session
