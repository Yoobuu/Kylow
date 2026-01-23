import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { IoPowerSharp, IoPowerOutline, IoRefreshSharp } from "react-icons/io5";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";

const ACTION_THEMES = {
  start: {
    base: "bg-green-500 hover:bg-green-600 focus-visible:ring-green-300",
  },
  stop: {
    base: "bg-red-500 hover:bg-red-600 focus-visible:ring-red-300",
  },
  reset: {
    base: "bg-yellow-500 hover:bg-yellow-600 focus-visible:ring-yellow-300",
  },
};

const SKELETON_WIDTHS = ["w-2/3", "w-1/2", "w-5/6", "w-3/4", "w-1/3", "w-2/5"];

const PERF_WINDOW_SECONDS = 120;

const isFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const formatGiB = (value) => {
  const num = isFiniteNumber(value);
  if (num === null) return "\u2014";
  return `${num.toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;
};

const parseSizeGiB = (disk) => {
  if (!disk) return null;
  if (typeof disk === "object" && disk !== null) {
    const direct =
      disk.sizeGiB ??
      disk.SizeGiB ??
      disk.capacityGiB ??
      disk.capacity_gib ??
      disk.capacityGiB ??
      disk.allocatedGiB ??
      disk.AllocatedGiB;
    const candidate = isFiniteNumber(direct);
    if (candidate !== null) return candidate;
    if (typeof disk.text === "string" && disk.text.trim()) {
      return parseSizeGiB(disk.text.trim());
    }
  }

  const text = typeof disk === "string" ? disk : null;
  if (!text) return null;

  const detailed = /\/\s*([\d.,]+)\s*Gi?B/i.exec(text);
  if (detailed) {
    return isFiniteNumber(detailed[1].replace(",", "."));
  }

  const simple = /([\d.,]+)\s*(Gi?B|GB)/i.exec(text);
  if (simple) {
    return isFiniteNumber(simple[1].replace(",", "."));
  }

  return null;
};

const extractDiskText = (disk) => {
  if (disk == null) return "\u2014";
  if (typeof disk === "string") return disk;
  if (typeof disk.text === "string" && disk.text.trim()) return disk.text;
  if (typeof disk.description === "string" && disk.description.trim()) return disk.description;
  if (typeof disk.label === "string" && disk.label.trim()) return disk.label;
  const size = parseSizeGiB(disk);
  if (size !== null) {
    return formatGiB(size);
  }
  return "\u2014";
};

const normalizeDiskEntries = (disks) => {
  if (!Array.isArray(disks) || disks.length === 0) return [];
  return disks.map((disk, index) => {
    const capacityGiB = parseSizeGiB(disk);
    const description = extractDiskText(disk);
    return {
      id: `disk-${index}`,
      label: `Disco ${index + 1}`,
      description,
      capacityGiB,
    };
  });
};

const shortenAzureVmId = (value) => {
  if (!value) return null;
  const raw = String(value);
  const match = /\/virtualMachines\/([^/]+)$/i.exec(raw);
  if (match) return match[1];
  const parts = raw.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
};

export default function VMDetailModal({
  vmId,
  record = null,
  onClose,
  onAction,
  getVmDetail,
  getVmPerf,
  powerActionsEnabled = true,
}) {
  const modalRef = useRef(null);
  const perfAbortRef = useRef(null);
  const { hasPermission } = useAuth();

  const detailFetcher = useMemo(() => {
    if (typeof getVmDetail === "function") {
      return getVmDetail;
    }
    return (id) => api.get(`/vms/${id}`).then((res) => res.data);
  }, [getVmDetail]);

  const perfFetcher = useMemo(() => {
    if (typeof getVmPerf === "function") {
      return getVmPerf;
    }
    return (id, params, signal) =>
      api.get(`/vms/${id}/perf`, { params, signal }).then((res) => res.data);
  }, [getVmPerf]);

  const [loading, setLoading] = useState(!record);
  const [detail, setDetail] = useState(record);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [pending, setPending] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState("");
  const [perf, setPerf] = useState(null);
  const rawName = detail?.name || detail?.Name || record?.name || record?.Name;
  const idFallback = shortenAzureVmId(detail?.id || record?.id || vmId);
  const displayName = rawName || idFallback || vmId || "";
  const displayNameTitle = displayName || "\u2014";
  const memoryLabel =
    detail?.memory_size_MiB != null ? `${detail.memory_size_MiB} MiB` : "\u2014";

  const hasPowerPermission = hasPermission("vms.power");
  const showPowerActions = powerActionsEnabled;
  const powerDisabled = showPowerActions && !hasPowerPermission;
  const powerDisabledMessage = "No tienes permisos para controlar energia. Pide acceso a un admin.";

  const fetchPerf = useCallback(() => {
    if (perfAbortRef.current) {
      perfAbortRef.current.abort();
      perfAbortRef.current = null;
    }

    if (!vmId) {
      setPerf(null);
      setPerfError("");
      setPerfLoading(false);
      return null;
    }

    const controller = new AbortController();
    perfAbortRef.current = controller;

    setPerfLoading(true);
    setPerfError("");

    perfFetcher(vmId, { window: PERF_WINDOW_SECONDS }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) {
          return;
        }
        setPerf(res?.data ?? res);
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.code === "ERR_CANCELED") {
          return;
        }
        setPerf(null);
        setPerfError("No se pudo cargar metricas.");
      })
      .finally(() => {
        if (perfAbortRef.current === controller) {
          perfAbortRef.current = null;
        }
        if (!controller.signal.aborted) {
          setPerfLoading(false);
        }
      });

    return controller;
  }, [vmId, perfFetcher]);

  useEffect(() => {
    if (!vmId) {
      setDetail(null);
      setError("");
      setSuccessMsg("");
      setPending(null);
      setActionLoading(null);
      setLoading(false);
      return;
    }

    const hasInitialRecord = record && record.id === vmId;
    setDetail(hasInitialRecord ? record : null);
    setLoading(!hasInitialRecord);
    setError("");
    setSuccessMsg("");
    setPending(null);

    let cancelled = false;
    Promise.resolve(detailFetcher(vmId))
      .then((res) => {
        if (cancelled) return;
        setDetail(res?.data ?? res);
      })
      .catch(() => {
        if (cancelled) return;
        if (!hasInitialRecord) {
          setError("No se pudo cargar el detalle.");
          setDetail(null);
        } else {
          setError("No se pudo actualizar el detalle.");
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [record, vmId, detailFetcher]);

  useEffect(() => {
    const controller = fetchPerf();
    return () => {
      if (controller) {
        controller.abort();
      }
    };
  }, [fetchPerf]);

  useEffect(() => {
    return () => {
      if (perfAbortRef.current) {
        perfAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!vmId) return undefined;
    modalRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [vmId, onClose]);

  const handlePerfRefresh = () => {
    fetchPerf();
  };

  const diskEntries = useMemo(() => normalizeDiskEntries(detail?.disks), [detail?.disks]);
  const totalDiskCapacity = useMemo(() => {
    if (!diskEntries.length) return null;
    const total = diskEntries.reduce((sum, disk) => sum + (disk.capacityGiB ?? 0), 0);
    return total > 0 ? total : null;
  }, [diskEntries]);

  const perfMetricsConfig = [
    { key: "cpu_usage_pct", label: "CPU uso" },
    { key: "mem_usage_pct", label: "Memoria uso" },
  ];

  const formatPerfPercent = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return "\u2014";
    }
    const rounded = Math.round(num * 100) / 100;
    return `${rounded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
  };

  const renderPerfBar = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return null;
    }
    const clamped = Math.max(0, Math.min(num, 100));
    const barColor = clamped < 50 ? "bg-green-500" : clamped < 80 ? "bg-yellow-500" : "bg-red-500";
    return (
      <div className="mt-3 h-1.5 rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${clamped}%` }} />
      </div>
    );
  };

  const renderSourceBadge = (source) => {
    const normalized = source || "none";
    const labelMap = {
      realtime: "realtime",
      rollup: "rollup",
      quickstats: "quickstats",
      idle_zero: "idle",
      missing_metric: "missing",
      none: "sin datos",
    };
    const classMap = {
      realtime: "bg-emerald-100 text-emerald-700",
      rollup: "bg-amber-100 text-amber-700",
      quickstats: "bg-sky-100 text-sky-700",
      idle_zero: "bg-gray-100 text-gray-600",
      missing_metric: "bg-rose-100 text-rose-700",
      none: "bg-gray-100 text-gray-500",
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classMap[normalized] || "bg-gray-100 text-gray-600"}`}>
        {labelMap[normalized] || normalized}
      </span>
    );
  };

  const handlePowerExecution = async (apiPath) => {
    const actionLabel = apiPath === "start" ? "encender" : apiPath === "stop" ? "apagar" : "resetear";
    if (!showPowerActions || powerDisabled) {
      alert("Acceso denegado (403).");
      setPending(null);
      return;
    }
    setActionLoading(apiPath);
    let ok = false;
    try {
      await api.post(`/vms/${vmId}/power/${apiPath}`);
      ok = true;
    } catch (err) {
      if (err?.response?.status === 403) {
        alert("Acceso denegado (403).");
      } else {
        alert(`Error al intentar ${actionLabel}.`);
      }
    } finally {
      setActionLoading(null);
      setPending(null);
    }

    if (ok) {
      setSuccessMsg(`VM ${detail?.name ?? ""} ${actionLabel} exitosamente.`);
      onAction?.(apiPath);
    }
  };

  const actionButton = (text, themeKey, apiPath, IconComponent) => {
    const isLoading = actionLoading === apiPath;
    const disabled = powerDisabled || isLoading;
    const theme = ACTION_THEMES[themeKey] ?? ACTION_THEMES.start;
    const IconElement = IconComponent;

    const baseClass =
      "flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow transition disabled:cursor-not-allowed disabled:opacity-60";

    const handleClick = () => {
      if (disabled) return;
      setPending({ text, apiPath });
    };

    return (
      <Motion.button
        type="button"
        disabled={disabled}
        title={powerDisabled ? powerDisabledMessage : undefined}
        className={`${baseClass} ${theme.base}`}
        onClick={handleClick}
        whileTap={disabled ? undefined : { scale: 0.97 }}
      >
        {isLoading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
        ) : (
          <IconElement />
        )}
        <span>{text}</span>
      </Motion.button>
    );
  };

  const perfCollectedAt = perf && perf["_collected_at"] ? new Date(perf["_collected_at"]) : null;
  const perfCollectedLabel = perfCollectedAt && !Number.isNaN(perfCollectedAt.getTime()) ? perfCollectedAt.toLocaleString() : null;
  const perfIntervalSeconds = perf?._interval_seconds ?? PERF_WINDOW_SECONDS;
  const hasPerfValues = perfMetricsConfig.some(({ key }) => perf && perf[key] != null);
  const showPerfNoDataMessage = !perfLoading && !perfError && !hasPerfValues;

  if (!vmId) return null;

  const content = (
    <AnimatePresence>
      {vmId && (
        <Motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <Motion.div
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vm-detail-title"
            className="relative flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white text-gray-800 shadow-xl focus:outline-none"
            variants={{
              hidden: { opacity: 0, scale: 0.95 },
              visible: { opacity: 1, scale: 1 },
            }}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
              <h3
                id="vm-detail-title"
                className="min-w-0 flex-1 truncate text-2xl font-semibold"
                title={displayNameTitle}
              >
                Detalle VM {displayNameTitle}
              </h3>
              <button
                onClick={onClose}
                aria-label="Cerrar detalle de VM"
                className="shrink-0 text-xl text-gray-500 transition hover:text-gray-900"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {successMsg && (
                <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {successMsg}
                </div>
              )}

              {pending && (
                <div className="mb-4 rounded border border-gray-300 bg-gray-100 p-4">
                  <p className="text-sm text-gray-800">
                    ¿Seguro que deseas <strong>{pending.text.toLowerCase()}</strong> la VM {detail?.name ?? vmId}?
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      className="rounded bg-green-500 px-3 py-1 text-sm text-white hover:bg-green-600"
                      onClick={() => handlePowerExecution(pending.apiPath)}
                    >
                      Sí
                    </button>
                    <button
                      className="rounded bg-gray-300 px-3 py-1 text-sm text-gray-800 hover:bg-gray-400"
                      onClick={() => setPending(null)}
                    >
                      No
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-6 lg:flex-row">
                <div className="flex-1 min-w-0 space-y-6">
                  {loading && (
                    <div className="space-y-3">
                      {SKELETON_WIDTHS.map((widthClass, index) => (
                        <div key={index} className={`h-4 animate-pulse rounded bg-gray-200 ${widthClass}`} />
                      ))}
                    </div>
                  )}

                  {error && !loading && (
                    <p className="text-center text-sm text-red-600">{error}</p>
                  )}

                  {!loading && detail && (
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-2">
                      {[
                        ["Nombre", detail.name],
                        [
                          "Estado",
                          detail.power_state === "POWERED_ON"
                            ? "Encendida"
                            : detail.power_state === "POWERED_OFF"
                            ? "Apagada"
                            : detail.power_state,
                        ],
                        ["CPU", detail.cpu_count],
                        ["RAM", memoryLabel],
                        ["OS", detail.guest_os],
                        ["IPs", detail.ip_addresses?.length ? detail.ip_addresses.join(", ") : "-"],
                        [
                          "Discos",
                          diskEntries.length ? (
                            <div className="flex flex-col gap-1">
                              {diskEntries.map((disk) => {
                                const text = disk.description || "\u2014";
                                const needsCapacityHint =
                                  disk.capacityGiB != null && !/gi?b|gb/i.test(text);
                                const display = needsCapacityHint
                                  ? `${text} (${formatGiB(disk.capacityGiB)})`
                                  : text;
                                return (
                                  <span key={disk.id} className="text-gray-800">
                                    {diskEntries.length > 1 ? `${disk.label}: ` : ""}
                                    {display}
                                  </span>
                                );
                              })}
                              {totalDiskCapacity != null && diskEntries.length > 1 && (
                                <span className="text-xs text-gray-500">
                                  Total: {formatGiB(totalDiskCapacity)}
                                </span>
                              )}
                            </div>
                          ) : (
                            "\u2014"
                          ),
                        ],
                        ["NICs", detail.nics?.length ? detail.nics.join(", ") : "-"],
                        ["Host", detail.host || "-"],
                        ["Cluster", detail.cluster || "-"],
                        ["VLAN(s)", detail.networks?.length ? detail.networks.join(", ") : "-"],
                      ].map(([label, value]) => (
                        <div key={label} className="col-span-1 flex">
                          <dt className="w-1/2 font-medium text-gray-700">{label}:</dt>
                          <dd className="flex-1 break-words text-gray-800">{value ?? "\u2014"}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {showPowerActions && (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {actionButton("Encender", "start", "start", IoPowerSharp)}
                        {actionButton("Apagar", "stop", "stop", IoPowerOutline)}
                        {actionButton("Reset", "reset", "reset", IoRefreshSharp)}
                      </div>
                      {powerDisabled && <p className="text-xs text-red-500">{powerDisabledMessage}</p>}
                    </>
                  )}
                </div>

                <aside className="w-full shrink-0 space-y-4 border-t border-gray-200 pt-4 lg:w-72 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 xl:w-80">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-700">
                      Contexto realtime ({PERF_WINDOW_SECONDS}s)
                    </h4>
                    <button
                      type="button"
                      onClick={handlePerfRefresh}
                      disabled={perfLoading}
                      className="text-xs font-medium text-blue-600 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {perfLoading ? "Actualizando..." : "Actualizar"}
                    </button>
                  </div>

                  {perfError && <p className="text-xs text-red-600">{perfError}</p>}

                  {perfLoading && !perf && (
                    <div className="space-y-3">
                      {[0, 1].map((index) => (
                        <div key={index} className="rounded-lg border border-gray-200 p-4">
                          <div className="mb-3 h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                          <div className="h-6 w-3/4 animate-pulse rounded bg-gray-200" />
                          <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-gray-200" />
                        </div>
                      ))}
                    </div>
                  )}

                  {perf && (
                    <div className="space-y-3">
                      {perfMetricsConfig.map(({ key, label }) => (
                        <div key={key} className="rounded-lg border border-gray-200 p-4">
                          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <span>{label}</span>
                            {renderSourceBadge(perf?._sources?.[key])}
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-gray-900">
                            {formatPerfPercent(perf[key])}
                          </div>
                          {renderPerfBar(perf[key])}
                        </div>
                      ))}
                    </div>
                  )}

                  {showPerfNoDataMessage && (
                    <p className="text-xs text-gray-500">Sin datos dentro de la ventana solicitada.</p>
                  )}
                  {perfCollectedLabel && (
                    <p className="text-xs text-gray-500">
                      Última muestra: {perfCollectedLabel} · intervalo {perfIntervalSeconds} s
                    </p>
                  )}
                </aside>
              </div>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
