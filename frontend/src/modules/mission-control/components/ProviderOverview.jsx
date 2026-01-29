import { useCallback, useMemo } from "react";

const PROVIDERS = [
  { key: "vmware", label: "VMware", tone: "mc-provider-vmware" },
  { key: "hyperv", label: "Hyper-V", tone: "mc-provider-hyperv" },
  { key: "ovirt", label: "oVirt", tone: "mc-provider-ovirt" },
  { key: "cedia", label: "CEDIA", tone: "mc-provider-cedia" },
  { key: "azure", label: "Azure", tone: "mc-provider-azure" },
];

const isPoweredOn = (state) => {
  const value = String(state || "").toUpperCase();
  return value === "POWERED_ON" || value === "RUNNING";
};

const isPoweredOff = (state) => {
  const value = String(state || "").toUpperCase();
  return value === "POWERED_OFF" || value === "OFF";
};

const safeNumber = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const formatNumber = (value) => {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("en-US").format(value);
};

const formatPct = (value) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
};

const formatSnapshotTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleTimeString();
};

const resolveEnvBucket = (env) => {
  const raw = String(env || "").toLowerCase();
  if (!raw) return null;
  if (raw.includes("sand")) return "sandbox";
  if (raw.includes("test") || raw.includes("qa")) return "test";
  if (raw.includes("prod") || raw.includes("produccion") || raw.includes("production")) return "prod";
  return null;
};

export default function ProviderOverview({ vms = [], hosts = [], providerMeta = {}, providerStatus = {} }) {
  const providerCards = useMemo(() => {
    return PROVIDERS.map((provider) => {
      const status = providerStatus?.[provider.key] || {};
      const meta = providerMeta?.[provider.key] || {};
      const providerVms = vms.filter((vm) => vm.provider === provider.key);
      const providerHosts = hosts.filter((host) => host.provider === provider.key);
      const vmTotal = Number.isFinite(status?.vmCount) ? status.vmCount : providerVms.length;
      const hostTotal = Number.isFinite(status?.hostCount)
        ? status.hostCount
        : providerHosts.length;
      const poweredOn = providerVms.length
        ? providerVms.filter((vm) => isPoweredOn(vm.power_state)).length
        : null;
      const poweredOff = providerVms.length
        ? providerVms.filter((vm) => isPoweredOff(vm.power_state)).length
        : null;
      const cpuVals = providerVms
        .map((vm) => safeNumber(vm.cpu_usage_pct))
        .filter((value) => value != null);
      const ramVals = providerVms
        .map((vm) => safeNumber(vm.ram_usage_pct))
        .filter((value) => value != null);
      const avgCpu = cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : null;
      const avgRam = ramVals.length ? ramVals.reduce((a, b) => a + b, 0) / ramVals.length : null;
      const stale = Boolean(status?.stale || meta?.stale);
      const hasError = Boolean(status?.errorMessage);
      const isEmpty = Boolean(status?.empty);
      const badgeLabel = hasError ? "Sin datos" : isEmpty ? "Sin snapshot" : stale ? "Stale" : "Fresh";
      const badgeTone = hasError ? "mc-badge-error" : isEmpty ? "mc-badge-empty" : stale ? "mc-badge-warn" : "mc-badge-ok";

      const envCounts = providerVms.reduce(
        (acc, vm) => {
          const bucket = resolveEnvBucket(vm.environment);
          if (bucket) acc[bucket] += 1;
          return acc;
        },
        { sandbox: 0, test: 0, prod: 0 }
      );
      const hasEnv = envCounts.sandbox + envCounts.test + envCounts.prod > 0;

      return {
        key: provider.key,
        label: provider.label,
        tone: provider.tone,
        status,
        meta,
        badgeLabel,
        badgeTone,
        counts: {
          hosts: hostTotal,
          vms: vmTotal,
          on: poweredOn,
          off: poweredOff,
          avgCpu,
          avgRam,
        },
        snapshot: {
          generatedAt: meta.generated_at || null,
          timeLabel: formatSnapshotTime(meta.generated_at),
          source: meta.source || "—",
        },
        envCounts,
        hasEnv,
      };
    });
  }, [vms, hosts, providerMeta, providerStatus]);

  const handleJump = useCallback((key) => {
    const row = document.getElementById(`mc-breakdown-${key}`);
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  return (
    <div className="mc-provider-overview">
      <div className="mc-provider-grid">
        {providerCards.map((card) => (
          <article key={card.key} className={`mc-provider-card ${card.tone}`}>
            <div className="mc-provider-header">
              <div>
                <div className="mc-provider-title">{card.label}</div>
                <div className="mc-provider-subtitle">
                  Snapshot {card.snapshot.timeLabel} · {card.snapshot.source}
                </div>
              </div>
              <span className={`mc-provider-badge ${card.badgeTone}`}>{card.badgeLabel}</span>
            </div>
            {card.status?.errorMessage && (
              <div className="mc-provider-warning">{card.status.errorMessage}</div>
            )}
            <div className="mc-provider-stats">
              <div className="mc-provider-stat">
                <div className="mc-provider-stat-label">Hosts</div>
                <div className="mc-provider-stat-value">{formatNumber(card.counts.hosts)}</div>
              </div>
              <div className="mc-provider-stat">
                <div className="mc-provider-stat-label">VMs</div>
                <div className="mc-provider-stat-value">{formatNumber(card.counts.vms)}</div>
              </div>
              <div className="mc-provider-stat">
                <div className="mc-provider-stat-label">Encendidas</div>
                <div className="mc-provider-stat-value">{formatNumber(card.counts.on)}</div>
              </div>
              <div className="mc-provider-stat">
                <div className="mc-provider-stat-label">Apagadas</div>
                <div className="mc-provider-stat-value">{formatNumber(card.counts.off)}</div>
              </div>
              <div className="mc-provider-stat">
                <div className="mc-provider-stat-label">CPU promedio</div>
                <div className="mc-provider-stat-value">{formatPct(card.counts.avgCpu)}</div>
              </div>
              <div className="mc-provider-stat">
                <div className="mc-provider-stat-label">RAM promedio</div>
                <div className="mc-provider-stat-value">{formatPct(card.counts.avgRam)}</div>
              </div>
            </div>
            <div className="mc-provider-footer">
              <div className="mc-provider-meta">
                {card.status?.stale ? "Snapshot stale" : "Snapshot activo"}
              </div>
              <button type="button" className="mc-provider-link" onClick={() => handleJump(card.key)}>
                Ver detalle
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="mc-breakdown" id="mc-breakdown">
        <div className="mc-breakdown-header">
          <div className="mc-breakdown-title">Breakdown por ambiente</div>
          <div className="mc-breakdown-subtitle">Sandbox · Test · Prod</div>
        </div>
        <div className="mc-breakdown-table">
          <div className="mc-breakdown-row mc-breakdown-head">
            <span>Provider</span>
            <span>Sandbox</span>
            <span>Test</span>
            <span>Prod</span>
            <span>Total</span>
          </div>
          {providerCards.map((card) => {
            const sandbox = card.hasEnv ? formatNumber(card.envCounts.sandbox) : "—";
            const test = card.hasEnv ? formatNumber(card.envCounts.test) : "—";
            const prod = card.hasEnv ? formatNumber(card.envCounts.prod) : "—";
            return (
              <div
                key={card.key}
                id={`mc-breakdown-${card.key}`}
                className="mc-breakdown-row"
              >
                <span className={`mc-breakdown-provider ${card.tone}`}>{card.label}</span>
                <span>{sandbox}</span>
                <span>{test}</span>
                <span>{prod}</span>
                <span>{formatNumber(card.counts.vms)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
