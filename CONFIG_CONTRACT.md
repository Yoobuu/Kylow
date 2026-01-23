# Config Contract (Env Vars)

All configuration is controlled by environment variables. `.env` is optional and only loaded in `APP_ENV=dev`.

Legend:
- Required: `Prod` means required in production; `If enabled` means required when that provider is used.
- Secret: `yes` means never log the value.

| ENV_VAR | Descripción | Default | Requerida/Opcional | Secreta | Ejemplo |
| --- | --- | --- | --- | --- | --- |
| APP_ENV | Entorno de ejecución (`dev`/`prod`). | `dev` | Opcional | no | `prod` |
| LOG_LEVEL | Nivel de logs. | `INFO` | Opcional | no | `DEBUG` |
| TEST_MODE | Activa modo test a nivel app. | `false` | Opcional | no | `true` |
| TESTING | Bandera para pruebas internas (desactiva DB init). | `false` | Opcional | no | `true` |
| REFRESH_INTERVAL_MINUTES | Intervalo base (fallback global) para warmup/refresh. | `60` | Opcional | no | `30` |
| CORS_ALLOW_ORIGINS | Lista de orígenes CORS (coma/`;`). | vacío | Opcional | no | `https://ui.example.com,https://admin.example.com` |
| FRONTEND_ORIGIN | Origen único CORS legado (fallback si no hay `CORS_ALLOW_ORIGINS`). | vacío | Opcional | no | `https://ui.example.com` |
| SECRET_KEY | Clave secreta para JWT. | none | **Prod** | **sí** | `supersecret` |
| JWT_ALGORITHM | Algoritmo JWT. | `HS256` | Opcional | no | `HS256` |
| ACCESS_TOKEN_EXPIRE_MINUTES | Expiración JWT (min). | `60` | Opcional | no | `120` |
| VCENTER_HOST | Host/URL de vCenter. | none | **If enabled** (VMware) | no | `https://vcenter.local` |
| VCENTER_USER | Usuario vCenter. | none | **If enabled** (VMware) | no | `svc_vmware` |
| VCENTER_PASS | Password vCenter. | none | **If enabled** (VMware) | **sí** | `********` |
| VMWARE_JOB_MAX_GLOBAL | Concurrencia global jobs VMware VMs. | `4` | Opcional | no | `6` |
| VMWARE_JOB_MAX_PER_SCOPE | Concurrencia por scope VMware VMs. | `2` | Opcional | no | `2` |
| VMWARE_JOB_HOST_TIMEOUT | Timeout por host VMware VMs (seg). | `150` | Opcional | no | `300` |
| VMWARE_JOB_MAX_DURATION | Timeout job VMware VMs (seg). | `900` | Opcional | no | `1200` |
| VMWARE_REFRESH_INTERVAL_MINUTES | Intervalo VMware VMs (min). | `REFRESH_INTERVAL_MINUTES` | Opcional | no | `60` |
| VMWARE_HOSTS_JOB_HOST_TIMEOUT | Timeout por host VMware Hosts (seg). | `VMWARE_JOB_HOST_TIMEOUT` | Opcional | no | `300` |
| VMWARE_HOSTS_JOB_MAX_DURATION | Timeout job VMware Hosts (seg). | `VMWARE_JOB_MAX_DURATION` | Opcional | no | `1200` |
| VMWARE_HOSTS_REFRESH_INTERVAL_MINUTES | Intervalo VMware Hosts (min). | `VMWARE_REFRESH_INTERVAL_MINUTES` | Opcional | no | `60` |
| CEDIA_BASE | Base URL Cedia. | none | **If enabled** (Cedia) | no | `https://cedia.example.com` |
| CEDIA_USER | Usuario Cedia. | none | **If enabled** (Cedia) | no | `svc_cedia` |
| CEDIA_PASS | Password Cedia. | none | **If enabled** (Cedia) | **sí** | `********` |
| CEDIA_JOB_MAX_GLOBAL | Concurrencia global jobs Cedia. | `4` | Opcional | no | `6` |
| CEDIA_JOB_MAX_PER_SCOPE | Concurrencia por scope Cedia. | `2` | Opcional | no | `2` |
| CEDIA_JOB_HOST_TIMEOUT | Timeout por host Cedia (seg). | `150` | Opcional | no | `300` |
| CEDIA_JOB_MAX_DURATION | Timeout job Cedia (seg). | `900` | Opcional | no | `1200` |
| CEDIA_REFRESH_INTERVAL_MINUTES | Intervalo Cedia (min). | `REFRESH_INTERVAL_MINUTES` | Opcional | no | `60` |
| AZURE_TENANT_ID | Tenant ID (AAD) para Azure ARM. | none | **If enabled** (Azure) | no | `00000000-0000-0000-0000-000000000000` |
| AZURE_CLIENT_ID | Client ID (App Registration) para Azure ARM. | none | **If enabled** (Azure) | no | `00000000-0000-0000-0000-000000000000` |
| AZURE_CLIENT_SECRET | Client Secret (App Registration). | none | **If enabled** (Azure) | **sí** | `********` |
| AZURE_SUBSCRIPTION_ID | Subscription ID (GUID). | none | **If enabled** (Azure) | no | `00000000-0000-0000-0000-000000000000` |
| AZURE_RESOURCE_GROUPS | CSV de Resource Groups (opcional). | vacío | Opcional | no | `rg-a,rg-b` |
| AZURE_API_BASE | Base URL ARM. | `https://management.azure.com` | Opcional | no | `https://management.azure.com` |
| AZURE_API_VERSION_COMPUTE | API version Compute. | `2025-04-01` | Opcional | no | `2025-04-01` |
| AZURE_API_VERSION_NETWORK | API version Network. | `2024-05-01` | Opcional | no | `2024-05-01` |
| AZURE_JOB_MAX_GLOBAL | Concurrencia global jobs Azure. | `4` | Opcional | no | `6` |
| AZURE_JOB_MAX_PER_SCOPE | Concurrencia por scope Azure. | `2` | Opcional | no | `2` |
| AZURE_JOB_HOST_TIMEOUT | Timeout por host Azure (seg). | `150` | Opcional | no | `300` |
| AZURE_JOB_MAX_DURATION | Timeout job Azure (seg). | `900` | Opcional | no | `1200` |
| AZURE_REFRESH_INTERVAL_MINUTES | Intervalo Azure (min). | `REFRESH_INTERVAL_MINUTES` | Opcional | no | `60` |
| HYPERV_HOSTS | Lista de hosts Hyper-V (coma/`;`). | vacío | **If enabled** (Hyper-V) | no | `hv1,hv2;hv3` |
| HYPERV_HOST | Host Hyper-V único (fallback). | vacío | **If enabled** (Hyper-V) | no | `hv1` |
| HYPERV_USER | Usuario Hyper-V. | none | **If enabled** (Hyper-V) | no | `svc_hyperv` |
| HYPERV_PASS | Password Hyper-V. | none | **If enabled** (Hyper-V) | **sí** | `********` |
| HYPERV_TRANSPORT | Transporte WinRM. | `ntlm` | Opcional | no | `kerberos` |
| HYPERV_PS_PATH | Ruta script PowerShell. | auto | Opcional | no | `/app/scripts/collect_hyperv_inventory.ps1` |
| HYPERV_CACHE_TTL | TTL cache base Hyper-V (seg). | `300` | Opcional | no | `300` |
| HYPERV_CACHE_TTL_SUMMARY | TTL cache summary Hyper-V (seg). | `300` | Opcional | no | `300` |
| HYPERV_CACHE_TTL_DETAIL | TTL cache detail Hyper-V (seg). | `120` | Opcional | no | `120` |
| HYPERV_CACHE_TTL_DEEP | TTL cache deep Hyper-V (seg). | `30` | Opcional | no | `30` |
| HYPERV_CACHE_TTL_HOSTS | TTL cache hosts Hyper-V (seg). | `300` | Opcional | no | `300` |
| HYPERV_JOB_MAX_GLOBAL | Concurrencia global jobs Hyper-V. | `4` | Opcional | no | `6` |
| HYPERV_JOB_MAX_PER_SCOPE | Concurrencia por scope Hyper-V. | `2` | Opcional | no | `2` |
| HYPERV_JOB_HOST_TIMEOUT | Timeout por host Hyper-V (seg). | `300` | Opcional | no | `300` |
| HYPERV_JOB_MAX_DURATION | Timeout job Hyper-V (seg). | `900` | Opcional | no | `1200` |
| HYPERV_INVENTORY_READ_TIMEOUT | Timeout WinRM inventario (seg). | `1800` | Opcional | no | `1200` |
| HYPERV_INVENTORY_RETRIES | Reintentos WinRM inventario. | `2` | Opcional | no | `3` |
| HYPERV_INVENTORY_BACKOFF_SEC | Backoff WinRM inventario (seg). | `1.5` | Opcional | no | `2` |
| HYPERV_POWER_READ_TIMEOUT | Timeout WinRM power (seg). | `60` | Opcional | no | `120` |
| HYPERV_DETAIL_TIMEOUT | Timeout WinRM detail (seg). | `300` | Opcional | no | `300` |
| HYPERV_REFRESH_INTERVAL_MINUTES | Intervalo Hyper‑V (min). | `REFRESH_INTERVAL_MINUTES` | Opcional | no | `60` |
| NOTIF_SCHED_ENABLED | Habilita scheduler de notificaciones. | `false` | Opcional | no | `true` |
| NOTIF_SCHED_DEV_MINUTES | Cron cada N minutos (dev). | vacío | Opcional | no | `5` |
| NOTIFS_AUTOCLEAR_ENABLED | Limpieza automática de notificaciones. | `true` (si no `TESTING`) | Opcional | no | `false` |
| NOTIFS_RETENTION_DAYS | Retención de notificaciones (días). | `180` | Opcional | no | `365` |
| VITE_API_BASE | Base URL API (frontend). | `/api` | **Prod** | no | `/api` |
| VITE_API_URL | Alias legacy de VITE_API_BASE. | vacío | Opcional | no | `http://localhost:8000/api` |
| DB_HOST | Host DB (futuro, no usado). | none | Futuro | no | `db` |
| DB_PORT | Puerto DB (futuro, no usado). | none | Futuro | no | `5432` |
| DB_NAME | Nombre DB (futuro, no usado). | none | Futuro | no | `inventory` |
| DB_USER | Usuario DB (futuro, no usado). | none | Futuro | **sí** | `inventory_user` |
| DB_PASSWORD | Password DB (futuro, no usado). | none | Futuro | **sí** | `********` |

Notes:
- `VMWARE_ENABLED`, `CEDIA_ENABLED`, `HYPERV_ENABLED`, `AZURE_ENABLED` are derived flags (computed from env presence) and are not env vars themselves.
- In production, do not rely on `.env`; supply env vars via K8S/Secrets/ConfigMaps.
