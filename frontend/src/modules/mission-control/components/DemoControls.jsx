export default function DemoControls({ enabled, nowShowingText, onToggle, onReset }) {
  return (
    <div className="mc-demo-controls">
      <button
        type="button"
        onClick={onToggle}
        className={`mc-demo-button ${enabled ? "is-active" : ""}`}
      >
        {enabled ? "Demo activo" : "Demo"}
      </button>
      <div className="mc-demo-now">
        <span className="mc-demo-live" aria-hidden="true" />
        <span>{nowShowingText || "Now showing: Mission Control"}</span>
      </div>
      {onReset && (
        <button type="button" onClick={onReset} className="mc-demo-reset">
          Reset view
        </button>
      )}
    </div>
  );
}
