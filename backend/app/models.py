from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class LLMConfigIn(BaseModel):
    base_url: str = Field(..., description="OpenAI-compatible base url, e.g. https://api.openai.com")
    api_key: str = Field(..., description="API Key（建议只保存到后端）")
    model: str = Field(..., description="模型名")
    temperature: float = Field(0.2, ge=0.0, le=2.0)


class LLMConfigOut(BaseModel):
    base_url: str
    model: str
    temperature: float
    api_key_masked: str


class SessionCreateOut(BaseModel):
    session_id: str
    created_at: datetime


class SessionListItem(BaseModel):
    session_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class AskIn(BaseModel):
    user_id: str = Field(..., description="最小可行：由前端生成并持久化的设备ID/用户ID")
    question: str
    topic_hint: str | None = Field(
        default=None,
        description="可选：学习主题提示（如 asyncio / multiprocessing），不给则从问题里推断",
    )


class LearningNode(BaseModel):
    node_id: str
    order: int
    title: str

    knowledge_goal: str
    practice_task: str

    # 给用户迁移思路的“必要提示代码”（不同场景，不是练习答案）
    hint_code: str

    # 评分 rubric：告诉 grader 看哪些点
    grading_rubric: list[str]
    pass_score: int = Field(70, ge=0, le=100)


class LearningPlan(BaseModel):
    outline: str
    nodes: list[LearningNode]


class AskOut(BaseModel):
    session_id: str
    question_id: str
    created_at: datetime
    plan: LearningPlan
    unlocked_order: int = 0  # 0 表示只解锁大纲；1 表示解锁第一个知识点节点...


class PlanGetOut(BaseModel):
    session_id: str
    plan: LearningPlan
    unlocked_order: int


class SubmitAnswerIn(BaseModel):
    user_id: str
    answer: str = Field(..., description="用户对该节点练习任务的回答（文字/代码都可）")


class GradeOut(BaseModel):
    score: int = Field(..., ge=0, le=100)
    passed: bool
    feedback: str
    strengths: list[str]
    improvements: list[str]


class SubmitAnswerOut(BaseModel):
    node_id: str
    order: int
    grade: GradeOut
    unlocked_order: int
    finished: bool


class GraphUploadIn(BaseModel):
    """
    用户上传知识图谱（最小格式）：
    - nodes: [{ "name": "...", "level": 1(optional) }]
    - edges: [{ "from": "A", "to": "B", "type": "PREREQ" }]
    """

    user_id: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class GraphNodeOut(BaseModel):
    id: str
    name: str
    level: int | None = None
    brightness: float = Field(..., ge=0.0, le=1.0)
    last_practice_at: datetime | None = None
    mastery_score: float | None = None


class GraphEdgeOut(BaseModel):
    source: str
    target: str
    type: Literal["PREREQ", "REL"]


class GraphOut(BaseModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]

