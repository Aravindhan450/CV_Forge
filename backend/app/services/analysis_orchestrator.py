from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import AnalysisRun
from app.models.schemas import (
    AnalysisResponse,
    ATSResult,
    CareerFitResult,
    HighlightResult,
    KeywordResult,
    ParseSections,
    ScoreCard,
    ScoreDelta,
    SemanticFeedback,
    SkillMatchResult,
)
from app.services.ats_engine import ATSEngine
from app.services.career_fit_engine import CareerFitEngine
from app.services.highlight_engine import HighlightEngine
from app.services.keyword_extractor import KeywordExtractorService
from app.services.resume_parser import ResumeParserService
from app.services.semantic_analyzer import SemanticAnalyzerService
from app.services.skill_matcher import SkillMatcherService
from app.utils.text import unique_preserve_order


class AnalysisOrchestrator:
    def __init__(self) -> None:
        self.resume_parser = ResumeParserService()
        self.keyword_extractor = KeywordExtractorService()
        self.ats_engine = ATSEngine()
        self.skill_matcher = SkillMatcherService()
        self.semantic_analyzer = SemanticAnalyzerService()
        self.career_fit_engine = CareerFitEngine()
        self.highlight_engine = HighlightEngine()

    async def analyze_upload(
        self,
        filename: str,
        file_bytes: bytes,
        job_description: str,
        db: AsyncSession,
        previous_analysis_id: str | None = None,
    ) -> AnalysisResponse:
        resume_text, sections = self.resume_parser.parse_upload(filename, file_bytes)
        return await self._analyze_core(
            resume_text=resume_text,
            sections=sections,
            job_description=job_description,
            db=db,
            previous_analysis_id=previous_analysis_id,
            resume_filename=filename,
        )

    async def analyze_text(
        self,
        resume_text: str,
        job_description: str,
        db: AsyncSession,
        previous_analysis_id: str | None = None,
    ) -> AnalysisResponse:
        normalized_text, sections = self.resume_parser.parse_text(resume_text)
        return await self._analyze_core(
            resume_text=normalized_text,
            sections=sections,
            job_description=job_description,
            db=db,
            previous_analysis_id=previous_analysis_id,
            resume_filename=None,
        )

    async def _analyze_core(
        self,
        resume_text: str,
        sections: ParseSections,
        job_description: str,
        db: AsyncSession,
        previous_analysis_id: str | None,
        resume_filename: str | None,
    ) -> AnalysisResponse:
        keyword_result = self.keyword_extractor.extract(resume_text=resume_text, job_description=job_description)

        ats_result = self.ats_engine.score(
            resume_text=resume_text,
            sections=sections,
            jd_keywords=keyword_result.jd_keywords,
        )

        resume_skills = unique_preserve_order(sections.skills + keyword_result.resume_keywords)
        jd_skills = unique_preserve_order(keyword_result.jd_keywords)

        skill_result = self.skill_matcher.match_skills(resume_skills=resume_skills, job_skills=jd_skills)

        semantic_result = await self.semantic_analyzer.analyze(
            resume_text=resume_text,
            job_description=job_description,
            skill_result=skill_result,
            ats_result=ats_result,
        )

        career_fit = self.career_fit_engine.analyze(
            sections=sections,
            job_description=job_description,
            matched_skills=skill_result.matched_skills,
            missing_skills=skill_result.missing_skills,
        )

        highlights = self.highlight_engine.build(
            resume_text=resume_text,
            keyword_result=keyword_result,
            skill_result=skill_result,
            semantic_result=semantic_result,
        )

        record = AnalysisRun(
            previous_analysis_id=previous_analysis_id,
            resume_filename=resume_filename,
            resume_text=resume_text,
            job_description=job_description,
            parsed_sections=sections.model_dump(),
            keyword_data=keyword_result.model_dump(),
            ats_result=ats_result.model_dump(),
            skill_result=skill_result.model_dump(),
            semantic_result=semantic_result.model_dump(),
            career_fit_result=career_fit.model_dump(),
            highlight_result=highlights.model_dump(),
            ats_score=ats_result.score,
            skill_match_score=skill_result.score,
            semantic_fit_score=semantic_result.suitability_score,
        )

        db.add(record)
        await db.commit()
        await db.refresh(record)

        previous = await self._get_previous(db, previous_analysis_id)
        delta = self._build_delta(record, previous)

        return self._build_response(record, delta)

    async def get_analysis(self, analysis_id: str, db: AsyncSession) -> AnalysisResponse | None:
        result = await db.execute(select(AnalysisRun).where(AnalysisRun.id == analysis_id))
        record = result.scalar_one_or_none()
        if not record:
            return None

        previous = await self._get_previous(db, record.previous_analysis_id)
        delta = self._build_delta(record, previous)
        return self._build_response(record, delta)

    async def _get_previous(self, db: AsyncSession, previous_analysis_id: str | None) -> AnalysisRun | None:
        if not previous_analysis_id:
            return None
        result = await db.execute(select(AnalysisRun).where(AnalysisRun.id == previous_analysis_id))
        return result.scalar_one_or_none()

    def _build_delta(self, current: AnalysisRun, previous: AnalysisRun | None) -> ScoreDelta:
        if not previous:
            return ScoreDelta()

        return ScoreDelta(
            ats_delta=current.ats_score - previous.ats_score,
            skill_delta=current.skill_match_score - previous.skill_match_score,
            semantic_delta=current.semantic_fit_score - previous.semantic_fit_score,
        )

    def _build_response(self, record: AnalysisRun, delta: ScoreDelta) -> AnalysisResponse:
        created_at = record.created_at
        if isinstance(created_at, datetime) and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        return AnalysisResponse(
            analysis_id=record.id,
            created_at=created_at,
            scores=ScoreCard(
                ats_score=record.ats_score,
                skill_match_score=record.skill_match_score,
                semantic_fit_score=record.semantic_fit_score,
            ),
            score_delta=delta,
            parsed_sections=ParseSections(**record.parsed_sections),
            keywords=KeywordResult(**record.keyword_data),
            ats=ATSResult(**record.ats_result),
            skill_match=SkillMatchResult(**record.skill_result),
            semantic=SemanticFeedback(**record.semantic_result),
            career_fit=CareerFitResult(**record.career_fit_result),
            highlights=HighlightResult(**record.highlight_result),
            resume_text=record.resume_text,
        )
