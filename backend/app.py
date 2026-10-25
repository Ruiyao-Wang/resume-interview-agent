from __future__ import annotations

import base64
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from matcher import rank_materials, split_tags
from storage import Storage
from interview.config import Settings
from interview.extraction import ExtractionError, extract_text
from interview.providers import make_provider
from interview.routes import agent_router
from interview.store import InterviewStore, StoreError
from interview.workflow import AgentService


BASE_DIR = Path(__file__).resolve().parent
agent_logger = logging.getLogger("interview")
if not agent_logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    agent_logger.addHandler(handler)
agent_logger.setLevel(logging.INFO)
agent_logger.propagate = False
settings = Settings.from_env()
DATA_DIR = Path(os.environ.get("JOB_AUTOFILL_DATA_DIR", str(BASE_DIR.parent / ".data")))
storage = Storage(DATA_DIR)
agent_service = AgentService(InterviewStore(DATA_DIR), make_provider(settings), settings.provider)
access_token = os.getenv("APP_ACCESS_TOKEN", "")
allowed_hosts = [host.strip() for host in os.getenv("APP_ALLOWED_HOSTS", "127.0.0.1,localhost,testserver").split(",") if host.strip()]
allowed_origins = {origin.strip() for origin in os.getenv("APP_ALLOWED_ORIGINS", "").split(",") if origin.strip()}
if not access_token and (set(allowed_hosts) - {"127.0.0.1", "localhost", "testserver"} or allowed_origins):
    raise RuntimeError("远端 Host/Origin 配置必须同时设置 APP_ACCESS_TOKEN，避免公开私人资料")
if access_token and len(access_token) < 24:
    raise RuntimeError("APP_ACCESS_TOKEN 至少需要24个字符")


@asynccontextmanager
async def lifespan(_app):
    agent_service.store.recover_interrupted()
    yield

app = FastAPI(title="求职助手 · 简历分析与模拟面试 Agent", version="1.0.0", lifespan=lifespan)
app.state.agent_service = agent_service
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
app.mount("/dashboard", StaticFiles(directory=BASE_DIR / "dashboard", html=True), name="dashboard")
app.include_router(agent_router(agent_service, settings, bool(access_token)))


@app.exception_handler(StoreError)
async def store_error(_request, error):
    return JSONResponse({"detail": {"code": "state_conflict" if error.status == 409 else "invalid_request", "message": error.message}}, status_code=error.status)


@app.exception_handler(Exception)
async def internal_error(_request, error):
    logging.getLogger("interview.api").error(json.dumps({"event": "request_failed", "exception_type": type(error).__name__}))
    return JSONResponse({"detail": {"code": "internal_error", "message": "请求处理失败，请重试或检查服务器日志"}}, status_code=500)


@app.middleware("http")
async def local_clients_only(request: Request, call_next):
    origin = request.headers.get("origin", "")
    local_origins = {f"http://127.0.0.1:{request.url.port}", f"http://localhost:{request.url.port}"}
    if request.url.path.startswith("/api/") and origin and origin not in local_origins | allowed_origins and not origin.startswith("chrome-extension://"):
        return JSONResponse({"detail": "请从本地素材库或浏览器扩展访问"}, status_code=403)
    if access_token and request.url.path.startswith("/api/") and request.url.path not in {"/api/health", "/api/agent/config"}:
        supplied = request.headers.get("x-agent-token", "")
        if not hmac.compare_digest(supplied.encode(), access_token.encode()):
            return JSONResponse({"detail": {"code": "unauthorized", "message": "请填写部署者设置的访问口令"}}, status_code=401)
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


PROFILE_KEYS = set("fullNameCn fullNameEn email phone currentCity targetCity school major degree graduationDate studentId gender birthDate heightCm weightKg maritalStatus politicalStatus ethnicity idNumber homeAddress fatherName fatherEmployer fatherPhone motherName motherEmployer motherPhone".split())
EDUCATION_KEYS = ("school", "major", "degree", "graduationDate", "studentId")


class EducationInput(BaseModel):
    school: str = Field(default="", max_length=200)
    major: str = Field(default="", max_length=200)
    degree: str = Field(default="", max_length=80)
    startDate: str = Field(default="", max_length=30)
    graduationDate: str = Field(default="", max_length=30)
    studentId: str = Field(default="", max_length=80)


class PersonalDataInput(BaseModel):
    profile: dict[str, str] = Field(default_factory=dict)
    education: list[EducationInput] = Field(default_factory=list, max_length=20)
    primary_education: int = Field(default=0, ge=0)

    @field_validator("profile")
    @classmethod
    def validate_profile(cls, value):
        if set(value) - PROFILE_KEYS or any(len(text) > 1000 for text in value.values()):
            raise ValueError("存在未知资料字段或字段超过1000字")
        return {key: text.strip() for key, text in value.items()}

    @model_validator(mode="after")
    def validate_primary(self):
        if self.primary_education >= max(1, len(self.education)):
            raise ValueError("默认教育经历不存在")
        return self


@app.get("/shared/core.js")
def shared_core():
    return FileResponse(BASE_DIR.parent / "core.js", media_type="application/javascript")


@app.get("/api/profile")
def get_profile():
    return storage.get_profile()


@app.put("/api/profile")
def save_profile(payload: PersonalDataInput):
    return storage.save_profile(payload.model_dump())


@app.post("/api/profile/import")
def import_legacy_profile(payload: PersonalDataInput):
    # Existing backend values take precedence, including manually entered education.
    current = storage.get_profile()
    for key, value in payload.profile.items():
        if value and not current["profile"].get(key):
            current["profile"][key] = value
    if not current["education"]:
        if payload.education:
            current["education"] = [item.model_dump() for item in payload.education]
            current["primary_education"] = payload.primary_education
        elif any(current["profile"].get(key) for key in EDUCATION_KEYS):
            current["education"] = [{key: current["profile"].get(key, "") for key in EDUCATION_KEYS}]
    return storage.save_profile(current)


class ProjectVariantInput(BaseModel):
    project_name: str = Field(min_length=1, max_length=100)
    category: str = Field(default="项目经历", max_length=40)
    project_tags: list[str] = Field(default_factory=list)
    variant_name: str = Field(default="通用版", min_length=1, max_length=60)
    variant_tags: list[str] = Field(default_factory=list)
    content: str = Field(min_length=1, max_length=6000)
    start_date: str = Field(default="", max_length=20)
    end_date: str = Field(default="", max_length=20)
    role: str = Field(default="", max_length=100)
    organization: str = Field(default="", max_length=150)
    responsibilities: str = Field(default="", max_length=6000)


class MatchInput(BaseModel):
    job_title: str = ""
    job_description: str = Field(min_length=1, max_length=50000)
    max_projects: int = Field(default=3, ge=1, le=6)


class ResumeMetadataInput(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=6000)
    tags: list[str] = Field(default_factory=list)


@app.patch("/api/resumes/{resume_id}")
def update_resume(resume_id: str, payload: ResumeMetadataInput):
    updated = storage.update_resume(resume_id, payload.name, payload.description, payload.tags)
    if updated is None:
        raise HTTPException(404, "简历不存在")
    return updated


def extract_resume_text(filename: str, content: bytes) -> str:
    try:
        return extract_text(filename, content, allow_text=True)
    except ExtractionError as error:
        raise HTTPException(error.status_code, error.message) from error


@app.get("/")
def root():
    return FileResponse(BASE_DIR / "dashboard" / "index.html")


@app.get("/interview")
def interview_page():
    return FileResponse(BASE_DIR / "dashboard" / "interview.html")


@app.get("/api/health")
def health():
    return {"ok": True, "version": app.version}


@app.get("/api/resumes")
def resumes():
    return storage.list_resumes()


@app.post("/api/resumes")
async def upload_resume(
    file: UploadFile = File(...),
    name: str = Form(...),
    tags: str = Form(""),
    description: str = Form(""),
):
    try:
        content = await file.read(12 * 1024 * 1024 + 1)
        from starlette.concurrency import run_in_threadpool
        extracted_text = await run_in_threadpool(extract_resume_text, file.filename or "resume.bin", content)
    finally:
        await file.close()
    return storage.add_resume(name, description, split_tags(tags), file.filename or "resume.bin", content, extracted_text)


@app.get("/api/resumes/{resume_id}/attachment")
def attachment(resume_id: str):
    resume = next((item for item in storage.list_resumes() if item["id"] == resume_id), None)
    if resume is None:
        raise HTTPException(404, "简历不存在，请重新匹配")
    path = (storage.resume_dir / resume["file_path"]).resolve()
    if path.parent != storage.resume_dir.resolve() or not path.is_file():
        raise HTTPException(404, "简历文件不存在")
    mime = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}.get(path.suffix, "text/plain")
    return {"name": resume["original_filename"], "mime": mime, "base64": base64.b64encode(path.read_bytes()).decode("ascii")}


@app.get("/api/projects")
def projects():
    return storage.list_projects()


@app.post("/api/projects")
def add_project(payload: ProjectVariantInput):
    return storage.add_project_variant(
        payload.project_name,
        payload.category,
        payload.project_tags,
        {"name": payload.variant_name, "tags": payload.variant_tags, "content": payload.content,
         "start_date": payload.start_date, "end_date": payload.end_date, "role": payload.role,
         "organization": payload.organization, "responsibilities": payload.responsibilities},
    )


@app.post("/api/match")
def match(payload: MatchInput):
    return rank_materials(
        payload.job_title,
        payload.job_description,
        storage.list_resumes(),
        storage.list_projects(),
        payload.max_projects,
    )
