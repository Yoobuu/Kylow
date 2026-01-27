const baseCellClass = "px-4 py-2 text-sm text-[#231F20] align-top";

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
  onResetFilters,
  formatDate,
  formatDateUTC,
  formatNumber,
  statusMeta = {},
  canAckPermission = true,
}) {
  if (loading) {
    return <div className="p-6 text-sm text-[#6b6b6b]">Cargando…</div>;
  }

  if (fetchError) {
    return (
      <div className="flex flex-col gap-3 p-6 text-sm text-[#6b6b6b]">
        <p>
          No se pudieron cargar las notificaciones. Detalle:{" "}
          <span className="font-medium text-[#231F20]">{fetchError}</span>
        </p>
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="self-start rounded border border-[#D6C7B8] bg-white px-3 py-1 text-xs font-semibold text-[#E11B22] transition hover:bg-[#FAF3E9]"
          >
            Restablecer filtros
          </button>
        )}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-col gap-3 p-6 text-sm text-[#6b6b6b]">
        <p>Sin notificaciones para los filtros actuales.</p>
        <p>Revisa que el rango de fechas y proveedor sean correctos o restablece los filtros para ver todo el historial.</p>
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="self-start rounded border border-[#D6C7B8] bg-white px-3 py-1 text-xs font-semibold text-[#E11B22] transition hover:bg-[#FAF3E9]"
          >
            Restablecer filtros
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-[#E1D6C8] text-sm">
        <thead className="bg-[#FAF3E9]">
          <tr className="text-left text-[#E11B22]">
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
        <tbody className="divide-y divide-[#E1D6C8] bg-white">
          {items.map((item, index) => {
            const providerValue = (item.provider || "").toUpperCase();
            const metricValue = (item.metric || "").toUpperCase();
            const statusValue = (item.status || "").toUpperCase();
          const meta =
            statusMeta[statusValue] ||
            statusMeta.DEFAULT || {
              icon: <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#939598]" />,
                label: statusValue || "Sin estado",
                badgeClass: "bg-[#FAF3E9] text-[#6b6b6b] border-[#D6C7B8]",
                tooltip: "Estado no reconocido por el sistema",
              };
            const canAck = statusValue === "OPEN" && canAckPermission;
            const showDisks =
              metricValue === "DISK" && Array.isArray(item.disks_json) && item.disks_json.length > 0;

            return (
              <tr key={item.id} className={index % 2 === 0 ? "bg-white" : "bg-[#FAF3E9]"}>
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
                      className="rounded bg-[#E11B22] px-3 py-1 text-xs font-semibold text-white shadow transition hover:bg-[#c9161c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Marcar en revisión
                    </button>
                    {showDisks && (
                      <button
                        type="button"
                        onClick={() => onViewDisks?.(item)}
                        className="rounded bg-[#231F20] px-3 py-1 text-xs font-semibold text-white shadow transition hover:bg-black"
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
