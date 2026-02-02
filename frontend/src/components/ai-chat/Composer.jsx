import { useLayoutEffect, useRef } from "react";

const MAX_ROWS = 6;

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  isEditing,
  canSend,
  inputRef,
  placeholder = "Escribe una pregunta...",
  disabled = false,
}) {
  const localRef = useRef(null);
  const textareaRef = inputRef || localRef;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight) || 22;
    const maxHeight = lineHeight * MAX_ROWS;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  const handleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="rounded-card border border-[#E1D6C8] bg-white shadow-soft">
      <div className="flex items-end gap-3 p-4">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              if (disabled) return;
              onChange(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full resize-none bg-transparent text-body text-usfq-black placeholder:text-usfq-gray/70 outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Escribe tu mensaje"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-usfq-gray">
            <span>Enter para enviar · Shift+Enter para nueva línea</span>
            {isEditing && (
              <span className="rounded-pill border border-usfq-red/20 bg-usfq-red/10 px-2 py-0.5 text-[10px] font-semibold text-usfq-red">
                Editando último mensaje
              </span>
            )}
            {isGenerating && (
              <span className="text-[10px] uppercase tracking-[0.2em] text-usfq-gray">
                Generando…
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={isGenerating ? onStop : onSend}
          disabled={disabled || (!isGenerating && !canSend)}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/40 disabled:cursor-not-allowed disabled:opacity-60 ${
            isGenerating
              ? "border-usfq-red/50 bg-usfq-red/10 text-usfq-red hover:bg-usfq-red/20"
              : "border-usfq-red bg-usfq-red text-usfq-white hover:bg-usfq-red/90"
          }`}
          aria-label={isGenerating ? "Detener respuesta" : "Enviar mensaje"}
        >
          {isGenerating ? (
            <span className="text-lg leading-none">■</span>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                d="M4.5 12h15m0 0-6-6m6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
