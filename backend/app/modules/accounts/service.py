"""Reglas de negocio de cuentas.

REGLA DE COMPOSICION TRANSACCIONAL: todas las funciones reciben `session` como
primer parametro. Ninguna abre `transaction()` ni hace commit. Solo el caller mas
externo (el router, o el motor de comisiones en la Fase 3) abre la transaccion,
y asi un split completo puede componer varias llamadas a este service dentro de
UNA sola unidad atomica.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.errors import AccountNotFound, InsufficientFunds, RestrictedAccount
from app.modules.accounts import repository
from app.modules.accounts.models import Account, AccountType


def create_account(
    session: Session,
    *,
    name: str,
    account_type: AccountType = AccountType.BROKER,
    account_id: uuid.UUID | None = None,
) -> Account:
    return repository.insert(
        session, name=name, account_type=account_type, account_id=account_id
    )


def get_account(session: Session, account_id: uuid.UUID) -> Account:
    account = repository.get(session, account_id)
    if account is None:
        raise AccountNotFound("La cuenta no existe", account_id=str(account_id))
    return account


def require_settleable_account(session: Session, account_id: uuid.UUID) -> Account:
    """Como `get_account`, pero rechaza la cuenta externa / mundo.

    La cuenta externa es la contrapartida de los depositos y es la unica sin
    `CHECK (balance >= 0)`. Esa excepcion existe para representar el dinero que
    ENTRO desde afuera, y solo tiene sentido si nadie mas puede usarla.

    Sin este filtro, `POST /transfers` con `from = cuenta externa` acuñaba plata:
    la cuenta se hunde en negativo sin restriccion que la frene. Y una comision
    con la externa como broker sacaba plata del sistema. En los dos casos
    `SUM(ledger) == 0` seguia cuadrando —por eso no basta con ese invariante— pero
    la afirmacion de negocio "el negativo de la externa es el dinero vivo adentro"
    quedaba rota.

    Se valida AQUI, en el borde de los casos de uso, y no en `post_movement`: el
    motor de movimientos sigue siendo ciego al tipo de cuenta. Es `deposit()`
    quien tiene el permiso explicito de tocar la externa.
    """
    account = get_account(session, account_id)
    if account.account_type == AccountType.EXTERNAL:
        raise RestrictedAccount(
            "La cuenta externa solo puede moverse mediante un deposito",
            account_id=str(account_id),
        )
    return account


def get_balance(session: Session, account_id: uuid.UUID) -> int:
    return get_account(session, account_id).balance


def list_accounts(session: Session) -> list[Account]:
    return repository.list_all(session)


def apply_delta(session: Session, account_id: uuid.UUID, amount: int) -> Account:
    """Mueve el saldo de UNA cuenta bajo lock de fila. Es el unico camino de escritura.

    `amount` es firmado: negativo debita, positivo acredita.

    Este es el unico lugar del sistema que sabe que existen cuentas autorizadas a
    ir en negativo. El motor de movimientos (`ledger.service`) es CIEGO al tipo de
    cuenta: solo mueve saldo entre IDs y delega aqui la pregunta de si el
    resultado es admisible.
    """
    account = repository.get_for_update(session, account_id)
    if account is None:
        raise AccountNotFound("La cuenta no existe", account_id=str(account_id))

    new_balance = account.balance + amount

    if new_balance < 0 and not account.allows_negative_balance:
        raise InsufficientFunds(
            "Saldo insuficiente",
            account_id=str(account_id),
            balance=account.balance,
            requested=abs(amount),
        )

    account.balance = new_balance
    session.flush()
    return account
