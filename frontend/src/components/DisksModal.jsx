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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E11B22]">Discos para {vmName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl font-semibold text-[#6b6b6b] transition hover:text-[#231F20]"
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
                    isOverThreshold
                      ? "border-[#F5B5B5] bg-[#FDE2E2] text-[#8B0000]"
                      : "border-[#E1D6C8] bg-white text-[#231F20]"
                  }`}
                  title={tooltip}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">
                      {isOverThreshold && <span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#E11B22]" />}
                      {resolveDiskLabel(disk, index)}
                    </span>
                    <span className="text-xs text-[#6b6b6b]">{tooltip}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={`${baseCardClass} border-[#E1D6C8] bg-white text-[#231F20]`}>
              No se encontraron métricas de discos para esta notificación.
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[#D6C7B8] bg-white px-4 py-2 text-sm font-semibold text-[#E11B22] transition hover:bg-[#FAF3E9]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
