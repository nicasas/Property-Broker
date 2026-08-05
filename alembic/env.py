import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import settings
from app.core.database import Base

# OBLIGATORIO: con Base compartida, autogenerate solo ve las tablas cuyos modulos
# hayan sido importados. Falta uno -> la migracion sale vacia, en silencio.
# Cada modulo nuevo se agrega aqui.
import app.core.idempotency  # noqa: F401,E402
import app.modules.accounts.models  # noqa: F401,E402
import app.modules.commissions.models  # noqa: F401,E402
import app.modules.ledger.models  # noqa: F401,E402
import app.modules.listings.models  # noqa: F401,E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """DATABASE_URL del entorno gana; si no, la de la config de la app.

    Permite correr las migraciones contra postgres-test sin tocar archivos:
        DATABASE_URL=$TEST_DATABASE_URL alembic upgrade head
    """
    return os.getenv("DATABASE_URL") or settings.database_url


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(get_url(), poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
