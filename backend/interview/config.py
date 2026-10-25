from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field, SecretStr, model_validator


class Settings(BaseModel):
    provider: Literal["mock", "openai_compatible"] = "mock"
    api_key: SecretStr = SecretStr("")
    base_url: str = "https://api.openai.com/v1"
    model: str = ""
    timeout_seconds: float = Field(default=30, ge=1, le=120)
    max_retries: int = Field(default=2, ge=0, le=3)
    response_format: Literal["json_schema", "json_object"] = "json_schema"

    @model_validator(mode="after")
    def validate_provider(self):
        if self.provider == "openai_compatible":
            if not self.api_key.get_secret_value() or not self.model.strip():
                raise ValueError("真实模型模式必须配置 LLM_API_KEY 和 LLM_MODEL；演示请用 AGENT_PROVIDER=mock")
            from urllib.parse import urlsplit
            url = urlsplit(self.base_url)
            if url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("LLM_BASE_URL 必须是无凭据和查询参数的 HTTP(S) 服务地址")
            if url.scheme == "http" and url.hostname not in {"127.0.0.1", "localhost", "::1"}:
                raise ValueError("远端模型服务必须使用 HTTPS")
        return self

    @classmethod
    def from_env(cls):
        load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
        return cls(provider=os.getenv("AGENT_PROVIDER", "mock"), api_key=os.getenv("LLM_API_KEY", ""),
                   base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
                   model=os.getenv("LLM_MODEL", ""), timeout_seconds=os.getenv("LLM_TIMEOUT_SECONDS", "30"),
                   max_retries=os.getenv("LLM_MAX_RETRIES", "2"), response_format=os.getenv("LLM_RESPONSE_FORMAT", "json_schema"))
