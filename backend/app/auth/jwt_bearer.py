# backend/app/auth/jwt_bearer.py

from fastapi import Request, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.status import HTTP_403_FORBIDDEN
from app.auth.jwt_handler import decode_token

# —————— Middleware de autenticación JWT ——————
class JWTBearer(HTTPBearer):
    """
    Componente de seguridad que extiende HTTPBearer para:
    1. Extraer el token Bearer de la cabecera Authorization.
    2. Verificar que el token tenga el esquema correcto.
    3. Validar la firma y expiración del JWT.
    """
    def __init__(self, auto_error: bool = True):
        # Configura comportamiento por defecto (lanza error si falta token)
        super(JWTBearer, self).__init__(auto_error=auto_error)

    async def __call__(self, request: Request):
        """
        Proceso de interceptación de cada petición:
        a) Obtiene las credenciales de la cabecera Authorization.
        b) Comprueba que el esquema sea 'Bearer'.
        c) Verifica la validez del token.
        d) Retorna el token para su uso en rutas protegidas,
           o lanza un HTTPException 403 si hay algún fallo.
        """
        credentials: HTTPAuthorizationCredentials = await super(JWTBearer, self).__call__(request)
        if credentials:
            if credentials.scheme != "Bearer":
                raise HTTPException(
                    status_code=HTTP_403_FORBIDDEN,
                    detail="Formato inválido de autenticación"
                )
            if not self.verify_jwt(credentials.credentials):
                raise HTTPException(
                    status_code=HTTP_403_FORBIDDEN,
                    detail="Token inválido o expirado"
                )
            return credentials.credentials
        else:
            # No se proporcionó ningún token en la petición
            raise HTTPException(
                status_code=HTTP_403_FORBIDDEN,
                detail="No se proporcionó token"
            )

    def verify_jwt(self, jwt_token: str) -> bool:
        """
        Verifica de forma segura el contenido del JWT:
        - Decodifica el token con la clave y algoritmos configurados.
        - Devuelve True si el payload es válido, False de lo contrario.
        """
        try:
            payload = decode_token(jwt_token)
            return payload is not None
        except:
            return False
