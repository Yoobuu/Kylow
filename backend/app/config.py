from dotenv import load_dotenv

# Carga las variables de entorno definidas en el archivo .env
load_dotenv()

import os

# —————— Parámetros de conexión a vCenter ——————
# VCENTER_HOST : URL o dirección del servidor vCenter (incluye protocolo y puerto)
# VCENTER_USER : Nombre de usuario con permisos para la API de vCenter
# VCENTER_PASS : Contraseña asociada al usuario de vCenter
VCENTER_HOST = os.getenv("VCENTER_HOST")
VCENTER_USER = os.getenv("VCENTER_USER")
VCENTER_PASS = os.getenv("VCENTER_PASS")

# —————— Configuración de JWT ——————
# SECRET_KEY                 : Clave secreta utilizada para firmar y verificar tokens JWT
# ALGORITHM                  : Algoritmo de cifrado empleado para los JWT
# ACCESS_TOKEN_EXPIRE_MINUTES: Duración (en minutos) antes de que el token caduque
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
