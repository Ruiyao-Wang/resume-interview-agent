"""Persistence, lease and deletion regression tests using disposable SQLite files."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from interview.store import InterviewStore, StoreError, now


class InterviewStoreTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="interview-store-test-")
        self.store = InterviewStore(Path(self.scratch.name))
        self.resume = self.store.add_resume("synthetic.pdf", "Synthetic course project with Python.")

    def tearDown(self):
        self.scratch.cleanup()

    def session(self):
        stamp = now()
        return self.store.create({"id": str(uuid4()), "resume_id": self.resume["id"], "title": "Example", "status": "uploaded", "stage": "resume_parse", "mode": "mock", "created_at": stamp, "updated_at": stamp, "turns": [], "questions": []})

    def test_state_survives_new_store_instance(self):
        session = self.session()
        with self.store.claim(session["id"]) as (state, lease):
            state["status"] = "awaiting_answer"
            state["questions"] = [{"id": "synthetic-question", "prompt": "Explain Python."}]
            self.store.save(state, lease)
        reopened = InterviewStore(Path(self.scratch.name))
        loaded = reopened.get(session["id"])
        self.assertEqual(loaded["status"], "awaiting_answer")
        self.assertEqual(loaded["questions"][0]["id"], "synthetic-question")
        self.assertNotIn("resume", reopened.list()[0], "History summaries should not return the full resume")

    def test_concurrent_claim_and_delete_are_rejected(self):
        session = self.session()
        with self.store.claim(session["id"]):
            with self.assertRaises(StoreError) as claimed:
                with self.store.claim(session["id"]):
                    self.fail("A second operation acquired the same active session")
            self.assertEqual(claimed.exception.status, 409)
            with self.assertRaises(StoreError) as deleted:
                self.store.delete(session["id"])
            self.assertEqual(deleted.exception.status, 409)
        with self.store.claim(session["id"]):
            self.assertEqual(self.store.get(session["id"])["status"], "uploaded")

    def test_claim_released_after_failure_and_stale_lease_rejected(self):
        session = self.session()
        with self.assertRaisesRegex(RuntimeError, "synthetic failure"):
            with self.store.claim(session["id"]) as (_, lease):
                raise RuntimeError("synthetic failure")
        with self.assertRaises(StoreError) as stale:
            self.store.save(session, lease)
        self.assertEqual(stale.exception.status, 409)
        with self.store.claim(session["id"]):
            self.assertTrue(self.store.get(session["id"]))

    def test_delete_preserves_shared_resume_until_last_session(self):
        first, second = self.session(), self.session()
        self.store.delete(first["id"])
        self.assertEqual(self.store.resume(self.resume["id"])["text"], self.resume["text"])
        self.assertEqual(self.store.get(second["id"])["id"], second["id"])
        self.store.delete(second["id"])
        with self.assertRaises(StoreError) as missing:
            self.store.resume(self.resume["id"])
        self.assertEqual(missing.exception.status, 404)

    def test_interrupted_run_becomes_explicit_recoverable_failure(self):
        session = self.session()
        session.update(status="running", stage="jd_parse", resume={"name": "Synthetic Example"})
        with self.store.connect() as db:
            db.execute("UPDATE agent_sessions SET state_json=?, lease=?, lease_until=? WHERE id=?", (json.dumps(session), "crashed-worker", 9999999999, session["id"]))
        self.store.recover_interrupted()
        state = self.store.get(session["id"])
        self.assertEqual(state["status"], "failed")
        self.assertEqual(state["error"]["code"], "interrupted")
        self.assertTrue(state["error"]["retryable"])
        self.assertEqual(state["resume"]["name"], "Synthetic Example")
        with self.store.claim(session["id"]):
            self.assertTrue(state)

    def test_unknown_ids_are_explicit_404(self):
        for operation in (self.store.get, self.store.resume, self.store.delete):
            with self.subTest(operation=operation.__name__), self.assertRaises(StoreError) as error:
                operation(str(uuid4()))
            self.assertEqual(error.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
