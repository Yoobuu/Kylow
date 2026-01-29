import { useMemo } from "react";
import { motion as Motion } from "framer-motion";
import KpiStrip from "../modules/mission-control/components/KpiStrip";
import ProviderOverview from "../modules/mission-control/components/ProviderOverview";
import { useMissionData, missionControlProviderLabels } from "../modules/mission-control/hooks/useMissionData";
import "../modules/mission-control/styles/mission-control.css";

const containerVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut", staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const formatSnapshotTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleTimeString();
};

export default function ExecutiveMissionControl() {
  const { loading, errorSummary, kpis, providerMeta, providerStatus, vms, hosts } = useMissionData();
  const providerEntries = useMemo(
    () => Object.entries(providerStatus || {}),
    [providerStatus]
  );

  const kpiCards = useMemo(() => {
    const total = kpis?.total_vms ?? null;
    const poweredOn = kpis?.powered_on ?? null;
    const poweredOff = kpis?.powered_off ?? null;
    const totalHosts = kpis?.total_hosts ?? null;
    const avgCpu = kpis?.avg_cpu_usage_pct ?? null;
    const avgRam = kpis?.avg_ram_usage_pct ?? null;
    const providersLabel =
      kpis?.providers_included?.length
        ? kpis.providers_included.map((key) => missionControlProviderLabels[key] || key).join(" · ")
        : "—";
    const onPct = total ? (poweredOn / total) * 100 : null;
    const offPct = total ? (poweredOff / total) * 100 : null;

    return [
      {
        id: "kpi-total-vms",
        label: "Total VMs",
        value: total,
        tone: "emerald",
        format: "number",
        note: `Providers: ${providersLabel}`,
      },
      {
        id: "kpi-on",
        label: "Encendidas",
        value: poweredOn,
        tone: "cyan",
        format: "number",
        note: onPct != null ? `${onPct.toFixed(1)}% del total` : "—",
      },
      {
        id: "kpi-off",
        label: "Apagadas",
        value: poweredOff,
        tone: "slate",
        format: "number",
        note: offPct != null ? `${offPct.toFixed(1)}% del total` : "—",
      },
      {
        id: "kpi-hosts",
        label: "Hosts totales",
        value: totalHosts,
        tone: "amber",
        format: "number",
        note: totalHosts == null ? "Snapshot de hosts no disponible" : "VMware + oVirt + Hyper-V",
      },
      {
        id: "kpi-cpu",
        label: "CPU promedio",
        value: avgCpu,
        tone: "indigo",
        format: "percent",
        note: "Sobre VMs con metricas",
      },
      {
        id: "kpi-ram",
        label: "RAM promedio",
        value: avgRam,
        tone: "rose",
        format: "percent",
        note: "Sobre VMs con metricas",
      },
    ];
  }, [kpis]);

  return (
    <div className="mc-root">
      <Motion.div className="mc-shell" variants={containerVariants} initial="hidden" animate="show">
        <Motion.header className="mc-header" variants={itemVariants}>
          <div>
            <div className="mc-title">Mission Control</div>
            <div className="mc-subtitle">Vista ejecutiva en tiempo real para demos.</div>
          </div>
          <div className="mc-badges">
            <span className="mc-badge mc-badge-live">Live</span>
            <span className="mc-badge mc-badge-demo">Demo Mode</span>
          </div>
        </Motion.header>

        <Motion.div className="mc-status-row" variants={itemVariants}>
          <div className="mc-status-left">
            {loading ? (
              <span className="mc-status-text">Conectando fuentes...</span>
            ) : errorSummary ? (
              <span className="mc-status-text mc-status-warn">{errorSummary}</span>
            ) : (
              <span className="mc-status-text">Fuentes activas</span>
            )}
          </div>
          <div className="mc-status-pills">
            {providerEntries.map(([provider, status]) => {
              const label = missionControlProviderLabels[provider] || provider;
              const isError = Boolean(status?.errorMessage);
              const isEmpty = Boolean(status?.empty);
              const isStale = Boolean(status?.stale);
              const count = Number.isFinite(status?.vmCount) ? status.vmCount : null;
              const tone = isError ? "mc-pill-error" : isEmpty ? "mc-pill-empty" : isStale ? "mc-pill-stale" : "mc-pill-ok";
              const detail = isError ? "sin datos" : isEmpty ? "sin snapshot" : isStale ? "stale" : "ok";
              const countLabel = count != null ? ` (${count})` : "";
              return (
                <span key={provider} className={`mc-pill ${tone}`} title={status?.errorMessage || ""}>
                  {label}: {detail}{countLabel}
                </span>
              );
            })}
          </div>
        </Motion.div>

        <Motion.div variants={itemVariants}>
          <KpiStrip kpis={kpiCards} loading={loading} />
        </Motion.div>

        <Motion.div className="mc-snapshot-row" variants={itemVariants}>
          {providerEntries.map(([provider, status]) => {
            const meta = providerMeta?.[provider] || {};
            const label = missionControlProviderLabels[provider] || provider;
            const timeLabel = formatSnapshotTime(meta.generated_at);
            const staleLabel = status?.stale ? "stale" : meta?.source || "—";
            return (
              <span key={provider} className="mc-snapshot-pill">
                {label} {timeLabel} · {staleLabel}
              </span>
            );
          })}
        </Motion.div>

        <Motion.section className="mc-provider-section" variants={itemVariants}>
          <ProviderOverview
            vms={vms}
            hosts={hosts}
            providerMeta={providerMeta}
            providerStatus={providerStatus}
          />
        </Motion.section>
      </Motion.div>
    </div>
  );
}
