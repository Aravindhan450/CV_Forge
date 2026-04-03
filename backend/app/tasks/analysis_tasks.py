from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.analysis_orchestrator import AnalysisOrchestrator

logger = logging.getLogger(__name__)
orchestrator = AnalysisOrchestrator()


async def _run_analysis_async(
    resume_text: str,
    job_description: str,
    previous_analysis_id: str | None = None,
    resume_filename: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    async with AsyncSessionLocal() as db:
        analysis = await orchestrator.analyze_text(
            resume_text=resume_text,
            job_description=job_description,
            db=db,
            previous_analysis_id=previous_analysis_id,
            resume_filename=resume_filename,
            user_id=user_id,
        )
    return analysis.model_dump(mode="json")


@celery_app.task(
    bind=True,
    name="app.tasks.analysis_tasks.run_resume_analysis",
    autoretry_for=(RuntimeError,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def run_resume_analysis(
    self,
    resume_text: str,
    job_description: str,
    previous_analysis_id: str | None = None,
    resume_filename: str | None = None,
    user_id: str | None = None,
) -> Mapping[str, Any]:
    """Run full resume analysis in a Celery worker process."""
    logger.info("Starting analysis task_id=%s", self.request.id)
    try:
        return asyncio.run(
            _run_analysis_async(
                resume_text=resume_text,
                job_description=job_description,
                previous_analysis_id=previous_analysis_id,
                resume_filename=resume_filename,
                user_id=user_id,
            )
        )
    except ValueError:
        # Deterministic validation errors should not be retried.
        logger.exception("Validation error for task_id=%s", self.request.id)
        raise
    except Exception as exc:
        logger.exception("Worker execution failure task_id=%s", self.request.id)
        raise RuntimeError(str(exc)) from exc
