from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import register_exception_handlers
from app.modules.accounts.router import router as accounts_router
from app.modules.commissions.router import router as commissions_router
from app.modules.ledger.router import router as ledger_router
from app.modules.listings.router import router as listings_router

app = FastAPI(
    title=settings.app_name,
    description="Liquidacion de comisiones compartidas entre brokers inmobiliarios.",
    version="0.3.0",
)

register_exception_handlers(app)


@app.get("/health", tags=["health"])
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    """Healthcheck real: verifica que la BD responde, no solo que el proceso vive."""
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


# Nucleo bancario (Fase 2). Funciona como wallet generico por si solo.
app.include_router(accounts_router)
app.include_router(ledger_router)

# Motor de comisiones (Fase 3), construido ENCIMA del nucleo.
app.include_router(listings_router)
app.include_router(commissions_router)
