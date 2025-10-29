from sqlmodel import SQLModel, Field

# —————— Definición del modelo de usuario ——————
class User(SQLModel, table=True):
    """
    Representa la tabla 'User' en la base de datos.

    Campos:
    - id             : Clave primaria autogenerada para cada usuario.
    - username       : Nombre de usuario único, indexado para búsquedas.
    - hashed_password: Contraseña almacenada de forma segura (hasheada).
    """
    id: int | None = Field(default=None, primary_key=True)
    username: str       = Field(index=True, unique=True)
    hashed_password: str
