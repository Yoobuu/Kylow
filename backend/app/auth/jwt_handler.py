from datetime import datetime, timedelta
from jose import jwt
from app.config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

# —————— Gestión de tokens JWT ——————
def create_access_token(data: dict):
    """
    Genera un token de acceso JWT:
    1. Copia los datos de la petición (payload).
    2. Calcula la fecha de expiración según la configuración.
    3. Añade el campo 'exp' al payload.
    4. Codifica y retorna el JWT usando la clave secreta y el algoritmo definido.
    """
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str):
    """
    Decodifica y verifica un JWT:
    1. Usa la clave secreta y los algoritmos permitidos.
    2. Retorna el payload si el token es válido y no ha expirado.
    3. Lanza excepciones de JOSE en caso de formato inválido o expiración.
    """
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
