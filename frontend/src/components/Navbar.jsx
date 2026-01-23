import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const links = [];
  if (
    hasPermission("vms.view") ||
    hasPermission("hyperv.view") ||
    hasPermission("cedia.view") ||
    hasPermission("azure.view")
  ) {
    links.push({ to: "/choose", label: "Inventarios" });
  }
  if (hasPermission("vms.view")) links.push({ to: "/mission-control", label: "Mission Control" });
  if (hasPermission("notifications.view")) links.push({ to: "/notifications", label: "Notificaciones" });
  if (hasPermission("audit.view")) links.push({ to: "/audit", label: "Auditoría" });
  if (hasPermission("users.manage")) links.push({ to: "/users", label: "Usuarios" });
  if (hasPermission("system.settings.view")) links.push({ to: "/system", label: "Sistema" });

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-neutral-950/80 backdrop-blur text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white/10 px-3 py-1 text-sm font-semibold text-white">Inventario DC</div>
          <div className="hidden h-6 w-px bg-white/10 sm:block" />
          <div className="flex flex-wrap items-center gap-2">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => {
                  const isCurrent =
                    isActive || (link.to !== "/" && location.pathname.startsWith(link.to));
                  return [
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm",
                    isCurrent
                      ? "bg-white text-neutral-900 shadow"
                      : "bg-white/5 text-neutral-200 hover:bg-white/10",
                  ].join(" ");
                }}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {user && <div className="text-xs font-medium text-white sm:text-sm">{user.username}</div>}
          <button
            onClick={handleLogout}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 sm:text-sm"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );
}
