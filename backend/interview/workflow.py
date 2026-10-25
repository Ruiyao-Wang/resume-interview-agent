from __future__ import annotations

import json
import logging
from uuid import uuid4

from pydantic import ValidationError

from .providers import ProviderError
from .schemas import AnswerInput, CreateSession, Evaluation, JDData, MatchAnalysis, Question, QuestionSet, ResumeData, ReviewInput
from .store import InterviewStore, StoreError, now


logger = logging.getLogger("interview.workflow")
DISCLAIMER = "评分仅用于练习，不代表录用概率；真实性维度仅检查叙述与已提供资料的一致性，不能鉴定经历真伪。参考答案不能替代真实项目经历。"
STAGES = ["parse_resume", "parse_jd", "match", "questions", "awaiting_answer", "evaluate", "follow_up", "weak_points", "report"]


class AgentService:
    def __init__(self, store: InterviewStore, provider, mode: str):
        self.store, self.provider, self.mode = store, provider, mode

    def create(self, payload: CreateSession):
        if self.mode != "mock" and not payload.allow_external_model:
            raise StoreError(400, "真实模型模式会把简历、JD及回答发送给已配置的模型服务，请先确认授权")
        resume = self.store.resume(payload.resume_id)
        return self.store.create({
            "id": str(uuid4()), "title": payload.title, "resume_id": payload.resume_id,
            "resume_text": resume["text"], "filename": resume["filename"], "jd": payload.jd,
            "question_count": payload.question_count, "mode": self.mode, "status": "uploaded", "stage": "uploaded",
            "created_at": now(), "updated_at": now(), "resume": None, "jd_parsed": None, "analysis": None,
            "questions": [], "current_question": None, "cursor": 0, "turns": [], "reviews": [],
            "weak_points": [], "events": [], "error": None, "report": None, "pending": None,
        })

    def _mode_check(self, state):
        if state["mode"] != self.mode:
            raise StoreError(409, "此会话的模型模式与当前配置不同，请恢复原配置或创建新会话，不会自动切换模型")

    def _event(self, state, lease, stage, status="completed"):
        state["stage"] = stage
        state["events"].append({"stage": stage, "status": status, "time": now()})
        self.store.save(state, lease)
        logger.info(json.dumps({"event": "agent_node", "session_id": state["id"], "stage": stage, "status": status}))

    def _generate(self, state, lease, task, payload, schema):
        state["status"], state["error"] = "running", None
        self._event(state, lease, task, "running")
        result = self.provider.generate(task, payload, schema)
        # Validate even substituted providers. Bad outputs must never become a valid persisted node.
        return schema.model_validate(result.model_dump() if hasattr(result, "model_dump") else result).model_dump()

    def _fail(self, state, lease, error):
        if isinstance(error, ProviderError):
            code, message, retryable = error.code, error.message, error.retryable
        elif isinstance(error, ValidationError):
            code, message, retryable = "invalid_output", "模型结构化输出校验失败，可重试；未保存无效结果", True
        else:
            code, message, retryable = "internal_error", "当前节点处理失败，记录已保留；请重试或查看服务器错误类型日志", True
        state["status"] = "failed"
        state["error"] = {"code": code, "message": message, "stage": state["stage"], "retryable": retryable}
        logger.error(json.dumps({"event": "agent_failed", "session_id": state["id"], "stage": state["stage"], "code": code, "exception_type": type(error).__name__}))
        self._event(state, lease, state["stage"], "failed")
        return state

    def _prepare(self, state, lease):
        for task, key, schema in [("parse_resume", "resume", ResumeData), ("parse_jd", "jd_parsed", JDData), ("match", "analysis", MatchAnalysis), ("questions", "questions", QuestionSet)]:
            if state[key]:
                continue
            payload = {"resume": state["resume"], "jd": state["jd_parsed"], "resume_text": state["resume_text"], "jd_text": state["jd"], "analysis": state["analysis"], "question_count": state["question_count"]}
            if task in {"parse_resume", "parse_jd"}:
                payload = {"text": state["resume_text"] if task == "parse_resume" else state["jd"]}
            output = self._generate(state, lease, task, payload, schema)
            if task == "questions":
                if len(output["questions"]) != state["question_count"]:
                    raise ProviderError("invalid_output", "模型返回的问题数量与设置不一致，请重试", True)
                if {question["level"] for question in output["questions"]} != {"基础", "项目", "进阶"}:
                    raise ProviderError("invalid_output", "题目未覆盖基础、项目与进阶三个层次，请重试", True)
                output = [{**question, "id": str(uuid4()), "parent_id": None} for question in output["questions"]]
            state[key] = output
            self._event(state, lease, task)
        state["current_question"] = state["questions"][state["cursor"]]
        state["status"], state["error"] = "awaiting_answer", None
        self._event(state, lease, "awaiting_answer")
        return state

    def prepare(self, session_id):
        with self.store.claim(session_id) as (state, lease):
            self._mode_check(state)
            if state["status"] in {"awaiting_answer", "ready_report", "completed"}:
                return state
            if state["pending"]:
                raise StoreError(409, "有未完成的回答，请使用重试操作")
            try:
                return self._prepare(state, lease)
            except StoreError:
                raise
            except Exception as error:
                return self._fail(state, lease, error)

    @staticmethod
    def _score(evaluation):
        return round(sum(evaluation["scores"].values()) / 25 * 100, 1)

    def _weak(self, state, turn):
        topics = turn["evaluation"]["weak_topics"]
        if turn["score"] < 60 and not topics:
            topics = [turn["question"]["topic"]]
        for topic in topics:
            item = next((point for point in state["weak_points"] if point["topic"].casefold() == topic.casefold()), None)
            if item is None:
                item = {"topic": topic, "turn_ids": [], "reviewed": False}
                state["weak_points"].append(item)
            if turn["id"] not in item["turn_ids"]:
                item["turn_ids"].append(turn["id"])
            item["reviewed"] = False

    def _evaluate_pending(self, state, lease):
        pending = state["pending"]
        if pending["kind"] == "review":
            original = next(turn for turn in state["turns"] if turn["id"] == pending["turn_id"])
            question = original["question"]
        else:
            question = state["current_question"]
        evaluation = self._generate(state, lease, "evaluate", {
            "resume": state["resume"], "jd": state["jd_parsed"], "question": question,
            "answer": pending["answer"], "history": state["turns"][-6:], "is_review": pending["kind"] == "review",
        }, Evaluation)
        evaluation["authenticity_note"] = "只核对与所提供资料的一致性，不鉴定真实经历。" + evaluation["authenticity_note"]
        turn = {"id": str(uuid4()), "question": question, "answer": pending["answer"], "request_id": pending["request_id"], "evaluation": evaluation, "score": self._score(evaluation), "created_at": now()}
        if pending["kind"] == "review":
            turn["turn_id"] = pending["turn_id"]
            state["reviews"].append(turn)
            for point in state["weak_points"]:
                if pending["turn_id"] in point["turn_ids"]:
                    point["reviewed"] = True
            # Reviewed is a completion flag, never an automatic declaration of mastery.
            state["status"] = pending["previous_status"]
            state["pending"], state["error"] = None, None
            if state["report"]:
                state["report"]["weak_points"] = state["weak_points"]
                state["report"]["review_count"] = len(state["reviews"])
            self._event(state, lease, "weak_points")
            return state
        state["turns"].append(turn)
        self._weak(state, turn)
        # Persist answer and state advancement in ONE commit. A repeated request_id cannot duplicate it.
        follow = evaluation["follow_up"]
        if evaluation["needs_follow_up"] and follow and not question.get("parent_id"):
            state["current_question"] = Question(id=str(uuid4()), level=question["level"], topic=question["topic"], prompt=follow,
                evidence=question["evidence"], expected_points=question["expected_points"], parent_id=question["id"]).model_dump()
            state["status"] = "awaiting_answer"
            next_stage = "follow_up"
        else:
            state["cursor"] += 1
            state["current_question"] = state["questions"][state["cursor"]] if state["cursor"] < len(state["questions"]) else None
            state["status"] = "awaiting_answer" if state["current_question"] else "ready_report"
            next_stage = "awaiting_answer" if state["current_question"] else "weak_points"
        state["pending"], state["error"] = None, None
        state["events"].extend([{"stage": "evaluate", "status": "completed", "time": now()}, {"stage": "weak_points", "status": "completed", "time": now()}])
        self._event(state, lease, next_stage)
        return state

    def answer(self, session_id, payload: AnswerInput):
        with self.store.claim(session_id) as (state, lease):
            self._mode_check(state)
            previous = next((turn for turn in state["turns"] if turn["request_id"] == payload.request_id), None)
            if previous:
                if previous["answer"] != payload.answer or previous["question"]["id"] != payload.question_id:
                    raise StoreError(409, "同一请求编号不能用于不同回答")
                return state
            if state["status"] != "awaiting_answer" or not state["current_question"] or state["current_question"]["id"] != payload.question_id:
                raise StoreError(409, "题目或会话状态已变化，请刷新后作答；失败回答请重试")
            state["pending"] = {"kind": "answer", **payload.model_dump()}
            self.store.save(state, lease)
            try:
                return self._evaluate_pending(state, lease)
            except StoreError:
                raise
            except Exception as error:
                return self._fail(state, lease, error)

    def review(self, session_id, payload: ReviewInput):
        with self.store.claim(session_id) as (state, lease):
            self._mode_check(state)
            previous = next((turn for turn in state["reviews"] if turn["request_id"] == payload.request_id), None)
            if previous:
                if previous["answer"] != payload.answer or previous["turn_id"] != payload.turn_id:
                    raise StoreError(409, "同一请求编号不能用于不同复习回答")
                return state
            if state["status"] not in {"awaiting_answer", "ready_report", "completed"}:
                raise StoreError(409, "当前阶段不能复习，请先完成处理或重试")
            if not any(turn["id"] == payload.turn_id for turn in state["turns"]):
                raise StoreError(404, "待复习的回答不存在")
            state["pending"] = {"kind": "review", "previous_status": state["status"], **payload.model_dump()}
            self.store.save(state, lease)
            try:
                return self._evaluate_pending(state, lease)
            except StoreError:
                raise
            except Exception as error:
                return self._fail(state, lease, error)

    def retry(self, session_id):
        with self.store.claim(session_id) as (state, lease):
            self._mode_check(state)
            if state["status"] != "failed":
                raise StoreError(409, "只有失败或被中断的节点可以重试")
            try:
                return self._evaluate_pending(state, lease) if state["pending"] else self._prepare(state, lease)
            except StoreError:
                raise
            except Exception as error:
                return self._fail(state, lease, error)

    def finish(self, session_id):
        with self.store.claim(session_id) as (state, lease):
            if state["status"] == "completed":
                return state
            if state["status"] not in {"awaiting_answer", "ready_report"} or not state["turns"]:
                raise StoreError(409, "请先完成至少一道回答，失败节点需先重试")
            turns = state["turns"]
            dimensions = {key: round(sum(turn["evaluation"]["scores"][key] for turn in turns) / len(turns), 2)
                          for key in ("accuracy", "logic", "authenticity", "job_match", "expression")}
            unique = lambda key: list(dict.fromkeys(text for turn in turns for text in turn["evaluation"][key]))[:12]
            state["report"] = {
                "average_score": round(sum(turn["score"] for turn in turns) / len(turns), 1), "dimensions": dimensions,
                "answered": len(turns), "total": len(state["questions"]), "base_answered": len({turn["question"].get("parent_id") or turn["question"]["id"] for turn in turns}),
                "summary": f"完成 {len(turns)} 轮问答（含追问）；报告以实际已回答内容为依据，未回答部分不计分。",
                "strengths": unique("strengths"), "improvements": unique("improvements"), "weak_points": state["weak_points"],
                "disclaimer": DISCLAIMER + (" 当前为 Mock 规则演示，分数不等同真实模型评测。" if state["mode"] == "mock" else ""),
                "generated_at": now(), "mode": state["mode"], "review_count": len(state["reviews"]),
            }
            state["status"], state["current_question"] = "completed", None
            self._event(state, lease, "report")
            return state
