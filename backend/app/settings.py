from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    后端配置：
    - LLM：OpenAI-compatible Chat Completions API（/v1/chat/completions）
    - Neo4j：用于知识图谱
    - SQLite：用于会话/历史/解锁状态
    """

    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env", extra="ignore")

    # HTTP / CORS
    cors_allow_origins: str = "*"

    # SQLite
    sqlite_path: str = "data/app.db"

    # LLM（可通过 /config/llm 动态覆盖；这里是默认值）
    llm_base_url: str = "https://api.openai.com"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_temperature: float = 0.2

    # Neo4j
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "neo4j_password"


settings = Settings()

