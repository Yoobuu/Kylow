const formatPct = (value) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
};

const formatNumber = (value) => {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("en-US").format(value);
};

const PROVIDER_LABELS = {
  vmware: "VMware",
  hyperv: "Hyper-V",
  ovirt: "oVirt",
  cedia: "CEDIA",
  unknown: "Unknown",
};

const formatProvider = (value) => {
  const key = String(value || "").toLowerCase();
  return PROVIDER_LABELS[key] || value || "—";
};

const buildHighlights = ({ selectedNode, envKpis }) => {
  if (!selectedNode) return [];
  const type = selectedNode.type;
  if (type === "vm") {
    return [
      { label: "Estado", value: selectedNode.power_state || "—" },
      { label: "Host", value: selectedNode.host || "—" },
      { label: "Cluster", value: selectedNode.cluster || "—" },
      { label: "CPU", value: formatPct(selectedNode.cpu_usage_pct) },
      { label: "RAM", value: formatPct(selectedNode.ram_usage_pct) },
    ];
  }
  if (type === "host") {
    return [
      { label: "VMs", value: formatNumber(selectedNode.meta?.vmCount) },
      { label: "CPU", value: formatPct(selectedNode.cpu_usage_pct) },
      { label: "RAM", value: formatPct(selectedNode.memory_usage_pct) },
      { label: "Health", value: selectedNode.health || "—" },
      { label: "Conexion", value: selectedNode.connection_state || "—" },
    ];
  }
  if (type === "cluster") {
    return [
      { label: "Total VMs", value: formatNumber(selectedNode.meta?.total) },
      { label: "Encendidas", value: formatNumber(selectedNode.meta?.on) },
      { label: "Apagadas", value: formatNumber(selectedNode.meta?.off) },
      { label: "Provider", value: formatProvider(selectedNode.provider) },
    ];
  }
  if (type === "provider") {
    return [
      { label: "Ambiente", value: selectedNode.environment || "—" },
      { label: "Total VMs", value: formatNumber(selectedNode.meta?.total) },
      { label: "Encendidas", value: formatNumber(selectedNode.meta?.on) },
      { label: "Apagadas", value: formatNumber(selectedNode.meta?.off) },
    ];
  }
  if (type === "env") {
    const envMeta = envKpis?.[selectedNode.environment] || selectedNode.meta || {};
    return [
      { label: "Total VMs", value: formatNumber(envMeta.total) },
      { label: "Encendidas", value: formatNumber(envMeta.on) },
      { label: "Apagadas", value: formatNumber(envMeta.off) },
      { label: "Providers", value: Object.keys(envMeta.providers || {}).join(", ") || "—" },
    ];
  }
  return [];
};

export default function SidePanel({
  selectedNode,
  envKpis,
  providerStatus,
  detailNotice,
  focusNode,
  onFocus,
  onResetFocus,
}) {
  const highlights = buildHighlights({ selectedNode, envKpis });
  const providerEntries = Object.entries(providerStatus || {});
  const title = selectedNode ? selectedNode.name : "Ninguno";
  const typeLabel = selectedNode ? selectedNode.type : "—";
  const subtitle = selectedNode
    ? `${typeLabel.toUpperCase()} · ${formatProvider(selectedNode.provider || "multi")}`
    : "Selecciona un nodo del atlas.";
  const canFocus = selectedNode && ["env", "provider", "cluster", "host"].includes(selectedNode.type);
  const focusLabel = focusNode ? focusNode.type : null;

  return (
    <aside className="mc-panel">
      <div className="mc-panel-header">
        <div className="mc-panel-title">Detalle</div>
        <div className="mc-panel-subtitle">{subtitle}</div>
      </div>

      <div className="mc-panel-card">
        <div className="mc-panel-kicker">Nodo activo</div>
        <div className="mc-panel-value">{title}</div>
        <div className="mc-panel-meta">
          {selectedNode ? (selectedNode.environment || selectedNode.cluster || "—") : "Haz click en un nodo."}
        </div>
        {detailNotice && (
          <div className="mc-panel-meta mc-panel-warning">{detailNotice}</div>
        )}
        <div className="mc-panel-actions">
          {canFocus && (
            <button type="button" className="mc-panel-btn" onClick={() => onFocus?.(selectedNode)}>
              Focus
            </button>
          )}
          {focusNode && (
            <button type="button" className="mc-panel-btn mc-panel-btn-ghost" onClick={onResetFocus}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="mc-panel-section">
        <div className="mc-panel-kicker">Highlights</div>
        <div className="mc-panel-list">
          {highlights.map((item) => (
            <div key={item.label} className="mc-panel-item">
              <div className="mc-panel-item-title">{item.label}</div>
              <div className="mc-panel-item-value">{item.value}</div>
            </div>
          ))}
          {!highlights.length && (
            <div className="mc-panel-item">
              <div className="mc-panel-item-title">Sin seleccion</div>
              <div className="mc-panel-item-value">Haz click en un nodo.</div>
            </div>
          )}
        </div>
      </div>

      <div className="mc-panel-section">
        <div className="mc-panel-kicker">Fuentes</div>
        <div className="mc-panel-list">
          {providerEntries.map(([provider, status]) => {
            const label = provider.toUpperCase();
            const state = status?.errorMessage ? "sin datos" : status?.stale ? "stale" : "ok";
            return (
              <div key={provider} className="mc-panel-item">
                <div className="mc-panel-item-title">{label}</div>
                <div className="mc-panel-item-value">{state}</div>
              </div>
            );
          })}
        </div>
      </div>

      {focusNode && (
        <div className="mc-panel-section">
          <div className="mc-panel-kicker">Focus activo</div>
          <div className="mc-panel-item">
            <div className="mc-panel-item-title">{focusLabel?.toUpperCase() || "FOCUS"}</div>
            <div className="mc-panel-item-value">{focusNode.name || focusNode.id}</div>
          </div>
        </div>
      )}

      <div className="mc-panel-section">
        <div className="mc-panel-kicker">Demo Mode</div>
        <div className="mc-panel-toggle">
          <div className="mc-toggle-dot" aria-hidden="true" />
          <span>Autoplay activo</span>
        </div>
      </div>
    </aside>
  );
}
