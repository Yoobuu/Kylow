import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { IoShieldSharp, IoArrowBackSharp, IoMailSharp } from "react-icons/io5";

export default function AccessDenied({ title = "Acceso denegado" }) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[70vh] w-full flex-col items-center justify-center px-6 py-12 text-[#231F20]">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="flex w-full max-w-lg flex-col items-center text-center"
      >
        {/* Icono de escudo */}
        <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-[#FAF3E9] text-[#E11B22] shadow-sm ring-1 ring-[#E1D6C8]">
          <IoShieldSharp className="text-5xl" />
        </div>
        
        {/* Título Principal */}
        <h1 className="font-usfqTitle text-4xl font-bold tracking-tight text-[#E11B22] sm:text-5xl">
          {title}
        </h1>
        
        {/* Descripción Detallada */}
        <div className="mt-6 space-y-4">
          <p className="text-lg font-medium text-[#3b3b3b]">
            Lo sentimos, tu cuenta no tiene privilegios suficientes.
          </p>
          <div className="mx-auto max-w-sm rounded-xl border border-[#E1D6C8] bg-[#FAF3E9]/50 p-6">
            <p className="text-sm font-semibold text-[#6b6b6b] leading-relaxed italic">
              No tienes los permisos necesarios para acceder a esta sección.
            </p>
            
            <a 
              href="mailto:cramosm@usfq.edu.ec"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-[#E11B22] border border-[#E1D6C8] shadow-sm transition-all hover:bg-[#FAF3E9] hover:border-[#E11B22]"
            >
              <IoMailSharp className="text-sm" />
              Solicitar permisos por correo
            </a>
          </div>
        </div>

        {/* Acción de Retorno */}
        <div className="mt-12 flex flex-col items-center gap-6">
          <button
            onClick={() => navigate("/choose")}
            className="group flex items-center gap-2 rounded-full bg-[#E11B22] px-10 py-4 text-xs font-bold uppercase tracking-widest text-white shadow-xl shadow-red-100 transition-all hover:bg-[#c9161c] hover:shadow-2xl active:scale-95"
          >
            <IoArrowBackSharp className="text-base transition-transform group-hover:-translate-x-1" />
            Volver al Portal de Inventarios
          </button>
          
          <div className="h-px w-16 bg-[#E1D6C8]" />
          
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#939598]">
            KYLOW &middot; v1.00
          </p>
        </div>
      </motion.div>
    </div>
  );
}
