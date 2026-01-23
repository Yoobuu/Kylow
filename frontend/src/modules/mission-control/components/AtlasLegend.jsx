export default function AtlasLegend() {
  return (
    <div className="mc-legend">
      <div className="mc-legend-title">Legend</div>
      <div className="mc-legend-section">
        <div className="mc-legend-label">Tipos</div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-env" /> Env
        </div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-provider" /> Provider
        </div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-cluster" /> Cluster
        </div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-host" /> Host
        </div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-vm" /> VM
        </div>
      </div>
      <div className="mc-legend-section">
        <div className="mc-legend-label">Estados</div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-on" /> Powered ON
        </div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-off" /> Powered OFF
        </div>
        <div className="mc-legend-row">
          <span className="mc-legend-dot mc-dot-hot" /> High load (≥85%)
        </div>
      </div>
      <div className="mc-legend-section">
        <div className="mc-legend-label">LOD</div>
        <div className="mc-legend-row">Far &lt; 0.9</div>
        <div className="mc-legend-row">Mid 0.9–2.2</div>
        <div className="mc-legend-row">Near &gt; 2.2</div>
      </div>
    </div>
  );
}
