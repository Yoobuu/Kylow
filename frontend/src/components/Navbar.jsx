import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const navigate = useNavigate();
  const { user, logout, isSuperadmin } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-neutral-900/80 backdrop-blur text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/choose"
            className="rounded-xl bg-blue-600/90 px-4 py-2 text-sm font-medium shadow transition hover:bg-blue-500/90"
          >
            ← Inventarios
          </Link>
          {isSuperadmin && (
            <>
              <Link
                to="/users"
                className="rounded-xl bg-emerald-600/90 px-4 py-2 text-sm font-medium shadow transition hover:bg-emerald-500/90"
              >
                Usuarios
              </Link>
              <Link
                to="/notifications"
                className="rounded-xl bg-indigo-600/90 px-4 py-2 text-sm font-medium shadow transition hover:bg-indigo-500/90"
              >
                Notificaciones
              </Link>
              <Link
                to="/audit"
                className="rounded-xl bg-purple-600/90 px-4 py-2 text-sm font-medium shadow transition hover:bg-purple-500/90"
              >
                Auditoría
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm">
          {user && (
            <div className="text-right text-xs sm:text-sm">
              <div className="font-medium text-white">{user.username}</div>
              <div className="text-neutral-300">{user.role}</div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="rounded-xl bg-red-600/90 px-4 py-2 text-sm font-medium shadow transition hover:bg-red-500/90"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );
}
