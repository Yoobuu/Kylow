# ConfigMap: vmware-inv-config

KEY | VALUE | SOURCE
--- | --- | ---
APP_ENV | production | k8s/configmap.yaml
PORT | 8000 | k8s/configmap.yaml
LOG_LEVEL | INFO | k8s/configmap.yaml
INIT_DB_ON_STARTUP | false | k8s/configmap.yaml
VMWARE_ENABLED | true | k8s/configmap.yaml
HYPERV_ENABLED | true | k8s/configmap.yaml
CEDIA_ENABLED | true | k8s/configmap.yaml
WARMUP_ENABLED | true | k8s/configmap.yaml
NOTIF_SCHED_ENABLED | false | k8s/configmap.yaml
CORS_ALLOW_ORIGINS | "" | k8s/configmap.yaml
FRONTEND_ORIGIN | "" | k8s/configmap.yaml

# Secret: vmware-inv-secrets (Infisical)

KEY | VALUE | SENSITIVE? | SOURCE
--- | --- | --- | ---
DATABASE_URL | TBD_INFRA | [SENSITIVE] | prod default (assumed)
SECRET_KEY | TBD_INFRA | [SENSITIVE] | prod default (assumed)
BOOTSTRAP_ADMIN_ENABLED | true |  | prod default (assumed)
BOOTSTRAP_ADMIN_USERNAME | admin |  | prod default (assumed)
BOOTSTRAP_ADMIN_PASSWORD | TBD_INFRA | [SENSITIVE] | prod default (assumed)
VCENTER_HOST | TBD_INFRA |  | prod default (assumed)
VCENTER_USER | TBD_INFRA | [SENSITIVE] | prod default (assumed)
VCENTER_PASS | TBD_INFRA | [SENSITIVE] | prod default (assumed)
HYPERV_HOSTS | TBD_INFRA |  | prod default (assumed)
HYPERV_HOST | "" |  | prod default (assumed)
HYPERV_USER | TBD_INFRA | [SENSITIVE] | prod default (assumed)
HYPERV_PASS | TBD_INFRA | [SENSITIVE] | prod default (assumed)
CEDIA_BASE | TBD_INFRA |  | prod default (assumed)
CEDIA_USER | TBD_INFRA | [SENSITIVE] | prod default (assumed)
CEDIA_PASS | TBD_INFRA | [SENSITIVE] | prod default (assumed)

# TBD_INFRA
DATABASE_URL
SECRET_KEY
BOOTSTRAP_ADMIN_PASSWORD
VCENTER_HOST
VCENTER_USER
VCENTER_PASS
HYPERV_HOSTS
HYPERV_USER
HYPERV_PASS
CEDIA_BASE
CEDIA_USER
CEDIA_PASS
