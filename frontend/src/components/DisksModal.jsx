const baseCardClass = "rounded border px-3 py-2 text-sm transition-colors";

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toFixed(1);
}

function resolveDiskLabel(disk, index) {
  return (
    disk?.name ||
    disk?.label ||
    disk?.device ||
    disk?.mount ||
    disk?.path ||
    `Disco ${index + 1}`
  );
}

export default function DisksModal({ isOpen, vmName, disks, threshold, onClose }) {
  if (!isOpen) return null;

  const safeThreshold = typeof threshold === "number" ? threshold : 90;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Discos para {vmName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl font-semibold text-gray-500 transition hover:text-gray-800"
            aria-label="Cerrar modal de discos"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          {Array.isArray(disks) && disks.length > 0 ? (
            disks.map((disk, index) => {
              const usage = disk?.used_pct ?? disk?.usage_pct ?? null;
              const size = disk?.size_gib ?? disk?.size ?? null;
              const isOverThreshold = typeof usage === "number" && usage > safeThreshold;

              const tooltip = [
                typeof usage === "number" ? `Uso: ${formatNumber(usage)}%` : null,
                typeof size === "number" ? `Tamaño: ${formatNumber(size)} GiB` : null,
                `Umbral: ${formatNumber(safeThreshold)}%`,
              ]
                .filter(Boolean)
                .join(" • ");

              return (
                <div
                  key={index}
                  className={`${baseCardClass} ${
                    isOverThreshold ? "border-red-200 bg-red-50 text-red-800" : "border-gray-200 bg-gray-50 text-gray-700"
                  }`}
                  title={tooltip}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">
                      {isOverThreshold && <span aria-hidden="true">⚠️ </span>}
                      {resolveDiskLabel(disk, index)}
                    </span>
                    <span className="text-xs text-gray-500">{tooltip}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={`${baseCardClass} border-gray-200 bg-gray-50 text-gray-700`}>
              No se encontraron métricas de discos para esta notificación.
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-400"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
