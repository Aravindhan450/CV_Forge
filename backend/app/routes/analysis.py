from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.models.schemas import AnalysisRequest, AnalysisResponse
from app.services.analysis_orchestrator import AnalysisOrchestrator
from app.services.report_generator import PDFReportGenerator

router = APIRouter(prefix="/analysis", tags=["analysis"])
orchestrator = AnalysisOrchestrator()
report_generator = PDFReportGenerator()


@router.post("/upload", response_model=AnalysisResponse)
async def analyze_upload_resume(
    resume_file: UploadFile = File(...),
    job_description: str = Form(...),
    previous_analysis_id: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db_session),
) -> AnalysisResponse:
    settings = get_settings()
    content = await resume_file.read()

    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb}MB upload limit")

    try:
        result = await orchestrator.analyze_upload(
            filename=resume_file.filename or "resume.txt",
            file_bytes=content,
            job_description=job_description,
            db=db,
            previous_analysis_id=previous_analysis_id,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to analyze uploaded resume") from exc


@router.post("/reanalyze", response_model=AnalysisResponse)
async def reanalyze_resume(
    payload: AnalysisRequest,
    db: AsyncSession = Depends(get_db_session),
) -> AnalysisResponse:
    try:
        result = await orchestrator.analyze_text(
            resume_text=payload.resume_text,
            job_description=payload.job_description,
            db=db,
            previous_analysis_id=payload.previous_analysis_id,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to re-analyze resume") from exc


@router.get("/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> AnalysisResponse:
    result = await orchestrator.get_analysis(analysis_id=analysis_id, db=db)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return result


@router.get("/{analysis_id}/report")
async def download_report(
    analysis_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    result = await orchestrator.get_analysis(analysis_id=analysis_id, db=db)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    pdf_bytes = report_generator.generate(result)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=analysis-{analysis_id}.pdf"},
    )
