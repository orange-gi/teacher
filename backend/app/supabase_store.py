from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

from .settings import settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _brightness_from_time(last: datetime | None) -> float:
    # 与前端星空一致：指数衰减 + 底亮度
    if not last:
        return 0.12
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    days = max(0.0, (_utcnow() - last.astimezone(timezone.utc)).total_seconds() / 86400.0)
    b = math.exp(-days / 30.0)
    return float(max(0.08, min(1.0, b)))


def _stable_id(name: str) -> str:
    return hashlib.sha1(name.encode("utf-8")).hexdigest()[:16]


class SupabaseStore:
    """
    通过 Supabase PostgREST 读写（使用 publishable/anon key）。
    需要在 Supabase 中创建表（见 /supabase/schema.sql）。
    """

    def __init__(self) -> None:
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise RuntimeError("Supabase 未配置：请设置 APP_SUPABASE_URL / APP_SUPABASE_ANON_KEY")

        self._base = settings.supabase_url.rstrip("/")
        self._key = settings.supabase_anon_key
        self._schema = settings.supabase_schema or "public"

        self._headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        }

    def _rest(self, path: str) -> str:
        return f"{self._base}/rest/v1{path}"

    def upsert_plan_concepts(self, user_id: str, nodes: list[dict[str, Any]]) -> None:
        concepts = []
        for n in nodes:
            title = str(n.get("title") or n.get("name") or "").strip()
            if not title:
                continue
            concepts.append(
                {
                    "user_id": user_id,
                    "concept_id": _stable_id(title),
                    "name": title,
                    "level": int(n.get("order") or n.get("level") or 0),
                    "last_seen_at": _utcnow().isoformat(),
                    "updated_at": _utcnow().isoformat(),
                }
            )

        edges = []
        # 默认按顺序串联 prereq
        for a, b in zip(concepts, concepts[1:]):
            edges.append(
                {
                    "user_id": user_id,
                    "source_id": a["concept_id"],
                    "target_id": b["concept_id"],
                    "type": "PREREQ",
                    "updated_at": _utcnow().isoformat(),
                }
            )

        with httpx.Client(timeout=20) as c:
            if concepts:
                c.post(
                    self._rest("/user_concepts?on_conflict=user_id,concept_id"),
                    headers={**self._headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                    json=concepts,
                ).raise_for_status()
            if edges:
                c.post(
                    self._rest("/user_edges?on_conflict=user_id,source_id,target_id,type"),
                    headers={**self._headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                    json=edges,
                ).raise_for_status()

    def update_practice(self, user_id: str, concept_title: str, score: int) -> None:
        cid = _stable_id(concept_title)
        # mastery_score：简单 EMA
        with httpx.Client(timeout=20) as c:
            # 先读旧 mastery_score
            r = c.get(
                self._rest(f"/user_concepts?user_id=eq.{user_id}&concept_id=eq.{cid}&select=mastery_score"),
                headers=self._headers,
            )
            r.raise_for_status()
            rows = r.json()
            old = float(rows[0]["mastery_score"]) if rows and rows[0].get("mastery_score") is not None else 0.0
            new = old * 0.7 + (float(score) / 100.0) * 0.3

            payload = {
                "user_id": user_id,
                "concept_id": cid,
                "name": concept_title,
                "last_practice_at": _utcnow().isoformat(),
                "mastery_score": new,
                "updated_at": _utcnow().isoformat(),
            }
            c.post(
                self._rest("/user_concepts?on_conflict=user_id,concept_id"),
                headers={**self._headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                json=[payload],
            ).raise_for_status()

    def upload_graph(self, user_id: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        concepts = []
        for n in nodes:
            name = str(n.get("name") or n.get("title") or "").strip()
            if not name:
                continue
            concepts.append(
                {
                    "user_id": user_id,
                    "concept_id": _stable_id(name),
                    "name": name,
                    "level": int(n.get("level") or 0),
                    "last_seen_at": _utcnow().isoformat(),
                    "updated_at": _utcnow().isoformat(),
                }
            )

        rels = []
        for e in edges:
            a = str(e.get("from") or e.get("source") or "").strip()
            b = str(e.get("to") or e.get("target") or "").strip()
            if not a or not b:
                continue
            typ = str(e.get("type") or "PREREQ").upper()
            rels.append(
                {
                    "user_id": user_id,
                    "source_id": _stable_id(a),
                    "target_id": _stable_id(b),
                    "type": "PREREQ" if typ == "PREREQ" else "REL",
                    "updated_at": _utcnow().isoformat(),
                }
            )

        with httpx.Client(timeout=20) as c:
            if concepts:
                c.post(
                    self._rest("/user_concepts?on_conflict=user_id,concept_id"),
                    headers={**self._headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                    json=concepts,
                ).raise_for_status()
            if rels:
                c.post(
                    self._rest("/user_edges?on_conflict=user_id,source_id,target_id,type"),
                    headers={**self._headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                    json=rels,
                ).raise_for_status()

    def get_graph(self, user_id: str) -> dict[str, Any]:
        with httpx.Client(timeout=20) as c:
            rn = c.get(
                self._rest(f"/user_concepts?user_id=eq.{user_id}&select=concept_id,name,level,last_seen_at,last_practice_at,mastery_score"),
                headers=self._headers,
            )
            rn.raise_for_status()
            re = c.get(
                self._rest(f"/user_edges?user_id=eq.{user_id}&select=source_id,target_id,type"),
                headers=self._headers,
            )
            re.raise_for_status()

        nodes = []
        for r in rn.json():
            last = r.get("last_practice_at") or r.get("last_seen_at")
            last_dt = None
            if last:
                try:
                    last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                except Exception:
                    last_dt = None
            nodes.append(
                {
                    "id": r["concept_id"],
                    "name": r["name"],
                    "level": r.get("level"),
                    "brightness": _brightness_from_time(last_dt),
                    "last_practice_at": r.get("last_practice_at"),
                    "mastery_score": r.get("mastery_score"),
                }
            )

        edges = [{"source": e["source_id"], "target": e["target_id"], "type": e["type"]} for e in re.json()]
        return {"nodes": nodes, "edges": edges}

