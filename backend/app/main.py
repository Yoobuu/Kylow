# filepath: backend/app/main.py
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Cargar .env si existe, sin sobrescribir variables ya definidas (K8s-friendly).
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

from app.audit import router as audit_router  # /api/audit
from app.auth import auth_router, user_admin_router  # /api/auth/...
from app.middleware import install_audit_middleware
from app.hosts import router as host_router  # /api/hosts
from app.hosts.vmware_host_snapshot_router import router as vmware_hosts_router  # /api/vmware/hosts
from app.notifications import router as notifications_router  # /api/notifications
from app.permissions.router import router as permissions_router  # /api/permissions
from app.cedia.router import router as cedia_router  # /api/cedia
from app.cedia.cedia_snapshot_router import router as cedia_snapshot_router  # /api/cedia snapshot/jobs
from app.admin.system_router import router as system_router  # /api/admin/system
from app.admin.system_settings_router import router as system_settings_router  # /api/admin/system/settings
from app.vms import vm_router  # /api/vms (VMware)
from app.vms.hyperv_router import router as hyperv_router  # /api/hyperv (Hyper-V)
from app.vms.vmware_router import router as vmware_router  # /api/vmware (VMware snapshot/jobs)
# Import register_startup_events after TEST_MODE definition to avoid circular issues
from app.startup import register_startup_events
from app.settings import settings
from app.system_state import is_restarting

logger = logging.getLogger(__name__)
TEST_MODE = settings.test_mode
APP_ENV = settings.app_env

# ─────────────────────────────
# FastAPI app
# ─────────────────────────────
app = FastAPI(title="VM Inventory API")
register_startup_events(app)
install_audit_middleware(app)


# Health checks
@app.get("/health")
def health():
    if is_restarting():
        return JSONResponse(status_code=503, content={"ok": False, "restarting": True})
    return {"ok": True}


@app.get("/healthz")
def healthz():
    if is_restarting():
        return JSONResponse(status_code=503, content={"ok": False, "restarting": True})
    return {"ok": True}


# CORS
allow_origins = list(settings.cors_allow_origins)
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
app.include_router(vmware_hosts_router)  # /api/vmware/hosts (snapshot/jobs)
app.include_router(hyperv_router)  # /api/hyperv (Hyper-V)
app.include_router(vmware_router)  # /api/vmware (VMware snapshot/jobs)
app.include_router(permissions_router)  # /api/permissions (management)
app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
app.include_router(audit_router)  # /api/audit (Audit trail)
app.include_router(cedia_router)  # /api/cedia (CEDIA VMs)
app.include_router(cedia_snapshot_router)  # /api/cedia (snapshot/jobs)
app.include_router(system_router)  # /api/admin/system
app.include_router(system_settings_router)  # /api/admin/system/settings
