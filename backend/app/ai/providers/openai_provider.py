from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests import exceptions as requests_exceptions

from app.ai.schemas import (
    AiChatResponse,
    AINotification,
    AIHost,
    AIVm,
    HostFilters,
    NotificationFilters,
    VmFilters,
)
from app.ai.tools import (
    count_vms,
    get_host_detail,
    get_vm_detail,
    list_hosts,
    list_notifications,
    list_vms,
    top_vms,
)
from app.ai.types import ProviderResult

logger = logging.getLogger(__name__)


@dataclass
class OpenAIConfig:
    api_key: str
    model: str
    fallback_model: Optional[str]
    timeout_s: int
    max_tool_loops: int
    base_url: str


class OpenAIProvider:
    def __init__(self, config: OpenAIConfig) -> None:
        self._config = config
        self._client = None
        try:
            from openai import OpenAI  # type: ignore

            self._client = OpenAI(
                api_key=config.api_key,
                base_url=config.base_url,
                timeout=config.timeout_s,
            )
        except Exception:
            self._client = None

    def run(self, message: str, ui_context: Optional[Dict[str, object]] = None, *, user, session):
        try:
            return self._run_with_fallback_models(message, ui_context, user=user, session=session)
        except Exception as exc:
            logger.warning("OpenAIProvider failed: %s", exc)
            if isinstance(exc, ModelOutputError):
                return _parse_error_response(raw_text=exc.raw_text, tools_used=exc.tools_used, notes=exc.notes)
            return _fallback_response(
                text=str(exc),
                tools_used=[{"provider": "openai", "model": self._config.model, "error": str(exc)}],
            )

    def _run_with_fallback_models(
        self,
        message: str,
        ui_context: Optional[Dict[str, object]],
        *,
        user,
        session,
    ):
        current_model = self._config.model
        fallback_model = self._config.fallback_model
        preference = _model_preference(ui_context)
        if preference == "smart" and self._config.fallback_model:
            current_model = self._config.fallback_model
            fallback_model = self._config.model if self._config.model != current_model else None
        elif preference == "fast":
            current_model = self._config.model
            fallback_model = self._config.fallback_model
        fallback_used = False
        tools_used: List[Dict[str, object]] = [
            {"provider": "openai", "model": current_model, "fallback": False, "preference": preference or "fast"}
        ]
        notes: List[Dict[str, object]] = []

        tools_schema = _build_tools_schema()
        system_prompt = _system_prompt()
        input_items: List[Dict[str, object]] = [
            {"role": "system", "content": f"You must respond with valid JSON.\n{system_prompt}"},
            {"role": "user", "content": message},
        ]

        for loop_idx in range(self._config.max_tool_loops + 1):
            while True:
                payload = {
                    "model": current_model,
                    "input": input_items,
                    "tools": tools_schema,
                    "tool_choice": "auto",
                    "store": False,
                    "text": {"format": {"type": "json_object"}},
                }
                # store=false: do not re-send reasoning items to avoid rs_ id issues
                started = time.monotonic()
                try:
                    response = self._call_openai(payload)
                except Exception as exc:
                    elapsed_ms = int((time.monotonic() - started) * 1000)
                    logger.warning(
                        "OpenAI call failed model=%s loop_idx=%s elapsed_ms=%s error=%s",
                        current_model,
                        loop_idx,
                        elapsed_ms,
                        exc,
                    )
                    if _is_read_timeout(exc) and fallback_model and not fallback_used and current_model != fallback_model:
                        fallback_used = True
                        current_model = fallback_model
                        tools_used.append(
                            {"provider": "openai", "model": current_model, "fallback": True, "reason": "ReadTimeout"}
                        )
                        continue
                    raise
                else:
                    elapsed_ms = int((time.monotonic() - started) * 1000)
                    logger.info(
                        "OpenAI call model=%s loop_idx=%s elapsed_ms=%s",
                        current_model,
                        loop_idx,
                        elapsed_ms,
                    )
                break

            output_items = response.get("output") or []
            if isinstance(output_items, list) and output_items:
                input_items.extend(_sanitize_output_items(output_items))

            tool_calls = _extract_tool_calls(output_items)
            if tool_calls:
                for tool_call in tool_calls:
                    name = tool_call.get("name")
                    call_id = tool_call.get("call_id") or tool_call.get("id") or tool_call.get("tool_call_id") or "unknown"
                    raw_args = tool_call.get("arguments")
                    args = raw_args or {}
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    try:
                        result, meta = _dispatch_tool(name, args, user=user, session=session, notes=notes)
                        tools_used.append({
                            "name": name,
                            "arguments": args,
                            "result_count": meta.get("count"),
                            "notes": meta.get("notes"),
                            "snapshot": meta.get("snapshot"),
                        })
                        input_items.append({
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": json.dumps(result, ensure_ascii=False),
                        })
                    except Exception as exc:
                        tools_used.append({
                            "name": name,
                            "arguments": args,
                            "error": str(exc),
                        })
                        input_items.append({
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": json.dumps({"error": str(exc)}, ensure_ascii=False),
                        })
                continue

            output_text = _extract_output_text(response)
            parsed = _parse_model_json(output_text)
            if parsed is None:
                if fallback_model and not fallback_used and current_model != fallback_model:
                    fallback_used = True
                    current_model = fallback_model
                    tools_used.append(
                        {"provider": "openai", "model": current_model, "fallback": True, "reason": "ParseError"}
                    )
                    continue
                raise ModelOutputError(output_text, tools_used, notes)

            normalized = _normalize_model_payload(parsed, tools_used=tools_used)
            try:
                validated = _validate_response(normalized)
            except Exception:
                if fallback_model and not fallback_used and current_model != fallback_model:
                    fallback_used = True
                    current_model = fallback_model
                    tools_used.append(
                        {"provider": "openai", "model": current_model, "fallback": True, "reason": "ParseError"}
                    )
                    continue
                raise ModelOutputError(output_text, tools_used, notes)
            validated.meta = validated.meta or {}
            validated.meta.update({"tools_used": tools_used, "notes": notes})
            snapshot_meta = _collect_snapshot_meta(tools_used)
            if snapshot_meta:
                validated.meta["snapshot"] = snapshot_meta
            return _to_provider_result(validated, tools_used=tools_used)

        return _fallback_response(
            text="Se alcanzó el límite de llamadas a herramientas.",
            tools_used=tools_used + [{"loop_exceeded": True}],
            meta_override={"loop_exceeded": True},
            invalid_model_output=False,
        )

    def _call_openai(self, payload: Dict[str, object]) -> Dict[str, object]:
        _ensure_json_keyword(payload)
        has_json = _input_contains_json(payload.get("input"))
        logger.info("OpenAI input contains json=%s", has_json)
        if self._client is not None:
            try:
                response = self._client.responses.create(**payload)
                return _to_dict(response)
            except Exception as exc:
                status = getattr(exc, "status_code", None)
                body = getattr(exc, "response", None)
                if body is not None and hasattr(body, "json"):
                    try:
                        body = body.json()
                    except Exception:
                        body = getattr(body, "text", None) or str(body)
                logger.error(
                    "OpenAI Responses error status=%s body=%s payload=%s",
                    status,
                    body,
                    payload,
                )
                raise

        headers = {
            "Authorization": f"Bearer {self._config.api_key}",
            "Content-Type": "application/json",
        }
        resp = requests.post(
            f"{self._config.base_url}/responses",
            headers=headers,
            json=payload,
            timeout=self._config.timeout_s,
        )
        if resp.status_code >= 400:
            try:
                body = resp.json()
            except ValueError:
                body = resp.text
            logger.error(
                "OpenAI Responses error status=%s body=%s payload=%s",
                resp.status_code,
                body,
                payload,
            )
        resp.raise_for_status()
        return resp.json()


def _to_dict(response: Any) -> Dict[str, object]:
    if hasattr(response, "model_dump"):
        return response.model_dump()
    if hasattr(response, "dict"):
        return response.dict()
    if isinstance(response, dict):
        return response
    return json.loads(str(response))


def _system_prompt() -> str:
    return (
        "Eres un copiloto read-only de inventario y monitoreo.\n"
        "No inventes datos: usa tools para consultar.\n"
        "Para preguntas de conteo (\"cuántas\", \"how many\"), usa count_vms.\n"
        "Para preguntas de ranking (\"las que más\", \"top\"), usa top_vms.\n"
        "Si piden máximo/mínimo por host, usa count_vms con group_by=\"host\" y calcula max/min.\n"
        "Si el usuario pide 'uso de CPU' o '% de CPU', usa cpu_usage_pct (sort=cpu_usage_desc). "
        "Si no hay cpu_usage_pct disponible, dilo explícitamente y ofrece ranking por vCPU.\n"
        "Si los tools devuelven note=env_filter_empty, pide confirmación del criterio de producción "
        "(env exacto vs prefijo P- vs cluster_contains) y NO asumas.\n"
        "Si los tools devuelven note=cluster_filter_empty, pregunta por el cluster correcto y no inventes.\n"
        "Si un campo no existe (ej VLAN en VMware), dilo explícito.\n"
        "Respeta permisos y disponibilidad: si tools devuelven vacío, explica por qué.\n"
        "\n"
        "Output contract (STRICT):\n"
        "- Responde SIEMPRE con un unico objeto JSON valido.\n"
        "- Keys exactas: conversation_id, answer_text, entities, actions, meta.\n"
        "- actions es una lista de objetos {type, payload, label?}.\n"
        "\n"
        "Allowed actions (ONLY): NAVIGATE, OPEN_VM, OPEN_HOST, OPEN_HYPERV_VM, OPEN_HYPERV_HOST.\n"
        "Allowed routes (ONLY): /vmware, /hosts, /kvm?view=vms|hosts, /hyperv?view=vms|hosts, /cedia, /azure, /ai.\n"
        "Never invent routes (e.g. /vms, /notifications). If you are not 100% sure about a route/path, DO NOT produce an action.\n"
        "\n"
        "NAVIGATE payload MUST be {\"path\": <string>, \"query\": <object optional>}.\n"
        "- Use path only from the allowed routes list.\n"
        "- Do NOT put query parameters inside path. Use query object instead.\n"
        "- Examples:\n"
        "  {\"type\":\"NAVIGATE\",\"payload\":{\"path\":\"/vmware\"}}\n"
        "  {\"type\":\"NAVIGATE\",\"payload\":{\"path\":\"/kvm\",\"query\":{\"view\":\"vms\"}}}\n"
        "  {\"type\":\"NAVIGATE\",\"payload\":{\"path\":\"/hyperv\",\"query\":{\"view\":\"hosts\"}}}\n"
        "\n"
        "Action rules:\n"
        "- Only create OPEN_VM/OPEN_HOST actions when you have concrete entities from tools.\n"
        "- For Hyper-V VM: use OPEN_HYPERV_VM payload { vm: <name>, host: <HVHost> }.\n"
        "- For Hyper-V Host: use OPEN_HYPERV_HOST payload { host: <HVHost|name> }.\n"
        "- For other providers, use OPEN_VM or OPEN_HOST with payload including provider/id/name/host when available.\n"
        "- If the user asks to navigate to a section without an allowed route, explain in answer_text and do NOT include actions.\n"
    )


def _build_tools_schema() -> List[Dict[str, object]]:
    return [
        {
            "type": "function",
            "name": "list_vms",
            "description": "Listar VMs según filtros canónicos.",
            "parameters": {
                "type": "object",
                "properties": {"filters": VmFilters.model_json_schema()},
                "required": ["filters"],
            },
        },
        {
            "type": "function",
            "name": "count_vms",
            "description": "Contar VMs agrupadas por campos (provider/env/power_state/host/cluster).",
            "parameters": {
                "type": "object",
                "properties": {
                    "filters": VmFilters.model_json_schema(),
                    "group_by": {
                        "type": ["string", "array", "null"],
                        "items": {"type": "string"},
                        "description": "Campos de agrupación: provider, env, power_state, host, cluster.",
                    },
                },
                "required": ["filters"],
            },
        },
        {
            "type": "function",
            "name": "top_vms",
            "description": "Obtener top N VMs según ordenamiento (ram_desc/cpu_desc/cpu_usage_desc/ram_usage_desc/name_asc/name_desc).",
            "parameters": {
                "type": "object",
                "properties": {
                    "filters": VmFilters.model_json_schema(),
                    "sort": {"type": ["string", "null"]},
                    "limit": {"type": ["integer", "null"]},
                },
                "required": ["filters"],
            },
        },
        {
            "type": "function",
            "name": "get_vm_detail",
            "description": "Obtener detalle de VM por provider/id/selector.",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "env": {"type": "string"},
                    "id": {"type": ["string", "null"]},
                    "selector": {"type": ["object", "null"]},
                },
                "required": ["provider", "env"],
            },
        },
        {
            "type": "function",
            "name": "list_hosts",
            "description": "Listar hosts según filtros canónicos.",
            "parameters": {
                "type": "object",
                "properties": {"filters": HostFilters.model_json_schema()},
                "required": ["filters"],
            },
        },
        {
            "type": "function",
            "name": "get_host_detail",
            "description": "Obtener detalle de host por provider/id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "env": {"type": "string"},
                    "id": {"type": "string"},
                },
                "required": ["provider", "env", "id"],
            },
        },
        {
            "type": "function",
            "name": "list_notifications",
            "description": "Listar notificaciones según filtros canónicos.",
            "parameters": {
                "type": "object",
                "properties": {"filters": NotificationFilters.model_json_schema()},
                "required": ["filters"],
            },
        },
    ]


def _extract_tool_calls(output_items: object) -> List[Dict[str, object]]:
    tool_calls: List[Dict[str, object]] = []
    if isinstance(output_items, list):
        for item in output_items:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "function_call":
                tool_calls.append(item)
    return tool_calls


def _extract_output_text(response: Dict[str, object]) -> str:
    output_text = response.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    text_parts: List[str] = []
    output = response.get("output") or []
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "message":
                continue
            content = item.get("content") or []
            if isinstance(content, list):
                for chunk in content:
                    if not isinstance(chunk, dict):
                        continue
                    if chunk.get("type") in {"output_text", "text"}:
                        text = chunk.get("text") or chunk.get("value")
                        if text:
                            text_parts.append(str(text))
    return "\n".join(text_parts).strip()


def _sanitize_output_items(output_items: List[Dict[str, object]]) -> List[Dict[str, object]]:
    cleaned: List[Dict[str, object]] = []
    for item in output_items:
        if not isinstance(item, dict):
            continue
        item = dict(item)
        item.pop("id", None)
        item.pop("status", None)
        item_type = item.get("type")
        if item_type == "reasoning":
            continue
            continue
        if item_type == "function_call":
            call_id = item.get("call_id") or item.get("id") or item.get("tool_call_id")
            name = item.get("name")
            arguments = item.get("arguments")
            cleaned.append(
                {
                    "type": "function_call",
                    "call_id": call_id,
                    "name": name,
                    "arguments": arguments,
                }
            )
            continue
        cleaned.append(item)
    return cleaned


def _dispatch_tool(
    name: str,
    args: Dict[str, object],
    *,
    user,
    session,
    notes: List[Dict[str, object]],
) -> Tuple[Dict[str, object], Dict[str, object]]:
    if not isinstance(args, dict):
        args = {}
    meta: Dict[str, object] = {"notes": []}
    if name == "list_vms":
        filters = VmFilters(**_ensure_dict(args.get("filters")))
        items = list_vms(filters, user=user, session=session, notes=meta["notes"])
        if meta["notes"]:
            notes.extend(meta["notes"])
        snapshot_meta = {}
        for entry in meta["notes"]:
            if not isinstance(entry, dict):
                continue
            provider = entry.get("provider")
            snapshot = entry.get("snapshot")
            if provider and isinstance(snapshot, dict):
                snapshot_meta[str(provider)] = snapshot
        if snapshot_meta:
            meta["snapshot"] = snapshot_meta
        compact = [_compact_vm(item) for item in items[:20]]
        meta["count"] = len(items)
        return {"items": compact, "count_total": len(items), "notes": meta.get("notes")}, meta

    if name == "count_vms":
        filters = VmFilters(**_ensure_dict(args.get("filters")))
        group_by = args.get("group_by")
        result = count_vms(filters, group_by, user=user, session=session, notes=meta["notes"])
        if meta["notes"]:
            notes.extend(meta["notes"])
        snapshot_meta = {}
        for entry in meta["notes"]:
            if not isinstance(entry, dict):
                continue
            provider = entry.get("provider")
            snapshot = entry.get("snapshot")
            if provider and isinstance(snapshot, dict):
                snapshot_meta[str(provider)] = snapshot
        if snapshot_meta:
            meta["snapshot"] = snapshot_meta
        meta["count"] = result.get("count_total")
        result_out = dict(result)
        result_out["notes"] = meta.get("notes")
        return result_out, meta

    if name == "top_vms":
        filters = VmFilters(**_ensure_dict(args.get("filters")))
        sort = args.get("sort")
        limit = args.get("limit")
        items = top_vms(filters, sort, limit, user=user, session=session, notes=meta["notes"])
        if meta["notes"]:
            notes.extend(meta["notes"])
        snapshot_meta = {}
        for entry in meta["notes"]:
            if not isinstance(entry, dict):
                continue
            provider = entry.get("provider")
            snapshot = entry.get("snapshot")
            if provider and isinstance(snapshot, dict):
                snapshot_meta[str(provider)] = snapshot
        if snapshot_meta:
            meta["snapshot"] = snapshot_meta
        compact = [_compact_vm(item) for item in items[:20]]
        meta["count"] = len(items)
        return {"items": compact, "count_total": len(items), "notes": meta.get("notes")}, meta

    if name == "get_vm_detail":
        provider = args.get("provider")
        env = args.get("env")
        vm_id = args.get("id")
        selector = _ensure_dict(args.get("selector")) if args.get("selector") is not None else None

        item = get_vm_detail(provider, env, vm_id, selector, user=user, session=session)
        return {"item": _compact_vm(item)}, meta

    if name == "list_hosts":
        filters = HostFilters(**_ensure_dict(args.get("filters")))
        items = list_hosts(filters, user=user, session=session, notes=meta["notes"])
        if meta["notes"]:
            notes.extend(meta["notes"])
        compact = [_compact_host(item) for item in items[:20]]
        meta["count"] = len(items)
        return {"items": compact, "count_total": len(items)}, meta

    if name == "get_host_detail":
        provider = args.get("provider")
        env = args.get("env")
        host_id = args.get("id")

        item = get_host_detail(provider, env, host_id, user=user, session=session)
        return {"item": _compact_host(item)}, meta

    if name == "list_notifications":
        filters = NotificationFilters(**_ensure_dict(args.get("filters")))
        items = list_notifications(filters, user=user, session=session, notes=meta["notes"])
        if meta["notes"]:
            notes.extend(meta["notes"])
        compact = [_compact_notification(item) for item in items[:20]]
        meta["count"] = len(items)
        return {"items": compact, "count_total": len(items)}, meta

    raise ValueError(f"Tool not supported: {name}")


def _collect_snapshot_meta(tools_used: List[Dict[str, object]]) -> Dict[str, object]:
    snapshot_meta: Dict[str, object] = {}
    for entry in tools_used:
        if not isinstance(entry, dict):
            continue
        snapshot = entry.get("snapshot")
        if not isinstance(snapshot, dict):
            continue
        for provider, meta in snapshot.items():
            if provider and isinstance(meta, dict):
                snapshot_meta[str(provider)] = meta
    return snapshot_meta


def _compact_vm(vm: AIVm) -> Dict[str, object]:
    payload = {
        "id": vm.id,
        "name": vm.name,
        "provider": vm.provider,
        "env": vm.env,
        "power_state": vm.power_state,
        "cpu_count": vm.cpu_count,
        "cpu_usage_pct": vm.cpu_usage_pct,
        "memory_size_MiB": vm.memory_size_MiB,
        "ram_usage_pct": vm.ram_usage_pct,
        "ram_demand_mib": vm.ram_demand_mib,
        "host": vm.host,
        "cluster": vm.cluster,
        "vlans": vm.vlans,
        "ip_addresses": vm.ip_addresses,
    }
    if vm.raw_refs:
        payload["raw_refs"] = vm.raw_refs
    return payload


def _compact_host(host: AIHost) -> Dict[str, object]:
    return {
        "id": host.id,
        "name": host.name,
        "provider": host.provider,
        "env": host.env,
        "state": host.state,
    }


def _compact_notification(item: AINotification) -> Dict[str, object]:
    return {
        "id": item.id,
        "provider": item.provider,
        "env": item.env,
        "severity": item.severity,
        "status": item.status,
        "metric": item.metric,
        "resource_type": item.resource_type,
        "resource_id": item.resource_id,
        "message": item.message,
        "timestamp": item.timestamp.isoformat() if item.timestamp else None,
    }


def _parse_model_json(text: str) -> Optional[Dict[str, object]]:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def _validate_response(payload: Dict[str, object]) -> AiChatResponse:
    if "conversation_id" not in payload:
        payload["conversation_id"] = ""
    return AiChatResponse.model_validate(payload)


def _normalize_model_payload(
    payload: Dict[str, object],
    *,
    tools_used: List[Dict[str, object]],
) -> Dict[str, object]:
    normalized: Dict[str, object] = dict(payload)

    answer_text = normalized.get("answer_text")
    if not isinstance(answer_text, str) or not answer_text.strip():
        for alt in ("answer", "response", "text", "message"):
            alt_val = normalized.get(alt)
            if isinstance(alt_val, str) and alt_val.strip():
                normalized["answer_text"] = alt_val.strip()
                break

    entities = normalized.get("entities")
    if entities is None:
        normalized["entities"] = []
    elif isinstance(entities, dict):
        normalized["entities"] = [entities]
    elif isinstance(entities, list):
        normalized["entities"] = [item for item in entities if isinstance(item, dict)]
    else:
        normalized["entities"] = []

    actions = normalized.get("actions")
    if actions is None:
        normalized["actions"] = []
    elif isinstance(actions, dict):
        normalized["actions"] = [actions]
    elif isinstance(actions, list):
        normalized["actions"] = [item for item in actions if isinstance(item, dict)]
    else:
        normalized["actions"] = []

    meta = normalized.get("meta")
    if not isinstance(meta, dict):
        meta = {}
    tool_used = meta.pop("tool_used", None)
    if "tools_used" not in meta:
        if isinstance(tool_used, list):
            meta["tools_used"] = tool_used
        elif isinstance(tool_used, dict):
            meta["tools_used"] = [tool_used]
        else:
            meta["tools_used"] = tools_used
    elif not isinstance(meta.get("tools_used"), list):
        meta["tools_used"] = tools_used
    normalized["meta"] = meta

    if "conversation_id" not in normalized:
        normalized["conversation_id"] = ""

    return normalized


def _fallback_response(
    text: str,
    tools_used: List[Dict[str, object]],
    meta_override: Optional[Dict[str, object]] = None,
    invalid_model_output: bool = True,
) -> ProviderResult:
    meta: Dict[str, object] = {"tools_used": tools_used, "invalid_model_output": invalid_model_output}
    if meta_override:
        meta.update(meta_override)
    return ProviderResult(
        answer_text=text or "No se pudo generar respuesta.",
        entities=[],
        actions=[],
        tools_used=tools_used,
        meta=meta,
    )


def _parse_error_response(
    raw_text: str,
    tools_used: List[Dict[str, object]],
    notes: Optional[List[Dict[str, object]]] = None,
) -> ProviderResult:
    meta: Dict[str, object] = {
        "tools_used": tools_used,
        "parse_error": True,
    }
    if notes:
        meta["notes"] = notes
    return ProviderResult(
        answer_text=raw_text or "No se pudo parsear el JSON de la respuesta.",
        entities=[],
        actions=[],
        tools_used=tools_used,
        meta=meta,
    )


def _to_provider_result(response: AiChatResponse, *, tools_used: List[Dict[str, object]]) -> ProviderResult:
    meta = response.meta or {}
    if "tools_used" not in meta:
        meta["tools_used"] = tools_used
    return ProviderResult(
        answer_text=response.answer_text,
        entities=response.entities,
        actions=response.actions,
        tools_used=meta.get("tools_used") or tools_used,
        meta=meta,
    )


def _ensure_dict(value: object) -> Dict[str, object]:
    if isinstance(value, dict):
        return value
    return {}


def _ensure_json_keyword(payload: Dict[str, object]) -> None:
    text = payload.get("text")
    if not isinstance(text, dict):
        return
    fmt = text.get("format")
    if not isinstance(fmt, dict) or fmt.get("type") != "json_object":
        return
    input_items = payload.get("input")
    if not isinstance(input_items, list):
        return
    if _input_contains_json(input_items):
        return
    input_items.insert(
        0,
        {"role": "system", "content": "You must respond with valid json (lowercase 'json')."},
    )


def _model_preference(ui_context: Optional[Dict[str, object]]) -> Optional[str]:
    if not isinstance(ui_context, dict):
        return None
    pref = ui_context.get("model_preference")
    if not pref:
        return None
    pref = str(pref).strip().lower()
    if pref in {"fast", "smart"}:
        return pref
    return None


def _input_contains_json(input_items: object) -> bool:
    if not isinstance(input_items, list):
        return False
    for item in input_items:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if isinstance(content, str) and ("json" in content.lower()):
            return True
    return False


class ModelOutputError(ValueError):
    def __init__(self, raw_text: str, tools_used: List[Dict[str, object]], notes: List[Dict[str, object]]):
        super().__init__("Invalid model JSON output")
        self.raw_text = raw_text
        self.tools_used = tools_used
        self.notes = notes


def _is_read_timeout(exc: Exception) -> bool:
    if isinstance(exc, requests_exceptions.ReadTimeout):
        return True
    if isinstance(exc, requests_exceptions.Timeout) and exc.__class__.__name__ == "ReadTimeout":
        return True
    try:
        import httpx  # type: ignore

        if isinstance(exc, httpx.ReadTimeout):
            return True
    except Exception:
        pass
    return exc.__class__.__name__ == "ReadTimeout"


def build_openai_config() -> Optional[OpenAIConfig]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
    fallback = os.getenv("OPENAI_FALLBACK_MODEL") or os.getenv("OPENAI_MODEL2")
    timeout_s = int(os.getenv("OPENAI_TIMEOUT_S", "45"))
    max_loops = int(os.getenv("OPENAI_MAX_TOOL_LOOPS", "6"))
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    return OpenAIConfig(
        api_key=api_key,
        model=model,
        fallback_model=fallback,
        timeout_s=timeout_s,
        max_tool_loops=max_loops,
        base_url=base_url,
    )
