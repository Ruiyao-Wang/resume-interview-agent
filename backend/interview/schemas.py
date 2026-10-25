from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Education(StrictModel):
    school: str = ""
    degree: str = ""
    major: str = ""
    start_date: str = ""
    end_date: str = ""
    evidence: str = ""


class Experience(StrictModel):
    title: str = ""
    organization: str = ""
    role: str = ""
    summary: str = ""
    technologies: list[str] = Field(default_factory=list, max_length=30)
    evidence: str = ""


class ResumeData(StrictModel):
    name: str = ""
    education: list[Education] = Field(default_factory=list, max_length=20)
    skills: list[str] = Field(default_factory=list, max_length=80)
    internships: list[Experience] = Field(default_factory=list, max_length=30)
    projects: list[Experience] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=20)


class Requirement(StrictModel):
    topic: str = Field(min_length=1, max_length=150)
    description: str = Field(min_length=1, max_length=1000)
    priority: Literal["must", "preferred"] = "must"
    evidence: str = ""


class JDData(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    requirements: list[Requirement] = Field(min_length=1, max_length=40)
    responsibilities: list[str] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=20)


class MatchPoint(StrictModel):
    requirement: str
    evidence: str
    reason: str


class MatchAnalysis(StrictModel):
    score: float = Field(ge=0, le=100)
    summary: str = Field(min_length=1, max_length=2000)
    matched: list[MatchPoint] = Field(default_factory=list, max_length=40)
    gaps: list[str] = Field(default_factory=list, max_length=40)
    suggestions: list[str] = Field(default_factory=list, max_length=40)


class Question(StrictModel):
    id: str = ""
    level: Literal["基础", "项目", "进阶"]
    topic: str = Field(min_length=1, max_length=150)
    prompt: str = Field(min_length=5, max_length=2000)
    evidence: str = ""
    expected_points: list[str] = Field(min_length=1, max_length=10)
    parent_id: str | None = None


class QuestionSet(StrictModel):
    questions: list[Question] = Field(min_length=3, max_length=8)


class Dimensions(StrictModel):
    accuracy: int = Field(ge=0, le=5, strict=True)
    logic: int = Field(ge=0, le=5, strict=True)
    authenticity: int = Field(ge=0, le=5, strict=True)
    job_match: int = Field(ge=0, le=5, strict=True)
    expression: int = Field(ge=0, le=5, strict=True)


class Evaluation(StrictModel):
    scores: Dimensions
    rationale: str = Field(min_length=1, max_length=3000)
    strengths: list[str] = Field(default_factory=list, max_length=10)
    improvements: list[str] = Field(default_factory=list, max_length=10)
    weak_topics: list[str] = Field(default_factory=list, max_length=10)
    reference_answer: str = Field(min_length=1, max_length=5000)
    authenticity_note: str = Field(min_length=1, max_length=1500)
    needs_follow_up: bool
    follow_up: str | None = Field(default=None, max_length=2000)


class CreateSession(StrictModel):
    resume_id: str = Field(min_length=1, max_length=100)
    jd: str = Field(min_length=20, max_length=30000)
    title: str = Field(default="模拟面试", max_length=200)
    question_count: int = Field(default=5, ge=3, le=8)
    allow_external_model: bool = False


class AnswerInput(StrictModel):
    question_id: str = Field(min_length=1, max_length=100)
    answer: str = Field(min_length=1, max_length=10000)
    request_id: str = Field(min_length=8, max_length=100)


class ReviewInput(StrictModel):
    turn_id: str = Field(min_length=1, max_length=100)
    answer: str = Field(min_length=1, max_length=10000)
    request_id: str = Field(min_length=8, max_length=100)
