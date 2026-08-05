from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Property Broker Settlement"
    debug: bool = False

    database_url: str = "postgresql+psycopg://broker:broker@localhost:5432/broker"
    test_database_url: str = (
        "postgresql+psycopg://broker:broker@localhost:5433/broker_test"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
