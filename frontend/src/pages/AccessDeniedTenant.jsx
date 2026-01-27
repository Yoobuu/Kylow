import { useNavigate } from "react-router-dom";

export default function AccessDeniedTenant() {
  const navigate = useNavigate();

  return (
    <main className="min-h-dvh w-full bg-neutral-950 text-white flex items-center justify-center px-6 py-16">
      <div className="max-w-md rounded-2xl border border-white/10 bg-neutral-900/80 p-8 text-center shadow-xl">
        <h1 className="text-xl font-semibold">Tenant no permitido</h1>
        <p className="mt-3 text-sm text-neutral-300">
          Tu cuenta Microsoft pertenece a un tenant que no está autorizado para este portal.
          Si crees que es un error, contacta al administrador.
        </p>
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
