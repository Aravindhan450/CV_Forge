from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    supabase_user_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    analysis_runs: Mapped[list["AnalysisRun"]] = relationship(back_populates="user")
    analysis_jobs: Mapped[list["AnalysisJob"]] = relationship(back_populates="user")


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    previous_analysis_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("analysis_runs.id"), nullable=True
    )
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True, index=True
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
    user: Mapped["User | None"] = relationship(back_populates="analysis_runs")
    jobs: Mapped[list["AnalysisJob"]] = relationship(back_populates="analysis")


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    task_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=False, index=True
    )
    analysis_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("analysis_runs.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="processing")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="analysis_jobs")
    analysis: Mapped["AnalysisRun | None"] = relationship(back_populates="jobs")
