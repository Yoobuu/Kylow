# filepath: app/providers/hyperv/remote.py
from __future__ import annotations
import json, logging, os, subprocess, tempfile, time
from typing import List, Optional
from dataclasses import dataclass

import winrm  # pywinrm en requirements
from requests.exceptions import RequestException
from winrm.exceptions import WinRMOperationTimeoutError, WinRMTransportError

try:
    from app.main import TEST_MODE
except Exception:
    TEST_MODE = False

logger = logging.getLogger("hyperv.remote")


@dataclass
class RemoteCreds:
    host: str
    username: Optional[str] = None
    password: Optional[str] = None
    transport: str = "ntlm"   # ntlm|kerberos|credssp
    use_winrm: bool = True    # si False, ejecuta localmente el PS (debug)
    port: int = 5985
    scheme: str = "http"
    read_timeout: int = 60    # segundos por ejecuciA3n
    connect_timeout: int = 10
    retries: int = 2
    backoff_sec: float = 1.5
    # Ruta del JSON/CSV que escribe tu script en el host remoto (fallback)
    json_path: str = r"C:\Temp\hyperv_cluster_inventory_clean.json"
    csv_path: str = r"C:\Temp\hyperv_cluster_inventory_clean.csv"


PS_SCRIPT_BASENAME = "collect_hyperv_inventory.ps1"


class HostUnreachableError(RuntimeError):
    pass


def _compute_winrm_timeouts(read_timeout_sec: int, *, cap_operation_timeout_sec: int | None = None) -> tuple[int, int]:
    """
    Compute pywinrm timeouts.

    - operation_timeout_sec controls the WSMan operation timeout.
    - read_timeout_sec controls the underlying HTTP read timeout and must be > operation_timeout_sec.
    """
    op_timeout = max(5, int(read_timeout_sec))
    if cap_operation_timeout_sec is not None:
        op_timeout = min(op_timeout, int(cap_operation_timeout_sec))
    # Keep a small margin so the HTTP client doesn't cut off exactly at WSMan timeout.
    read_timeout = op_timeout + 30
    return op_timeout, read_timeout


def _compute_probe_timeouts(connect_timeout_sec: int) -> tuple[int, int]:
    read_timeout = max(2, int(connect_timeout_sec))
    op_timeout = max(1, read_timeout - 1)
    if read_timeout <= op_timeout:
        read_timeout = op_timeout + 1
    return op_timeout, read_timeout


def _is_unreachable_exception(exc: Exception) -> bool:
    if isinstance(exc, HostUnreachableError):
        return True
    if isinstance(exc, (RequestException, WinRMTransportError, WinRMOperationTimeoutError, TimeoutError)):
        msg = str(exc).lower()
        return any(
            token in msg
            for token in (
                "connect",
                "connection",
                "timed out",
                "timeout",
                "refused",
                "unreachable",
                "no route",
                "failed to establish",
                "name or service not known",
                "temporary failure in name resolution",
            )
        )
    return False


def _ensure_winrm_reachable(creds: RemoteCreds) -> None:
    if creds.connect_timeout <= 0:
        return
    endpoint = f"{creds.scheme}://{creds.host}:{creds.port}/wsman"
    op_timeout, read_timeout = _compute_probe_timeouts(creds.connect_timeout)
    try:
        session = winrm.Session(
            target=endpoint,
            auth=(creds.username or "", creds.password or ""),
            transport=creds.transport,
            read_timeout_sec=read_timeout,
            operation_timeout_sec=op_timeout,
        )
        response = session.run_cmd("echo", ["ok"])
        if response.status_code != 0:
            raise RuntimeError(f"WinRM probe failed: {response.status_code}")
    except Exception as exc:
        if _is_unreachable_exception(exc):
            raise HostUnreachableError("unreachable") from exc
        raise


def _run_local_powershell(
    ps_path: str,
    hvhost: str,
    level: str,
    timeout: int,
    vm_name: str | None,
    skip_vhd: bool,
    skip_measure: bool,
    skip_kvp: bool,
) -> str:
    args = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps_path,
        "-HVHost",
        hvhost,
        "-Level",
        level,
    ]
    if vm_name:
        args.extend(["-VMName", vm_name])
    # For switch parameters, pass the flag only when True to avoid PS
    # interpreting string values and failing conversion.
    if skip_vhd:
        args.append("-SkipVhd")
    if skip_measure:
        args.append("-SkipMeasure")
    if skip_kvp:
        args.append("-SkipKvp")
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"PS exited {result.returncode}: {result.stderr.strip()[:500]}")
    return result.stdout


def _decode_bytes(b: bytes) -> str:
    """Intenta decodificar primero como UTF-8 y si no, como UTF-16-LE (tApico PowerShell)."""
    if not b:
        return ""
    try:
        return b.decode("utf-8")
    except Exception:
        try:
            return b.decode("utf-16-le")
        except Exception:
            return b.decode(errors="ignore")


def _extract_json_list(txt: str) -> Optional[List[dict]]:
    """
    Devuelve una lista de dicts a partir de:
      - una lista JSON vAlida:            [ {...}, {...} ]
      - un Aonico objeto JSON:              { ... }            -> [ { ... } ]
      - varios objetos sin corchetes:      { ... }\n{ ... }   -> [ { ... }, { ... } ]
      - NDJSON:                            { ... }\n{ ... }
    Ignora banners antes/despuAs.
    """
    if not txt:
        return None
    s = txt.strip()

    # 1) Intento directo
    try:
        obj = json.loads(s)
        if isinstance(obj, list):
            return obj
        if isinstance(obj, dict):
            return [obj]
    except Exception:
        pass

    # 2) Extraer el primer bloque con '[' ... ']'
    i = s.find('[')
    j = s.rfind(']')
    if i != -1 and j != -1 and j > i:
        snippet = s[i:j+1]
        try:
            obj = json.loads(snippet)
            if isinstance(obj, list):
                return obj
            if isinstance(obj, dict):
                return [obj]
        except Exception:
            pass

    # 3) Varias lAneas de objetos { } (sin corchetes) o NDJSON
    #    Tomamos lAneas que parezcan JSON-object, las parseamos individualmente.
    objs: List[dict] = []
    for line in s.splitlines():
        line = line.strip()
        if not line:
            continue
        # lAnea que luce como objeto JSON
        if line.startswith("{") and line.endswith("}"):
            try:
                o = json.loads(line)
                if isinstance(o, dict):
                    objs.append(o)
            except Exception:
                # puede que sean objetos multi-lAnea, intentemos acumular bloques
                pass

    if objs:
        return objs

    # 4) Intento de apegara bloques { } separados por saltos, creando una gran lista
    #    HeurAstica simple: envolver todo en [ ... ] e insertar comas entre '}{' o '}\n{'
    glue = s.replace('}\r\n{', '},{').replace('}\n{', '},{').replace('}{', '},{')
    if glue.startswith("{") and glue.endswith("}"):
        try:
            obj = json.loads(f"[{glue}]")
            if isinstance(obj, list):
                return obj
        except Exception:
            pass

    return None



def _read_remote_text(session: winrm.Session, ps: str) -> str:
    r = session.run_ps(ps)
    if r.status_code != 0:
        return ""
    return _decode_bytes(r.std_out).strip()


def _run_winrm_inline(
    creds: RemoteCreds,
    ps_content: str,
    hvhost: str,
    level: str,
    vm_name: str | None,
    skip_vhd: bool,
    skip_measure: bool,
    skip_kvp: bool,
) -> str:
    """
    Sube el script al host remoto en chunks, lo ejecuta y devuelve stdout (texto).
    Si stdout sale vacAo, aquA NO se lee archivo: eso lo maneja run_inventory().
    """
    import base64, uuid

    endpoint = f"{creds.scheme}://{creds.host}:{creds.port}/wsman"
    _ensure_winrm_reachable(creds)
    op_timeout, read_timeout = _compute_winrm_timeouts(creds.read_timeout)

    session = winrm.Session(
        target=endpoint,
        auth=(creds.username or "", creds.password or ""),
        transport=creds.transport,
        read_timeout_sec=read_timeout,
        operation_timeout_sec=op_timeout,
    )

    guid = str(uuid.uuid4())
    remote_file_name = f"collect_{guid}.ps1"

    # 1) crear archivo vacAo en %TEMP%
    init_cmd = rf"""
$fname = '{remote_file_name}'
$path  = Join-Path $env:TEMP $fname
Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $path -Force | Out-Null
$path
"""
    r = session.run_ps(init_cmd)
    if r.status_code != 0:
        err = _decode_bytes(r.std_err)
        raise RuntimeError(f"WinRM init file error: {err[:500]}")

    # 2) subir contenido en chunks
    CHUNK = 512
    encoded = base64.b64encode(ps_content.encode("utf-8")).decode("ascii")
    for i in range(0, len(encoded), CHUNK):
        part = encoded[i:i + CHUNK]
        append_cmd = rf"""
$fname='{remote_file_name}';$p=Join-Path $env:TEMP $fname;
$bytes=[Convert]::FromBase64String("{part}");
$txt=[Text.Encoding]::UTF8.GetString($bytes);
[IO.File]::AppendAllText($p,$txt,[Text.Encoding]::UTF8)
"""
        r = session.run_ps(append_cmd)
        if r.status_code != 0:
            err = _decode_bytes(r.std_err)
            raise RuntimeError(f"WinRM append chunk error: {err[:500]}")

    # 3) ejecutar
    vm_arg = ""
    if vm_name:
        escaped_vm = vm_name.replace("'", "''")
        vm_arg = f"-VMName '{escaped_vm}'"
    flag_args = []
    if skip_vhd:
        flag_args.append("-SkipVhd")
    if skip_measure:
        flag_args.append("-SkipMeasure")
    if skip_kvp:
        flag_args.append("-SkipKvp")
    flags_str = " ".join(flag_args)
    run_cmd = rf"""
$fname='{remote_file_name}';$p=Join-Path $env:TEMP $fname;
& powershell -NoProfile -ExecutionPolicy Bypass -File $p -HVHost '{hvhost}' -Level '{level}' {vm_arg} {flags_str}
"""
    r = session.run_ps(run_cmd)

    # 4) limpieza best-effort
    session.run_ps(rf"""
$fname='{remote_file_name}';$p=Join-Path $env:TEMP $fname;
Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
""")

    if r.status_code != 0:
        # Nota: permitimos que siga si stdout trae algo (banner + JSON)
        stdout_txt = _decode_bytes(r.std_out).strip()
        if not stdout_txt:
            stderr_txt = _decode_bytes(r.std_err)
            raise RuntimeError(f"WinRM PS error {r.status_code}: {stderr_txt[:500]}")
        return stdout_txt

    return _decode_bytes(r.std_out).strip()


def run_inventory(
    creds: RemoteCreds,
    ps_content: Optional[str] = None,
    ps_path_local: Optional[str] = None,
    *,
    level: str = "summary",
    vm_name: Optional[str] = None,
    skip_vhd: Optional[bool] = None,
    skip_measure: Optional[bool] = None,
    skip_kvp: Optional[bool] = None,
) -> List[dict]:
    """
    Ejecuta collect_hyperv_inventory en el host remoto (WinRM) o localmente.
    Retorna una lista de dicts (cada VM) con el nivel indicado.
    """
    if TEST_MODE:
        return [{"test_mode": True, "results": []}]
    last_err = None
    level_norm = (level or "summary").lower()
    sv = skip_vhd if skip_vhd is not None else level_norm == "summary"
    sm = skip_measure if skip_measure is not None else level_norm == "summary"
    sk = skip_kvp if skip_kvp is not None else level_norm == "summary"
    if os.getenv("HV_DEBUG_VHD") == "1":
        logger.info(
            "HV_DEBUG run_inventory level=%s skip_vhd=%s skip_measure=%s skip_kvp=%s host=%s vm=%s use_winrm=%s",
            level_norm,
            sv,
            sm,
            sk,
            creds.host,
            vm_name,
            creds.use_winrm,
        )

    for attempt in range(creds.retries + 1):
        try:
            # 1) ejecutar
            if creds.use_winrm:
                if ps_content is None:
                    raise ValueError("ps_content requerido para WinRM inline")
                raw = _run_winrm_inline(
                    creds,
                    ps_content,
                    hvhost=creds.host,
                    level=level_norm,
                    vm_name=vm_name,
                    skip_vhd=sv,
                    skip_measure=sm,
                    skip_kvp=sk,
                )
            else:
                if not ps_path_local:
                    if ps_content is None:
                        raise ValueError("ps_content requerido si no hay ps_path_local")
                    with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False) as fh:
                        fh.write(ps_content)
                        ps_path_local = fh.name
                raw = _run_local_powershell(
                    ps_path_local,
                    hvhost=creds.host,
                    level=level_norm,
                    timeout=creds.read_timeout,
                    vm_name=vm_name,
                    skip_vhd=sv,
                    skip_measure=sm,
                    skip_kvp=sk,
                )

            raw = (raw or "").strip()

            # 2) intentar extraer lista JSON desde stdout
            data = _extract_json_list(raw)

            # 3) si no hay lista, abrir sesiA3n y probar archivo JSON/CSV remotos
            if data is None and creds.use_winrm:
                endpoint = f"{creds.scheme}://{creds.host}:{creds.port}/wsman"
                op_timeout, read_timeout = _compute_winrm_timeouts(creds.read_timeout)
                session = winrm.Session(
                    target=endpoint,
                    auth=(creds.username or "", creds.password or ""),
                    transport=creds.transport,
                    read_timeout_sec=read_timeout,
                    operation_timeout_sec=op_timeout,
                )

                # 3.a JSON remoto
                if creds.json_path:
                    read_json_cmd = rf"""
$p = '{creds.json_path}';
if (Test-Path -LiteralPath $p) {{ Get-Content -LiteralPath $p -Raw }} else {{ '' }}
"""
                    raw_json = _read_remote_text(session, read_json_cmd)
                    data = _extract_json_list(raw_json)

                # 3.b CSV remoto -> JSON si sigue sin datos
                if data is None and creds.csv_path:
                    read_csv_cmd = rf"""
$p = '{creds.csv_path}';
if (Test-Path -LiteralPath $p) {{
  Import-Csv -LiteralPath $p | ConvertTo-Json -Depth 6
}} else {{ '' }}
"""
                    raw_csv_json = _read_remote_text(session, read_csv_cmd)
                    data = _extract_json_list(raw_csv_json)

            if data is None:
                snippet = (raw[:300] + "a") if raw else "<vacAo>"
                raise ValueError(f"El inventario debe ser una lista JSON (snippet stdout: {snippet})")

            return data

        except (json.JSONDecodeError, RequestException, subprocess.TimeoutExpired,
                RuntimeError, ValueError) as e:
            if _is_unreachable_exception(e):
                raise HostUnreachableError("unreachable") from e
            last_err = e
            logger.warning(
                "Intento %s/%s fallA3 para %s: %s",
                attempt + 1, creds.retries + 1, creds.host, str(e)
            )
            if attempt < creds.retries:
                time.sleep((attempt + 1) * creds.backoff_sec)
            else:
                break

    raise RuntimeError(f"Fallo al recolectar inventario de {creds.host}: {last_err}")


def run_power_action(creds: RemoteCreds, vm_name: str, action: str) -> tuple[bool, str]:
    """
    Ejecuta acciones de energia sobre una VM en Hyper-V mediante WinRM.
    Soporta:
      start -> Start-VM
      stop  -> Stop-VM -Force
      reset -> Stop-VM -Force ; Start-VM

    Devuelve (ok, mensaje). Si algo falla, devuelve (False, mensaje_de_error).
    NO debe colgar la request HTTP.
    """

    action_normalized = (action or "").strip().lower()

    if action_normalized == "start":
        core_cmds = "Start-VM -Name $vmName -Confirm:$false | Out-Null"
    elif action_normalized == "stop":
        core_cmds = "Stop-VM -Name $vmName -Force -Confirm:$false | Out-Null"
    elif action_normalized == "reset":
        # En lugar de usar Restart-VM (que se cuelga),
        # hacemos stop forzado + start.
        core_cmds = (
            "Stop-VM -Name $vmName -Force -Confirm:$false | Out-Null\n"
            "Start-VM -Name $vmName -Confirm:$false | Out-Null"
        )
    else:
        return (False, f"Accion no soportada: {action}")

    # Sanitizamos el nombre de la VM para PowerShell
    vm_escaped = vm_name.replace("`", "``").replace('"', '`"')

    script = rf"""
$ErrorActionPreference = "Stop"
$vmName = "{vm_escaped}"
try {{
    {core_cmds}
    Write-Output ("OK: Accion '{action_normalized}' enviada a " + $vmName)
}} catch {{
    $errMsg = $_.Exception.Message
    Write-Error $errMsg
    exit 1
}}
""".strip()

    if TEST_MODE:
        return (False, "WinRM disabled in test mode")

    try:
        endpoint = f"{creds.scheme}://{creds.host}:{creds.port}/wsman"
        _ensure_winrm_reachable(creds)
        op_timeout, read_timeout = _compute_winrm_timeouts(
            creds.read_timeout,
            cap_operation_timeout_sec=120,
        )
        session = winrm.Session(
            target=endpoint,
            auth=(creds.username or "", creds.password or ""),
            transport=creds.transport,
            read_timeout_sec=read_timeout,
            operation_timeout_sec=op_timeout,
        )
        response = session.run_ps(script)
    except HostUnreachableError:
        return (False, "unreachable")
    except Exception as exc:
        logger.error("WinRM power action failure for %s: %s", creds.host, exc)
        return (False, f"WinRM error: {exc}")

    stdout_txt = _decode_bytes(response.std_out).strip()
    stderr_txt = _decode_bytes(response.std_err).strip()

    if response.status_code == 0:
        message = stdout_txt or f"OK: Accion '{action_normalized}' enviada a {vm_name}"
        return (True, message)

    logger.warning(
        "Power action '%s' failed for VM '%s' on host '%s': %s",
        action_normalized,
        vm_name,
        creds.host,
        stderr_txt or stdout_txt,
    )
    error_msg = stderr_txt or stdout_txt or "Accion de potencia fallida sin detalles"
    return (False, error_msg)
