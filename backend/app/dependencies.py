from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import ExpiredSignatureError, JWTError
from sqlmodel import Session, select

from app.auth.jwt_handler import decode_access_token
from app.auth.user_model import User
from app.db import get_session
from app.permissions.models import PermissionCode
from app.permissions.service import user_has_permission

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
    request: Request = None,
) -> User:
    """
    Valida el token JWT recibido y devuelve la entidad User correspondiente.
    Lanza HTTP 401 si el token es inválido/expirado o el usuario no existe.
    """
    try:
        payload = decode_access_token(token)
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expirado",
        ) from None
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        ) from None

    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido (sin 'sub')",
        )

    try:
        user_id = int(sub)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido (sub inválido)",
        ) from None

    user = session.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado",
        )

    if user.must_change_password and request is not None:
        allowed_paths = {"/api/auth/change-password", "/api/auth/me"}
        if request.url.path not in allowed_paths:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cambio de contraseña requerido",
            )

    return user


def require_permission(permission: PermissionCode):
    """
    Devuelve un dependency que valida que el usuario tenga el permiso solicitado.
    Se basa únicamente en permisos atómicos por usuario.
    """

    def _dep(
        current_user: User = Depends(get_current_user),
        session: Session = Depends(get_session),
    ) -> User:
        if user_has_permission(current_user, permission, session):
            return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permiso requerido: {permission.value}",
        )

    return _dep


def require_any(permissions: Iterable[PermissionCode]):
    """
    Devuelve un dependency que acepta si el usuario tiene AL MENOS uno de los permisos dados.
    """
    perm_list = list(permissions)

    def _dep(
        current_user: User = Depends(get_current_user),
        session: Session = Depends(get_session),
    ) -> User:
        for perm in perm_list:
            if user_has_permission(current_user, perm, session):
                return current_user
        joined = ", ".join(p.value for p in perm_list)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permisos insuficientes (requiere uno de: {joined})",
        )

    return _dep


@dataclass
class AuditRequestContext:
    ip: Optional[str]
    user_agent: Optional[str]
    correlation_id: Optional[str]


def get_request_audit_context(request: Request) -> AuditRequestContext:
    """
    Extrae metadatos de la petición necesarios para el registro de auditoría.
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        ip = forwarded_for.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else None

    user_agent = request.headers.get("User-Agent")
    correlation_id = getattr(request.state, "correlation_id", None)

    return AuditRequestContext(ip=ip, user_agent=user_agent, correlation_id=correlation_id)
