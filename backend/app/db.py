from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .settings import settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _parse_iso(s: str) -> datetime:
    # sqlite 里统一存 ISO8601
    return datetime.fromisoformat(s)


def ensure_db() -> None:
    db_path = Path(settings.sqlite_path)
    if not db_path.is_absolute():
        # 以 backend 目录为根（uvicorn working dir 可能变化）
        db_path = Path(__file__).resolve().parent.parent / db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS llm_config (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              base_url TEXT NOT NULL,
              api_key TEXT NOT NULL,
              model TEXT NOT NULL,
              temperature REAL NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
              session_id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              unlocked_order INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS questions (
              question_id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              question TEXT NOT NULL,
              topic_hint TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS plans (
              session_id TEXT PRIMARY KEY,
              outline TEXT NOT NULL,
              nodes_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS node_attempts (
              attempt_id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              node_order INTEGER NOT NULL,
              answer TEXT NOT NULL,
              score INTEGER NOT NULL,
              passed INTEGER NOT NULL,
              feedback TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );
            """
        )
        conn.commit()


def _db_path_str() -> str:
    db_path = Path(settings.sqlite_path)
    if not db_path.is_absolute():
        db_path = Path(__file__).resolve().parent.parent / db_path
    return str(db_path)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    ensure_db()
    conn = sqlite3.connect(_db_path_str())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def get_llm_config() -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM llm_config WHERE id = 1").fetchone()
        if row is None:
            # 默认值来自 settings（也支持用环境变量启动）
            return {
                "base_url": settings.llm_base_url,
                "api_key": settings.llm_api_key,
                "model": settings.llm_model,
                "temperature": settings.llm_temperature,
                "updated_at": _iso(_utcnow()),
            }
        return dict(row)


def upsert_llm_config(base_url: str, api_key: str, model: str, temperature: float) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO llm_config (id, base_url, api_key, model, temperature, updated_at)
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              base_url=excluded.base_url,
              api_key=excluded.api_key,
              model=excluded.model,
              temperature=excluded.temperature,
              updated_at=excluded.updated_at;
            """,
            (base_url, api_key, model, temperature, _iso(_utcnow())),
        )
        conn.commit()


def create_session(session_id: str, user_id: str, title: str) -> dict[str, Any]:
    now = _iso(_utcnow())
    with connect() as conn:
        conn.execute(
            "INSERT INTO sessions(session_id, user_id, title, created_at, updated_at, unlocked_order) VALUES(?,?,?,?,?,0)",
            (session_id, user_id, title, now, now),
        )
        conn.commit()
        return {
            "session_id": session_id,
            "user_id": user_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "unlocked_order": 0,
        }


def list_sessions(user_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT session_id, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_session(session_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
        return dict(row) if row else None


def bump_session_updated(session_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE sessions SET updated_at = ? WHERE session_id = ?", (_iso(_utcnow()), session_id))
        conn.commit()


def set_unlocked_order(session_id: str, unlocked_order: int) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE sessions SET unlocked_order = ?, updated_at = ? WHERE session_id = ?",
            (unlocked_order, _iso(_utcnow()), session_id),
        )
        conn.commit()


def insert_question(question_id: str, session_id: str, question: str, topic_hint: str | None) -> dict[str, Any]:
    now = _iso(_utcnow())
    with connect() as conn:
        conn.execute(
            "INSERT INTO questions(question_id, session_id, question, topic_hint, created_at) VALUES(?,?,?,?,?)",
            (question_id, session_id, question, topic_hint, now),
        )
        conn.execute("UPDATE sessions SET title=?, updated_at=? WHERE session_id=?",
                     (_make_title(question), now, session_id))
        conn.commit()
    return {"question_id": question_id, "created_at": now}


def _make_title(q: str) -> str:
    q = " ".join(q.strip().split())
    return q[:28] + ("…" if len(q) > 28 else "")


def upsert_plan(session_id: str, outline: str, nodes: list[dict[str, Any]]) -> None:
    now = _iso(_utcnow())
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO plans(session_id, outline, nodes_json, created_at)
            VALUES(?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET
              outline=excluded.outline,
              nodes_json=excluded.nodes_json,
              created_at=excluded.created_at;
            """,
            (session_id, outline, json.dumps(nodes, ensure_ascii=False), now),
        )
        conn.commit()


def get_plan(session_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT outline, nodes_json, created_at FROM plans WHERE session_id = ?", (session_id,)).fetchone()
        if not row:
            return None
        return {"outline": row["outline"], "nodes": json.loads(row["nodes_json"]), "created_at": row["created_at"]}


def insert_attempt(
    attempt_id: str,
    session_id: str,
    user_id: str,
    node_id: str,
    node_order: int,
    answer: str,
    score: int,
    passed: bool,
    feedback: str,
) -> None:
    now = _iso(_utcnow())
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO node_attempts(attempt_id, session_id, user_id, node_id, node_order, answer, score, passed, feedback, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (attempt_id, session_id, user_id, node_id, node_order, answer, score, 1 if passed else 0, feedback, now),
        )
        conn.commit()

