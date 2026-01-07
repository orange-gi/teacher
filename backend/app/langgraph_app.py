from __future__ import annotations

import uuid
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from .llm import LLMError, chat_json
from .mock import mock_plan


class PlanState(TypedDict, total=False):
    topic: str | None
    question: str
    outline: str
    nodes: list[dict[str, Any]]
    plan: dict[str, Any]


PLAN_SCHEMA_HINT = """
{
  "outline": "string(大纲，中文，多行可)",
  "nodes": [
    {
      "node_id": "string(uuid)",
      "order": 1,
      "title": "string(知识点标题)",
      "knowledge_goal": "string(一句话目标：我需要理解什么)",
      "practice_task": "string(一个练习任务：可验证)",
      "hint_code": "string(10-30行，可运行，带注释；必须是另一个不同练习/场景，不要直接实现 practice_task)",
      "grading_rubric": ["string", "..."],
      "pass_score": 70
    }
  ]
}
""".strip()


def _build_messages(topic: str | None, question: str) -> list[dict[str, str]]:
    coach_prompt = f"""
你是我的编程教练。我在学习【主题：{topic or "asyncio / multiprocessing / 并发实战"}】。
用户问题：{question}

请输出 N 个递进知识点（一般 5-10 个），每个知识点必须包含：
1) knowledge_goal：一句话目标
2) practice_task：一个可验证的练习任务（要我自己写）
3) hint_code：必要提示代码（可直接运行，10-30 行，注释完善），但必须是“另一个不同练习/场景”，不能直接实现该 practice_task
4) grading_rubric：评分要点列表（3-6 条）
5) pass_score：通过分数（0-100）

重要约束：
- 只输出严格 JSON（不要 markdown）
- hint_code 要用到与该知识点相关的关键 API/语法，但不要与 practice_task 同构（不要同变量/同流程/同输出）
    """.strip()

    return [
        {"role": "system", "content": "你是严格遵循结构化输出的编程教练。"},
        {"role": "user", "content": coach_prompt},
    ]


async def generate_plan_node(state: PlanState) -> PlanState:
    topic = state.get("topic")
    question = state["question"]
    try:
        data = await chat_json(_build_messages(topic, question), PLAN_SCHEMA_HINT)
        # 保证 node_id 存在且是 uuid
        nodes = data.get("nodes") or []
        for n in nodes:
            if not n.get("node_id"):
                n["node_id"] = str(uuid.uuid4())
        return {"plan": {"outline": data.get("outline", ""), "nodes": nodes}}
    except LLMError:
        return {"plan": mock_plan(topic, question)}


def build_plan_graph():
    g = StateGraph(PlanState)
    g.add_node("generate_plan", generate_plan_node)
    g.set_entry_point("generate_plan")
    g.add_edge("generate_plan", END)
    return g.compile()


plan_graph = build_plan_graph()

