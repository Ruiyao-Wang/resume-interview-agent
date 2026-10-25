from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.interview.config import Settings
from backend.interview.providers import OpenAICompatibleProvider, ProviderError, make_provider, strict_json_schema, validate_grounding, MAX_RESPONSE_BYTES
from backend.interview.schemas import ResumeData, JDData, MatchAnalysis, QuestionSet, Evaluation


RESUME = """姓名：演示同学
教育经历
2023.09-2026.06 示例大学 硕士 通信工程专业
专业技能
Python、PyTorch、Git、MATLAB
项目经历
2025.10 多源图像语义分割课程项目
参与数据清洗与模型评测，使用 PyTorch 分析 mIoU。
实习经历
未提供实习经历
"""
JD = """视觉测试工程师
岗位要求
熟悉 Python、PyTorch 与模型评测。
掌握 SQL 和 Linux，自动化测试经验优先。
负责分析语义分割测试结果和数据泄漏问题。
"""


class ProviderTests(unittest.TestCase):
    def settings(self, **changes):
        return Settings(provider="openai_compatible", api_key="test-only-not-real", model="unit-test-model", **changes)

    @staticmethod
    def success(content):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}, "finish_reason": "stop"}]})

    def test_mock_complete_pipeline_and_no_invented_skills(self):
        provider = make_provider(Settings())
        resume = provider.generate("parse_resume", {"text": RESUME}, ResumeData)
        self.assertEqual(resume.name, "演示同学")
        self.assertEqual(resume.education[0].school, "示例大学")
        self.assertIn("Python", resume.skills)
        self.assertNotIn("SQL", resume.skills)
        self.assertEqual(len(resume.projects), 1)
        self.assertEqual(resume.internships, [])
        jd = provider.generate("parse_jd", {"text": JD}, JDData)
        payload = {"resume": resume.model_dump(), "jd": jd.model_dump(), "resume_text": RESUME, "jd_text": JD}
        analysis = provider.generate("match", payload, MatchAnalysis)
        self.assertGreater(analysis.score, 0)
        self.assertLess(analysis.score, 100)
        self.assertTrue(any("SQL" in item for item in analysis.gaps))
        question_set = provider.generate("questions", {**payload, "analysis": analysis.model_dump(), "question_count": 5}, QuestionSet)
        self.assertEqual(len(question_set.questions), 5)
        self.assertEqual(set(item.level for item in question_set.questions), {"基础", "项目", "进阶"})
        self.assertEqual(len(set(item.prompt for item in question_set.questions)), 5)
        evaluation = provider.generate("evaluate", {**payload, "question": question_set.questions[0].model_dump(),
                                        "answer": "不太清楚", "history": [], "is_review": False}, Evaluation)
        self.assertTrue(evaluation.needs_follow_up)
        self.assertTrue(evaluation.weak_topics)
        self.assertIn("Mock", evaluation.rationale)
        self.assertIn("不得", evaluation.reference_answer)
        self.assertIn("未进行事实核验", evaluation.authenticity_note)
        review = provider.generate("evaluate", {"question": question_set.questions[0].model_dump(),
                                               "answer": "我没有实践过", "is_review": True}, Evaluation)
        self.assertFalse(review.needs_follow_up)

    def test_unknown_task_is_explicit(self):
        with self.assertRaises(ProviderError) as caught:
            make_provider(Settings()).generate("not-a-task", {}, ResumeData)
        self.assertEqual(caught.exception.code, "unsupported_task")

    def test_demo_resume_has_no_fake_internship_and_two_projects(self):
        sample = (Path(__file__).resolve().parents[1] / "examples" / "resume.txt").read_text(encoding="utf-8")
        resume = make_provider(Settings()).generate("parse_resume", {"text": sample}, ResumeData)
        self.assertEqual(resume.internships, [])
        self.assertEqual(len(resume.projects), 2)
        self.assertEqual(len(resume.education), 2)

    def test_negated_skill_is_not_an_asserted_ability(self):
        provider = make_provider(Settings())
        text = "姓名：演示同学\n技能\n不会 Python，没有 SQL 项目经验；了解 Git。"
        resume = provider.generate("parse_resume", {"text": text}, ResumeData)
        self.assertNotIn("Python", resume.skills)
        self.assertNotIn("SQL", resume.skills)
        self.assertIn("Git", resume.skills)
        jd = provider.generate("parse_jd", {"text": "开发工程师\n掌握 Python、SQL。"}, JDData)
        analysis = provider.generate("match", {"resume": resume.model_dump(), "jd": jd.model_dump(), "resume_text": text}, MatchAnalysis)
        self.assertEqual(analysis.matched, [])

    def test_success_and_strict_schema(self):
        requests = []
        def handle(request):
            requests.append(json.loads(request.content))
            self.assertEqual(request.url.path, "/v1/chat/completions")
            return self.success(ResumeData(skills=["Python"]).model_dump())
        provider = OpenAICompatibleProvider(self.settings(), transport=httpx.MockTransport(handle))
        result = provider.generate("parse_resume", {"text": "untrusted resume text Python"}, ResumeData)
        self.assertEqual(result.skills, ["Python"])
        shape = requests[0]["response_format"]["json_schema"]["schema"]
        self.assertFalse(shape["additionalProperties"])
        self.assertEqual(set(shape["required"]), set(shape["properties"]))
        self.assertFalse(shape["$defs"]["Education"]["additionalProperties"])
        self.assertEqual(set(shape["$defs"]["Education"]["required"]), set(shape["$defs"]["Education"]["properties"]))
        self.assertNotIn("default", shape["properties"]["name"])

    def test_json_object_compatibility(self):
        def handle(request):
            data = json.loads(request.content)
            self.assertEqual(data["response_format"], {"type": "json_object"})
            self.assertIn("JSON schema", data["messages"][0]["content"])
            return self.success({"skills": ["Python"]})
        provider = OpenAICompatibleProvider(self.settings(response_format="json_object"), transport=httpx.MockTransport(handle))
        self.assertEqual(provider.generate("parse_resume", {"text": "Python"}, ResumeData).skills, ["Python"])

    def test_transient_retry_then_success(self):
        calls = []
        sleeps = []
        def handle(request):
            calls.append(request)
            return httpx.Response(429) if len(calls) == 1 else self.success({"skills": []})
        result = OpenAICompatibleProvider(self.settings(max_retries=1), httpx.MockTransport(handle), sleeps.append).generate("parse_resume", {"text": "resume"}, ResumeData)
        self.assertEqual(result.skills, [])
        self.assertEqual(len(calls), 2)
        self.assertEqual(sleeps, [0.5])

    def test_timeout_is_bounded_and_not_mock_fallback(self):
        calls = []
        def handle(request):
            calls.append(request)
            raise httpx.ReadTimeout("do not expose raw input", request=request)
        with self.assertRaises(ProviderError) as caught:
            OpenAICompatibleProvider(self.settings(max_retries=2), httpx.MockTransport(handle), lambda _: None).generate("parse_resume", {"text": "resume"}, ResumeData)
        self.assertEqual(caught.exception.code, "model_timeout")
        self.assertEqual(len(calls), 3)
        self.assertNotIn("raw input", caught.exception.message)

    def test_auth_and_bad_request_do_not_retry(self):
        for status, code in [(401, "model_auth"), (403, "model_auth"), (400, "model_request"), (302, "model_request")]:
            with self.subTest(status=status):
                calls = []
                def handle(request):
                    calls.append(request)
                    return httpx.Response(status, text="secret provider body")
                with self.assertRaises(ProviderError) as caught:
                    OpenAICompatibleProvider(self.settings(), httpx.MockTransport(handle), lambda _: None).generate("parse_resume", {"text": "resume"}, ResumeData)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(len(calls), 1)
                self.assertNotIn("secret", caught.exception.message)

    def test_refusal_and_truncated_outputs(self):
        for body, code, attempts in [
            ({"choices": [{"message": {"refusal": "provider reason", "content": None}}]}, "model_refusal", 1),
            ({"choices": [{"message": {"content": "{}"}, "finish_reason": "length"}]}, "invalid_model_output", 2),
            ({"choices": []}, "invalid_model_output", 2),
            ({"choices": [{"message": 123}]}, "invalid_model_output", 2),
        ]:
            with self.subTest(code=code):
                calls = []
                def handle(request):
                    calls.append(request)
                    return httpx.Response(200, json=body)
                with self.assertRaises(ProviderError) as caught:
                    OpenAICompatibleProvider(self.settings(max_retries=1), httpx.MockTransport(handle), lambda _: None).generate("parse_resume", {"text": "resume"}, ResumeData)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(len(calls), attempts)

    def test_invalid_outputs_are_rejected_and_logged_without_pii(self):
        bodies = ["not JSON", json.dumps({"invented_key": "secret resume"}), json.dumps({"skills": 12})]
        for body in bodies:
            with self.subTest(body=body):
                calls = []
                def handle(request):
                    calls.append(request)
                    return httpx.Response(200, json={"choices": [{"message": {"content": body}}]})
                with self.assertLogs("interview.provider", level="WARNING") as logs:
                    with self.assertRaises(ProviderError) as caught:
                        OpenAICompatibleProvider(self.settings(max_retries=1), httpx.MockTransport(handle), lambda _: None).generate("parse_resume", {"text": "private resume phone 12345"}, ResumeData)
                self.assertEqual(caught.exception.code, "invalid_model_output")
                self.assertEqual(len(calls), 2)
                self.assertNotIn("private resume", "".join(logs.output))
                self.assertNotIn("test-only-not-real", "".join(logs.output))

    def test_schema_nullable_required(self):
        shape = strict_json_schema(Evaluation.model_json_schema())
        self.assertIn("follow_up", shape["required"])
        self.assertIn({"type": "null"}, shape["properties"]["follow_up"]["anyOf"])

    def test_grounding_rejects_fabricated_and_negated_skills(self):
        for source, result in [
            ("Python", ResumeData(skills=["SQL"])),
            ("不会 Python", ResumeData(skills=["Python"])),
            ("项目：课堂练习", ResumeData(projects=[{"title": "课堂练习", "evidence": "我在大公司完成研发"}])),
            ("项目：课堂练习", ResumeData(projects=[{"title": "企业实习", "evidence": "项目：课堂练习"}])),
        ]:
            with self.subTest(source=source):
                with self.assertRaises(ProviderError) as caught:
                    validate_grounding("parse_resume", {"text": source}, result)
                self.assertEqual(caught.exception.code, "ungrounded_model_output")
        validate_grounding("parse_resume", {"text": "熟悉 computer vision 和 Py Torch"}, ResumeData(skills=["计算机视觉", "PyTorch"]))

    def test_real_provider_applies_grounding_after_schema_validation(self):
        def handle(request):
            return self.success(ResumeData(skills=["SQL"]).model_dump())
        with self.assertRaises(ProviderError) as caught:
            OpenAICompatibleProvider(self.settings(max_retries=0), httpx.MockTransport(handle)).generate("parse_resume", {"text": "Python"}, ResumeData)
        self.assertEqual(caught.exception.code, "ungrounded_model_output")

    def test_reference_answer_cannot_ghostwrite_personal_achievements(self):
        from backend.interview.schemas import Question
        question = Question(level="基础", topic="Python", prompt="请介绍 Python。", expected_points=["输入输出"])
        evaluation = make_provider(Settings()).generate("evaluate", {"question": question.model_dump(), "answer": "不清楚"}, Evaluation)
        evaluation.reference_answer = "我曾在某公司负责百万用户系统，提升了百分之八十。"
        with self.assertRaises(ProviderError):
            validate_grounding("evaluate", {}, evaluation)

    def test_response_bytes_are_bounded_while_reading(self):
        reads = []
        class LargeBody(httpx.SyncByteStream):
            def __iter__(self):
                for index in range(1024):
                    reads.append(index)
                    yield b"x" * 16384
        def handle(request):
            return httpx.Response(200, stream=LargeBody())
        with self.assertRaises(ProviderError) as caught:
            OpenAICompatibleProvider(self.settings(max_retries=0), httpx.MockTransport(handle)).generate("parse_resume", {"text": "resume"}, ResumeData)
        self.assertEqual(caught.exception.code, "invalid_model_output")
        self.assertLessEqual(len(reads), MAX_RESPONSE_BYTES // 16384 + 1)


if __name__ == "__main__":
    unittest.main()
