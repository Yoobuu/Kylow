import { useMemo } from "react";

import { formatSnapshotTimes } from "../../lib/snapshotTime";

const SOURCE_LABELS = {
  memory: "MEMORIA",
  db: "BDD",
  cache: "CACHE LOCAL",
  legacy: "LEGACY",
};

export default function InventoryMetaBar({
  generatedAt = null,
  source = null,
  lastFetchTs = null,
  stale = false,
  staleReason = null,
  className = "",
  textClassName = "text-xs text-gray-500",
  badgeClassName = "border-amber-300/70 bg-amber-100 text-amber-800",
}) {
  const snapshotTimes = useMemo(
    () => formatSnapshotTimes(generatedAt),
    [generatedAt]
  );
  const sourceLabel =
    source && SOURCE_LABELS[source] ? SOURCE_LABELS[source] : "—";

  return (
    <div className={`flex flex-col gap-1 ${className}`.trim()}>
      <div className={textClassName}>
        <span>Fuente: {sourceLabel}</span>
        {stale && (
          <span
            className={`ml-2 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badgeClassName}`}
          >
            STALE
          </span>
        )}
        {stale && staleReason ? (
          <span className="ml-2">{staleReason}</span>
        ) : null}
      </div>
      <div className={textClassName}>
        {snapshotTimes
          ? `Ultima informacion (snapshot): ${snapshotTimes.guayaquil} · ${snapshotTimes.utc}`
          : source === "cache"
            ? "Datos cacheados (sin timestamp de snapshot)"
            : source === "legacy"
              ? "Datos legacy (sin snapshot)"
              : "Sin snapshot disponible"}
      </div>
      {lastFetchTs ? (
        <div className={textClassName}>
          Cargado en tu navegador: {new Date(lastFetchTs).toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}
