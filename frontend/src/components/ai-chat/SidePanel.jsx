const SUGGESTIONS = [
  "Resumen del inventario actual",
  "Hosts con alertas críticas hoy",
  "Últimas notificaciones relevantes",
  "Top VMs con mayor uso de CPU",
  "Auditoría: cambios recientes",
  "Usuarios con acceso pendiente",
  "Estado general del sistema",
  "Recomendaciones rápidas de salud",
];

export default function SidePanel({
  onPromptSelect,
  variant = "card",
  className = "",
  maintenanceMode = false,
}) {
  const containerClass =
    variant === "flat"
      ? `flex h-full flex-col gap-4 ${className}`
      : `flex h-full flex-col gap-4 rounded-card border border-[#E1D6C8] bg-[#FAF3E9] p-4 shadow-soft ${className}`;

  return (
    <div className={containerClass}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-usfq-gray">Estado</p>
          <h3 className="mt-1 font-usfqTitle text-lg text-usfq-black">
            <span className="font-brand">KYLOW</span>{" "}
            {maintenanceMode ? "en mantenimiento" : "activo"}
          </h3>
        </div>
        {maintenanceMode ? (
          <span className="rounded-pill border border-amber-200 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
            IA en pausa
          </span>
        ) : (
          <span className="rounded-pill border border-usfq-red/20 bg-usfq-red/10 px-2 py-1 text-[10px] font-semibold text-usfq-red">
            IA activa
          </span>
        )}
      </div>

      <div className="rounded-card border border-[#E1D6C8] bg-white/80 px-3 py-3 text-sm text-usfq-gray">
        <p className="text-[11px] uppercase tracking-[0.2em] text-usfq-gray">Modo</p>
        {maintenanceMode ? (
          <>
            <p className="mt-1 font-semibold text-usfq-black">En migración</p>
            <p className="mt-2 text-xs text-usfq-gray">
              Estamos migrando a un modelo local. El asistente no está disponible.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 font-semibold text-usfq-black">Solo lectura</p>
            <p className="mt-2 text-xs text-usfq-gray">
              <span className="font-brand">KYLOW</span> no ejecuta acciones, solo consulta inventario y reportes.
            </p>
          </>
        )}
      </div>

      <div className="rounded-card border border-[#E1D6C8] bg-white/80 px-3 py-3 text-sm text-usfq-gray">
        <p className="text-[11px] uppercase tracking-[0.2em] text-usfq-gray">Atajos</p>
        {maintenanceMode ? (
          <p className="mt-2 text-xs text-usfq-gray">No disponibles mientras está en mantenimiento.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-pill border border-usfq-gray/30 bg-usfq-white px-2 py-1 text-usfq-gray">
              Enter · Enviar
            </span>
            <span className="rounded-pill border border-usfq-gray/30 bg-usfq-white px-2 py-1 text-usfq-gray">
              Shift + Enter · Salto
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 rounded-card border border-[#E1D6C8] bg-white/80 px-3 py-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-usfq-gray">Sugerencias rápidas</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPromptSelect(prompt)}
              disabled={maintenanceMode}
              className={`rounded-pill border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30 ${
                maintenanceMode
                  ? "border-usfq-gray/20 bg-usfq-white text-usfq-gray/70"
                  : "border-usfq-red/20 bg-usfq-red/5 text-usfq-red hover:border-usfq-red/50"
              }`}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
