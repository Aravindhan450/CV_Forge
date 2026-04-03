from __future__ import annotations

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.supabase_auth import CurrentUser, get_current_user
from app.models.db_models import AnalysisJob
from app.models.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    AnalysisTaskQueuedResponse,
    AnalysisTaskStatusResponse,
    ResumeHistoryItem,
)
from app.services.analysis_orchestrator import AnalysisOrchestrator
from app.services.report_generator import PDFReportGenerator
from app.services.resume_parser import ResumeParserService
from app.tasks.analysis_tasks import run_resume_analysis

analysis_router = APIRouter(prefix="/analysis", tags=["analysis"])
status_router = APIRouter(tags=["analysis"])
orchestrator = AnalysisOrchestrator()
report_generator = PDFReportGenerator()
resume_parser = ResumeParserService()


@analysis_router.post("/upload", response_model=AnalysisTaskQueuedResponse, status_code=202)
async def analyze_upload_resume(
    resume_file: UploadFile = File(...),
    job_description: str = Form(...),
    previous_analysis_id: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> AnalysisTaskQueuedResponse:
    settings = get_settings()
    content = await resume_file.read()

    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb}MB upload limit")

    try:
        filename = resume_file.filename or "resume.txt"
        resume_text, _ = resume_parser.parse_upload(filename=filename, file_bytes=content)

        task = run_resume_analysis.delay(
            resume_text=resume_text,
            job_description=job_description,
            previous_analysis_id=previous_analysis_id,
            resume_filename=filename,
            user_id=current_user.id,
        )

        db.add(AnalysisJob(task_id=task.id, user_id=current_user.id, status="processing"))
        await db.commit()
        return AnalysisTaskQueuedResponse(task_id=task.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to enqueue uploaded resume for analysis") from exc


@analysis_router.post("/reanalyze", response_model=AnalysisTaskQueuedResponse, status_code=202)
async def reanalyze_resume(
    payload: AnalysisRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> AnalysisTaskQueuedResponse:
    try:
        task = run_resume_analysis.delay(
            resume_text=payload.resume_text,
            job_description=payload.job_description,
            previous_analysis_id=payload.previous_analysis_id,
            user_id=current_user.id,
        )

        db.add(AnalysisJob(task_id=task.id, user_id=current_user.id, status="processing"))
        await db.commit()
        return AnalysisTaskQueuedResponse(task_id=task.id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to enqueue resume for analysis") from exc


@analysis_router.get("/history", response_model=list[ResumeHistoryItem])
async def get_resume_history(
    limit: int = 20,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ResumeHistoryItem]:
    safe_limit = max(1, min(limit, 100))
    history = await orchestrator.list_history(db=db, user_id=current_user.id, limit=safe_limit)
    return [
        ResumeHistoryItem(
            analysis_id=item.id,
            created_at=item.created_at,
            resume_filename=item.resume_filename,
            ats_score=item.ats_score,
            skill_match_score=item.skill_match_score,
            semantic_fit_score=item.semantic_fit_score,
        )
        for item in history
    ]


@status_router.get("/analysis-status/{task_id}", response_model=AnalysisTaskStatusResponse)
async def get_analysis_status(
    task_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> AnalysisTaskStatusResponse:
    job_result = await db.execute(
        select(AnalysisJob).where(AnalysisJob.task_id == task_id, AnalysisJob.user_id == current_user.id)
    )
    job = job_result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Task not found")

    task_result = AsyncResult(task_id, app=celery_app)

    processing_states = {"PENDING", "RECEIVED", "STARTED", "RETRY"}
    if task_result.state in processing_states:
        return AnalysisTaskStatusResponse(task_id=task_id, status="processing")

    if task_result.state == "SUCCESS":
        payload = task_result.result
        if not isinstance(payload, dict):
            raise HTTPException(status_code=500, detail="Unexpected task result payload")

        job.status = "completed"
        job.analysis_id = payload.get("analysis_id")
        job.error = None
        await db.commit()
        return AnalysisTaskStatusResponse(task_id=task_id, status="completed", result=payload)

    if task_result.state == "FAILURE":
        message = str(task_result.result) if task_result.result else "Task failed"
        job.status = "failed"
        job.error = message
        await db.commit()
        return AnalysisTaskStatusResponse(task_id=task_id, status="failed", error=message)

    return AnalysisTaskStatusResponse(task_id=task_id, status="processing")


@analysis_router.get("/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> AnalysisResponse:
    result = await orchestrator.get_analysis(analysis_id=analysis_id, db=db, user_id=current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return result


@analysis_router.get("/{analysis_id}/report")
async def download_report(
    analysis_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    result = await orchestrator.get_analysis(analysis_id=analysis_id, db=db, user_id=current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    pdf_bytes = report_generator.generate(result)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=analysis-{analysis_id}.pdf"},
    )
