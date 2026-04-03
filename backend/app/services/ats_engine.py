from __future__ import annotations

import re

from app.models.schemas import ATSIssue, ATSResult, ParseSections


class ATSEngine:
    def score(self, resume_text: str, sections: ParseSections, jd_keywords: list[str]) -> ATSResult:
        issues: list[ATSIssue] = []
        diagnostics: dict[str, float] = {}

        # 1) Section completeness
        section_presence_ratio = sum(1 for section in [
            sections.skills,
            sections.experience,
            sections.education,
            sections.projects,
        ] if section) / 4
        section_score = int(section_presence_ratio * 25)
        diagnostics["section_presence"] = round(section_presence_ratio * 100, 2)

        if section_presence_ratio < 0.75:
            issues.append(
                ATSIssue(
                    issue="Missing or weak standard resume sections",
                    severity="high",
                    recommendation="Ensure Skills, Experience, Education, and Projects sections are clearly labeled.",
                )
            )

        # 2) Bullet-point usage in experiential content
        bullet_lines = len(re.findall(r"(?m)^\s*[\-•*]\s+", resume_text))
        experience_lines = len(sections.experience) + len(sections.projects)
        bullet_ratio = bullet_lines / max(experience_lines, 1)
        bullet_score = min(int(bullet_ratio * 25), 25)
        diagnostics["bullet_usage"] = round(min(bullet_ratio, 1.0) * 100, 2)

        if bullet_ratio < 0.4:
            issues.append(
                ATSIssue(
                    issue="Low usage of bullet points for accomplishments",
                    severity="medium",
                    recommendation="Use concise bullet points in experience/projects to improve ATS readability.",
                )
            )

        # 3) Keyword density
        lower_resume = resume_text.lower()
        keyword_hits = sum(1 for keyword in jd_keywords if keyword.lower() in lower_resume)
        density = keyword_hits / max(len(jd_keywords), 1)
        keyword_score = int(min(density, 1.0) * 25)
        diagnostics["keyword_density"] = round(density * 100, 2)

        if density < 0.35:
            issues.append(
                ATSIssue(
                    issue="Low keyword coverage for target role",
                    severity="high",
                    recommendation="Integrate critical job-description keywords naturally into Skills and Experience sections.",
                )
            )

        # 4) Table/layout risk and formatting consistency
        table_signals = len(re.findall(r"\|", resume_text)) + len(re.findall(r"\t", resume_text))
        alignment_signals = len(re.findall(r"(?m)\S+\s{4,}\S+", resume_text))

        table_penalty = 0
        if table_signals > 0 or alignment_signals > 2:
            table_penalty = 10
            issues.append(
                ATSIssue(
                    issue="Potential table or multi-column formatting detected",
                    severity="medium",
                    recommendation="Use single-column plain text layout to prevent ATS parsing errors.",
                )
            )

        inconsistent_case_lines = sum(
            1 for line in resume_text.split("\n") if line.strip() and line.strip() != line.strip().title() and line.isupper()
        )
        format_score = 25 - table_penalty - min(inconsistent_case_lines, 10)
        format_score = max(format_score, 0)
        diagnostics["formatting_consistency"] = round((format_score / 25) * 100, 2)

        total = section_score + bullet_score + keyword_score + format_score
        score = max(0, min(100, total))

        return ATSResult(score=score, issues=issues, diagnostics=diagnostics)
