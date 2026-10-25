"""Replaceable, synchronous model boundary with bounded retries and safe logs."""
from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
from typing import Callable, Protocol, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .config import Settings
from .prompts import COMMON, TASKS

Model = TypeVar("Model", bound=BaseModel)
logger = logging.getLogger("interview.provider")
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_COMPLETION_TOKENS = 8192


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class Provider(Protocol):
    def generate(self, task: str, payload: dict, schema: type[Model]) -> Model: ...


def strict_json_schema(schema: dict) -> dict:
    """Structured Outputs requires every object field (nullable too) to be required."""
    result = {}
    for key, value in schema.items():
        if key == "default":
            continue
        if isinstance(value, dict):
            result[key] = strict_json_schema(value)
        elif isinstance(value, list):
            result[key] = [strict_json_schema(item) if isinstance(item, dict) else item for item in value]
        else:
            result[key] = value
    if result.get("type") == "object" or "properties" in result:
        result["additionalProperties"] = False
        result["required"] = list(result.get("properties", {}))
    return result


def _normalized_evidence(text: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).casefold()


def validate_grounding(task: str, payload: dict, result: BaseModel) -> None:
    """Reject untraceable evidence, not claim to prove real-world truth.

    Verbatim evidence and primary identity/experience labels can be checked
    deterministically; paraphrases, omissions and model reasoning still require
    user review. No LLM output is trusted merely because it passes its schema.
    """
    data = result.model_dump()
    def require_quote(quote, source):
        if not quote or _normalized_evidence(str(quote)) not in _normalized_evidence(source):
            raise ProviderError("ungrounded_model_output", "模型返回了无法在输入中定位的事实或证据，请重试并检查原始材料", True)
    if task == "parse_resume":
        source = payload["text"]
        if data.get("name"):
            require_quote(data["name"], source)
        for section in ("education", "internships", "projects"):
            for item in data.get(section, []):
                evidence = item.get("evidence", "")
                require_quote(evidence, source)
                keys = ("school", "degree", "major") if section == "education" else ("title", "organization", "role")
                for key in keys:
                    if item.get(key):
                        require_quote(item[key], evidence)
        from .mock_provider import skills_in
        supported_skills = set(skills_in(source, reject_negated=True))
        for skill in data.get("skills", []):
            concepts = set(skills_in(skill))
            if concepts and not concepts.issubset(supported_skills):
                raise ProviderError("ungrounded_model_output", "模型技能清单缺少原文支持或包含被明确否定的技能，请核对后重试", True)
            if not concepts and skill not in supported_skills:
                require_quote(skill, source)
    elif task == "parse_jd":
        for item in data.get("requirements", []):
            require_quote(item.get("evidence", ""), payload["text"])
    elif task == "match":
        source = payload.get("resume_text") or json.dumps(payload.get("resume", {}), ensure_ascii=False)
        for item in data.get("matched", []):
            require_quote(item.get("evidence", ""), source)
    elif task == "evaluate":
        # Reference answers must stay conceptual or framed as questions/plans,
        # never ghostwrite accomplishments in the candidate's first person.
        if re.search(r"我(?:曾经?|负责|参与|主导|独立完成|带领)|在我的项目中|我们团队(?:完成|实现|取得)", data.get("reference_answer", "")):
            raise ProviderError("ungrounded_model_output", "参考答案包含个人经历式断言，已拒绝；请重试生成概念解释或回答框架", True)


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None,
                 sleep_fn: Callable[[float], None] = time.sleep):
        self.settings = settings
        self.transport = transport
        self.sleep_fn = sleep_fn

    def generate(self, task: str, payload: dict, schema: type[Model]) -> Model:
        if task not in TASKS:
            raise ProviderError("unsupported_task", "不支持的模型任务")
        shape = strict_json_schema(schema.model_json_schema())
        if self.settings.response_format == "json_schema":
            response_format = {"type": "json_schema", "json_schema": {"name": schema.__name__, "strict": True, "schema": shape}}
        else:
            response_format = {"type": "json_object"}
        system = COMMON + "\n" + TASKS[task]
        # Also give the shape to compatible providers whose json_object mode only
        # guarantees valid JSON, not schema adherence. Pydantic still validates.
        if self.settings.response_format == "json_object":
            system += "\n输出 JSON schema：" + json.dumps(shape, ensure_ascii=False)
        body = {"model": self.settings.model, "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ], "response_format": response_format, "max_completion_tokens": MAX_COMPLETION_TOKENS}
        started = time.monotonic()
        with httpx.Client(timeout=self.settings.timeout_seconds, transport=self.transport, follow_redirects=False) as client:
            for attempt in range(self.settings.max_retries + 1):
                attempt_started = time.monotonic()
                try:
                    with client.stream("POST", self.settings.base_url.rstrip("/") + "/chat/completions", json=body,
                                       headers={"Authorization": "Bearer " + self.settings.api_key.get_secret_value()}) as response:
                        if response.status_code in {401, 403}:
                            raise ProviderError("model_auth", "模型鉴权失败，请检查 API Key 与模型权限")
                        if response.status_code == 429 or response.status_code >= 500:
                            raise ProviderError("model_unavailable", "模型服务繁忙或暂不可用，请稍后重试", True)
                        if not 200 <= response.status_code < 300:
                            raise ProviderError("model_request", "模型服务拒绝请求，请检查模型名称、地址及结构化输出支持")
                        response_bytes = bytearray()
                        for chunk in response.iter_bytes(chunk_size=16384):
                            response_bytes.extend(chunk)
                            if len(response_bytes) > MAX_RESPONSE_BYTES:
                                raise ProviderError("invalid_model_output", "模型响应过大，请调整模型配置", True)
                            if time.monotonic() - attempt_started > self.settings.timeout_seconds:
                                raise ProviderError("model_timeout", "模型响应时间超过限制，请重试", True)
                    try:
                        data = json.loads(response_bytes)
                        choice = data["choices"][0]
                        message = choice["message"]
                        if not isinstance(choice, dict) or not isinstance(message, dict):
                            raise TypeError("Expected structured message object")
                        if message.get("refusal"):
                            raise ProviderError("model_refusal", "模型拒绝了本次请求，请检查输入内容")
                        if choice.get("finish_reason") in {"length", "content_filter"}:
                            raise ProviderError("invalid_model_output", "模型输出被截断或过滤，请重试或调整模型", True)
                        content = message["content"]
                        if not isinstance(content, str):
                            raise TypeError("Expected JSON text")
                        result = schema.model_validate_json(content)
                        validate_grounding(task, payload, result)
                    except (ValueError, KeyError, IndexError, TypeError, ValidationError) as error:
                        raise ProviderError("invalid_model_output", "模型未返回符合约定的数据结构，请重试或更换支持结构化输出的模型", True) from error
                    logger.info(json.dumps({"event": "model_call", "task": task, "attempt": attempt + 1,
                                            "status": "ok", "duration_ms": round((time.monotonic() - started) * 1000)}))
                    return result
                except httpx.TimeoutException as error:
                    failure = ProviderError("model_timeout", "模型调用超时，请重试或调整超时设置", True)
                    failure.__cause__ = error
                except httpx.RequestError as error:
                    failure = ProviderError("model_network", "无法连接模型服务，请检查网络和服务地址", True)
                    failure.__cause__ = error
                except ProviderError as error:
                    failure = error
                logger.warning(json.dumps({"event": "model_call", "task": task, "attempt": attempt + 1,
                                           "status": "error", "code": failure.code,
                                           "duration_ms": round((time.monotonic() - started) * 1000)}))
                if not failure.retryable or attempt >= self.settings.max_retries:
                    raise failure
                self.sleep_fn(min(0.5 * 2 ** attempt, 2.0))
        raise ProviderError("model_unavailable", "模型调用未完成", True)


def make_provider(settings: Settings) -> Provider:
    if settings.provider == "mock":
        from .mock_provider import MockProvider
        return MockProvider()
    return OpenAICompatibleProvider(settings)
