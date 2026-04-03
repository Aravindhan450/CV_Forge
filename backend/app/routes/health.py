from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import HealthResponse

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", timestamp=datetime.now(timezone.utc))
