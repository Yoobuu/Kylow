import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ENVIRONMENTS = [
  {
    key: "esxi",
    title: "ESXi / vCenter",
    desc: "Inventario VMware clásico.",
    tone: "from-emerald-500 via-emerald-600 to-emerald-700",
    actions: [
      { label: "Ver VMs", to: "/vmware?view=vms", permission: "vms.view" },
      { label: "Ver Hosts", to: "/vmware?view=hosts", permission: "vms.view" },
    ],
  },
  {
    key: "hyperv",
    title: "Microsoft Hyper-V",
    desc: "Inventario y estado de Hyper-V.",
    tone: "from-blue-500 via-blue-600 to-indigo-600",
    actions: [
      { label: "Ver VMs", to: "/hyperv?view=vms", permission: "hyperv.view" },
      { label: "Ver Hosts", to: "/hyperv?view=hosts", permission: "hyperv.view" },
    ],
  },
  {
    key: "kvm",
    title: "KVM / Libvirt",
    desc: "Inventario KVM (piloto).",
    tone: "from-neutral-700 via-neutral-800 to-black",
    actions: [
      { label: "Ver VMs", to: "/kvm?view=vms", permission: "vms.view" },
      { label: "Ver Hosts", to: "/kvm?view=hosts", permission: "vms.view" },
    ],
  },
  {
    key: "cedia",
    title: "CEDIA Cloud",
    desc: "Inventario de VMs en CEDIA (vCloud).",
    tone: "from-teal-500 via-teal-600 to-cyan-600",
    actions: [{ label: "Ver VMs", to: "/cedia", permission: "cedia.view" }],
  },
  {
    key: "azure",
    title: "Microsoft Azure",
    desc: "Inventario de VMs en Azure (ARM).",
    tone: "from-sky-500 via-blue-600 to-indigo-700",
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

  return (
    <div className="relative min-h-full w-full bg-black text-white">
      {/* Fondo de cuadrícula sutil */}
      <div className="pointer-events-none fixed inset-0 opacity-20" aria-hidden>
        <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-6xl">
          <h1
            className="mb-10 text-center text-3xl font-semibold"
            data-tutorial-id="choose-title"
          >
            Selecciona el inventario
          </h1>

          {visibleEnvs.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-6 text-center text-sm text-neutral-200 shadow-xl">
              No tienes permisos para ver inventarios. Solicita acceso a un administrador.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2" data-tutorial-id="choose-grid">
              {visibleEnvs.map((env) => (
                <div
                  key={env.key}
                  data-tutorial-id={`choose-card-${env.key}`}
                  className="group relative overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/60 p-6 text-left shadow-xl backdrop-blur transition hover:scale-[1.01] hover:border-white/20 hover:shadow-2xl"
                >
                  <div className={`absolute inset-0 opacity-60 blur-2xl bg-gradient-to-r ${env.tone}`} aria-hidden />
                  <div className="relative flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-2xl bg-white/10 ring-2 ring-white/20" />
                      <div>
                        <h2 className="text-lg font-semibold">{env.title}</h2>
                        <p className="text-sm text-neutral-300">{env.desc}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2" data-tutorial-id={`choose-actions-${env.key}`}>
                      {env.actions.map((action) => (
                        <button
                          key={action.to}
                          type="button"
                          onClick={() => navigate(action.to)}
                          className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/15"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
