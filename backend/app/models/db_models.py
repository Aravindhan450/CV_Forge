from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    previous_analysis_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("analysis_runs.id"), nullable=True
    )

    resume_filename: Mapped[str | None] = mapped_column(String(256), nullable=True)
    resume_text: Mapped[str] = mapped_column(Text, nullable=False)
    job_description: Mapped[str] = mapped_column(Text, nullable=False)

    parsed_sections: Mapped[dict] = mapped_column(JSONB, nullable=False)
    keyword_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ats_result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    skill_result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    semantic_result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    career_fit_result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    highlight_result: Mapped[dict] = mapped_column(JSONB, nullable=False)

    ats_score: Mapped[int] = mapped_column(Integer, nullable=False)
    skill_match_score: Mapped[int] = mapped_column(Integer, nullable=False)
    semantic_fit_score: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    previous_analysis: Mapped["AnalysisRun | None"] = relationship(remote_side=[id])
