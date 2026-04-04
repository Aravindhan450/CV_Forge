from __future__ import annotations

from dataclasses import dataclass
import time

import httpx
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


_JWKS_CACHE_TTL_SECONDS = 300
_jwks_cache: dict[str, object] = {"expires_at": 0.0, "keys_by_kid": {}}


async def _fetch_supabase_jwks() -> dict[str, dict]:
    settings = get_settings()
    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_URL is not configured",
        )

    jwks_url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(jwks_url)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to fetch Supabase JWKS",
        ) from exc

    keys = payload.get("keys", [])
    return {str(key["kid"]): key for key in keys if isinstance(key, dict) and key.get("kid")}


async def _get_cached_jwks() -> dict[str, dict]:
    now = time.time()
    cached_keys = _jwks_cache.get("keys_by_kid")
    expires_at = float(_jwks_cache.get("expires_at", 0.0))

    if isinstance(cached_keys, dict) and now < expires_at and cached_keys:
        return cached_keys

    fetched = await _fetch_supabase_jwks()
    _jwks_cache["keys_by_kid"] = fetched
    _jwks_cache["expires_at"] = now + _JWKS_CACHE_TTL_SECONDS
    return fetched


async def verify_supabase_token(token: str) -> dict:
    settings = get_settings()

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token header",
        ) from exc

    algorithm = str(header.get("alg") or "")
    if not algorithm:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing signing algorithm",
        )

    try:
        if algorithm.startswith("HS"):
            if not settings.supabase_jwt_secret:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="SUPABASE_JWT_SECRET is not configured",
                )

            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=[algorithm],
                options={"verify_aud": False},
            )
        else:
            kid = str(header.get("kid") or "")
            if not kid:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token missing key identifier",
                )

            keys_by_kid = await _get_cached_jwks()
            verification_key = keys_by_kid.get(kid)

            if not verification_key:
                # Key rotation fallback: fetch once again bypassing cache.
                _jwks_cache["expires_at"] = 0.0
                keys_by_kid = await _get_cached_jwks()
                verification_key = keys_by_kid.get(kid)

            if not verification_key:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unable to find signing key for token",
                )

            payload = jwt.decode(
                token,
                verification_key,
                algorithms=[algorithm],
                options={"verify_aud": False},
            )
    except HTTPException:
        raise
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

    claims = await verify_supabase_token(token)
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
