from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile

from .extraction import ExtractionError, extract_text
from .schemas import AnswerInput, CreateSession, ReviewInput
from .workflow import STAGES


def agent_router(service, settings, requires_token=False):
    router = APIRouter(prefix="/api/agent", tags=["Interview Agent"])
    examples = Path(__file__).resolve().parents[2] / "examples"

    @router.get("/config")
    def config():
        return {"provider": settings.provider, "model": settings.model if settings.provider != "mock" else "deterministic-demo",
                "is_mock": settings.provider == "mock", "requires_token": requires_token, "stages": STAGES,
                "limits": {"max_upload_bytes": 12 * 1024 * 1024, "max_resume_chars": 60000, "max_jd_chars": 30000, "max_answer_chars": 10000}}

    @router.get("/demo")
    def demo():
        return {"resume_text": (examples / "resume.txt").read_text(encoding="utf-8"),
                "jd": (examples / "job_description.txt").read_text(encoding="utf-8"), "title": "模型评测 · 脱敏演示"}

    @router.post("/demo")
    def create_demo():
        data = demo()
        resume = service.store.add_resume("脱敏演示简历.txt", data["resume_text"])
        return {"resume_id": resume["id"], "jd": data["jd"], "title": data["title"]}

    @router.post("/resumes")
    async def upload(file: UploadFile = File(...)):
        try:
            content = await file.read(12 * 1024 * 1024 + 1)
            from starlette.concurrency import run_in_threadpool
            text = await run_in_threadpool(extract_text, file.filename or "", content)
            filename = (file.filename or "简历").replace("\\", "/").rsplit("/", 1)[-1][:200]
            return service.store.add_resume(filename, text)
        except ExtractionError as error:
            raise HTTPException(error.status_code, {"code": "invalid_file", "message": error.message}) from error
        finally:
            await file.close()

    @router.post("/sessions")
    def create(payload: CreateSession):
        return service.create(payload)

    @router.get("/sessions")
    def sessions():
        return service.store.list()

    @router.get("/sessions/{session_id}")
    def session(session_id: str):
        return service.store.get(session_id)

    @router.post("/sessions/{session_id}/prepare")
    def prepare(session_id: str):
        return service.prepare(session_id)

    @router.post("/sessions/{session_id}/answer")
    def answer(session_id: str, payload: AnswerInput):
        return service.answer(session_id, payload)

    @router.post("/sessions/{session_id}/retry")
    def retry(session_id: str):
        return service.retry(session_id)

    @router.post("/sessions/{session_id}/review")
    def review(session_id: str, payload: ReviewInput):
        return service.review(session_id, payload)

    @router.post("/sessions/{session_id}/finish")
    def finish(session_id: str):
        return service.finish(session_id)

    @router.delete("/sessions/{session_id}", status_code=204)
    def delete(session_id: str):
        service.store.delete(session_id)
        return Response(status_code=204)

    return router
