from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.models.db_models import User


@dataclass
class CurrentUser:
    id: str
    supabase_user_id: str
    email: str | None


def verify_supabase_token(token: str) -> dict:
    settings = get_settings()
    if not settings.supabase_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_JWT_SECRET is not configured",
        )

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
        ) from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing user identifier",
        )

    return payload


async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db_session),
) -> CurrentUser:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is required",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization must use Bearer token",
        )

    claims = verify_supabase_token(token)
    supabase_user_id = str(claims["sub"])
    email = claims.get("email")

    existing = await db.execute(select(User).where(User.supabase_user_id == supabase_user_id))
    user = existing.scalar_one_or_none()

    if not user:
        user = User(supabase_user_id=supabase_user_id, email=email)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif email and user.email != email:
        user.email = email
        await db.commit()
        await db.refresh(user)

    return CurrentUser(id=user.id, supabase_user_id=user.supabase_user_id, email=user.email)
