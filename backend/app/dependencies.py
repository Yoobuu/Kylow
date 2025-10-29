import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, ExpiredSignatureError, jwt
from sqlmodel import Session

from app.config import ALGORITHM, SECRET_KEY
from app.db import engine

# —————— Seguridad y autenticación JWT ——————
security = HTTPBearer()
logger = logging.getLogger(__name__)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    1. Extrae el token Bearer de la cabecera Authorization.
    2. Decodifica y valida el JWT (firma y expiración).
    3. Recupera el campo 'sub' (username) del payload.
    4. Lanza 401 si el token está expirado, inválido o carece de 'sub'.
    """
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            logger.warning("JWT token lacking 'sub' claim")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido (sin 'sub')"
            )
        return username
    except ExpiredSignatureError:
        logger.info("Expired JWT received")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expirado"
        )
    except JWTError:
        logger.warning("Invalid JWT received")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )


def get_session():
    """
    Proporciona una sesión de base de datos:
    - Crea un contexto de sesión SQLModel ligado al engine configurado.
    - Yield de la sesión para inyectarla en dependencias de rutas.
    - Cierra la sesión automáticamente al finalizar.
    """
    with Session(engine) as session:
        yield session
