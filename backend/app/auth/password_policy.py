from __future__ import annotations

from typing import List


def check_password_policy(password: str, *, min_length: int, require_classes: int) -> List[str]:
    errors: List[str] = []
    if password is None:
        return ["password requerido"]
    if len(password) < min_length:
        errors.append(f"password debe tener al menos {min_length} caracteres")

    classes = 0
    if any(ch.islower() for ch in password):
        classes += 1
    if any(ch.isupper() for ch in password):
        classes += 1
    if any(ch.isdigit() for ch in password):
        classes += 1
    if any(not ch.isalnum() for ch in password):
        classes += 1
    if classes < require_classes:
        errors.append(
            f"password debe incluir al menos {require_classes} tipos: mayusculas, minusculas, numeros, simbolos"
        )
    return errors
