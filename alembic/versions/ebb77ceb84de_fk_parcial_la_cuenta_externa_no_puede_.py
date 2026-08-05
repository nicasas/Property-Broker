"""fk parcial: la cuenta externa no puede aparecer en columnas de split

Revision ID: ebb77ceb84de
Revises: 9e5e6444c341
Create Date: 2026-08-05 03:29:12.436323

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'ebb77ceb84de'
down_revision: Union[str, None] = '9e5e6444c341'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mismos textos que declaran los modelos SQLAlchemy. Sin ellos, quien haga \d+ sobre
# la tabla ve una columna booleana siempre en `true` y no tiene forma de saber para
# que existe.
ACCOUNTS_COMMENT = (
    "Derivada del tipo de cuenta. Destino de las FK compuestas que impiden que la "
    "cuenta externa sea referenciada por columnas que mueven plata."
)
COMPANION_COMMENT = (
    "Clavada en true por CHECK. Junto a la columna de cuenta forma una FK compuesta "
    "contra accounts(id, is_settleable): hace estructuralmente imposible referenciar "
    "la cuenta externa."
)


def upgrade() -> None:
    """FK PARCIAL VIA COLUMNA GENERADA.

    Impide de forma declarativa que la cuenta externa aparezca en cualquiera de las
    cuatro columnas que terminan alimentando un movimiento de plata.

    Postgres no admite subconsultas en un CHECK ni claves foraneas contra una vista,
    asi que una tabla no puede exigir por si sola "esta cuenta no es la externa". El
    rodeo es en dos partes:

      1. `accounts.is_settleable` se deriva del tipo (GENERATED ... STORED, porque
         una FK no puede referenciar una columna generada VIRTUAL), y se le agrega
         UNIQUE (id, is_settleable) para que exista un par referenciable.
      2. Cada columna de cuenta lleva una acompañante clavada en `true` por CHECK y
         una FK compuesta contra ese par. La cuenta externa tiene
         `is_settleable = false`, asi que NO EXISTE fila del otro lado que satisfaga
         la FK.

    Se eligio FK y no trigger por una razon concreta: al crear la FK, Postgres valida
    la tabla entera. Si existe una fila previa que la viola, ESTA MIGRACION FALLA en
    vez de dejarla viva en silencio. Un trigger solo dispara en escrituras futuras.
    Ademas la FK cubre la direccion inversa: no se puede convertir en EXTERNAL una
    cuenta ya referenciada.
    """
    # --- 1. El par referenciable en accounts -------------------------------
    op.add_column('accounts', sa.Column('is_settleable', sa.Boolean(), sa.Computed("account_type <> 'EXTERNAL'", persisted=True), nullable=False, comment=ACCOUNTS_COMMENT))
    op.create_unique_constraint('uq_accounts_id_is_settleable', 'accounts', ['id', 'is_settleable'])

    # --- 2. listings -------------------------------------------------------
    op.add_column('listings', sa.Column('listing_broker_is_settleable', sa.Boolean(), server_default=sa.text('true'), nullable=False, comment=COMPANION_COMMENT))
    op.create_check_constraint('ck_listings_broker_is_settleable', 'listings', 'listing_broker_is_settleable')
    op.drop_constraint('listings_listing_broker_account_id_fkey', 'listings', type_='foreignkey')
    op.create_foreign_key('fk_listings_broker_settleable', 'listings', 'accounts', ['listing_broker_account_id', 'listing_broker_is_settleable'], ['id', 'is_settleable'])

    # --- 3. commissions: las tres columnas que el approve lee para mover plata
    op.add_column('commissions', sa.Column('reported_by_is_settleable', sa.Boolean(), server_default=sa.text('true'), nullable=False, comment=COMPANION_COMMENT))
    op.add_column('commissions', sa.Column('selling_broker_is_settleable', sa.Boolean(), server_default=sa.text('true'), nullable=False, comment=COMPANION_COMMENT))
    op.add_column('commissions', sa.Column('listing_broker_is_settleable', sa.Boolean(), server_default=sa.text('true'), nullable=False, comment=COMPANION_COMMENT))
    op.create_check_constraint('ck_commissions_reported_by_settleable', 'commissions', 'reported_by_is_settleable')
    op.create_check_constraint('ck_commissions_selling_broker_settleable', 'commissions', 'selling_broker_is_settleable')
    op.create_check_constraint('ck_commissions_listing_broker_settleable', 'commissions', 'listing_broker_is_settleable')
    op.drop_constraint('commissions_reported_by_account_id_fkey', 'commissions', type_='foreignkey')
    op.drop_constraint('commissions_listing_broker_account_id_fkey', 'commissions', type_='foreignkey')
    op.drop_constraint('commissions_selling_broker_account_id_fkey', 'commissions', type_='foreignkey')
    op.create_foreign_key('fk_commissions_selling_broker_settleable', 'commissions', 'accounts', ['selling_broker_account_id', 'selling_broker_is_settleable'], ['id', 'is_settleable'])
    op.create_foreign_key('fk_commissions_reported_by_settleable', 'commissions', 'accounts', ['reported_by_account_id', 'reported_by_is_settleable'], ['id', 'is_settleable'])
    op.create_foreign_key('fk_commissions_listing_broker_settleable', 'commissions', 'accounts', ['listing_broker_account_id', 'listing_broker_is_settleable'], ['id', 'is_settleable'])

    # Los COMMENT de columna viajan en las definiciones de arriba (`comment=`), no
    # como SQL suelto: asi el modelo SQLAlchemy sigue siendo la unica fuente de
    # verdad y `alembic check` no detecta deriva.


def downgrade() -> None:
    op.drop_constraint('ck_commissions_listing_broker_settleable', 'commissions', type_='check')
    op.drop_constraint('ck_commissions_selling_broker_settleable', 'commissions', type_='check')
    op.drop_constraint('ck_commissions_reported_by_settleable', 'commissions', type_='check')
    op.drop_constraint('ck_listings_broker_is_settleable', 'listings', type_='check')
    op.drop_constraint('fk_listings_broker_settleable', 'listings', type_='foreignkey')
    op.create_foreign_key('listings_listing_broker_account_id_fkey', 'listings', 'accounts', ['listing_broker_account_id'], ['id'])
    op.drop_column('listings', 'listing_broker_is_settleable')
    op.drop_constraint('fk_commissions_listing_broker_settleable', 'commissions', type_='foreignkey')
    op.drop_constraint('fk_commissions_reported_by_settleable', 'commissions', type_='foreignkey')
    op.drop_constraint('fk_commissions_selling_broker_settleable', 'commissions', type_='foreignkey')
    op.create_foreign_key('commissions_selling_broker_account_id_fkey', 'commissions', 'accounts', ['selling_broker_account_id'], ['id'])
    op.create_foreign_key('commissions_listing_broker_account_id_fkey', 'commissions', 'accounts', ['listing_broker_account_id'], ['id'])
    op.create_foreign_key('commissions_reported_by_account_id_fkey', 'commissions', 'accounts', ['reported_by_account_id'], ['id'])
    op.drop_column('commissions', 'listing_broker_is_settleable')
    op.drop_column('commissions', 'selling_broker_is_settleable')
    op.drop_column('commissions', 'reported_by_is_settleable')
    op.drop_constraint('uq_accounts_id_is_settleable', 'accounts', type_='unique')
    op.drop_column('accounts', 'is_settleable')
    # ### end Alembic commands ###
