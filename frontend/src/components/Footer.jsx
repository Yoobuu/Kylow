export default function Footer() {
  return (
    <footer className="border-t border-white/10 border-usfq-white/10 bg-[#231F20] bg-usfq-black text-[#E1E1E1] text-usfq-grayLight">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 text-xs sm:flex-row sm:items-center sm:justify-between sm:text-sm">
        <div>
          <span className="font-semibold">Inventario DC</span> · Universidad San Francisco de Quito
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <span>Versión beta · {new Date().getFullYear()}</span>
          <a
            className="text-[#E1E1E1] text-usfq-grayLight transition hover:text-white hover:text-usfq-white"
            href="mailto:ti-inventario@usfq.edu.ec"
          >
            Soporte: ti-inventario@usfq.edu.ec
          </a>
        </div>
      </div>
    </footer>
  );
}
