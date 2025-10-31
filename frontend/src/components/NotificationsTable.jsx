const baseCellClass = "px-4 py-2 text-sm text-gray-800 align-top";

function StatusBadge({ meta }) {
  const { icon, label, badgeClass, tooltip } = meta;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
      title={tooltip || label}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

export default function NotificationsTable({
  items = [],
  loading = false,
  fetchError = "",
  onAck,
  onViewDisks,
  formatDate,
  formatDateUTC,
  formatNumber,
  statusMeta = {},
}) {
  if (loading) {
    return <div className="p-6 text-sm text-gray-600">Cargando…</div>;
  }

  if (fetchError) {
    return (
      <div className="p-6 text-sm text-gray-600">
        No se pudieron cargar las notificaciones. Detalle:{" "}
        <span className="font-medium text-gray-900">{fetchError}</span>
      </div>
    );
  }

  if (!items.length) {
    return <div className="p-6 text-sm text-gray-600">Sin notificaciones para los filtros actuales.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-gray-700">
            <th className="px-4 py-2 font-semibold">Fecha</th>
            <th className="px-4 py-2 font-semibold">Proveedor</th>
            <th className="px-4 py-2 font-semibold">Ambiente</th>
            <th className="px-4 py-2 font-semibold">VM</th>
            <th className="px-4 py-2 font-semibold">Métrica</th>
            <th className="px-4 py-2 font-semibold">Valor %</th>
            <th className="px-4 py-2 font-semibold">Umbral %</th>
            <th className="px-4 py-2 font-semibold">Estado</th>
            <th className="px-4 py-2 font-semibold">Atendida por</th>
            <th className="px-4 py-2 font-semibold">Fecha de revisión (UTC)</th>
            <th className="px-4 py-2 font-semibold">Creada (UTC)</th>
            <th className="px-4 py-2 font-semibold">Identificador interno de rastreo</th>
            <th className="px-4 py-2 font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {items.map((item) => {
            const providerValue = (item.provider || "").toUpperCase();
            const metricValue = (item.metric || "").toUpperCase();
            const statusValue = (item.status || "").toUpperCase();
            const meta =
              statusMeta[statusValue] ||
              statusMeta.DEFAULT || {
                icon: "⚪",
                label: statusValue || "Sin estado",
                badgeClass: "bg-gray-100 text-gray-700 border-gray-300",
                tooltip: "Estado no reconocido por el sistema",
              };
            const canAck = statusValue === "OPEN";
            const showDisks =
              metricValue === "DISK" && Array.isArray(item.disks_json) && item.disks_json.length > 0;

            return (
              <tr key={item.id}>
                <td className={baseCellClass}>{formatDate(item.at)}</td>
                <td className={baseCellClass}>{providerValue || "—"}</td>
                <td className={baseCellClass}>{item.env || "—"}</td>
                <td className={baseCellClass}>{item.vm_name}</td>
                <td className={baseCellClass}>{metricValue || "—"}</td>
                <td className={baseCellClass}>{formatNumber(item.value_pct)}</td>
                <td className={baseCellClass}>{formatNumber(item.threshold_pct)}</td>
                <td className={`${baseCellClass} whitespace-nowrap`}>
                  <StatusBadge meta={meta} />
                </td>
                <td className={baseCellClass}>{item.ack_by || "—"}</td>
                <td className={baseCellClass}>{formatDateUTC(item.ack_at)}</td>
                <td className={baseCellClass}>{formatDateUTC(item.created_at)}</td>
                <td className={baseCellClass}>{item.correlation_id || "—"}</td>
                <td className={`${baseCellClass} whitespace-nowrap`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!canAck}
                      onClick={() => onAck?.(item)}
                      className="rounded bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Marcar en revisión
                    </button>
                    {showDisks && (
                      <button
                        type="button"
                        onClick={() => onViewDisks?.(item)}
                        className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white shadow transition hover:bg-slate-600"
                      >
                        Ver discos
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
