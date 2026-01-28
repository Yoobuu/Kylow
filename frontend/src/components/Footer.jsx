import { FaLinkedin, FaEnvelope } from "react-icons/fa";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-[#E1D6C8] bg-white py-8 text-[#231F20]">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          
          {/* Lado Izquierdo: Branding */}
          <div className="flex flex-col items-center md:items-start">
            <div className="flex items-center gap-2">
              <span className="font-brand text-xl font-semibold tracking-tighter text-[#E11B22]">KYLOW</span>
              <span className="text-xs font-bold uppercase tracking-widest text-[#6b6b6b] ml-2">Inventario DC · v1.00</span>
            </div>
            <p className="mt-2 text-xs text-[#939598]">
              © {currentYear} Universidad San Francisco de Quito. Todos los derechos reservados.
            </p>
          </div>

          {/* Centro: Soporte y Contacto */}
          <div className="flex flex-col items-center text-center">
            <p className="text-sm font-medium text-[#3b3b3b]">
              ¿Necesitas ayuda o reportar un problema?
            </p>
            <a 
              href="mailto:cramosm@usfq.edu.ec" 
              className="mt-1 flex items-center gap-2 text-sm font-bold text-[#E11B22] transition-colors hover:text-[#c9161c]"
            >
              <FaEnvelope className="text-xs" />
              Soporte Técnico
            </a>
          </div>

          {/* Lado Derecho: Créditos */}
          <div className="flex flex-col items-center md:items-end">
            <p className="text-xs font-medium text-[#6b6b6b]">Desarrollado por</p>
            <a
              href="https://www.linkedin.com/in/paulo-cantos-riera-7658a9206/"
              target="_blank"
              rel="noreferrer"
              className="group mt-1 flex items-center gap-2 text-sm font-bold text-[#231F20] transition-colors hover:text-[#E11B22]"
            >
              Paulo Cantos
              <FaLinkedin className="text-lg text-[#0077B5] transition-transform group-hover:scale-110" />
            </a>
          </div>

        </div>
      </div>
    </footer>
  );
}
