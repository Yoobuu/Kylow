# filepath: backend/app/main.py
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Cargar variables de entorno desde .env anclado a /backend
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

from app.audit import router as audit_router  # /api/audit
from app.auth import auth_router, user_admin_router  # /api/auth/...
from app.middleware import install_audit_middleware
from app.hosts import router as host_router  # /api/hosts
from app.notifications import router as notifications_router  # /api/notifications
from app.permissions.router import router as permissions_router  # /api/permissions
from app.cedia.router import router as cedia_router  # /api/cedia
from app.vms import vm_router  # /api/vms (VMware)
from app.vms.hyperv_router import router as hyperv_router  # /api/hyperv (Hyper-V)
# Import register_startup_events after TEST_MODE definition to avoid circular issues
from app.startup import register_startup_events

logger = logging.getLogger(__name__)
TEST_MODE = os.getenv("PYTEST_RUNNING") == "1"
APP_ENV = (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "dev").strip().lower()

# ─────────────────────────────
# FastAPI app
# ─────────────────────────────
app = FastAPI(title="VM Inventory API")
register_startup_events(app)
install_audit_middleware(app)


# Health checks
@app.get("/health")
def health():
    return {"ok": True}


@app.get("/healthz")
def healthz():
    return {"ok": True}


# CORS
def _split_origins(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.replace(";", ",").split(",") if item.strip()]


allow_origins = _split_origins(os.getenv("CORS_ALLOW_ORIGINS"))
if not allow_origins:
    allow_origins = _split_origins(os.getenv("FRONTEND_ORIGIN"))
if APP_ENV not in {"prod", "production"}:
    for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
        if origin not in allow_origins:
            allow_origins.append(origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers (orden no importa, pero manténlos agrupados)
app.include_router(auth_router.router, prefix="/api/auth")  # /api/auth/...
app.include_router(user_admin_router.router)  # /api/users (Admin)
app.include_router(vm_router.router, prefix="/api")  # /api/vms (VMware)
app.include_router(host_router, prefix="/api")  # /api/hosts (ESXi)
app.include_router(hyperv_router)  # /api/hyperv (Hyper-V)
app.include_router(permissions_router)  # /api/permissions (management)
app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
app.include_router(audit_router)  # /api/audit (Audit trail)
app.include_router(cedia_router)  # /api/cedia (CEDIA VMs)
