from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from . import db


class LLMError(RuntimeError):
    pass


def _mask_key(k: str) -> str:
    if not k:
        return ""
    if len(k) <= 8:
        return "*" * len(k)
    return k[:3] + "*" * (len(k) - 7) + k[-4:]


def get_llm_public_config() -> dict[str, Any]:
    cfg = db.get_llm_config()
    return {
        "base_url": cfg["base_url"],
        "model": cfg["model"],
        "temperature": float(cfg["temperature"]),
        "api_key_masked": _mask_key(cfg["api_key"]),
    }


async def chat_json(messages: list[dict[str, str]], json_schema_hint: str) -> dict[str, Any]:
    """
    调用 OpenAI-compatible Chat Completions，期望返回 JSON。
    - 如果未配置 key：抛出 LLMError（上层可 fallback 到 mock）
    """

    cfg = db.get_llm_config()
    if not cfg.get("api_key"):
        raise LLMError("LLM API key 未配置")

    base_url = cfg["base_url"].rstrip("/")
    url = f"{base_url}/v1/chat/completions"
    headers = {"Authorization": f"Bearer {cfg['api_key']}"}

    payload = {
        "model": cfg["model"],
        "temperature": float(cfg["temperature"]),
        "messages": messages
        + [
            {
                "role": "system",
                "content": "你必须只输出严格 JSON，不要输出 markdown code fence。若你要解释，请放进 JSON 字段中。",
            },
            {"role": "system", "content": f"JSON 结构提示：{json_schema_hint}"},
        ],
    }

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, json=payload)
        if r.status_code >= 400:
            raise LLMError(f"LLM 调用失败: {r.status_code} {r.text[:500]}")
        data = r.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except Exception as e:
            raise LLMError(f"LLM 返回结构异常: {e}")

    # 容错：有些模型会夹带多余文本；尽量抽取第一个 JSON 对象
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```[a-zA-Z]*\n|\n```$", "", content).strip()
    m = re.search(r"\{[\s\S]*\}$", content)
    if not m:
        # 尝试截取第一个 { ... }
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1 and end > start:
            content = content[start : end + 1]
    try:
        return json.loads(content)
    except Exception as e:
        raise LLMError(f"JSON 解析失败: {e}; content={content[:500]}")

