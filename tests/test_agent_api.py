"""Isolated HTTP integration tests. No personal .data directory or paid API is used."""
from __future__ import annotations

import importlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import UUID, uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
SYNTHETIC_TEXT = (
    "Demo Candidate\nEducation: Example University, Computer Science, Bachelor, 2023-2027\n"
    "Skills: Python, SQL, PyTorch, Git\nProject: Model evaluation course project. "
    "I cleaned public data and measured model errors. No employment experience."
)


def docx_bytes(text=SYNTHETIC_TEXT):
    """A valid minimal OOXML document, generated in memory from synthetic text."""
    from xml.sax.saxutils import escape

    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        paragraphs = "".join(f"<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>" for line in text.splitlines())
        archive.writestr("word/document.xml", f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}</w:body></w:document>')
    return output.getvalue()


def pdf_bytes():
    """Real selectable PDF text, without an extra report-generation dependency."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 50 700 Td (Demo Candidate - Python SQL - Example University.) Tj 0 -20 Td (Course project: model evaluation and public data analysis.) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class AgentAPITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix="interview-api-test-")
        cls.env = patch.dict(os.environ, {"JOB_AUTOFILL_DATA_DIR": cls.scratch.name, "AGENT_PROVIDER": "mock", "LLM_API_KEY": "", "LLM_MODEL": "", "APP_ACCESS_TOKEN": "", "APP_ALLOWED_HOSTS": "127.0.0.1,localhost,testserver", "APP_ALLOWED_ORIGINS": ""})
        cls.env.start()
        cls.module = importlib.import_module("app")
        cls.client = TestClient(cls.module.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.env.stop()
        cls.scratch.cleanup()

    def assert_ok(self, response, status=200):
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def demo_session(self, prepare=True):
        demo = self.assert_ok(self.client.post("/api/agent/demo"))
        session = self.assert_ok(self.client.post("/api/agent/sessions", json={"resume_id": demo["resume_id"], "jd": demo["jd"], "title": "Isolated demo interview", "question_count": 3}))
        UUID(session["id"])
        if prepare:
            session = self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/prepare"))
        return session

    def answer(self, session, text="我还不太清楚，需要先学习相关概念。", request_id=None):
        return self.client.post(f"/api/agent/sessions/{session['id']}/answer", json={"question_id": session["current_question"]["id"], "answer": text, "request_id": request_id or str(uuid4())})

    def test_config_demo_and_local_origin_protection(self):
        config = self.assert_ok(self.client.get("/api/agent/config"))
        self.assertIn("mock", str(config))
        self.assertNotIn("api_key", config)
        self.assertNotIn("LLM_API_KEY", config)
        demo = self.assert_ok(self.client.get("/api/agent/demo"))
        self.assertGreater(len(demo["resume_text"]), 60)
        self.assertGreater(len(demo["jd"]), 20)
        self.assertEqual(self.client.post("/api/agent/demo", headers={"Origin": "https://unrelated.example"}).status_code, 403)

    def test_real_docx_and_pdf_text_extraction(self):
        for filename, content, mime, expected in [
            ("demo.docx", docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Example University"),
            ("demo.pdf", pdf_bytes(), "application/pdf", "Python SQL"),
        ]:
            with self.subTest(filename=filename):
                result = self.assert_ok(self.client.post("/api/agent/resumes", files={"file": (filename, content, mime)}))
                UUID(result["id"])
                self.assertIn(expected, result["text"])
                self.assertTrue(result["filename"].endswith(Path(filename).suffix))

    def test_bad_file_formats_and_size_have_explicit_errors(self):
        cases = [
            ("resume.exe", b"not a document", "application/octet-stream", 415),
            ("resume.pdf", b"not a PDF", "application/pdf", 422),
            ("resume.docx", b"not a ZIP", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 422),
            ("large.pdf", b"%PDF-1.7\n" + b"x" * (13 * 1024 * 1024), "application/pdf", 413),
        ]
        for filename, content, mime, status in cases:
            with self.subTest(filename=filename):
                response = self.client.post("/api/agent/resumes", files={"file": (filename, content, mime)})
                result = self.assert_ok(response, status)
                self.assertTrue(result["detail"])
                self.assertNotIn("Traceback", response.text)

    def test_empty_document_is_not_a_fake_success(self):
        response = self.client.post("/api/agent/resumes", files={"file": ("empty.docx", docx_bytes(""), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
        self.assert_ok(response, 422)

    def test_create_validation_and_missing_records(self):
        missing = str(uuid4())
        self.assert_ok(self.client.get(f"/api/agent/sessions/{missing}"), 404)
        self.assert_ok(self.client.post("/api/agent/sessions", json={"resume_id": missing, "jd": "Python engineering role requiring programming and model evaluation"}), 404)
        self.assert_ok(self.client.post("/api/agent/sessions", json={"resume_id": missing, "jd": "short", "question_count": 2}), 422)
        self.assert_ok(self.client.post("/api/agent/sessions", json={"resume_id": missing, "jd": "Python engineering role requiring programming and model evaluation", "unknown": "discarding unknown input would be unsafe"}), 422)

    def test_prepare_produces_structured_matching_and_layered_questions(self):
        session = self.demo_session()
        self.assertEqual(session["status"], "awaiting_answer")
        self.assertEqual(session["mode"], "mock")
        self.assertTrue(session["resume"]["education"])
        self.assertTrue(session["resume"]["skills"])
        self.assertTrue(session["resume"]["projects"])
        self.assertTrue(session["jd_parsed"]["requirements"])
        self.assertGreaterEqual(session["analysis"]["score"], 0)
        self.assertLessEqual(session["analysis"]["score"], 100)
        self.assertTrue(session["analysis"]["suggestions"])
        self.assertEqual(len(session["questions"]), 3)
        self.assertEqual({item["level"] for item in session["questions"]}, {"基础", "项目", "进阶"})
        self.assertTrue(session["events"])

    def test_answer_is_idempotent_and_stale_question_rejected(self):
        session = self.demo_session()
        request_id = str(uuid4())
        payload = {"question_id": session["current_question"]["id"], "answer": "我还没有相关经验，不确定如何验证。", "request_id": request_id}
        endpoint = f"/api/agent/sessions/{session['id']}/answer"
        first = self.assert_ok(self.client.post(endpoint, json=payload))
        repeated = self.assert_ok(self.client.post(endpoint, json=payload))
        self.assertEqual(len(first["turns"]), len(repeated["turns"]))
        self.assertEqual(first["turns"][0]["id"], repeated["turns"][0]["id"])
        self.assert_ok(self.client.post(endpoint, json={**payload, "request_id": str(uuid4())}), 409)
        self.assert_ok(self.client.post(endpoint, json={**payload, "answer": "同一请求号的不同内容不能再次执行"}), 409)

    def test_complete_interview_followup_report_review_and_reload(self):
        session = self.demo_session()
        for _ in range(10):
            if session["status"] == "ready_report":
                break
            session = self.assert_ok(self.answer(session))
        self.assertEqual(session["status"], "ready_report", session)
        self.assertLessEqual(len(session["turns"]), 6, "Three initial questions permit at most one follow-up each")
        self.assertGreater(len(session["turns"]), 3, "Weak answers should exercise the follow-up path")
        self.assertTrue(session["weak_points"])
        for turn in session["turns"]:
            evaluation = turn["evaluation"]
            self.assertEqual(set(evaluation["scores"]), {"accuracy", "logic", "authenticity", "job_match", "expression"})
            self.assertTrue(all(0 <= score <= 5 for score in evaluation["scores"].values()))
            self.assertTrue(evaluation["reference_answer"])
            self.assertTrue(evaluation["authenticity_note"])
        finished = self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/finish"))
        self.assertEqual(finished["status"], "completed")
        self.assertTrue(finished["report"])
        self.assertIn("mock", str(finished["report"]).lower())
        self.assertGreaterEqual(finished["report"]["average_score"], 0)
        self.assertLessEqual(finished["report"]["average_score"], 100)
        self.assertEqual(len(finished["report"]["dimensions"]), 5)
        review = self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/review", json={"turn_id": session["turns"][0]["id"], "answer": "我未实际参与生产系统，只在课程中使用公开数据。我的验证步骤是划分独立测试集，再检查误差与失败案例，最后对照基线复测。", "request_id": str(uuid4())}))
        self.assertTrue(review)
        reloaded = self.assert_ok(self.client.get(f"/api/agent/sessions/{session['id']}"))
        self.assertEqual(reloaded["report"]["average_score"], finished["report"]["average_score"])
        self.assertEqual(reloaded["report"]["review_count"], 1)
        self.assertEqual(len(reloaded["reviews"]), 1)
        self.assertTrue(any(item["reviewed"] for item in reloaded["weak_points"]))
        self.assertEqual(len(reloaded["turns"]), len(finished["turns"]))
        self.assertIn(session["id"], str(self.assert_ok(self.client.get("/api/agent/sessions"))))

    def test_timeout_retains_completed_node_and_retry_resumes(self):
        from interview.providers import ProviderError

        service = self.module.app.state.agent_service
        original = service.provider
        session = self.demo_session(prepare=False)

        class TimeoutJD:
            def generate(self, task, payload, schema):
                if task == "parse_jd":
                    raise ProviderError("model_timeout", "模型调用超时，请重试", True)
                return original.generate(task, payload, schema)

        with patch.object(service, "provider", TimeoutJD()):
            failed = self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/prepare"))
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["error"]["code"], "model_timeout")
        self.assertTrue(failed["error"]["message"])
        self.assertIsNotNone(failed["resume"])
        self.assertIsNone(failed["jd_parsed"])
        resumed = self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/retry"))
        self.assertEqual(resumed["status"], "awaiting_answer")
        self.assertEqual(resumed["resume"], failed["resume"])
        self.assertEqual(sum(event["stage"] == "parse_resume" and event["status"] == "completed" for event in resumed["events"]), 1)

    def test_invalid_structured_model_output_is_explicit_failure(self):
        service = self.module.app.state.agent_service
        session = self.demo_session(prepare=False)

        class InvalidOutput:
            def generate(self, task, payload, schema):
                return {"education": "this is not an array", "fabricated_field": True}

        with patch.object(service, "provider", InvalidOutput()):
            failed = self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/prepare"))
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["error"]["code"], "invalid_output")
        self.assertIsNone(failed["resume"])
        self.assertEqual(failed["questions"], [])
        self.assertEqual(self.assert_ok(self.client.get(f"/api/agent/sessions/{session['id']}"))["error"], failed["error"])

    def test_failed_answer_retained_then_retried_once(self):
        from interview.providers import ProviderError

        service = self.module.app.state.agent_service
        session = self.demo_session()

        class TimeoutEvaluation:
            def generate(self, task, payload, schema):
                raise ProviderError("model_timeout", "评分超时，请重试", True)

        answer = "这段需要保留的回答来自合成测试，不是真实用户数据。"
        with patch.object(service, "provider", TimeoutEvaluation()):
            failed = self.assert_ok(self.answer(session, answer))
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["turns"], [])
        self.assertEqual(failed["pending"]["answer"], answer)
        retried = self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/retry"))
        self.assertEqual(len(retried["turns"]), 1)
        self.assertEqual(retried["turns"][0]["answer"], answer)
        self.assertIsNone(retried["pending"])
        self.assert_ok(self.client.post(f"/api/agent/sessions/{session['id']}/retry"), 409)

    def test_external_model_requires_explicit_consent(self):
        demo = self.assert_ok(self.client.post("/api/agent/demo"))
        payload = {"resume_id": demo["resume_id"], "jd": demo["jd"], "question_count": 3}
        service = self.module.app.state.agent_service
        with patch.object(service, "mode", "openai_compatible"):
            self.assert_ok(self.client.post("/api/agent/sessions", json=payload), 400)
            consented = self.assert_ok(self.client.post("/api/agent/sessions", json={**payload, "allow_external_model": True}))
            self.assertEqual(consented["mode"], "openai_compatible")
        # Restoring mock cannot silently reprocess a real-model session.
        self.assert_ok(self.client.post(f"/api/agent/sessions/{consented['id']}/prepare"), 409)

    def test_delete_session_does_not_delete_legacy_materials(self):
        profile = {"profile": {"fullNameCn": "Synthetic Example", "targetCity": "北京、南京"}, "education": [{"school": "Example University", "degree": "本科"}], "primary_education": 0}
        self.assert_ok(self.client.put("/api/profile", json=profile))
        self.assert_ok(self.client.post("/api/resumes", data={"name": "Legacy synthetic material", "tags": "Python"}, files={"file": ("legacy.txt", b"Synthetic Python resume.", "text/plain")}))
        self.assert_ok(self.client.post("/api/projects", json={"project_name": "Legacy example project", "content": "Synthetic course project", "variant_name": "General"}))
        before_profile = self.assert_ok(self.client.get("/api/profile"))
        before_resumes = self.assert_ok(self.client.get("/api/resumes"))
        before_projects = self.assert_ok(self.client.get("/api/projects"))
        session = self.demo_session()
        response = self.client.delete(f"/api/agent/sessions/{session['id']}")
        self.assertEqual(response.status_code, 204, response.text)
        self.assert_ok(self.client.get(f"/api/agent/sessions/{session['id']}"), 404)
        self.assertEqual(self.assert_ok(self.client.get("/api/profile")), before_profile)
        self.assertEqual(self.assert_ok(self.client.get("/api/resumes")), before_resumes)
        self.assertEqual(self.assert_ok(self.client.get("/api/projects")), before_projects)


class DeploymentAccessTest(unittest.TestCase):
    """A fresh process ensures startup configuration and auth cannot be cached away."""

    def run_isolated(self, code, overrides):
        with tempfile.TemporaryDirectory(prefix="interview-auth-test-") as directory:
            environment = {**os.environ, "JOB_AUTOFILL_DATA_DIR": directory, "AGENT_PROVIDER": "mock", "LLM_API_KEY": "", "LLM_MODEL": "", "APP_ACCESS_TOKEN": "", "APP_ALLOWED_HOSTS": "127.0.0.1,localhost,testserver", "APP_ALLOWED_ORIGINS": "", "PYTHONUTF8": "1", **overrides}
            return subprocess.run([sys.executable, "-c", code], cwd=ROOT / "backend", env=environment, text=True, encoding="utf-8", capture_output=True, timeout=30, check=False)

    def test_token_protects_agent_and_legacy_data(self):
        code = '''
import os
from fastapi.testclient import TestClient
import app
with TestClient(app.app) as client:
    token = os.environ["APP_ACCESS_TOKEN"]
    headers = {"x-agent-token": token}
    assert client.get("/api/health").status_code == 200
    config = client.get("/api/agent/config")
    assert config.status_code == 200 and config.json()["requires_token"] is True
    assert token not in config.text
    for endpoint in ("/api/profile", "/api/resumes", "/api/projects", "/api/agent/demo", "/api/agent/sessions"):
        assert client.get(endpoint).status_code == 401, endpoint
        assert client.get(endpoint, headers={"x-agent-token": "incorrect"}).status_code == 401, endpoint
        assert client.get(endpoint, headers=headers).status_code == 200, endpoint
    assert client.post("/api/agent/demo").status_code == 401
    assert client.put("/api/profile", json={"profile": {"fullNameCn": "Synthetic only"}}).status_code == 401
    assert client.get("/api/profile", headers={**headers, "Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/profile", headers={**headers, "Origin": "https://interview.example"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "untrusted.example"}).status_code == 400
print("token and origin checks passed")
'''
        result = self.run_isolated(code, {"APP_ACCESS_TOKEN": uuid4().hex, "APP_ALLOWED_HOSTS": "testserver,interview.example", "APP_ALLOWED_ORIGINS": "https://interview.example"})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("token and origin checks passed", result.stdout)

    def test_remote_or_short_token_configuration_refuses_startup(self):
        for configuration in (
            {"APP_ALLOWED_HOSTS": "testserver,interview.example"},
            {"APP_ALLOWED_ORIGINS": "https://interview.example"},
            {"APP_ACCESS_TOKEN": "too-short"},
        ):
            with self.subTest(configuration=configuration):
                result = self.run_isolated("import app", configuration)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("RuntimeError", result.stderr)
                self.assertIn("APP_ACCESS_TOKEN", result.stderr)


if __name__ == "__main__":
    unittest.main()
