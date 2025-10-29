# filepath: backend/app/main.py
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Cargar variables de entorno desde .env (debe ejecutarse desde /backend)
load_dotenv()

from app.auth import auth_router  # /api/auth/...
from app.startup import register_startup_events
from app.vms import vm_router  # /api/vms (VMware)
from app.vms.hyperv_router import router as hyperv_router  # /api/hyperv (Hyper-V)

logger = logging.getLogger(__name__)

# ─────────────────────────────
# FastAPI app
# ─────────────────────────────
app = FastAPI(title="VM Inventory API")
register_startup_events(app)


# Health checks
@app.get("/health")
def health():
    return {"ok": True}


@app.get("/healthz")
def healthz():
    return {"ok": True}


# CORS
frontend_origin = os.getenv("FRONTEND_ORIGIN")  # ej. https://tu-frontend
allow_origins = [frontend_origin] if frontend_origin else []

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",  # útil en dev (Vite)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers (orden no importa, pero manténlos agrupados)
app.include_router(auth_router.router, prefix="/api/auth")  # /api/auth/...
app.include_router(vm_router.router, prefix="/api")  # /api/vms (VMware)
app.include_router(hyperv_router)  # /api/hyperv (Hyper-V)
