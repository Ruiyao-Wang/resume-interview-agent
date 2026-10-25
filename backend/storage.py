from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class Storage:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.resume_dir = data_dir / "resumes"
        self.resume_dir.mkdir(parents=True, exist_ok=True)
        self.database = data_dir / "autofill.sqlite3"
        self._initialize()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.database)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self):
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS resumes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    original_filename TEXT NOT NULL,
                    stored_filename TEXT NOT NULL,
                    extracted_text TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    category TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    variants_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def _resume(row):
        item = dict(row)
        item["tags"] = json.loads(item.pop("tags_json"))
        item["file_path"] = item.pop("stored_filename")
        return item

    @staticmethod
    def _project(row):
        item = dict(row)
        item["tags"] = json.loads(item.pop("tags_json"))
        item["variants"] = json.loads(item.pop("variants_json"))
        return item

    def list_resumes(self):
        with self.connect() as connection:
            return [self._resume(row) for row in connection.execute("SELECT * FROM resumes ORDER BY created_at DESC")]

    def get_profile(self):
        with self.connect() as connection:
            row = connection.execute("SELECT value_json FROM settings WHERE key='profile'").fetchone()
        return json.loads(row["value_json"]) if row else {"profile": {}, "education": [], "primary_education": 0}

    def save_profile(self, data):
        with self.connect() as connection:
            connection.execute("INSERT INTO settings (key, value_json) VALUES ('profile', ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", (json.dumps(data, ensure_ascii=False),))
        return data

    def add_resume(self, name, description, tags, original_filename, content, extracted_text):
        resume_id = str(uuid4())
        suffix = Path(original_filename).suffix.lower() or ".bin"
        stored_filename = f"{resume_id}{suffix}"
        (self.resume_dir / stored_filename).write_bytes(content)
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO resumes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (resume_id, name, description, json.dumps(tags, ensure_ascii=False), original_filename, stored_filename, extracted_text, now),
            )
        return next(item for item in self.list_resumes() if item["id"] == resume_id)

    def list_projects(self):
        with self.connect() as connection:
            return [self._project(row) for row in connection.execute("SELECT * FROM projects ORDER BY updated_at DESC")]

    def update_resume(self, resume_id, name, description, tags):
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE resumes SET name=?, description=?, tags_json=? WHERE id=?",
                (name, description, json.dumps(tags, ensure_ascii=False), resume_id),
            )
            if cursor.rowcount == 0:
                return None
        return next(item for item in self.list_resumes() if item["id"] == resume_id)

    def add_project_variant(self, name, category, project_tags, variant):
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM projects WHERE name = ?", (name,)).fetchone()
            if row:
                project = self._project(row)
                variants = [item for item in project["variants"] if item.get("name") != variant.get("name")]
                variants.append(variant)
                connection.execute(
                    "UPDATE projects SET category=?, tags_json=?, variants_json=?, updated_at=? WHERE id=?",
                    (category, json.dumps(project_tags, ensure_ascii=False), json.dumps(variants, ensure_ascii=False), now, project["id"]),
                )
            else:
                project_id = str(uuid4())
                connection.execute(
                    "INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)",
                    (project_id, name, category, json.dumps(project_tags, ensure_ascii=False), json.dumps([variant], ensure_ascii=False), now),
                )
        return next(item for item in self.list_projects() if item["name"] == name)
