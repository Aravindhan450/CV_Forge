from __future__ import annotations

import re

from app.models.schemas import HighlightResult, HighlightSpan, KeywordResult, SemanticFeedback, SkillMatchResult
from app.utils.text import find_all_occurrences


class HighlightEngine:
    def build(
        self,
        resume_text: str,
        keyword_result: KeywordResult,
        skill_result: SkillMatchResult,
        semantic_result: SemanticFeedback,
    ) -> HighlightResult:
        spans: list[HighlightSpan] = []

        # Strong matches in green
        for skill in skill_result.matched_skills[:20]:
            for start, end in find_all_occurrences(resume_text, skill):
                self._append_if_available(
                    spans,
                    start,
                    end,
                    color="green",
                    message=f"Strong match: '{skill}' aligns with job requirements.",
                    snippet=resume_text[start:end],
                )

        # Weak phrasing in yellow
        weak_patterns = [
            (r"(?i)\bresponsible for\b", "Use an action verb and measurable outcome."),
            (r"(?i)\bworked on\b", "Specify what you delivered and business impact."),
            (r"(?i)\bhelped\b", "Clarify your ownership and quantified contribution."),
        ]
        for pattern, tip in weak_patterns:
            for match in re.finditer(pattern, resume_text):
                self._append_if_available(
                    spans,
                    match.start(),
                    match.end(),
                    color="yellow",
                    message=tip,
                    snippet=resume_text[match.start() : match.end()],
                )

        # Missing keywords in red (anchor near Skills section)
        anchor = self._find_anchor_position(resume_text)
        for keyword in keyword_result.missing_keywords[:8]:
            start = anchor
            end = min(len(resume_text), anchor + max(1, min(len(keyword), 18)))
            self._append_if_available(
                spans,
                start,
                end,
                color="red",
                message=f"Missing keyword: '{keyword}'. Add this where relevant.",
                snippet=resume_text[start:end] if resume_text else "",
                allow_overlap=True,
            )

        if semantic_result.weaknesses and len(spans) < 40:
            first_weakness = semantic_result.weaknesses[0]
            start = max(0, anchor - 5)
            end = min(len(resume_text), start + 20)
            self._append_if_available(
                spans,
                start,
                end,
                color="yellow",
                message=f"Focus area: {first_weakness}",
                snippet=resume_text[start:end],
                allow_overlap=True,
            )

        spans.sort(key=lambda item: (item.start, item.end))
        return HighlightResult(spans=spans[:120])

    def _find_anchor_position(self, resume_text: str) -> int:
        lowered = resume_text.lower()
        for marker in ["skills", "technical skills", "core competencies", "summary"]:
            idx = lowered.find(marker)
            if idx != -1:
                return idx
        return 0

    def _append_if_available(
        self,
        spans: list[HighlightSpan],
        start: int,
        end: int,
        color: str,
        message: str,
        snippet: str,
        allow_overlap: bool = False,
    ) -> None:
        if start >= end:
            return

        if not allow_overlap:
            for span in spans:
                intersects = not (end <= span.start or start >= span.end)
                if intersects:
                    return

        spans.append(
            HighlightSpan(
                start=start,
                end=end,
                color=color,
                message=message,
                snippet=snippet,
            )
        )
