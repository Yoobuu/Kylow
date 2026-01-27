export default function NotificationsComingSoon() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center text-center">
      <div className="rounded-3xl border border-[#E1D6C8] bg-[#FAF3E9] px-6 py-10 shadow-lg sm:px-10">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#E11B22]/10 text-2xl font-semibold text-[#E11B22]">
          WIP
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-[#E11B22]">Notificaciones en construccion</h1>
        <p className="mt-3 text-sm text-[#3b3b3b] sm:text-base">
          Estamos trabajando en esta seccion. Muy pronto podras ver y gestionar alertas desde aqui.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="relative">
            <span className="absolute inline-flex h-10 w-10 animate-ping rounded-full bg-[#E11B22]/20" />
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#E11B22] text-white shadow">
              1
            </span>
          </div>
          <div className="relative">
            <span className="absolute inline-flex h-10 w-10 animate-ping rounded-full bg-[#E11B22]/20 [animation-delay:200ms]" />
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#E11B22] text-white shadow">
              2
            </span>
          </div>
          <div className="relative">
            <span className="absolute inline-flex h-10 w-10 animate-ping rounded-full bg-[#E11B22]/20 [animation-delay:400ms]" />
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#E11B22] text-white shadow">
              3
            </span>
          </div>
        </div>
        <p className="mt-6 text-xs uppercase tracking-[0.3em] text-[#E11B22]">Proximamente</p>
      </div>
    </section>
  );
}
