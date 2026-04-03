from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ParseSections(BaseModel):
    skills: list[str] = Field(default_factory=list)
    experience: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)


class ATSIssue(BaseModel):
    issue: str
    severity: Literal["low", "medium", "high"]
    recommendation: str


class ATSResult(BaseModel):
    score: int = Field(ge=0, le=100)
    issues: list[ATSIssue] = Field(default_factory=list)
    diagnostics: dict[str, float] = Field(default_factory=dict)


class SkillMatchResult(BaseModel):
    score: int = Field(ge=0, le=100)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    resume_skills: list[str] = Field(default_factory=list)
    job_skills: list[str] = Field(default_factory=list)


class SemanticFeedback(BaseModel):
    role_alignment: str
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    improvement_suggestions: list[str] = Field(default_factory=list)
    suitability_score: int = Field(ge=0, le=100)


class CareerFitResult(BaseModel):
    transferable_skills: list[str] = Field(default_factory=list)
    experience_gaps: list[str] = Field(default_factory=list)
    trajectory_summary: str
    confidence: int = Field(ge=0, le=100)


class HighlightSpan(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    color: Literal["green", "yellow", "red"]
    message: str
    snippet: str


class HighlightResult(BaseModel):
    spans: list[HighlightSpan] = Field(default_factory=list)


class KeywordResult(BaseModel):
    resume_keywords: list[str] = Field(default_factory=list)
    jd_keywords: list[str] = Field(default_factory=list)
    found_keywords: list[str] = Field(default_factory=list)
    missing_keywords: list[str] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    resume_text: str = Field(min_length=50)
    job_description: str = Field(min_length=30)
    previous_analysis_id: str | None = None


class ScoreCard(BaseModel):
    ats_score: int
    skill_match_score: int
    semantic_fit_score: int


class ScoreDelta(BaseModel):
    ats_delta: int = 0
    skill_delta: int = 0
    semantic_delta: int = 0


class AnalysisResponse(BaseModel):
    analysis_id: str
    created_at: datetime
    scores: ScoreCard
    score_delta: ScoreDelta
    parsed_sections: ParseSections
    keywords: KeywordResult
    ats: ATSResult
    skill_match: SkillMatchResult
    semantic: SemanticFeedback
    career_fit: CareerFitResult
    highlights: HighlightResult
    resume_text: str


class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
