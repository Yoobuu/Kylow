# Kubernetes v1 (1 replica) quickstart

Apply order:

1) Config + Secrets
   - `kubectl apply -f k8s/configmap.yaml`
   - Secret real via Infisical (do not apply `k8s/secret.example.yaml`)

2) DB init one-shot
   - `kubectl apply -f k8s/db-init-job.yaml`
   - Wait for completion, then delete job if desired.
   - The job creates tables, default permissions, and the initial admin (only if no users exist).

3) App workloads + services
   - `kubectl apply -f k8s/backend-deployment.yaml`
   - `kubectl apply -f k8s/backend-service.yaml`
   - `kubectl apply -f k8s/frontend-deployment.yaml`
   - `kubectl apply -f k8s/frontend-service.yaml`

4) Ingress
   - `kubectl apply -f k8s/ingress.yaml`

Notes:
- Kubernetes does NOT expand `${IMAGE_TAG}`. Replace tags manually or use kustomize/helm/pipeline.
- Example (manual): `sed -i 's/${IMAGE_TAG}/v1.0.0/g' k8s/*.yaml`
- Example (kustomize): create/update `k8s/kustomization.yaml` and run `kubectl apply -k k8s/`
- Backend readiness probe uses `/ready` (checks DB). Liveness uses `/healthz`.
- This setup assumes **1 backend replica**. If you scale beyond 1, move schedulers/warmups to a singleton.
