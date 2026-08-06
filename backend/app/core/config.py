from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Property Broker Settlement"
    debug: bool = False

    database_url: str = "postgresql+psycopg://broker:broker@localhost:5432/broker"
    test_database_url: str = (
        "postgresql+psycopg://broker:broker@localhost:5433/broker_test"
    )

    @field_validator("database_url", "test_database_url", mode="after")
    @classmethod
    def _use_psycopg3(cls, url: str) -> str:
        """Normaliza el prefijo de la URL de conexion al driver que usamos.

        Los proveedores gestionados (Railway, Render, Heroku, Neon...) entregan la
        cadena en formato estandar:

            postgresql://usuario:clave@host:5432/base

        SQLAlchemy interpreta ese prefijo como psycopg2, que NO esta instalado
        —usamos psycopg 3— y falla con "No module named 'psycopg2'". El error
        aparece recien cuando el proceso toca la base, ya desplegado y despues de
        que el build paso sin problemas, asi que es caro de diagnosticar.

        Normalizarlo aca hace que la misma imagen funcione con la URL que de
        cualquier proveedor, sin tener que reescribirla a mano en cada entorno.

        `postgres://` es el prefijo antiguo que todavia usan algunos servicios.
        """
        for prefijo in ("postgresql://", "postgres://"):
            if url.startswith(prefijo):
                return f"postgresql+psycopg://{url[len(prefijo):]}"
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
