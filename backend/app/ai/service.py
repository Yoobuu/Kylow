from __future__ import annotations

import os
from typing import Dict, List, Optional, Protocol

from app.ai.providers import OpenAIProvider, build_openai_config
from app.ai.schemas import AINotification, AIHost, AIVm
from app.ai.tools import list_hosts, list_notifications, list_vms
from app.ai.types import ProviderResult


class LLMProvider(Protocol):
    def run(
        self,
        message: str,
        ui_context: Optional[Dict[str, object]] = None,
        *,
        user,
        session,
    ) -> ProviderResult:
        ...


class MockProvider:
    """
    Deterministic mock provider. This will be replaced by a real LLM provider
    (OpenAI/Azure/etc.) once API credentials and tool-calling are enabled.
    """

    def __init__(self) -> None:
        pass

    def run(
        self,
        message: str,
        ui_context: Optional[Dict[str, object]] = None,
        *,
        user,
        session,
    ) -> ProviderResult:
        from app.ai.schemas import HostFilters, NotificationFilters, VmFilters
        msg = (message or "").strip().lower()
        tools_used: List[Dict[str, object]] = []

        if not msg:
            return ProviderResult(
                answer_text="Envia una consulta valida sobre inventario, hosts o notificaciones.",
                entities=[],
                actions=[],
                tools_used=tools_used,
            )

        if any(token in msg for token in ("alerta", "alertas", "notification", "notificacion", "notificaciones")):
            filters = NotificationFilters()
            return self._run_notifications(filters, tools_used, user=user, session=session)

        if any(token in msg for token in ("host", "hosts")) and not any(token in msg for token in ("vm", "vms")):
            filters = HostFilters()
            return self._run_hosts(filters, tools_used, user=user, session=session)

        if any(token in msg for token in ("vm", "vms", "ram", "memoria", "cpu", "vlan", "top")):
            filters = self._build_vm_filters(msg)
            return self._run_vms(filters, tools_used, user=user, session=session)

        return ProviderResult(
            answer_text=(
                "En esta fase solo soporta consultas de inventario (VMs), hosts y notificaciones."
            ),
            entities=[],
            actions=[],
            tools_used=tools_used,
        )

    def _build_vm_filters(self, msg: str):
        from app.ai.schemas import VmFilters
        providers: List[str] = []
        if "vmware" in msg:
            providers.append("vmware")
        if "hyperv" in msg or "hyper-v" in msg or "hyper v" in msg:
            providers.append("hyperv")
        if "ovirt" in msg or "kvm" in msg:
            providers.append("ovirt")
        if "azure" in msg:
            providers.append("azure")
        if "cedia" in msg or "vcloud" in msg:
            providers.append("cedia")

        sort = None
        if "top" in msg or "mayor" in msg:
            if "ram" in msg or "memoria" in msg:
                sort = "ram_desc"
            elif "cpu" in msg:
                sort = "cpu_desc"
        if "cpu" in msg and ("uso" in msg or "%" in msg):
            sort = "cpu_usage_desc"
        if ("ram" in msg or "memoria" in msg) and ("uso" in msg or "%" in msg):
            sort = "ram_usage_desc"

        vlan_id = None
        match = __import__("re").search(r"vlan\s*(\d+)", msg)
        if match:
            try:
                vlan_id = int(match.group(1))
            except ValueError:
                vlan_id = None

        ram_min = None
        ram_match = __import__("re").search(r"(ram|memoria)\s*(\d+)", msg)
        if ram_match:
            try:
                ram_min = int(ram_match.group(2))
            except ValueError:
                ram_min = None

        limit = 20
        match = __import__("re").search(r"top\s*(\d+)", msg)
        if match:
            try:
                limit = int(match.group(1))
            except ValueError:
                limit = 20

        return VmFilters(
            provider=providers or None,
            vlan_id=vlan_id,
            sort=sort,
            limit=limit,
            ram_min_mib=ram_min,
        )

    def _run_vms(self, filters, tools_used: List[Dict[str, object]], *, user, session) -> ProviderResult:
        notes: List[Dict[str, object]] = []
        try:
            vms = list_vms(filters, user=user, session=session, notes=notes)
            tools_used.append({
                "name": "list_vms",
                "filters": filters.model_dump(),
                "result_count": len(vms),
                "notes": notes,
                "snapshot": self._snapshot_from_notes(notes),
            })
        except Exception as exc:
            tools_used.append({
                "name": "list_vms",
                "filters": filters.model_dump(),
                "error": str(exc),
                "notes": notes,
            })
            return ProviderResult(
                answer_text=str(exc),
                entities=[],
                actions=[],
                tools_used=tools_used,
                meta={"tools_used": tools_used},
            )

        entities = [self._vm_entity(vm) for vm in vms]
        lines = [f"{vm.name} ({vm.provider})" for vm in vms[:5]]
        summary = f"Encontré {len(vms)} VMs." if vms else "No encontré VMs con esos filtros."
        if lines:
            summary += " Ejemplos: " + ", ".join(lines)

        if filters.vlan_id and (not filters.provider or "vmware" in (filters.provider or [])):
            summary += " Nota: VMware todavía no expone VLAN ID, por eso puede estar vacío."

        for note in notes:
            if not isinstance(note, dict):
                continue
            if note.get("note") == "cpu_usage_unavailable":
                summary += " Nota: no hay % de uso de CPU disponible; el ranking es por vCPU."
            if note.get("note") == "ram_usage_unavailable":
                summary += " Nota: no hay % de uso de RAM disponible; el ranking es por memoria asignada."
            if note.get("note") == "env_filter_empty":
                summary += " Nota: el filtro de ambiente no devolvió resultados; confirma el criterio de producción."
            if note.get("note") == "cluster_filter_empty":
                summary += " Nota: el filtro de cluster no devolvió resultados; confirma el nombre del cluster."

        snapshot_meta = self._snapshot_from_notes(notes)
        meta = {"tools_used": tools_used}
        if snapshot_meta:
            meta["snapshot"] = snapshot_meta
        return ProviderResult(
            answer_text=summary,
            entities=entities,
            actions=[],
            tools_used=tools_used,
            meta=meta,
        )

    def _run_hosts(self, filters, tools_used: List[Dict[str, object]], *, user, session) -> ProviderResult:
        notes: List[Dict[str, object]] = []
        try:
            hosts = list_hosts(filters, user=user, session=session, notes=notes)
            tools_used.append({
                "name": "list_hosts",
                "filters": filters.model_dump(),
                "result_count": len(hosts),
                "notes": notes,
            })
        except Exception as exc:
            tools_used.append({
                "name": "list_hosts",
                "filters": filters.model_dump(),
                "error": str(exc),
                "notes": notes,
            })
            return ProviderResult(
                answer_text=str(exc),
                entities=[],
                actions=[],
                tools_used=tools_used,
            )

        entities = [self._host_entity(host) for host in hosts]
        lines = [host.name for host in hosts[:5]]
        summary = f"Encontré {len(hosts)} hosts." if hosts else "No encontré hosts con esos filtros."
        if lines:
            summary += " Ejemplos: " + ", ".join(lines)

        return ProviderResult(
            answer_text=summary,
            entities=entities,
            actions=[],
            tools_used=tools_used,
        )

    def _run_notifications(self, filters, tools_used: List[Dict[str, object]], *, user, session) -> ProviderResult:
        notes: List[Dict[str, object]] = []
        try:
            notifications = list_notifications(filters, user=user, session=session, notes=notes)
            tools_used.append({
                "name": "list_notifications",
                "filters": filters.model_dump(),
                "result_count": len(notifications),
                "notes": notes,
            })
        except Exception as exc:
            tools_used.append({
                "name": "list_notifications",
                "filters": filters.model_dump(),
                "error": str(exc),
                "notes": notes,
            })
            return ProviderResult(
                answer_text="No se pudieron obtener notificaciones en este momento.",
                entities=[],
                actions=[],
                tools_used=tools_used,
            )

        entities = [self._notification_entity(item) for item in notifications]
        lines = [item.message for item in notifications[:5]]
        summary = (
            f"Encontré {len(notifications)} notificaciones." if notifications else "No hay notificaciones."
        )
        if lines:
            summary += " Ejemplos: " + "; ".join(lines)

        return ProviderResult(
            answer_text=summary,
            entities=entities,
            actions=[],
            tools_used=tools_used,
        )

    @staticmethod
    def _snapshot_from_notes(notes: List[Dict[str, object]]) -> Dict[str, object]:
        snapshot_meta: Dict[str, object] = {}
        for entry in notes:
            if not isinstance(entry, dict):
                continue
            provider = entry.get("provider")
            snapshot = entry.get("snapshot")
            if provider and isinstance(snapshot, dict):
                snapshot_meta[str(provider)] = snapshot
        return snapshot_meta

    @staticmethod
    def _vm_entity(vm: AIVm) -> Dict[str, object]:
        return {
            "type": "vm",
            "provider": vm.provider,
            "env": vm.env,
            "id": vm.id,
            "name": vm.name,
        }

    @staticmethod
    def _host_entity(host: AIHost) -> Dict[str, object]:
        return {
            "type": "host",
            "provider": host.provider,
            "env": host.env,
            "id": host.id,
            "name": host.name,
        }

    @staticmethod
    def _notification_entity(item: AINotification) -> Dict[str, object]:
        return {
            "type": "notification",
            "provider": item.provider,
            "env": item.env,
            "id": str(item.id),
            "name": item.message,
        }


def get_provider() -> LLMProvider:
    provider_name = (os.getenv("AI_PROVIDER") or "").strip().lower()
    if provider_name == "openai":
        config = build_openai_config()
        if config:
            return OpenAIProvider(config)
    return MockProvider()


class AiService:
    def __init__(self, provider: Optional[LLMProvider] = None) -> None:
        self._provider = provider or get_provider()

    def chat(self, message: str, ui_context: Optional[Dict[str, object]] = None, *, user, session) -> ProviderResult:
        return self._provider.run(message, ui_context, user=user, session=session)
