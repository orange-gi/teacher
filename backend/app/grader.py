from __future__ import annotations

import uuid
from typing import Any

from .llm import LLMError, chat_json
from .mock import mock_grade


GRADE_SCHEMA_HINT = """
{
  "score": 0,
  "passed": true,
  "feedback": "string(总体评语，中文)",
  "strengths": ["string", "..."],
  "improvements": ["string", "..."]
}
""".strip()


def _grade_messages(title: str, knowledge_goal: str, practice_task: str, rubric: list[str], pass_score: int, answer: str) -> list[dict[str, str]]:
    prompt = f"""
你是严谨的代码/解题批改老师。请按 rubric 对学生答案打分。

知识点：{title}
目标：{knowledge_goal}
练习任务：{practice_task}
通过分数：{pass_score}
评分要点（rubric）：
{chr(10).join([f"- {r}" for r in rubric])}

学生答案：
{answer}

要求：
- 只输出严格 JSON
- score 为 0-100 的整数
- passed 必须与 score >= pass_score 保持一致
- feedback 要指出：是否满足“可验证”要求（输出/耗时/顺序/正确性），是否正确使用关键 API，缺失点是什么
""".strip()
    return [
        {"role": "system", "content": "你是严格输出 JSON 的批改老师。"},
        {"role": "user", "content": prompt},
    ]


async def grade_answer(
    *,
    title: str,
    knowledge_goal: str,
    practice_task: str,
    rubric: list[str],
    pass_score: int,
    answer: str,
) -> dict[str, Any]:
    try:
        data = await chat_json(_grade_messages(title, knowledge_goal, practice_task, rubric, pass_score, answer), GRADE_SCHEMA_HINT)
        score = int(data.get("score", 0))
        passed = bool(data.get("passed", False))
        # 强制一致
        passed = bool(score >= int(pass_score))
        return {
            "score": score,
            "passed": passed,
            "feedback": str(data.get("feedback", "")),
            "strengths": list(data.get("strengths") or []),
            "improvements": list(data.get("improvements") or []),
        }
    except LLMError:
        return mock_grade(int(pass_score), answer)

