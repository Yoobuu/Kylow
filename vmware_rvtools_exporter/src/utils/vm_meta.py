from typing import Dict, Optional
from urllib.parse import urlparse

from pyVmomi import vim


def _server_host(server: str) -> str:
    if not server:
        return ""
    if "://" not in server:
        server = f"https://{server}"
    try:
        parsed = urlparse(server)
        return parsed.hostname or server
    except Exception:
        return server


def get_vi_sdk_meta(service_instance, server: str) -> Dict[str, str]:
    instance_uuid = ""
    try:
        content = service_instance.RetrieveContent() if service_instance else None
        about = content.about if content else None
        instance_uuid = getattr(about, "instanceUuid", "") or ""
    except Exception:
        instance_uuid = ""

    return {
        "VI SDK Server": _server_host(server),
        "VI SDK UUID": instance_uuid,
    }


def _folder_path(folder_ref) -> str:
    if not folder_ref:
        return ""
    parts = []
    datacenter = ""
    current = folder_ref
    seen = set()
    depth = 0
    while current and depth < 20:
        moid = current._GetMoId() if hasattr(current, "_GetMoId") else None
        if moid:
            if moid in seen:
                break
            seen.add(moid)
        if isinstance(current, vim.Datacenter):
            datacenter = getattr(current, "name", "") or ""
            break
        name = getattr(current, "name", "") or ""
        if name:
            parts.append(name)
        current = getattr(current, "parent", None)
        depth += 1

    if not parts and not datacenter:
        return ""

    parts = list(reversed(parts))
    if datacenter:
        parts.insert(0, datacenter)
    return "/" + "/".join(parts)


def get_vm_meta(vm_ref, props: Dict[str, object], folder_ref=None) -> Dict[str, str]:
    moid = ""
    if vm_ref is not None and hasattr(vm_ref, "_GetMoId"):
        try:
            moid = vm_ref._GetMoId()
        except Exception:
            moid = ""

    if folder_ref is None and vm_ref is not None:
        try:
            folder_ref = getattr(vm_ref, "parent", None)
        except Exception:
            folder_ref = None

    vm_uuid = props.get("config.uuid") or props.get("config.instanceUuid") or ""
    os_config = props.get("config.guestFullName") or props.get("config.guestId") or ""
    os_tools = props.get("guest.guestFullName") or ""
    annotation = props.get("config.annotation") or ""
    cluster_invariant = props.get("config.instanceUuid") or ""
    folder_path = _folder_path(folder_ref)

    return {
        "VM ID": moid,
        "VM UUID": vm_uuid,
        "OS according to the configuration file": os_config,
        "OS according to the VMware Tools": os_tools,
        "Folder": folder_path,
        "ClusterInvariantVMMId": cluster_invariant,
        "Annotation": annotation,
        "SRM Placeholder": "FALSE",
    }


def _set_if_empty(row: Dict[str, object], key: str, value: object) -> None:
    if value is None:
        return
    if isinstance(value, str) and value == "":
        return
    if key in row:
        existing = row.get(key)
        if existing not in (None, ""):
            return
    row[key] = value


def apply_vm_meta(
    row: Dict[str, object],
    vm_meta: Optional[Dict[str, str]] = None,
    vi_meta: Optional[Dict[str, str]] = None,
    include_srm: bool = False,
) -> None:
    if vi_meta:
        _set_if_empty(row, "VI SDK Server", vi_meta.get("VI SDK Server", ""))
        _set_if_empty(row, "VI SDK UUID", vi_meta.get("VI SDK UUID", ""))

    if not vm_meta:
        return

    for key, value in vm_meta.items():
        if key == "SRM Placeholder" and not include_srm:
            continue
        _set_if_empty(row, key, value)
