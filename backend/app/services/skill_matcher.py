from __future__ import annotations

import numpy as np
from sentence_transformers import SentenceTransformer

from app.core.config import get_settings
from app.models.schemas import SkillMatchResult
from app.utils.text import normalize_token, unique_preserve_order


class SkillMatcherService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._embedder: SentenceTransformer | None = None
        self._embedder_unavailable = False

    @property
    def embedder(self) -> SentenceTransformer | None:
        if self._embedder_unavailable:
            return None
        if self._embedder is None:
            try:
                # Avoid blocking the worker on long model downloads in startup/dev environments.
                self._embedder = SentenceTransformer(
                    self.settings.embedding_model_name,
                    local_files_only=True,
                )
            except Exception:
                self._embedder_unavailable = True
                return None
        return self._embedder

    def match_skills(self, resume_skills: list[str], job_skills: list[str]) -> SkillMatchResult:
        cleaned_resume = unique_preserve_order([skill for skill in resume_skills if len(skill.strip()) > 1])
        cleaned_job = unique_preserve_order([skill for skill in job_skills if len(skill.strip()) > 1])

        if not cleaned_job:
            return SkillMatchResult(
                score=0,
                matched_skills=[],
                missing_skills=[],
                resume_skills=cleaned_resume,
                job_skills=cleaned_job,
            )

        if not cleaned_resume:
            return SkillMatchResult(
                score=0,
                matched_skills=[],
                missing_skills=cleaned_job,
                resume_skills=cleaned_resume,
                job_skills=cleaned_job,
            )

        normalized_resume = [normalize_token(skill) for skill in cleaned_resume]
        normalized_job = [normalize_token(skill) for skill in cleaned_job]

        embedder = self.embedder
        if embedder is None:
            return self._fallback_lexical(cleaned_resume, cleaned_job, normalized_resume, normalized_job)

        resume_embeddings = embedder.encode(normalized_resume, convert_to_numpy=True, normalize_embeddings=True)
        job_embeddings = embedder.encode(normalized_job, convert_to_numpy=True, normalize_embeddings=True)

        similarity = np.matmul(job_embeddings, resume_embeddings.T)

        matched: list[str] = []
        missing: list[str] = []

        for idx, job_skill in enumerate(cleaned_job):
            best_score = float(np.max(similarity[idx]))
            if best_score >= 0.55:
                matched.append(job_skill)
            else:
                missing.append(job_skill)

        coverage = len(matched) / max(len(cleaned_job), 1)
        semantic_strength = float(np.mean(np.max(similarity, axis=1)))

        weighted_score = int((coverage * 0.8 + semantic_strength * 0.2) * 100)
        score = max(0, min(100, weighted_score))

        return SkillMatchResult(
            score=score,
            matched_skills=unique_preserve_order(matched),
            missing_skills=unique_preserve_order(missing),
            resume_skills=cleaned_resume,
            job_skills=cleaned_job,
        )

    def _fallback_lexical(
        self,
        cleaned_resume: list[str],
        cleaned_job: list[str],
        normalized_resume: list[str],
        normalized_job: list[str],
    ) -> SkillMatchResult:
        resume_set = set(normalized_resume)
        matched: list[str] = []
        missing: list[str] = []

        for idx, job_skill in enumerate(cleaned_job):
            norm = normalized_job[idx]
            if norm in resume_set:
                matched.append(job_skill)
            else:
                missing.append(job_skill)

        score = int((len(matched) / max(len(cleaned_job), 1)) * 100)
        return SkillMatchResult(
            score=max(0, min(100, score)),
            matched_skills=unique_preserve_order(matched),
            missing_skills=unique_preserve_order(missing),
            resume_skills=cleaned_resume,
            job_skills=cleaned_job,
        )
