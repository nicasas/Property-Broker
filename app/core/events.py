"""Bus de eventos in-process detras de una interfaz.

No hay Redis ni colas por decision de alcance. Lo que si hay es la FRONTERA:
el dominio publica contra `EventBus`, nunca contra una implementacion concreta.
Cambiar a Redis/SQS mas adelante es escribir otra clase que cumpla el protocolo,
sin tocar una linea de los modulos de negocio.

Fase 1 solo define el contrato; los eventos concretos llegan con el motor de
comisiones en la Fase 3.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol


@dataclass(frozen=True)
class Event:
    name: str
    payload: dict[str, Any] = field(default_factory=dict)
    occurred_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


Handler = Callable[[Event], None]


class EventBus(Protocol):
    def subscribe(self, event_name: str, handler: Handler) -> None: ...

    def publish(self, event: Event) -> None: ...


class InProcessEventBus:
    """Despacho sincrono en memoria.

    Un handler que falla NO puede tumbar la transaccion que publico el evento:
    para cuando se publica, la plata ya se movio y el ledger ya cuadra. Los
    errores de los suscriptores se aislan y se registran.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, event_name: str, handler: Handler) -> None:
        self._handlers[event_name].append(handler)

    def publish(self, event: Event) -> None:
        for handler in self._handlers[event.name]:
            try:
                handler(event)
            except Exception:  # noqa: BLE001 - aislamiento deliberado
                import logging

                logging.getLogger(__name__).exception(
                    "handler fallo para el evento %s", event.name
                )


event_bus: EventBus = InProcessEventBus()
