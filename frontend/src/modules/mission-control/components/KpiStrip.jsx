import { motion as Motion } from "framer-motion";

const stripVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const formatNumber = (value) => {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("en-US").format(value);
};

const formatPercent = (value, decimals = 1) => {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(decimals)}%`;
};

export default function KpiStrip({ kpis = [], loading = false }) {
  return (
    <Motion.div className="mc-kpi-strip" variants={stripVariants} initial="hidden" animate="show">
      {kpis.map((kpi) => {
        const tone = kpi.tone ? `mc-kpi-${kpi.tone}` : "mc-kpi-default";
        const valueNode = loading ? (
          <div className="mc-skeleton mc-skeleton-lg" />
        ) : kpi.format === "percent" ? (
          <div className="mc-kpi-value">{formatPercent(kpi.value, kpi.decimals)}</div>
        ) : (
          <div className="mc-kpi-value">{formatNumber(kpi.value)}</div>
        );

        return (
          <Motion.div key={kpi.id} className={`mc-kpi-card ${tone}`} variants={cardVariants}>
            <div className="mc-kpi-label">{kpi.label}</div>
            {valueNode}
            <div className="mc-kpi-meta">{kpi.note}</div>
          </Motion.div>
        );
      })}
    </Motion.div>
  );
}
