from __future__ import annotations

from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.models.schemas import AnalysisResponse


class PDFReportGenerator:
    def generate(self, analysis: AnalysisResponse) -> bytes:
        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        _, height = A4

        y = height - 18 * mm

        def add_line(text: str, size: int = 10, gap: float = 6.5) -> None:
            nonlocal y
            pdf.setFont("Helvetica", size)
            pdf.drawString(16 * mm, y, text[:120])
            y -= gap * mm
            if y < 20 * mm:
                pdf.showPage()
                y = height - 18 * mm

        pdf.setTitle("CV Forge Analysis Report")
        add_line("CV Forge - Resume Analysis Report", size=14, gap=8)
        add_line(f"Analysis ID: {analysis.analysis_id}")
        add_line(f"Generated: {analysis.created_at.isoformat()}")

        y -= 2 * mm
        add_line("Scores", size=12)
        add_line(f"ATS Score: {analysis.scores.ats_score}")
        add_line(f"Skill Match Score: {analysis.scores.skill_match_score}")
        add_line(f"Semantic Fit Score: {analysis.scores.semantic_fit_score}")

        y -= 2 * mm
        add_line("ATS Issues", size=12)
        for issue in analysis.ats.issues[:8]:
            add_line(f"- [{issue.severity.upper()}] {issue.issue}")
            add_line(f"  Recommendation: {issue.recommendation}")

        y -= 2 * mm
        add_line("Keyword Insights", size=12)
        add_line("Found: " + ", ".join(analysis.keywords.found_keywords[:12]))
        add_line("Missing: " + ", ".join(analysis.keywords.missing_keywords[:12]))

        y -= 2 * mm
        add_line("Career Fit", size=12)
        add_line("Transferable skills: " + ", ".join(analysis.career_fit.transferable_skills[:10]))
        for gap in analysis.career_fit.experience_gaps[:6]:
            add_line(f"Gap: {gap}")
        add_line("Trajectory: " + analysis.career_fit.trajectory_summary)

        y -= 2 * mm
        add_line("Improvement Suggestions", size=12)
        for suggestion in analysis.semantic.improvement_suggestions[:10]:
            add_line(f"- {suggestion}")

        pdf.showPage()
        pdf.save()

        return buffer.getvalue()
