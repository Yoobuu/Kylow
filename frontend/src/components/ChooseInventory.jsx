import { useNavigate } from "react-router-dom";

const CARDS = [
  { key: "vcenter", title: "VMware vCenter", desc: "Inventario existente", to: "/", tone: "bg-emerald-600", glow: "group-hover:shadow-emerald-500/50" },
  { key: "hyperv",  title: "Microsoft Hyper-V", desc: "Pantalla vacía temporal", to: "/hyperv", tone: "bg-blue-600", glow: "group-hover:shadow-blue-500/50" },
  { key: "kvm",     title: "KVM / Libvirt",   desc: "Pantalla vacía temporal", to: "/kvm", tone: "bg-neutral-800", glow: "group-hover:shadow-neutral-500/40" },
];

export default function ChooseInventory() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full bg-black text-white relative">
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
          <h1 className="text-3xl font-semibold mb-10 text-center">
            Selecciona el inventario
          </h1>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {CARDS.map((c) => (
              <button
                key={c.key}
                onClick={() => navigate(c.to)}
                className={`group relative rounded-3xl border border-white/10 bg-neutral-900/60 p-6 text-left shadow-xl backdrop-blur transition hover:scale-[1.02] hover:border-white/20 hover:shadow-2xl ${c.glow}`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`h-10 w-10 rounded-xl ${c.tone}`} />
                  <div>
                    <h2 className="text-lg font-medium">{c.title}</h2>
                    <p className="text-sm text-neutral-400">{c.desc}</p>
                  </div>
                </div>
                <div className="mt-4 text-sm font-medium text-white/80 group-hover:underline">
                  Ingresar →
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
