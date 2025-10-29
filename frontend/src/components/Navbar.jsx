// src/components/Navbar.jsx
import { Link } from "react-router-dom";

export default function Navbar({ onLogout }) {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-neutral-900/80 backdrop-blur text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        
        {/* Logo + volver */}
        <div className="flex items-center gap-4">
          <Link
            to="/choose"
            className="rounded-xl bg-blue-600/90 px-4 py-2 text-sm font-medium shadow hover:bg-blue-500/90 transition"
          >
            ← Inventarios
          </Link>
        </div>

        {/* Cerrar sesión */}
        <div>
          <button
            onClick={onLogout}
            className="rounded-xl bg-red-600/90 px-4 py-2 text-sm font-medium shadow hover:bg-red-500/90 transition"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );
}
