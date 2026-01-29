import MessageBubble from "./MessageBubble";

const EMPTY_SUGGESTIONS = [
  {
    title: "Inventario",
    description: "Resumen del inventario actual por proveedor.",
    prompt: "Dame un resumen del inventario actual por proveedor.",
  },
  {
    title: "Hosts",
    description: "Hosts con alertas críticas o recursos altos.",
    prompt: "¿Qué hosts tienen alertas críticas o recursos altos hoy?",
  },
  {
    title: "Avisos",
    description: "Notificaciones recientes relevantes.",
    prompt: "Muéstrame las notificaciones más relevantes de hoy.",
  },
  {
    title: "Auditoría",
    description: "Cambios o eventos recientes destacados.",
    prompt: "¿Qué cambios recientes aparecen en auditoría?",
  },
  {
    title: "Usuarios",
    description: "Usuarios con acceso pendiente o cambios.",
    prompt: "¿Hay usuarios con acceso pendiente o cambios recientes?",
  },
  {
    title: "Sistema",
    description: "Estado general y recomendaciones rápidas.",
    prompt: "Dame el estado general del sistema y recomendaciones rápidas.",
  },
];

export default function MessageList({
  messages,
  listRef,
  onCopy,
  onRegenerate,
  onFeedback,
  onEdit,
  onRetry,
  onActionNavigate,
  onPromptSelect,
  lastUserMessageId,
  copiedMessageId,
  feedbackById,
  isGenerating,
}) {
  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto px-4 py-4"
      role="log"
      aria-live="off"
      aria-relevant="additions"
      aria-busy={isGenerating}
    >
      {messages.length === 0 ? (
        <div className="flex h-full flex-col gap-6 rounded-card border border-[#E1D6C8] bg-[#FAF3E9] p-6 shadow-soft">
          <div>
            <h3 className="font-usfqTitle text-2xl text-usfq-black">
              Hola, soy <span className="font-brand">KYLOW</span>.
            </h3>
            <p className="mt-2 text-body text-usfq-gray">
              Pregúntame sobre inventario, hosts o notificaciones. También puedo darte detalles específicos y resúmenes
              rápidos.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {EMPTY_SUGGESTIONS.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => onPromptSelect(item.prompt)}
                className="flex flex-col gap-3 rounded-card border border-[#E1D6C8] bg-white p-4 text-left text-sm shadow-soft transition hover:border-usfq-red/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30"
              >
                <span className="text-xs uppercase tracking-[0.2em] text-usfq-gray">{item.title}</span>
                <span className="font-semibold text-usfq-black">{item.prompt}</span>
                <span className="text-xs text-usfq-gray">{item.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        messages.map((message, index) => {
          const prev = messages[index - 1];
          const next = messages[index + 1];
          const isGroupedWithPrev = prev && prev.role === message.role;
          const isGroupedWithNext = next && next.role === message.role;
          return (
            <MessageBubble
              key={message.id}
              message={message}
              isGroupedWithPrev={isGroupedWithPrev}
              isGroupedWithNext={isGroupedWithNext}
              showAvatar={!isGroupedWithPrev}
              isLastUserMessage={message.id === lastUserMessageId}
              isCopied={copiedMessageId === message.id}
              feedback={feedbackById[message.id]}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              onFeedback={onFeedback}
              onEdit={onEdit}
              onRetry={onRetry}
              onActionNavigate={onActionNavigate}
            />
          );
        })
      )}
    </div>
  );
}
