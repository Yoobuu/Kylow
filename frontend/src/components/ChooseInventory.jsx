import { useNavigate } from "react-router-dom";
import { FaCloud, FaCubes, FaMicrosoft, FaServer, FaWindows } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";

const ENVIRONMENTS = [
  {
    key: "esxi",
    title: "ESXi / vCenter",
    desc: "Inventario VMware clásico.",
    tone: "from-[#FAF3E9] via-white to-[#FAF3E9]",
    icon: FaServer,
    accent: "#E11B22",
    actions: [
      { label: "Ver VMs", to: "/vmware?view=vms", permission: "vms.view" },
      { label: "Ver Hosts", to: "/vmware?view=hosts", permission: "vms.view" },
    ],
  },
  {
    key: "hyperv",
    title: "Microsoft Hyper-V",
    desc: "Inventario y estado de Hyper-V.",
    tone: "from-[#FAF3E9] via-white to-[#FAF3E9]",
    icon: FaWindows,
    accent: "#1F4E8C",
    actions: [
      { label: "Ver VMs", to: "/hyperv?view=vms", permission: "hyperv.view" },
      { label: "Ver Hosts", to: "/hyperv?view=hosts", permission: "hyperv.view" },
    ],
  },
  {
    key: "kvm",
    title: "KVM / Libvirt",
    desc: "Inventario KVM (piloto).",
    tone: "from-[#FAF3E9] via-white to-[#FAF3E9]",
    icon: FaCubes,
    accent: "#1B5E20",
    actions: [
      { label: "Ver VMs", to: "/kvm?view=vms", permission: "vms.view" },
      { label: "Ver Hosts", to: "/kvm?view=hosts", permission: "vms.view" },
    ],
  },
  {
    key: "cedia",
    title: "CEDIA Cloud",
    desc: "Inventario de VMs en CEDIA (vCloud).",
    tone: "from-[#FAF3E9] via-white to-[#FAF3E9]",
    icon: FaCloud,
    accent: "#7A5E00",
    actions: [{ label: "Ver VMs", to: "/cedia", permission: "cedia.view" }],
  },
  {
    key: "azure",
    title: "Microsoft Azure",
    desc: "Inventario de VMs en Azure (ARM).",
    tone: "from-[#FAF3E9] via-white to-[#FAF3E9]",
    icon: FaMicrosoft,
    accent: "#0B3D91",
    actions: [{ label: "Ver VMs", to: "/azure", permission: "azure.view" }],
  },
];

export default function ChooseInventory() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const visibleEnvs = ENVIRONMENTS.map((env) => {
    const allowed = env.actions.filter((a) => !a.permission || hasPermission(a.permission));
    return { ...env, actions: allowed };
  }).filter((env) => env.actions.length > 0);

  const handleCardClick = (env) => {
    const primary = env.actions[0];
    if (primary) {
      navigate(primary.to);
    }
  };

  const handleCardKeyDown = (env) => (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCardClick(env);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-white text-[#231F20]">
      {/* Fondo de cuadrícula sutil */}
      <div className="pointer-events-none fixed inset-0 opacity-[0.06]" aria-hidden>
        <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#231F20" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative flex min-h-screen items-start justify-center px-4 pt-10 pb-6">
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col justify-center">
          <div className="mb-10 text-center space-y-2" data-tutorial-id="choose-title">
            <h1 className="text-[clamp(1.6rem,2.6vw,2.8rem)] font-usfqTitle font-semibold text-[#E11B22]">
              Selecciona el inventario
            </h1>
            <p className="text-[clamp(0.75rem,1vw,0.95rem)] font-usfqBody text-[#3b3b3b]">
              Elige la plataforma para continuar con el inventario de VMs y hosts.
            </p>
          </div>

          {visibleEnvs.length === 0 ? (
            <div className="rounded-3xl border border-[#E1D6C8] bg-[#FAF3E9] p-6 text-center text-sm text-[#3b3b3b] shadow-xl">
              No tienes permisos para ver inventarios. Solicita acceso a un administrador.
            </div>
          ) : (
            <>
              <div
                className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5"
                data-tutorial-id="choose-grid"
              >
                {visibleEnvs.map((env) => (
                  <div
                    key={env.key}
                    data-tutorial-id={`choose-card-${env.key}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(env)}
                    onKeyDown={handleCardKeyDown(env)}
                    className="group relative overflow-hidden rounded-2xl border border-[#E1D6C8] bg-white p-[clamp(0.8rem,1.2vw,1.25rem)] text-left shadow-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E11B22]/40 hover:[transform:translateY(-4px)_rotate(0.4deg)] hover:border-[#E11B22]/40 hover:shadow-xl"
                  >
                    <div className={`absolute inset-0 opacity-70 blur-2xl bg-gradient-to-r ${env.tone}`} aria-hidden />
                    <div className="relative flex h-full flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-[clamp(2.5rem,4vw,3.5rem)] w-[clamp(2.5rem,4vw,3.5rem)] items-center justify-center rounded-2xl bg-[#FAF3E9] ring-2 ring-[#E1D6C8]"
                          style={{ color: env.accent }}
                        >
                          {env.icon ? <env.icon className="text-[clamp(1.4rem,2.2vw,2rem)]" /> : null}
                        </div>
                        <div>
                          <h2 className="text-[clamp(0.95rem,1.4vw,1.2rem)] font-semibold text-[#E11B22]">
                            {env.title}
                          </h2>
                          <p className="text-[clamp(0.7rem,1vw,0.9rem)] text-[#3b3b3b]">{env.desc}</p>
                        </div>
                      </div>
                    <div
                      className="flex flex-wrap gap-2 transition-all md:opacity-0 md:translate-y-1 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:translate-y-0 md:group-hover:pointer-events-auto"
                      data-tutorial-id={`choose-actions-${env.key}`}
                    >
                      {env.actions.map((action) => (
                        <button
                          key={action.to}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(action.to);
                          }}
                          className="rounded-xl border border-[#D6C7B8] bg-white px-[clamp(0.6rem,1vw,0.9rem)] py-[clamp(0.3rem,0.6vw,0.5rem)] text-[clamp(0.7rem,0.95vw,0.9rem)] font-semibold text-[#E11B22] transition hover:border-[#E11B22] hover:bg-[#FAF3E9]"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] px-4 py-3 text-center text-[clamp(0.7rem,0.95vw,0.9rem)] text-[#3b3b3b]">
                Plataformas disponibles: <span className="font-semibold text-[#231F20]">{visibleEnvs.length}</span> ·
                Acceso basado en permisos del usuario.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
