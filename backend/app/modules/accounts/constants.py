"""Identificadores conocidos de las cuentas de sistema.

Son UUIDs fijos y sembrados en la migracion inicial: el sistema necesita poder
referirse a "la plataforma" y a "el mundo exterior" sin hacer una busqueda por
nombre ni depender de un orden de creacion.
"""

from uuid import UUID

# Cuenta de la plataforma: recibe su % de cada comision. Cuenta normal, CON CHECK (>= 0).
PLATFORM_ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")

# Cuenta externa / mundo: contrapartida de todo deposito. Representa el dinero que
# entro al sistema desde afuera, por eso es la UNICA que puede ir negativa.
# Su saldo, en negativo, es exactamente el total de plata viva dentro del sistema.
EXTERNAL_ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000002")
