import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AccessPending() {
  const navigate = useNavigate();
  const [requested, setRequested] = useState(false);

  return (
    <main className="min-h-dvh w-full bg-neutral-950 text-white flex items-center justify-center px-6 py-16">
      <div className="max-w-md rounded-2xl border border-white/10 bg-neutral-900/80 p-8 text-center shadow-xl">
        <h1 className="text-xl font-semibold">Acceso pendiente</h1>
        <p className="mt-3 text-sm text-neutral-300">
          Tu acceso con Microsoft está en revisión. Cuando sea aprobado podrás iniciar sesión.
        </p>

        <button
          type="button"
          onClick={() => setRequested(true)}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Solicitar acceso
        </button>
        {requested && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            Solicitud enviada (mock)
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mt-6 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/80 transition hover:bg-white/10"
        >
          Volver al login
        </button>
      </div>
    </main>
  );
}
