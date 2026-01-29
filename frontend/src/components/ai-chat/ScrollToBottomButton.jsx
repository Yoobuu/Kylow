export default function ScrollToBottomButton({ unreadCount, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group pointer-events-auto inline-flex items-center gap-2 rounded-pill border border-usfq-red/30 bg-usfq-white px-3 py-2 text-xs font-semibold text-usfq-red shadow-soft transition hover:border-usfq-red/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30"
      aria-label="Volver al final"
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-usfq-red/10 text-usfq-red">
        ↓
      </span>
      <span>Volver al final</span>
      {unreadCount > 0 && (
        <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-pill bg-usfq-red text-[10px] font-bold text-usfq-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
