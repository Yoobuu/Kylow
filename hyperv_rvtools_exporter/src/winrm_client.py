import base64
import uuid
import logging
import winrm
from dataclasses import dataclass
from typing import Tuple, Optional

logger = logging.getLogger("hyperv.winrm")

@dataclass
class WinRMResult:
    host: str
    exit_code: int
    stdout: str
    stderr: str
    error: Optional[str] = None

class WinRMClient:
    def __init__(self, host: str, config):
        self.host = host
        self.config = config
        self._session = None

    def _get_session(self, operation_timeout=None, read_timeout=None):
        op_timeout = operation_timeout or self.config.read_timeout
        rd_timeout = read_timeout or (op_timeout + 30)
        
        endpoint = f"{self.config.winrm_scheme}://{self.host}:{self.config.winrm_port}/wsman"
        
        return winrm.Session(
            target=endpoint,
            auth=(self.config.username, self.config.password),
            transport=self.config.winrm_transport,
            server_cert_validation='validate' if self.config.verify_ssl else 'ignore',
            operation_timeout_sec=op_timeout,
            read_timeout_sec=rd_timeout
        )

    def run_command(self, command: str) -> WinRMResult:
        """Run a simple PowerShell command."""
        session = self._get_session()
        try:
            r = session.run_ps(command)
            return WinRMResult(
                host=self.host,
                exit_code=r.status_code,
                stdout=self._decode(r.std_out),
                stderr=self._decode(r.std_err)
            )
        except Exception as e:
            return WinRMResult(self.host, -1, "", "", str(e))

    def run_script_with_upload(self, script_content: str) -> WinRMResult:
        """
        Uploads a script to %TEMP% via chunked writes (to avoid CLI limits) and executes it.
        """
        session = self._get_session()
        guid = str(uuid.uuid4())
        remote_filename = f"hv_export_{guid}.ps1"
        
        try:
            # 1. Init empty file
            init_cmd = rf"""
$path = Join-Path $env:TEMP '{remote_filename}'
New-Item -ItemType File -Path $path -Force | Out-Null
$path
"""
            r = session.run_ps(init_cmd)
            if r.status_code != 0:
                return WinRMResult(self.host, r.status_code, self._decode(r.std_out), self._decode(r.std_err))

            # 2. Upload chunks
            CHUNK = 1024 # Larger chunk than remote.py for speed, assuming stable network
            encoded = base64.b64encode(script_content.encode("utf-8")).decode("ascii")
            
            for i in range(0, len(encoded), CHUNK):
                part = encoded[i:i + CHUNK]
                append_cmd = rf"""
$p = Join-Path $env:TEMP '{remote_filename}'
$bytes = [Convert]::FromBase64String("{part}")
$txt = [Text.Encoding]::UTF8.GetString($bytes)
[IO.File]::AppendAllText($p, $txt, [Text.Encoding]::UTF8)
"""
                r = session.run_ps(append_cmd)
                if r.status_code != 0:
                    return WinRMResult(self.host, r.status_code, "", f"Upload failed at chunk {i}: " + self._decode(r.std_err))

            # 3. Execute
            # Note: We use -File to execute the script
            run_cmd = rf"""
$p = Join-Path $env:TEMP '{remote_filename}'
try {{
    & powershell -NoProfile -ExecutionPolicy Bypass -File $p
}} finally {{
    Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
}}
"""
            r = session.run_ps(run_cmd)
            return WinRMResult(
                host=self.host,
                exit_code=r.status_code,
                stdout=self._decode(r.std_out),
                stderr=self._decode(r.std_err)
            )

        except Exception as e:
            return WinRMResult(self.host, -1, "", "", str(e))

    def _decode(self, b: bytes) -> str:
        if not b:
            return ""
        try:
            return b.decode("utf-8")
        except:
            return b.decode("utf-16-le", errors="ignore")
