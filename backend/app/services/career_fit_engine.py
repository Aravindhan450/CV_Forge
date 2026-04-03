from __future__ import annotations

import re

from app.models.schemas import CareerFitResult, ParseSections
from app.utils.text import unique_preserve_order


class CareerFitEngine:
    def analyze(
        self,
        sections: ParseSections,
        job_description: str,
        matched_skills: list[str],
        missing_skills: list[str],
    ) -> CareerFitResult:
        target_role = self._infer_target_role(job_description)
        prior_titles = self._extract_titles(sections.experience)

        trajectory = self._trajectory_summary(prior_titles, target_role)

        transferable = unique_preserve_order(matched_skills[:10])
        gaps = unique_preserve_order(missing_skills[:10])

        confidence = 45
        confidence += min(len(prior_titles) * 8, 25)
        confidence += min(len(transferable) * 3, 20)
        confidence -= min(len(gaps) * 2, 20)
        confidence = max(20, min(100, confidence))

        return CareerFitResult(
            transferable_skills=transferable,
            experience_gaps=gaps,
            trajectory_summary=trajectory,
            confidence=confidence,
        )

    def _infer_target_role(self, job_description: str) -> str:
        patterns = [
            r"(?i)(senior\s+[a-z ]+?)\s+(?:engineer|developer|manager|scientist)",
            r"(?i)([a-z ]+?)\s+(?:engineer|developer|manager|scientist)",
        ]
        for pattern in patterns:
            match = re.search(pattern, job_description)
            if match:
                candidate = match.group(0).strip()
                return re.sub(r"\s+", " ", candidate).title()
        return "Target Role"

    def _extract_titles(self, experience_lines: list[str]) -> list[str]:
        titles: list[str] = []
        for line in experience_lines:
            lowered = line.lower()
            if any(keyword in lowered for keyword in ["engineer", "developer", "manager", "analyst", "intern", "lead"]):
                cleaned = re.sub(r"\s+", " ", line).strip(" -|")
                titles.append(cleaned)
        return unique_preserve_order(titles)

    def _trajectory_summary(self, prior_titles: list[str], target_role: str) -> str:
        if not prior_titles:
            return (
                f"Limited role history was detected. Position your project outcomes and measurable impact "
                f"to support transition into {target_role}."
            )

        recent = prior_titles[:2]
        history_text = "; ".join(recent)
        return (
            f"Career path indicates progression through roles such as {history_text}. "
            f"The transition to {target_role} is plausible if missing domain keywords are addressed with "
            "evidence-backed achievements."
        )
