import { useMemo } from "react";

const formatNumber = (value) => {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("en-US").format(value);
};

const DEFAULT_PROVIDER_LABELS = {
  vmware: "VMware",
  ovirt: "KVM",
  kvm: "KVM",
  hyperv: "Hyper-V",
  cedia: "CEDIA",
  azure: "Azure",
};

const PROVIDER_ORDER = ["vmware", "ovirt", "hyperv", "cedia", "azure"];

const normalizeProviderKey = (value) => {
  const key = String(value || "").trim().toLowerCase();
  return key === "kvm" ? "ovirt" : key;
};

const classifyOs = (value) => {
  if (!value) return "unknown";
  const raw = String(value).toLowerCase();
  if (!raw) return "unknown";
  const windowsRe = /(windows|microsoft\s*windows|\bwin(dows)?\b|\bwin\d+)/i;
  if (windowsRe.test(raw)) return "windows";
  const linuxRe =
    /(linux|ubuntu|debian|centos|red hat|rhel|suse|sles|alpine|arch|fedora|rocky|alma|oracle|kali|amazon|amzn|coreos)/i;
  if (linuxRe.test(raw)) return "linux";
  return "unknown";
};

const isPoweredOff = (state) => {
  const value = String(state || "").toUpperCase();
  return value === "POWERED_OFF" || value === "OFF";
};

export default function EnvironmentSummary({
  vms = [],
  providerStatus = {},
  providerLabels = {},
  loading = false,
}) {
  const rows = useMemo(() => {
    const keys = new Set();
    PROVIDER_ORDER.forEach((key) => keys.add(key));
    Object.keys(providerLabels || {}).forEach((key) => keys.add(normalizeProviderKey(key)));
    Object.keys(providerStatus || {}).forEach((key) => keys.add(normalizeProviderKey(key)));
    vms.forEach((vm) => {
      const key = normalizeProviderKey(vm?.provider);
      if (key) keys.add(key);
    });

    return Array.from(keys)
      .filter(Boolean)
      .map((key) => {
        const providerVms = vms.filter((vm) => normalizeProviderKey(vm?.provider) === key);
        const counts = providerVms.reduce(
          (acc, vm) => {
            const osBucket = classifyOs(vm?.guest_os ?? vm?.os_type);
            if (osBucket === "linux") acc.linux += 1;
            else if (osBucket === "windows") acc.windows += 1;
            else acc.unknownOs += 1;
            if (isPoweredOff(vm?.power_state)) acc.off += 1;
            acc.total += 1;
            return acc;
          },
          { total: 0, linux: 0, windows: 0, unknownOs: 0, off: 0 }
        );

        const label =
          providerLabels?.[key] ||
          providerLabels?.[key === "ovirt" ? "kvm" : key] ||
          DEFAULT_PROVIDER_LABELS[key] ||
          key;
        return { key, label, ...counts };
      })
      .sort((a, b) => {
        const aIdx = PROVIDER_ORDER.indexOf(a.key);
        const bIdx = PROVIDER_ORDER.indexOf(b.key);
        const aOrder = aIdx === -1 ? 90 : aIdx;
        const bOrder = bIdx === -1 ? 90 : bIdx;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.label.localeCompare(b.label, "es", { numeric: true, sensitivity: "base" });
      });
  }, [providerLabels, providerStatus, vms]);

  const totals = useMemo(() => {
    if (rows.length < 2) return null;
    return rows.reduce(
      (acc, row) => {
        acc.total += row.total || 0;
        acc.linux += row.linux || 0;
        acc.windows += row.windows || 0;
        acc.unknownOs += row.unknownOs || 0;
        acc.off += row.off || 0;
        return acc;
      },
      { total: 0, linux: 0, windows: 0, unknownOs: 0, off: 0 }
    );
  }, [rows]);

  return (
    <section className="mc-env-summary">
      <div className="mc-env-header">
        <div>
          <div className="mc-env-title">Resumen por proveedor</div>
          <div className="mc-env-subtitle">
            Linux / Windows sin version · Sin SO = sin dato o no clasificado
          </div>
        </div>
        <span className="mc-env-pill">Vista integrada</span>
      </div>

      {!rows.length ? (
        <div className="mc-env-empty">
          {loading ? "Cargando resumen por proveedor..." : "Sin datos disponibles por proveedor."}
        </div>
      ) : (
        <div className="mc-env-table">
          <div className="mc-env-row mc-env-head">
            <span>Proveedor</span>
            <span>Total</span>
            <span>Linux</span>
            <span>Windows</span>
            <span>Sin SO</span>
            <span>Apagadas</span>
          </div>
          {rows.map((row) => (
            <div key={row.key} className="mc-env-row">
              <span className="mc-env-name">{row.label}</span>
              <span>{formatNumber(row.total)}</span>
              <span>{formatNumber(row.linux)}</span>
              <span>{formatNumber(row.windows)}</span>
              <span>{formatNumber(row.unknownOs)}</span>
              <span>{formatNumber(row.off)}</span>
            </div>
          ))}
          {totals && (
            <div className="mc-env-row mc-env-total">
              <span>Total general</span>
              <span>{formatNumber(totals.total)}</span>
              <span>{formatNumber(totals.linux)}</span>
              <span>{formatNumber(totals.windows)}</span>
              <span>{formatNumber(totals.unknownOs)}</span>
              <span>{formatNumber(totals.off)}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
