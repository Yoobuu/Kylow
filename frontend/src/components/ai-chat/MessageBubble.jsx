import TypingIndicator from "./TypingIndicator";

const statusLabel = (status, aborted) => {
  if (status === "sending") return "Enviando…";
  if (status === "generating") return "Generando…";
  if (status === "error") return "Error";
  if (aborted) return "Detenido";
  return "";
};

export default function MessageBubble({
  message,
  isGroupedWithPrev,
  isGroupedWithNext,
  showAvatar,
  isLastUserMessage,
  isCopied,
  feedback,
  onCopy,
  onRegenerate,
  onFeedback,
  onEdit,
  onRetry,
  onActionNavigate,
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isGenerating = message.status === "generating";
  const showTyping = isAssistant && isGenerating && !message.content;
  const showCursor = isAssistant && isGenerating && message.content;
  const showStatus = message.status === "sending" || message.status === "error" || message.aborted;
  const shouldReveal = message.status === "done" && message.justCompleted;
  const spacingTop = isGroupedWithPrev ? "mt-2" : "mt-6";
  const bubbleTone = isUser
    ? "border-usfq-red/30 bg-usfq-red/10 text-usfq-black"
    : "border-[#E1D6C8] bg-white text-[#231F20]";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"} ${spacingTop}`}>
      {!isUser && (
        <div className={`mr-3 flex h-9 w-9 items-center justify-center rounded-full border border-usfq-red/20 bg-usfq-red/10 text-xs font-semibold text-usfq-red ${
          showAvatar ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!showAvatar}
        >
          KY
        </div>
      )}
      <div className={`group flex max-w-prose flex-col ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`w-full rounded-card border px-4 py-3 text-body shadow-soft transition-all ${bubbleTone} ${
            isGroupedWithPrev && isUser ? "rounded-tr-md" : ""
          } ${isGroupedWithPrev && isAssistant ? "rounded-tl-md" : ""} ${
            isGroupedWithNext && isUser ? "rounded-br-md" : ""
          } ${isGroupedWithNext && isAssistant ? "rounded-bl-md" : ""}`}
          style={shouldReveal ? { animation: "chat-reveal 220ms ease-out" } : undefined}
        >
          {message.title && (
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-usfq-gray">
              {message.title}
            </div>
          )}
          <div className={`whitespace-pre-wrap break-words ${message.status === "error" ? "text-usfq-red" : ""}`}>
            {showTyping ? (
              <TypingIndicator />
            ) : (
              <>
                {message.content}
                {showCursor && (
                  <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-usfq-red/70" aria-hidden="true" />
                )}
              </>
            )}
          </div>
          {message.actions?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.actions.map((action, index) => {
                const isDisabled = !action?.nav;
                return (
                  <button
                    key={`${message.id}-action-${index}`}
                    type="button"
                    onClick={() => {
                      if (!isDisabled) onActionNavigate(action);
                    }}
                    disabled={isDisabled}
                    className={`rounded-pill border px-3 py-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30 ${
                      isDisabled
                        ? "cursor-not-allowed border-usfq-gray/20 bg-usfq-gray/10 text-usfq-gray"
                        : "border-usfq-red/30 bg-usfq-red/10 text-usfq-red hover:border-usfq-red/60"
                    }`}
                  >
                    {action.label || action.type || "Acción"}
                  </button>
                );
              })}
            </div>
          )}
          {message.status === "error" && (
            <button
              type="button"
              onClick={() => onRetry(message)}
              className="mt-3 inline-flex items-center gap-2 rounded-pill border border-usfq-red/30 bg-usfq-red/10 px-3 py-1 text-[11px] font-semibold text-usfq-red transition hover:border-usfq-red/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30"
            >
              Reintentar
            </button>
          )}
        </div>
        <div className={`mt-2 flex flex-wrap items-center gap-2 text-[11px] text-usfq-gray ${
          isUser ? "justify-end" : "justify-start"
        }`}
        >
          {showStatus && (
            <span className="uppercase tracking-[0.2em] text-[10px] text-usfq-gray">
              {statusLabel(message.status, message.aborted)}
            </span>
          )}
          {message.edited && (
            <span className="text-[10px] text-usfq-gray">Editado</span>
          )}
        </div>
        <div
          className={`mt-1 flex items-center gap-2 text-[11px] text-usfq-gray transition ${
            isUser ? "justify-end" : "justify-start"
          } opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}
        >
          {isAssistant && (
            <>
              <button
                type="button"
                onClick={() => onCopy(message)}
                className="rounded-pill border border-usfq-gray/30 px-2 py-1 font-semibold text-usfq-gray transition hover:border-usfq-red/40 hover:text-usfq-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30"
                aria-label="Copiar respuesta"
              >
                {isCopied ? "Copiado" : "Copiar"}
              </button>
              <button
                type="button"
                onClick={() => onRegenerate(message)}
                className="rounded-pill border border-usfq-gray/30 px-2 py-1 font-semibold text-usfq-gray transition hover:border-usfq-red/40 hover:text-usfq-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30"
                aria-label="Regenerar respuesta"
              >
                Regenerar
              </button>
              <button
                type="button"
                onClick={() => onFeedback(message, "up")}
                className={`rounded-pill border px-2 py-1 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30 ${
                  feedback === "up"
                    ? "border-usfq-red/60 bg-usfq-red/10 text-usfq-red"
                    : "border-usfq-gray/30 text-usfq-gray hover:border-usfq-red/40 hover:text-usfq-red"
                }`}
                aria-label="Respuesta útil"
              >
                👍
              </button>
              <button
                type="button"
                onClick={() => onFeedback(message, "down")}
                className={`rounded-pill border px-2 py-1 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30 ${
                  feedback === "down"
                    ? "border-usfq-red/60 bg-usfq-red/10 text-usfq-red"
                    : "border-usfq-gray/30 text-usfq-gray hover:border-usfq-red/40 hover:text-usfq-red"
                }`}
                aria-label="Respuesta no útil"
              >
                👎
              </button>
            </>
          )}
          {isUser && isLastUserMessage && (
            <button
              type="button"
              onClick={() => onEdit(message)}
              className="rounded-pill border border-usfq-gray/30 px-2 py-1 font-semibold text-usfq-gray transition hover:border-usfq-red/40 hover:text-usfq-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30"
              aria-label="Editar mensaje"
            >
              Editar
            </button>
          )}
        </div>
      </div>
      {isUser && (
        <div className={`ml-3 flex h-9 w-9 items-center justify-center rounded-full border border-usfq-red/20 bg-usfq-red/10 text-xs font-semibold text-usfq-red ${
          showAvatar ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!showAvatar}
        >
          Tú
        </div>
      )}
    </div>
  );
}
