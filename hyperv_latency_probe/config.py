"""Static configuration for the Hyper-V latency probe."""
from typing import List, Tuple

# Backend connection
BASE_URL: str = "http://localhost:8000"
API_PREFIX: str = "/api"

# API endpoints
AUTH_ENDPOINT: str = "/auth/login"
BATCH_ENDPOINT: str = "/hyperv/vms/batch"
HOST_SUMMARY_ENDPOINT: str = "/hyperv/vms/{host}"
HOSTS_ENDPOINT: str = "/hyperv/hosts"

# Credentials (intentionally hardcoded per requirements)
USERNAME: str = "admin"
PASSWORD: str = "1234"

# Hosts order to probe
HOSTS: List[str] = [
    "S-HYP-01",
    "S-HYP-02",
    "S-HYP-03",
    "S-HYP-04",
    "T-HYP-01",
    "T-HYP-02",
    "T-HYP-03",
    "P-HYP-01",
    "P-HYP-02",
    "P-HYP-03",
    "P-HYP-04",
    "P-HYP-05",
]

# Networking / timing
# Timeout is (connect, read) to allow long-running operations.
REQUEST_TIMEOUT: Tuple[float, float] = (10.0, 1800.0)
REQUEST_RETRY_LIMIT: int = 1  # Number of retries after the initial attempt (401/timeouts)
TOKEN_EXP_LEEWAY_SECONDS: int = 60
FALLBACK_TOKEN_TTL_SECONDS: int = 3600
ERROR_MESSAGE_MAX_LEN: int = 240

# Runner behavior
CYCLE_PAUSE_SECONDS: float = 1.0
MAX_CYCLES = 1  # Number of full passes over the request plan (1 ensures it stops)
REQUEST_REPETITIONS: int = 3  # How many times to hit each endpoint before moving on

# Output
REPORT_PATH: str = "hyperv_latency_probe/hyperv_latency_report.csv"

# VMware endpoints
VMS_ENDPOINT: str = "/vms"
VMWARE_HOSTS_ENDPOINT: str = "/hosts/"

# Auth / users / permissions
AUTH_ME_ENDPOINT: str = "/auth/me"
USERS_ENDPOINT: str = "/users/"
PERMISSIONS_ENDPOINT: str = "/permissions/"

# Audit
AUDIT_LOGS_ENDPOINT: str = "/audit/"

# Notifications
NOTIFICATIONS_ENDPOINT: str = "/notifications/"

# CEDIA
CEDIA_LOGIN_ENDPOINT: str = "/cedia/login"
CEDIA_VMS_ENDPOINT: str = "/cedia/vms"

# Hyper-V endpoints (existing)
HYPERV_VMS_ENDPOINT: str = "/hyperv/vms"


def build_url(path: str) -> str:
    """Compose full URL from a relative API path."""
    return f"{BASE_URL.rstrip('/')}{API_PREFIX}{path}"
