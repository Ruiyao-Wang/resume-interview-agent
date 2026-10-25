from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class StoreError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


class InterviewStore:
    """Independent tables, atomic state writes and one operation lease per session."""

    def __init__(self, data_dir: Path):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.database = data_dir / "interview.sqlite3"
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS agent_resumes (
                    id TEXT PRIMARY KEY, filename TEXT NOT NULL, text TEXT NOT NULL,
                    created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_sessions (
                    id TEXT PRIMARY KEY, state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL, lease TEXT, lease_until REAL NOT NULL DEFAULT 0);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def add_resume(self, filename: str, text: str) -> dict:
        item = {"id": str(uuid4()), "filename": filename, "text": text, "created_at": now()}
        with self.connect() as db:
            db.execute("INSERT INTO agent_resumes VALUES (:id,:filename,:text,:created_at)", item)
        return item

    def resume(self, resume_id: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT * FROM agent_resumes WHERE id=?", (resume_id,)).fetchone()
        if row is None:
            raise StoreError(404, "简历不存在，请重新上传")
        return dict(row)

    def create(self, state: dict) -> dict:
        with self.connect() as db:
            db.execute("INSERT INTO agent_sessions(id,state_json,updated_at) VALUES(?,?,?)",
                       (state["id"], json.dumps(state, ensure_ascii=False), state["updated_at"]))
        return state

    def get(self, session_id: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT state_json FROM agent_sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise StoreError(404, "面试会话不存在")
        return json.loads(row["state_json"])

    def list(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT state_json FROM agent_sessions ORDER BY updated_at DESC LIMIT 100").fetchall()
        return [{key: state.get(key) for key in ("id", "title", "status", "stage", "created_at", "updated_at", "mode")}
                | {"answered": len(state["turns"]), "total": len(state["questions"])}
                for state in (json.loads(row["state_json"]) for row in rows)]

    def save(self, state: dict, lease: str):
        state["updated_at"] = now()
        with self.connect() as db:
            changed = db.execute("UPDATE agent_sessions SET state_json=?,updated_at=? WHERE id=? AND lease=?",
                                 (json.dumps(state, ensure_ascii=False), state["updated_at"], state["id"], lease)).rowcount
        if changed != 1:
            raise StoreError(409, "会话已被其他操作更新，请刷新后重试")

    @contextmanager
    def claim(self, session_id: str):
        token = str(uuid4())
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT lease_until FROM agent_sessions WHERE id=?", (session_id,)).fetchone()
            if row is None:
                raise StoreError(404, "面试会话不存在")
            if row["lease_until"] > time.time():
                raise StoreError(409, "此面试正在处理另一个操作，请稍后重试")
            db.execute("UPDATE agent_sessions SET lease=?,lease_until=? WHERE id=?", (token, time.time() + 3600, session_id))
        try:
            yield self.get(session_id), token
        finally:
            with self.connect() as db:
                db.execute("UPDATE agent_sessions SET lease=NULL,lease_until=0 WHERE id=? AND lease=?", (session_id, token))

    def recover_interrupted(self):
        """Called once at single-worker server startup, never during ordinary reads."""
        with self.connect() as db:
            rows = db.execute("SELECT id,state_json FROM agent_sessions WHERE lease IS NOT NULL").fetchall()
            for row in rows:
                state = json.loads(row["state_json"])
                if state["status"] == "running":
                    state["status"] = "failed"
                    state["error"] = {"code": "interrupted", "message": "上次运行被中断，可从已完成节点继续", "stage": state["stage"], "retryable": True}
                db.execute("UPDATE agent_sessions SET state_json=?,lease=NULL,lease_until=0 WHERE id=?", (json.dumps(state, ensure_ascii=False), row["id"]))

    def delete(self, session_id: str):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state_json,lease_until FROM agent_sessions WHERE id=?", (session_id,)).fetchone()
            if row is None:
                raise StoreError(404, "面试会话不存在")
            if row["lease_until"] > time.time():
                raise StoreError(409, "正在处理的面试不能删除")
            resume_id = json.loads(row["state_json"])["resume_id"]
            db.execute("DELETE FROM agent_sessions WHERE id=?", (session_id,))
            states = db.execute("SELECT state_json FROM agent_sessions").fetchall()
            if not any(json.loads(item["state_json"])["resume_id"] == resume_id for item in states):
                db.execute("DELETE FROM agent_resumes WHERE id=?", (resume_id,))
