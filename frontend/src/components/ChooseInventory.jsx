import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FaCloud, FaCubes, FaMicrosoft, FaServer, FaWindows, FaArrowRight, FaComments } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";

const ENVIRONMENTS = [
  {
    key: "esxi",
    title: "ESXi / vCenter",
    desc: "Infraestructura virtual centralizada.",
    icon: FaServer,
    accent: "text-[#E11B22]", // USFQ Red
    bgHover: "group-hover:bg-[#E11B22]/5",
    actions: [
      { label: "Ver VMs", to: "/vmware?view=vms", permission: "vms.view" },
      { label: "Ver Hosts", to: "/vmware?view=hosts", permission: "vms.view" },
    ],
  },
  {
    key: "hyperv",
    title: "Hyper-V",
    desc: "Virtualización Microsoft en sitio.",
    icon: FaWindows,
    accent: "text-[#1F4E8C]", // Blue
    bgHover: "group-hover:bg-[#1F4E8C]/5",
    actions: [
      { label: "Ver VMs", to: "/hyperv?view=vms", permission: "hyperv.view" },
      { label: "Ver Hosts", to: "/hyperv?view=hosts", permission: "hyperv.view" },
    ],
  },
  {
    key: "kvm",
    title: "KVM",
    desc: "Infraestructura de virtualización KVM.",
    icon: FaCubes,
    accent: "text-[#1B5E20]", // Green
    bgHover: "group-hover:bg-[#1B5E20]/5",
    actions: [
      { label: "Ver VMs", to: "/kvm?view=vms", permission: "vms.view" },
      { label: "Ver Hosts", to: "/kvm?view=hosts", permission: "vms.view" },
    ],
  },
  {
    key: "cedia",
    title: "CEDIA Cloud",
    desc: "Recursos externos vCloud Director.",
    icon: FaCloud,
    accent: "text-[#7A5E00]", // Gold/Dark Yellow
    bgHover: "group-hover:bg-[#7A5E00]/5",
    actions: [{ label: "Explorar", to: "/cedia", permission: "cedia.view" }],
  },
  {
    key: "azure",
    title: "Azure",
    desc: "Nube pública Microsoft.",
    icon: FaMicrosoft,
    accent: "text-[#0078D4]", // Azure Blue
    bgHover: "group-hover:bg-[#0078D4]/5",
    actions: [{ label: "Explorar", to: "/azure", permission: "azure.view" }],
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export default function ChooseInventory() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canUseAi = hasPermission("ai.chat");

  const visibleEnvs = ENVIRONMENTS.map((env) => {
    const allowed = env.actions.filter((a) => !a.permission || hasPermission(a.permission));
    return { ...env, actions: allowed };
  }).filter((env) => env.actions.length > 0);

  const handleAction = (event, to) => {
    event.stopPropagation();
    navigate(to);
  };

  return (
    <div className="min-h-screen w-full bg-[#FAF3E9] text-[#231F20] font-usfqBody">
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-6 py-12 lg:px-8">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center"
          data-tutorial-id="choose-title"
        >
          <div className="mx-auto mb-6 h-1 w-24 rounded-full bg-[#E11B22]" />
          <h1 className="font-usfqTitle text-4xl font-bold tracking-tight text-[#E11B22] sm:text-5xl lg:text-6xl">
            Inventario Centralizado
          </h1>
          <p className="mt-4 text-lg text-[#3b3b3b] sm:text-xl">
            Selecciona una plataforma para gestionar tus recursos virtuales.
          </p>
        </motion.div>

        {canUseAi && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-10 flex flex-col items-start justify-between gap-6 rounded-3xl border border-[#E1D6C8] bg-white/80 p-6 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FAF3E9] text-2xl text-[#E11B22]">
                <FaComments />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Asistente IA</p>
                <h2 className="mt-1 text-2xl font-semibold text-[#231F20]">
                  Habla con <span className="font-brand">KYLOW</span>
                </h2>
                <p className="mt-2 text-sm text-[#6b6b6b]">
                  Consultas rápidas sobre inventario, hosts, avisos y auditoría sin salir del portal.
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate("/ai")}
              className="rounded-2xl border border-[#E11B22] bg-[#E11B22] px-5 py-2 text-xs font-semibold uppercase tracking-widest text-white transition hover:bg-[#c9161c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11B22]/40"
            >
              Abrir KYLOW
            </button>
          </motion.div>
        )}

        {/* Cards Grid */}
        {visibleEnvs.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-[#E1D6C8] bg-white p-8 text-center shadow-lg"
          >
            <p className="text-lg text-[#3b3b3b]">
              No tienes permisos para visualizar ningún inventario.
              <br />
              <span className="text-sm opacity-80">Contacta al administrador del sistema.</span>
            </p>
          </motion.div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
            data-tutorial-id="choose-grid"
          >
            {visibleEnvs.map((env) => (
              <motion.div
                key={env.key}
                variants={cardVariants}
                className={`group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-[#E1D6C8] bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#E11B22]/30 hover:shadow-xl ${env.bgHover}`}
                onClick={() => navigate(env.actions[0]?.to)}
                role="button"
                tabIndex={0}
                data-tutorial-id={`choose-card-${env.key}`}
              >
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FAF3E9] text-2xl ${env.accent}`}>
                      <env.icon />
                    </div>
                    <div className="opacity-0 transition-opacity group-hover:opacity-100">
                      <FaArrowRight className={`text-sm ${env.accent}`} />
                    </div>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-[#231F20] group-hover:text-[#E11B22] transition-colors">
                    {env.title}
                  </h3>
                  <p className="text-sm text-[#6b6b6b] leading-relaxed">
                    {env.desc}
                  </p>
                </div>

                <div 
                  className="mt-6 flex flex-wrap gap-2"
                  data-tutorial-id={`choose-actions-${env.key}`}
                >
                  {env.actions.map((action) => (
                    <button
                      key={action.to}
                      onClick={(e) => handleAction(e, action.to)}
                      className="z-10 rounded-lg border border-[#D6C7B8] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#231F20] transition-colors hover:border-[#E11B22] hover:bg-[#E11B22] hover:text-white"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
