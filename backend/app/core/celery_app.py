from __future__ import annotations

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "cvforge",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.analysis_tasks"],
)

celery_app.conf.update(
    task_default_queue="analysis",
    task_routes={
        "app.tasks.analysis_tasks.run_resume_analysis": {"queue": "analysis"},
    },
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    result_expires=60 * 60,
    task_soft_time_limit=60 * 8,
    task_time_limit=60 * 10,
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    enable_utc=True,
)

# Celery CLI compatibility for: `celery -A app.core.celery_app worker --loglevel=info`
app = celery_app
