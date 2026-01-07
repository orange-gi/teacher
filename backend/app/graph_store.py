from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from neo4j import GraphDatabase

from .settings import settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _brightness_from_time(last: datetime | None) -> float:
    """
    星空亮度：越近越亮（时间衰减）。
    - 使用指数衰减：brightness = max(0.08, exp(-days/30))
    """

    if not last:
        return 0.12
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    days = max(0.0, (_utcnow() - last.astimezone(timezone.utc)).total_seconds() / 86400.0)
    b = math.exp(-days / 30.0)
    return float(max(0.08, min(1.0, b)))


class Neo4jStore:
    def __init__(self) -> None:
        self._driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password))

    def close(self) -> None:
        self._driver.close()

    def ensure_schema(self) -> None:
        cyphers = [
            "CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE",
            "CREATE INDEX IF NOT EXISTS FOR (c:Concept) ON (c.name)",
        ]
        with self._driver.session() as s:
            for c in cyphers:
                s.run(c)

    def upsert_plan_concepts(self, user_id: str, session_id: str, nodes: list[dict[str, Any]]) -> None:
        """
        将学习计划写入图谱：
        - Concept: 用 title 作为 name；id 用稳定 hash（避免重复插入）
        - PREREQ: 按顺序串联（前一个 -> 后一个）
        - Session/Question 最小化：这里只关联 User 与 Concept
        """

        def stable_id(name: str) -> str:
            # 轻量稳定 ID：避免同名概念重复
            import hashlib

            return hashlib.sha1(name.encode("utf-8")).hexdigest()[:16]

        concepts = []
        for n in nodes:
            name = str(n.get("title") or n.get("name") or "").strip()
            if not name:
                continue
            concepts.append({"id": stable_id(name), "name": name, "level": int(n.get("order") or 0)})

        with self._driver.session() as s:
            s.run("MERGE (u:User {id:$uid})", uid=user_id)
            for c in concepts:
                s.run(
                    """
                    MERGE (c:Concept {id:$id})
                    SET c.name=$name, c.level=$level, c.updated_at=datetime()
                    ON CREATE SET c.created_at=datetime()
                    """,
                    **c,
                )
                # 视为“看过”：但亮度主要用 PRACTICED 的 last_practice_at
                s.run(
                    """
                    MATCH (u:User {id:$uid}), (c:Concept {id:$cid})
                    MERGE (u)-[r:SEEN]->(c)
                    SET r.last_seen_at=datetime()
                    """,
                    uid=user_id,
                    cid=c["id"],
                )

            # 串联先修
            for a, b in zip(concepts, concepts[1:]):
                s.run(
                    """
                    MATCH (a:Concept {id:$a}), (b:Concept {id:$b})
                    MERGE (a)-[:PREREQ]->(b)
                    """,
                    a=a["id"],
                    b=b["id"],
                )

    def update_practice(self, user_id: str, concept_title: str, score: int, passed: bool) -> None:
        import hashlib

        cid = hashlib.sha1(concept_title.encode("utf-8")).hexdigest()[:16]
        with self._driver.session() as s:
            s.run("MERGE (u:User {id:$uid})", uid=user_id)
            s.run(
                """
                MERGE (c:Concept {id:$cid})
                ON CREATE SET c.name=$name, c.created_at=datetime(), c.updated_at=datetime()
                ON MATCH SET c.updated_at=datetime()
                """,
                cid=cid,
                name=concept_title,
            )
            s.run(
                """
                MATCH (u:User {id:$uid}), (c:Concept {id:$cid})
                MERGE (u)-[r:PRACTICED]->(c)
                ON CREATE SET r.attempts=0, r.mastery_score=0.0
                SET r.attempts = r.attempts + 1,
                    r.last_practice_at = datetime(),
                    r.last_score = $score,
                    r.last_passed = $passed,
                    r.mastery_score = coalesce(r.mastery_score, 0.0) * 0.7 + ($score / 100.0) * 0.3
                """,
                uid=user_id,
                cid=cid,
                score=int(score),
                passed=bool(passed),
            )

    def upload_graph(self, user_id: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        """
        用户上传图谱：nodes/edges 合并入 Concept 与 PREREQ/REL。
        """

        def stable_id(name: str) -> str:
            import hashlib

            return hashlib.sha1(name.encode("utf-8")).hexdigest()[:16]

        with self._driver.session() as s:
            s.run("MERGE (u:User {id:$uid})", uid=user_id)

            for n in nodes:
                name = str(n.get("name") or n.get("title") or "").strip()
                if not name:
                    continue
                cid = stable_id(name)
                level = int(n.get("level") or 0)
                s.run(
                    """
                    MERGE (c:Concept {id:$cid})
                    SET c.name=$name, c.level=$level, c.updated_at=datetime()
                    ON CREATE SET c.created_at=datetime()
                    """,
                    cid=cid,
                    name=name,
                    level=level,
                )
                s.run(
                    """
                    MATCH (u:User {id:$uid}), (c:Concept {id:$cid})
                    MERGE (u)-[r:SEEN]->(c)
                    SET r.last_seen_at=datetime()
                    """,
                    uid=user_id,
                    cid=cid,
                )

            for e in edges:
                a = str(e.get("from") or e.get("source") or "").strip()
                b = str(e.get("to") or e.get("target") or "").strip()
                if not a or not b:
                    continue
                typ = str(e.get("type") or "PREREQ").upper()
                rel = "PREREQ" if typ == "PREREQ" else "REL"
                s.run(
                    f"""
                    MATCH (a:Concept {{id:$a}}), (b:Concept {{id:$b}})
                    MERGE (a)-[:{rel}]->(b)
                    """,
                    a=stable_id(a),
                    b=stable_id(b),
                )

    def get_graph(self, user_id: str) -> dict[str, Any]:
        """
        返回用户图谱：Concept 节点 + PREREQ/REL 边。
        亮度由 last_practice_at（优先）或 last_seen_at 决定，并在后端计算。
        """

        with self._driver.session() as s:
            nodes = s.run(
                """
                MATCH (u:User {id:$uid})-[:SEEN|PRACTICED]->(c:Concept)
                OPTIONAL MATCH (u)-[p:PRACTICED]->(c)
                OPTIONAL MATCH (u)-[v:SEEN]->(c)
                RETURN DISTINCT
                  c.id AS id,
                  c.name AS name,
                  c.level AS level,
                  p.last_practice_at AS last_practice_at,
                  v.last_seen_at AS last_seen_at,
                  p.mastery_score AS mastery_score
                """,
                uid=user_id,
            ).data()

            edges = s.run(
                """
                MATCH (u:User {id:$uid})-[:SEEN|PRACTICED]->(a:Concept)
                MATCH (a)-[r:PREREQ|REL]->(b:Concept)
                RETURN DISTINCT a.id AS source, b.id AS target, type(r) AS type
                """,
                uid=user_id,
            ).data()

        out_nodes = []
        for n in nodes:
            last = n.get("last_practice_at") or n.get("last_seen_at")
            # neo4j datetime -> python datetime（neo4j driver 返回的是 neo4j.time.DateTime）
            py_last = None
            if last is not None:
                try:
                    py_last = last.to_native()
                except Exception:
                    py_last = None
            brightness = _brightness_from_time(py_last)
            out_nodes.append(
                {
                    "id": n["id"],
                    "name": n["name"],
                    "level": n.get("level"),
                    "brightness": brightness,
                    "last_practice_at": py_last.isoformat() if py_last else None,
                    "mastery_score": float(n["mastery_score"]) if n.get("mastery_score") is not None else None,
                }
            )

        out_edges = [{"source": e["source"], "target": e["target"], "type": e["type"]} for e in edges]
        return {"nodes": out_nodes, "edges": out_edges}

