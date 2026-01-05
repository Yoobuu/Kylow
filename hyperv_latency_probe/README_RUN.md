# Hyper-V Latency Probe

Script de diagnóstico de latencias para los endpoints Hyper-V (ejecución secuencial, sin paralelismo).

## Dónde correrlo
- Ir al directorio del proyecto: `/home/paulo/projects/vmware-inv`

## Dependencias
- Python 3.8+.
- Módulo `requests` (instalar una sola vez en el entorno que uses):
  - `pip install requests`

## Comando de ejecución
- Desde `/home/paulo/projects/vmware-inv`:
  - `python -m hyperv_latency_probe.main`
- Cada ciclo usa `run_id` incremental (1, 2, 3...) y golpea cada ruta 3 veces de forma secuencial.
- Sigue tolerando requests de larga duración; timeouts largos no detienen el ciclo completo.

## Ejecutar en background (elige una)
1) `nohup python -m hyperv_latency_probe.main > hyperv_latency_probe/probe.log 2>&1 &`
2) `tmux new -s hyperv_probe`, correr el comando dentro y dejar la sesión viva.
3) `screen -S hyperv_probe`, correr el comando dentro y detach.

## Verificar que sigue corriendo
- Revisar procesos: `ps aux | grep hyperv_latency_probe`
- Ver la cola de logs (si usaste nohup): `tail -f hyperv_latency_probe/probe.log`
- Ver registros de latencia en vivo: `tail -f hyperv_latency_probe/hyperv_latency_report.csv`

## Dónde se guardan los resultados
- Archivo CSV incremental: `hyperv_latency_probe/hyperv_latency_report.csv`
  - Se escribe y flushea en cada request (incluye ciclo, secuencia, endpoint, host, status, tiempo, errores).
  - Si la cabecera cambia, se rota automáticamente a `*.bak-<timestamp>` y se vuelve a generar con las columnas nuevas.

## Flujo que ejecuta
1. Autenticación con las credenciales configuradas en `hyperv_latency_probe/config.py`.
2. GET `/api/hyperv/vms/batch`
3. GET `/api/hyperv/vms/batch?refresh=true`
4. GET `/api/hyperv/vms/<HOST>?refresh=true&level=summary` uno por uno en el orden configurado.
5. GET `/api/hyperv/hosts?refresh=true`
6. Repite el ciclo completo con pausa corta (configurable).

## Notas operativas
- Maneja expiración del JWT automáticamente y reintenta una vez en caso de 401 o timeout.
- Cada request mide el tiempo total (incluye retries y descarga completa).
- Tiempo de espera amplio para lecturas largas (configurable en `config.py`); los timeouts quedan marcados en el CSV.
- No requiere interacción humana durante la ejecución.
- Para detenerlo, corta el proceso; los datos ya escritos quedan en el CSV.

## Columnas del CSV
- `run_id`, `cycle`, `sequence`, `label`, `route_type`, `endpoint`, `host`, `level`, `refresh`
- `http_status`, `success`, `latency_sec`, `timeout_hit`, `retry_count`, `retry_reason`, `token_refresh`
- `error_type`, `error_message`, `started_at`, `finished_at`, `query`
