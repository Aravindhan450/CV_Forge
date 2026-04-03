from __future__ import annotations

import json
import re

from openai import AsyncOpenAI

from app.core.config import get_settings
from app.models.schemas import ATSResult, SemanticFeedback, SkillMatchResult


class SemanticAnalyzerService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client: AsyncOpenAI | None = None

    @property
    def client(self) -> AsyncOpenAI | None:
        if not self.settings.openai_api_key:
            return None
        if self._client is None:
            self._client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        return self._client

    async def analyze(
        self,
        resume_text: str,
        job_description: str,
        skill_result: SkillMatchResult,
        ats_result: ATSResult,
    ) -> SemanticFeedback:
        if not self.client:
            return self._fallback(skill_result, ats_result)

        system_prompt = (
            "You are an expert recruiter and resume evaluator. Return ONLY strict JSON with keys: "
            "role_alignment (string), strengths (string[]), weaknesses (string[]), "
            "improvement_suggestions (string[]), suitability_score (0-100 integer)."
        )

        user_prompt = {
            "resume": resume_text[:12000],
            "job_description": job_description[:8000],
            "context": {
                "skill_match_score": skill_result.score,
                "ats_score": ats_result.score,
                "matched_skills": skill_result.matched_skills[:15],
                "missing_skills": skill_result.missing_skills[:15],
            },
        }

        try:
            response = await self.client.responses.create(
                model=self.settings.openai_model,
                input=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(user_prompt)},
                ],
                temperature=0.2,
            )
            raw_output = response.output_text or ""
            parsed = self._parse_json(raw_output)
            return SemanticFeedback(
                role_alignment=parsed.get("role_alignment", "Moderate alignment based on available evidence."),
                strengths=parsed.get("strengths", [])[:8],
                weaknesses=parsed.get("weaknesses", [])[:8],
                improvement_suggestions=parsed.get("improvement_suggestions", [])[:10],
                suitability_score=int(parsed.get("suitability_score", max(skill_result.score, 40))),
            )
        except Exception:
            return self._fallback(skill_result, ats_result)

    def _parse_json(self, value: str) -> dict:
        cleaned = value.strip()
        fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, flags=re.DOTALL)
        if fenced:
            cleaned = fenced.group(1)

        if cleaned.startswith("{"):
            return json.loads(cleaned)

        match = re.search(r"(\{.*\})", cleaned, flags=re.DOTALL)
        if match:
            return json.loads(match.group(1))

        return {}

    def _fallback(self, skill_result: SkillMatchResult, ats_result: ATSResult) -> SemanticFeedback:
        combined = int(skill_result.score * 0.6 + ats_result.score * 0.4)

        strengths = []
        if skill_result.matched_skills:
            strengths.append(f"Relevant skills found: {', '.join(skill_result.matched_skills[:5])}")
        if ats_result.score >= 70:
            strengths.append("Resume format is generally ATS-friendly.")

        weaknesses = []
        if skill_result.missing_skills:
            weaknesses.append(f"Missing target-role skills: {', '.join(skill_result.missing_skills[:5])}")
        if ats_result.issues:
            weaknesses.append(ats_result.issues[0].issue)

        suggestions = [
            "Quantify achievements with measurable impact in recent experience bullets.",
            "Mirror role-specific keywords from the job description in your skills and project summaries.",
            "Tailor your professional summary to the target role and domain.",
        ]

        return SemanticFeedback(
            role_alignment="Candidate shows partial alignment and can be improved with role-specific tailoring.",
            strengths=strengths,
            weaknesses=weaknesses,
            improvement_suggestions=suggestions,
            suitability_score=max(35, min(100, combined)),
        )
