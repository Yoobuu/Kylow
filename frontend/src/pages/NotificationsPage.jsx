import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { ackNotification, listNotifications, NOTIFICATION_STATUS } from "../api/notifications";
import { useAuth } from "../context/AuthContext";
import NotificationsTable from "../components/NotificationsTable";
import DisksModal from "../components/DisksModal";

const PROVIDER_OPTIONS = ["", "CEDIA", "HYPERV", "OVIRT", "VMWARE"];
const METRIC_OPTIONS = ["", "CPU", "RAM", "DISK"];
const LIMIT_OPTIONS = [10, 25, 50];

const createInitialFilters = () => ({
  statuses: [NOTIFICATION_STATUS.OPEN],
  provider: "",
  metric: "",
  vm: "",
  env: "",
  from: "",
  to: "",
  limit: 25,
  offset: 0,
});

const STATUS_META = {
  [NOTIFICATION_STATUS.OPEN]: {
    value: NOTIFICATION_STATUS.OPEN,
    label: "Alerta activa",
    icon: "🟡",
    badgeClass: "border-amber-300 bg-amber-100 text-amber-800",
    tooltip: "Generada automáticamente y pendiente de revisión.",
  },
  [NOTIFICATION_STATUS.ACK]: {
    value: NOTIFICATION_STATUS.ACK,
    label: "En revisión",
    icon: "🔵",
    badgeClass: "border-sky-300 bg-sky-100 text-sky-800",
    tooltip: "Alguien del equipo está trabajando en esta alerta.",
  },
  [NOTIFICATION_STATUS.CLEARED]: {
    value: NOTIFICATION_STATUS.CLEARED,
    label: "Resuelta",
    icon: "🟢",
    badgeClass: "border-emerald-300 bg-emerald-100 text-emerald-800",
    tooltip: "El backend marcó la alerta como resuelta.",
  },
  DEFAULT: {
    value: "UNKNOWN",
    label: "Estado desconocido",
    icon: "⚪",
    badgeClass: "border-gray-300 bg-gray-100 text-gray-700",
    tooltip: "El estado recibido no está reconocido por la interfaz.",
  },
};

const STATUS_ORDER = [
  NOTIFICATION_STATUS.OPEN,
  NOTIFICATION_STATUS.ACK,
  NOTIFICATION_STATUS.CLEARED,
];

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toFixed(2);
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("es-ES");
  } catch {
    return value;
  }
}

function formatDateUTC(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[60] flex w-80 flex-col gap-3" aria-live="assertive">
      {toasts.map((toast) => {
        const isError = toast.type === "error";
        const isSuccess = toast.type === "success";
        const toneClass = isError
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : isSuccess
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-white text-slate-800";
        const icon = isError ? "⚠️" : isSuccess ? "✅" : "ℹ️";
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${toneClass}`}
            role={isError ? "alert" : "status"}
          >
            <span aria-hidden="true" className="text-lg">
              {icon}
            </span>
            <div className="flex-1">{toast.message}</div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-lg font-semibold text-slate-500 transition hover:text-slate-900"
              aria-label="Cerrar notificación"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export default function NotificationsPage() {
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState(() => createInitialFilters());

  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [disksModal, setDisksModal] = useState({ isOpen: false, vmName: "", disks: [], threshold: null });

  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef(new Map());

  const showToast = useCallback((message, type = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    const timeout = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      toastTimers.current.delete(id);
    }, type === "error" ? 5000 : 3500);
    toastTimers.current.set(id, timeout);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    const timeout = toastTimers.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      toastTimers.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useEffect(
    () => () => {
      toastTimers.current.forEach((timeout) => clearTimeout(timeout));
      toastTimers.current.clear();
    },
    [],
  );

  useEffect(() => {
    const params = Object.fromEntries(searchParams.entries());
    setFilters((prev) => ({
      statuses: params.status
        ? params.status
            .split(",")
            .map((value) => value.toUpperCase())
            .filter(Boolean)
        : [NOTIFICATION_STATUS.OPEN],
      provider: params.provider ?? "",
      metric: params.metric ?? "",
      vm: params.vm ?? "",
      env: params.env ?? "",
      from: params.from ? params.from.slice(0, 16) : "",
      to: params.to ? params.to.slice(0, 16) : "",
      limit: params.limit ? Number(params.limit) : prev.limit,
      offset: params.offset ? Number(params.offset) : 0,
    }));
  }, [searchParams]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    const params = {
      limit: filters.limit,
      offset: filters.offset,
    };
    if (filters.statuses.length) {
      params.status = filters.statuses.join(",");
    }
    if (filters.provider) params.provider = filters.provider;
    if (filters.metric) params.metric = filters.metric;
    if (filters.vm.trim()) params.vm = filters.vm.trim();
    if (filters.env.trim()) params.env = filters.env.trim();
    if (filters.from) params.from = new Date(filters.from).toISOString();
    if (filters.to) params.to = new Date(filters.to).toISOString();

    try {
      const response = await listNotifications(params);
      const payload = response.data || {};
      setData({
        items: Array.isArray(payload.items) ? payload.items : [],
        total: typeof payload.total === "number" ? payload.total : 0,
      });
    } catch (err) {
      const detail =
        err?.response?.data?.detail ||
        err?.response?.statusText ||
        err?.message ||
        "No se pudieron cargar las notificaciones.";
      setFetchError(detail);
      setData({ items: [], total: 0 });
      showToast(detail, "error");
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  const canViewNotifications = hasPermission("notifications.view");
  const canAckNotification = hasPermission("notifications.ack");

  useEffect(() => {
    if (!canViewNotifications) return;
    fetchData();
  }, [fetchData, canViewNotifications]);

  const syncSearchParams = useCallback(
    (nextFilters) => {
      const params = {};
      if (nextFilters.statuses?.length) params.status = nextFilters.statuses.join(",");
      if (nextFilters.provider) params.provider = nextFilters.provider;
      if (nextFilters.metric) params.metric = nextFilters.metric;
      if (nextFilters.vm.trim()) params.vm = nextFilters.vm.trim();
      if (nextFilters.env.trim()) params.env = nextFilters.env.trim();
      if (nextFilters.from) params.from = new Date(nextFilters.from).toISOString();
      if (nextFilters.to) params.to = new Date(nextFilters.to).toISOString();
      if (nextFilters.limit !== undefined) params.limit = String(nextFilters.limit);
      if (nextFilters.offset !== undefined && nextFilters.offset !== 0) params.offset = String(nextFilters.offset);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const updateFilter = (key, value) => {
    setFilters((prev) => {
      const next = {
        ...prev,
        [key]: value,
        offset: key === "limit" ? 0 : prev.offset,
      };
      syncSearchParams(next);
      return next;
    });
  };

  const toggleStatus = (status) => {
    setFilters((prev) => {
      const exists = prev.statuses.includes(status);
      const nextStatuses = exists ? prev.statuses.filter((value) => value !== status) : [...prev.statuses, status];
      const next = { ...prev, statuses: nextStatuses };
      syncSearchParams(next);
      return next;
    });
  };

  const resetFilters = useCallback(() => {
    const next = createInitialFilters();
    setFilters(next);
    syncSearchParams(next);
  }, [syncSearchParams]);

  const lastCreatedAt = useMemo(() => {
    if (!data.items.length) return null;
    return data.items.reduce((acc, item) => {
      const ts = item.created_at || item.at;
      if (!ts) return acc;
      if (!acc) return ts;
      return new Date(ts) > new Date(acc) ? ts : acc;
    }, null);
  }, [data.items]);

  const handleAck = useCallback(
    async (notification) => {
      if (!canAckNotification) {
        showToast("No tienes permiso para reconocer notificaciones.", "error");
        return;
      }
      try {
        await ackNotification(notification.id);
        showToast("Notificación marcada como En revisión.", "success");
        await fetchData();
      } catch (err) {
        const detail =
          err?.response?.data?.detail ||
          err?.response?.statusText ||
          err?.message ||
          "No se pudo actualizar la notificación.";
        showToast(detail, "error");
      }
    },
    [fetchData, showToast, canAckNotification],
  );

  const openDisksModal = useCallback((notification) => {
    setDisksModal({
      isOpen: true,
      vmName: notification.vm_name,
      disks: Array.isArray(notification.disks_json) ? notification.disks_json : [],
      threshold: notification.threshold_pct ?? null,
    });
  }, []);

  const closeDisksModal = useCallback(() => {
    setDisksModal({ isOpen: false, vmName: "", disks: [], threshold: null });
  }, []);

  const canGoBack = filters.offset > 0;
  const canGoForward = filters.offset + filters.limit < data.total;

  if (!canViewNotifications) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow">
          <h2 className="text-lg font-semibold text-gray-900">Acceso denegado</h2>
          <p className="mt-2 text-sm text-gray-600">
            Necesitas el permiso <strong>notifications.view</strong> para acceder a esta sección.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="flex-1 px-6 py-8">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900">Notificaciones</h1>
            <p className="text-sm text-gray-600">
              Supervisión de alertas provenientes del inventario VMware / Hyper-V.
            </p>
            {lastCreatedAt && (
              <p className="mt-2 text-xs text-gray-500">
                Última corrida registrada: <span className="font-medium">{formatDate(lastCreatedAt)}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={fetchData}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-500 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Actualizando..." : "Actualizar"}
            </button>
          </div>
        </header>

        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-700 shadow">
          <span className="font-semibold text-gray-900">Leyenda:</span>
          {STATUS_ORDER.map((status) => {
            const meta = STATUS_META[status];
            return (
              <span key={status} className="ml-4 inline-flex items-center gap-1">
                <span aria-hidden="true">{meta.icon}</span>
                <span>{meta.label}</span>
              </span>
            );
          })}
        </div>

        <section
          className="rounded-lg border border-gray-200 bg-white p-4 shadow"
          data-tutorial-id="notifications-filters"
        >
          <div className="grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <span className="block text-xs font-semibold uppercase text-gray-600">Estados</span>
              <div className="mt-2 flex flex-wrap gap-3">
                {STATUS_ORDER.map((status) => {
                  const meta = STATUS_META[status];
                  return (
                    <label key={status} className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={filters.statuses.includes(status)}
                        onChange={() => toggleStatus(status)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden="true">{meta.icon}</span>
                        <span>{meta.label}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600">Proveedor</label>
              <select
                value={filters.provider}
                onChange={(event) => updateFilter("provider", event.target.value)}
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option || "any"} value={option}>
                    {option ? option : "Todos"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600">Métrica</label>
              <select
                value={filters.metric}
                onChange={(event) => updateFilter("metric", event.target.value)}
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {METRIC_OPTIONS.map((option) => (
                  <option key={option || "any"} value={option}>
                    {option ? option : "Todas"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600">VM</label>
              <input
                type="text"
                value={filters.vm}
                onChange={(event) => updateFilter("vm", event.target.value)}
                placeholder="Substring..."
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600">Ambiente</label>
              <input
                type="text"
                value={filters.env}
                onChange={(event) => updateFilter("env", event.target.value)}
                placeholder="Substring..."
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600">Desde (UTC)</label>
              <input
                type="datetime-local"
                value={filters.from}
                onChange={(event) => updateFilter("from", event.target.value)}
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600">Hasta (UTC)</label>
              <input
                type="datetime-local"
                value={filters.to}
                onChange={(event) => updateFilter("to", event.target.value)}
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600">Por página</label>
              <select
                value={filters.limit}
                onChange={(event) => updateFilter("limit", Number(event.target.value))}
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section
          className="rounded-lg border border-gray-200 bg-white shadow"
          data-tutorial-id="notifications-table"
        >
          <NotificationsTable
            items={data.items}
            loading={loading}
            fetchError={fetchError}
            onAck={handleAck}
            canAckPermission={canAckNotification}
            onViewDisks={openDisksModal}
            onResetFilters={resetFilters}
            formatDate={formatDate}
            formatDateUTC={formatDateUTC}
            formatNumber={formatNumber}
            statusMeta={STATUS_META}
          />
        </section>

        <footer className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => updateFilter("offset", Math.max(0, filters.offset - filters.limit))}
            disabled={!canGoBack}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-600">
            Mostrando {data.items.length} / {data.total} (offset {filters.offset})
          </span>
          <button
            type="button"
            onClick={() => updateFilter("offset", filters.offset + filters.limit)}
            disabled={!canGoForward}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente
          </button>
        </footer>
      </div>

      <DisksModal
        isOpen={disksModal.isOpen}
        vmName={disksModal.vmName}
        disks={disksModal.disks}
        threshold={disksModal.threshold}
        onClose={closeDisksModal}
      />
    </main>
  );
}
