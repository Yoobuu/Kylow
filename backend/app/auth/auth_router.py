import logging

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.hash import bcrypt
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.jwt_handler import create_access_token
from app.auth.user_model import User
from app.dependencies import get_session  # inyección de sesión de base de datos

router = APIRouter()
logger = logging.getLogger(__name__)


# —————— Esquemas de datos ——————
class LoginRequest(BaseModel):
    """
    Modelo de entrada para la petición de login.
    Contiene las credenciales que el cliente debe enviar.
    """
    username: str
    password: str


class TokenResponse(BaseModel):
    """
    Modelo de salida para la respuesta de login.
    Devuelve el token generado y su tipo.
    """
    access_token: str
    token_type: str = "bearer"


# —————— Punto de entrada: autenticación ——————
@router.post("/login", response_model=TokenResponse)
def login(request: LoginRequest, session: Session = Depends(get_session)):
    """
    Endpoint POST /login
    1. Busca al usuario en la base de datos por username.
    2. Verifica que la contraseña enviada coincida con el hash almacenado.
    3. Si las credenciales son válidas, genera y retorna un JWT.
    4. En caso contrario, devuelve un 401 Unauthorized.
    """
    # Construye y ejecuta la consulta para obtener el usuario
    statement = select(User).where(User.username == request.username)
    user = session.exec(statement).first()

    logger.info("Login attempt for user '%s'", request.username)

    # Validación de credenciales
    if not user or not bcrypt.verify(request.password, user.hashed_password):
        logger.warning("Login failed for user '%s'", request.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas"
        )

    logger.info("Login succeeded for user '%s'", request.username)

    # Generación del token de acceso
    token = create_access_token({"sub": user.username})
    return {"access_token": token}
