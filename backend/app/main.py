from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .grader import grade_answer
from .supabase_store import SupabaseStore
from .langgraph_app import plan_graph
from .llm import get_llm_public_config
from .models import (
    AskIn,
    AskOut,
    GraphOut,
    GraphUploadIn,
    LLMConfigIn,
    LLMConfigOut,
    PlanGetOut,
    SessionCreateOut,
    SessionListItem,
    SubmitAnswerIn,
    SubmitAnswerOut,
)
from .settings import settings


app = FastAPI(title="LLM Learning Coach", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allow_origins.split(",")] if settings.cors_allow_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


sb: SupabaseStore | None = None


@app.on_event("startup")
def _startup() -> None:
    db.ensure_db()
    global sb
    try:
        sb = SupabaseStore()
    except Exception:
        # Supabase 不可用也允许后端启动（Teacher 仍可用；图谱接口会报错）
        sb = None


@app.on_event("shutdown")
def _shutdown() -> None:
    # Supabase store 为 HTTP，无需关闭
    pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/config/llm", response_model=LLMConfigOut)
def get_llm_config() -> LLMConfigOut:
    cfg = get_llm_public_config()
    return LLMConfigOut(**cfg)


@app.post("/config/llm", response_model=LLMConfigOut)
def set_llm_config(body: LLMConfigIn) -> LLMConfigOut:
    current = db.get_llm_config()
    api_key = body.api_key if body.api_key.strip() else str(current.get("api_key", ""))
    db.upsert_llm_config(body.base_url, api_key, body.model, float(body.temperature))
    cfg = get_llm_public_config()
    return LLMConfigOut(**cfg)


@app.post("/sessions", response_model=SessionCreateOut)
def create_session(user_id: str) -> SessionCreateOut:
    session_id = str(uuid.uuid4())
    row = db.create_session(session_id=session_id, user_id=user_id, title="新会话")
    return SessionCreateOut(session_id=row["session_id"], created_at=datetime.fromisoformat(row["created_at"]))


@app.get("/sessions", response_model=list[SessionListItem])
def list_sessions(user_id: str) -> list[SessionListItem]:
    items = db.list_sessions(user_id)
    return [
        SessionListItem(
            session_id=i["session_id"],
            title=i["title"],
            created_at=datetime.fromisoformat(i["created_at"]),
            updated_at=datetime.fromisoformat(i["updated_at"]),
        )
        for i in items
    ]


@app.get("/sessions/{session_id}/plan", response_model=PlanGetOut)
def get_plan(session_id: str, user_id: str) -> PlanGetOut:
    s = db.get_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    if s["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="forbidden")

    p = db.get_plan(session_id)
    if not p:
        raise HTTPException(status_code=404, detail="plan not found")

    return PlanGetOut(session_id=session_id, plan={"outline": p["outline"], "nodes": p["nodes"]}, unlocked_order=int(s.get("unlocked_order", 0)))


@app.post("/sessions/{session_id}/ask", response_model=AskOut)
async def ask(session_id: str, body: AskIn) -> AskOut:
    s = db.get_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    if s["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="forbidden")

    question_id = str(uuid.uuid4())
    qrow = db.insert_question(question_id, session_id, body.question, body.topic_hint)

    # 用 LangGraph 生成 plan（LLM or mock）
    result = await plan_graph.ainvoke({"topic": body.topic_hint, "question": body.question})
    plan = result["plan"]
    outline = str(plan.get("outline", ""))
    nodes = list(plan.get("nodes") or [])

    # 持久化 & 重置解锁
    db.upsert_plan(session_id, outline, nodes)
    db.set_unlocked_order(session_id, 1 if nodes else 0)  # 生成后默认解锁第 1 个知识点

    # 写入 Neo4j（可选）
    if sb:
        try:
            sb.upsert_plan_concepts(user_id=body.user_id, nodes=nodes)
        except Exception:
            pass

    s2 = db.get_session(session_id) or s
    return AskOut(
        session_id=session_id,
        question_id=question_id,
        created_at=datetime.fromisoformat(qrow["created_at"]),
        plan={"outline": outline, "nodes": nodes},
        unlocked_order=int(s2.get("unlocked_order", 0)),
    )


@app.post("/sessions/{session_id}/nodes/{node_id}/submit", response_model=SubmitAnswerOut)
async def submit(session_id: str, node_id: str, body: SubmitAnswerIn) -> SubmitAnswerOut:
    s = db.get_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    if s["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="forbidden")

    plan = db.get_plan(session_id)
    if not plan:
        raise HTTPException(status_code=400, detail="no plan yet; call /ask first")

    nodes = plan["nodes"]
    node = next((n for n in nodes if str(n.get("node_id")) == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail="node not found")

    order = int(node.get("order") or 0)
    unlocked = int(s.get("unlocked_order", 0))
    if order > unlocked:
        raise HTTPException(status_code=409, detail="node locked")

    pass_score = int(node.get("pass_score") or 70)
    rubric = list(node.get("grading_rubric") or [])
    grade = await grade_answer(
        title=str(node.get("title", "")),
        knowledge_goal=str(node.get("knowledge_goal", "")),
        practice_task=str(node.get("practice_task", "")),
        rubric=rubric,
        pass_score=pass_score,
        answer=body.answer,
    )

    attempt_id = str(uuid.uuid4())
    db.insert_attempt(
        attempt_id=attempt_id,
        session_id=session_id,
        user_id=body.user_id,
        node_id=node_id,
        node_order=order,
        answer=body.answer,
        score=int(grade["score"]),
        passed=bool(grade["passed"]),
        feedback=str(grade["feedback"]),
    )

    new_unlocked = unlocked
    if grade["passed"]:
        new_unlocked = max(unlocked, order + 1)
        db.set_unlocked_order(session_id, new_unlocked)

        # 图谱更新（可选）
        if sb:
            try:
                sb.update_practice(body.user_id, str(node.get("title", "")), int(grade["score"]))
            except Exception:
                pass

    finished = False
    if nodes:
        max_order = max(int(n.get("order") or 0) for n in nodes)
        finished = new_unlocked > max_order

    return SubmitAnswerOut(
        node_id=node_id,
        order=order,
        grade=grade,
        unlocked_order=new_unlocked,
        finished=finished,
    )


@app.get("/graph", response_model=GraphOut)
def get_graph(user_id: str) -> GraphOut:
    if not sb:
        raise HTTPException(status_code=503, detail="supabase not available")
    try:
        data = sb.get_graph(user_id)
        return GraphOut(nodes=data["nodes"], edges=data["edges"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"supabase error: {e}")


@app.post("/graph/upload")
def upload_graph(body: GraphUploadIn) -> dict[str, str]:
    if not sb:
        raise HTTPException(status_code=503, detail="supabase not available")
    try:
        sb.upload_graph(body.user_id, body.nodes, body.edges)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"supabase error: {e}")

