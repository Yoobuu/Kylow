import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listAudit } from "../api/audit";

const LIMIT_OPTIONS = [10, 25, 50];

const normalizeMeta = (meta) => {
  if (!meta) return null;
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta);
    } catch {
      return meta;
    }
  }
  return meta;
};

const formatValue = (value) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const summarizeChanges = (changes) => {
  if (!changes || typeof changes !== "object") return null;
  const entries = Object.entries(changes);
  if (!entries.length) return null;
  const parts = entries.slice(0, 3).map(([key, value]) => {
    if (!value || typeof value !== "object") return `${key}`;
    return `${key}: ${formatValue(value.from)} → ${formatValue(value.to)}`;
  });
  const extra = entries.length > 3 ? ` +${entries.length - 3} más` : "";
  return `${parts.join(" · ")}${extra}`;
};

const toTitle = (value) => {
  if (!value) return "—";
  if (value === "system") return "Sistema";
  if (value === "notification") return "Notificación";
  if (value === "user") return "Usuario";
  if (value === "vm") return "VM";
  if (value === "hosts") return "Hosts";
  return value;
};

const summarizeAudit = (item) => {
  const action = item?.action || "";
  const meta = normalizeMeta(item?.meta);
  if (!meta || typeof meta !== "object") return null;

  if (action === "notifications.reconcile") {
    const created = meta.created ?? 0;
    const cleared = meta.cleared ?? 0;
    const updated = meta.updated ?? 0;
    const preserved = meta.preserved ?? 0;
    if (!created && !cleared && !updated && !preserved) {
      return "Reconciliación sin cambios.";
    }
    return `Reconciliación: creadas ${created}, resueltas ${cleared}, actualizadas ${updated}, preservadas ${preserved}.`;
  }

  if (action === "system.settings.update") {
    const changesSummary = summarizeChanges(meta.changes);
    return changesSummary ? `Cambios: ${changesSummary}` : "Actualización de settings.";
  }

  if (action === "notification.ack") {
    const provider = meta.provider || "—";
    const vmName = meta.vm_name || "—";
    const metric = meta.metric || "—";
    const value = meta.value_pct !== undefined ? `${formatValue(meta.value_pct)}%` : "—";
    return `ACK ${provider} · ${vmName} · ${metric} · ${value}`;
  }

  if (/^NOTIFICATION_(CREATED|UPDATED|CLEARED)$/i.test(action)) {
    const provider = meta.provider || "—";
    const vmName = meta.vm_name || "—";
    const metric = meta.metric || "—";
    const value = meta.value_pct !== undefined ? `${formatValue(meta.value_pct)}%` : "—";
    return `${action} · ${provider} · ${vmName} · ${metric} · ${value}`;
  }

  if (action === "vms.power_action") {
    return `Power VM: ${formatValue(meta.action)}`;
  }

  if (action === "auth.change_password") {
    return `Cambio de contraseña (${formatValue(meta.mode)})`;
  }

  if (action.startsWith("users.")) {
    const username = meta.username || "—";
    return `Usuario: ${username}`;
  }

  const changesSummary = summarizeChanges(meta.changes);
  if (changesSummary) return `Cambios: ${changesSummary}`;
  return null;
};

const buildPreview = (item) => {
  if (!item) return "—";
  const summary = summarizeAudit(item);
  if (summary) return summary.length > 140 ? `${summary.slice(0, 140)}…` : summary;
  const meta = normalizeMeta(item.meta);
  if (!meta) return "—";
  try {
    const raw = typeof meta === "string" ? meta : JSON.stringify(meta);
    if (!raw) return "—";
    return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
  } catch {
    return "—";
  }
};

const formatMetaJson = (meta) => {
  if (!meta) return "—";
  const normalized = normalizeMeta(meta);
  try {
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(normalized);
  }
};

const isImportantAction = (value) => {
  if (!value) return false;
  return /system\.settings\.update|system\.restart|users\.|vms\.power_action/i.test(value);
};

function AuditDetailDrawer({ item, onClose }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [item]);

  useEffect(() => {
    if (!item) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [item, onClose]);

  if (!item) return null;

  const metaText = formatMetaJson(item.meta);
  const summary = summarizeAudit(item);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(metaText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const targetLabel = item.target_type || "—";
  const targetValue = item.target_id ? `· ${item.target_id}` : "";
  const actorLabel = item.actor_username || "—";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] text-[#231F20] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E1D6C8] px-6 py-5">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Detalle de auditoría</p>
            <h2 className="text-xl font-semibold text-[#E11B22]">{item.action}</h2>
            <p className="text-sm text-[#3b3b3b]">{item.when}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#D6C7B8] px-3 py-1 text-sm text-[#231F20] transition hover:border-[#E11B22] hover:text-[#E11B22]"
          >
            Cerrar
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Actor</p>
              <p className="text-sm text-[#231F20]">{toTitle(actorLabel)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Target</p>
              <p className="text-sm text-[#231F20]">
                {toTitle(targetLabel)} {targetValue}
              </p>
            </div>
            {item.ip ? (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">IP</p>
                <p className="text-sm text-[#231F20]">{item.ip}</p>
              </div>
            ) : null}
            {item.user_agent ? (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">User Agent</p>
                <p className="text-sm text-[#231F20]">{item.user_agent}</p>
              </div>
            ) : null}
            {item.correlation_id ? (
              <div className="space-y-1 md:col-span-2">
                <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Correlation ID</p>
                <p className="text-sm text-[#231F20]">{item.correlation_id}</p>
              </div>
            ) : null}
            <div className="space-y-1 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Resumen</p>
              <p className="text-sm text-[#231F20]">{summary || "—"}</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-[#E1D6C8] bg-white">
            <div className="flex items-center justify-between border-b border-[#E1D6C8] px-4 py-3">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-full bg-[#E11B22] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#c9161c]"
              >
                {copied ? "Copiado" : "Copiar JSON"}
              </button>
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words px-4 py-4 text-xs text-[#231F20] md:text-sm">
              {metaText}
            </pre>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function AuditPage() {
  const [items, setItems] = useState([]);
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [actorUsername, setActorUsername] = useState("");
  const [targetType, setTargetType] = useState("");
  const [draftAction, setDraftAction] = useState("");
  const [draftActorUsername, setDraftActorUsername] = useState("");
  const [draftTargetType, setDraftTargetType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    listAudit({
      limit,
      offset,
      action: action.trim() || undefined,
      actor_username: actorUsername.trim() || undefined,
      target_type: targetType.trim() || undefined,
    })
      .then((response) => {
        if (cancelled) return;
        const data = response?.data;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setTotal(typeof data?.total === "number" ? data.total : 0);
      })
      .catch((err) => {
        if (cancelled) return;
        const detail = err?.response?.data?.detail || err?.message || "No se pudo cargar la auditoría.";
        setError(detail);
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [limit, offset, action, actorUsername, targetType]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setAction(draftAction.trim());
    setActorUsername(draftActorUsername.trim());
    setTargetType(draftTargetType.trim());
    setOffset(0);
  };

  const canGoBack = useMemo(() => offset > 0, [offset]);
  const canGoForward = useMemo(() => {
    if (!total) return items.length === limit;
    return offset + items.length < total;
  }, [items.length, limit, offset, total]);

  const activeFilters = useMemo(() => {
    const entries = [];
    if (action) entries.push(`action:${action}`);
    if (actorUsername) entries.push(`actor:${actorUsername}`);
    if (targetType) entries.push(`target:${targetType}`);
    return entries;
  }, [action, actorUsername, targetType]);

  const formatDate = (value) => {
    try {
      return value ? new Date(value).toLocaleString() : "";
    } catch {
      return value || "";
    }
  };

  const openDetail = useCallback((item) => {
    setSelectedItem(item);
  }, []);

  const closeDetail = useCallback(() => setSelectedItem(null), []);

  const handleClearFilters = () => {
    setDraftAction("");
    setDraftActorUsername("");
    setDraftTargetType("");
    setAction("");
    setActorUsername("");
    setTargetType("");
    setOffset(0);
  };

  return (
    <main className="min-h-screen w-full bg-white px-4 py-8 text-[#231F20] md:px-8">
      <div className="space-y-6">
        <header className="flex flex-col gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-[#E11B22]">Auditoría</h1>
            <p className="text-sm text-[#3b3b3b]">Eventos recientes de operaciones sensibles.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#6b6b6b]">
            <span className="rounded-full border border-[#D6C7B8] bg-[#FAF3E9] px-3 py-1">
              Mostrando {items.length} de {total || "—"}
            </span>
            {activeFilters.length ? (
              activeFilters.map((chip) => (
                <span key={chip} className="rounded-full border border-[#D6C7B8] bg-[#FAF3E9] px-3 py-1 text-[#231F20]">
                  {chip}
                </span>
              ))
            ) : (
              <span className="text-[#6b6b6b]">Sin filtros activos</span>
            )}
          </div>
        </header>

        <section
          className="rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4"
          data-tutorial-id="audit-filters"
        >
          <form onSubmit={handleSearchSubmit} className="grid gap-4 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Action</label>
              <input
                value={draftAction}
                onChange={(event) => setDraftAction(event.target.value)}
                placeholder="system.settings.update"
                className="mt-2 w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] placeholder:text-[#939598] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Actor</label>
              <input
                value={draftActorUsername}
                onChange={(event) => setDraftActorUsername(event.target.value)}
                placeholder="admin"
                className="mt-2 w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] placeholder:text-[#939598] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Target type</label>
              <input
                value={draftTargetType}
                onChange={(event) => setDraftTargetType(event.target.value)}
                placeholder="system"
                className="mt-2 w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] placeholder:text-[#939598] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Página</label>
              <select
                value={limit}
                onChange={(event) => {
                  setLimit(Number(event.target.value));
                  setOffset(0);
                }}
                className="mt-2 w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option} por página
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2 md:col-span-5 md:justify-end">
              <button
                type="button"
                onClick={handleClearFilters}
                className="rounded-full border border-[#D6C7B8] bg-white px-4 py-2 text-sm text-[#E11B22] transition hover:bg-[#FAF3E9]"
              >
                Limpiar
              </button>
              <button
                type="submit"
                className="rounded-full bg-[#E11B22] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#c9161c]"
              >
                Aplicar
              </button>
            </div>
          </form>
        </section>

        <section
          className="rounded-2xl border border-[#E1D6C8] bg-white"
          data-tutorial-id="audit-table"
        >
          {loading ? (
            <div className="p-6 text-sm text-[#6b6b6b]">Cargando…</div>
          ) : error ? (
            <div className="p-6 text-sm text-[#E11B22]">{error}</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-[#6b6b6b]">Sin resultados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#FAF3E9]">
                  <tr className="text-left text-xs uppercase tracking-[0.2em] text-[#E11B22]">
                    <th className="px-4 py-3 whitespace-nowrap">Fecha y hora</th>
                    <th className="px-4 py-3 whitespace-nowrap">Acción</th>
                    <th className="px-4 py-3 whitespace-nowrap">Actor</th>
                    <th className="px-4 py-3 whitespace-nowrap">Target type</th>
                    <th className="px-4 py-3 whitespace-nowrap">Target id</th>
                    <th className="px-4 py-3">Detalle</th>
                    <th className="px-4 py-3 whitespace-nowrap">Correlation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1D6C8]">
                  {items.map((item, index) => {
                    const metaPreview = buildPreview(item);
                    const highlight = isImportantAction(item.action);
                    return (
                      <tr
                        key={item.id}
                        onClick={() => openDetail(item)}
                        className={`cursor-pointer transition hover:bg-[#FAF3E9] ${index % 2 === 0 ? "bg-white" : "bg-[#FAF3E9]"}`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-[#231F20]">
                          {formatDate(item.when)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                              highlight
                                ? "border-[#F5B5B5] bg-[#FDE2E2] text-[#8B0000]"
                                : "border-[#D6C7B8] bg-[#FAF3E9] text-[#231F20]"
                            }`}
                          >
                            {item.action}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full border border-[#D6C7B8] bg-[#FAF3E9] px-3 py-1 text-xs text-[#231F20]">
                            {item.actor_username || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#3b3b3b]">{item.target_type || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#3b3b3b]">
                          {item.target_id || "—"}
                        </td>
                        <td className="px-4 py-3 text-[#3b3b3b]">
                          <div className="flex min-w-0 items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-xs text-[#6b6b6b]">
                      {metaPreview}
                    </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDetail(item);
                              }}
                              className="shrink-0 rounded-full border border-[#D6C7B8] px-3 py-1 text-xs text-[#E11B22] transition hover:border-[#E11B22]"
                            >
                              Ver
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#6b6b6b]">
                          {item.correlation_id || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#6b6b6b]">
          <button
            type="button"
            onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
            disabled={!canGoBack}
            className="rounded-full border border-[#D6C7B8] bg-white px-4 py-2 text-sm text-[#E11B22] transition hover:bg-[#FAF3E9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior
          </button>
          <span>
            Offset {offset} · Mostrando {items.length} de {total || "—"}
          </span>
          <button
            type="button"
            onClick={() => setOffset((prev) => prev + limit)}
            disabled={!canGoForward}
            className="rounded-full border border-[#D6C7B8] bg-white px-4 py-2 text-sm text-[#E11B22] transition hover:bg-[#FAF3E9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente
          </button>
        </footer>
      </div>
      <AuditDetailDrawer item={selectedItem} onClose={closeDetail} />
    </main>
  );
}
