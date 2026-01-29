import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { motion } from "framer-motion";
import { 
  IoAppsSharp, 
  IoSpeedometerSharp, 
  IoNotificationsSharp, 
  IoChatbubbleEllipsesSharp,
  IoShieldCheckmark, 
  IoPeopleSharp, 
  IoSettingsSharp,
  IoLogOutSharp,
  IoPersonCircleSharp
} from "react-icons/io5";
import logoUsfq from "../assets/images/logo-usfq.svg";

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
    links.push({ to: "/choose", label: "Inventarios", icon: IoAppsSharp });
  }
  if (hasPermission("vms.view")) {
    links.push({ to: "/mission-control", label: "Control", icon: IoSpeedometerSharp });
  }
  if (hasPermission("notifications.view")) {
    links.push({ to: "/notifications", label: "Avisos", icon: IoNotificationsSharp });
  }
  if (hasPermission("ai.chat")) {
    links.push({ to: "/ai", label: "KYLOW", icon: IoChatbubbleEllipsesSharp });
  }
  if (hasPermission("audit.view")) {
    links.push({ to: "/audit", label: "Auditoría", icon: IoShieldCheckmark });
  }
  if (hasPermission("users.manage")) {
    links.push({ to: "/users", label: "Usuarios", icon: IoPeopleSharp });
  }
  if (hasPermission("system.settings.view")) {
    links.push({ to: "/system", label: "Sistema", icon: IoSettingsSharp });
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#E1D6C8] bg-white/80 backdrop-blur-md">
      {/* Línea decorativa superior roja USFQ */}
      <div className="h-1 w-full bg-[#E11B22]" />
      
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6 lg:px-8">
        {/* Lado Izquierdo: Brand */}
        <div className="flex items-center gap-8">
          <NavLink to="/choose" className="flex items-center gap-4 group py-1">
            <img 
              src={logoUsfq} 
              alt="USFQ" 
              className="h-20 w-auto transition-transform group-hover:scale-105 -my-6 drop-shadow-sm" 
            />
            <span className="font-brand text-2xl font-semibold tracking-tighter text-[#231F20] group-hover:text-[#E11B22] transition-colors">
              KYLOW
            </span>
          </NavLink>

          {/* Enlaces de navegación (Desktop) */}
          <div className="hidden lg:flex lg:items-center lg:gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const isCurrent = location.pathname.startsWith(link.to);
              const label = link.label === "KYLOW" ? <span className="font-brand">KYLOW</span> : link.label;
              
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                    isCurrent
                      ? "bg-[#E11B22] text-white shadow-md shadow-red-200"
                      : "text-[#6b6b6b] hover:bg-[#FAF3E9] hover:text-[#E11B22]"
                  }`}
                >
                  <Icon className={isCurrent ? "text-white" : "text-lg"} />
                  <span>{label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>

        {/* Lado Derecho: Usuario y Logout */}
        <div className="flex items-center gap-4 border-l border-[#E1D6C8] pl-6 ml-4">
          <div className="hidden flex-col items-end sm:flex">
            <span className="text-xs font-bold uppercase tracking-widest text-[#E11B22]">Usuario</span>
            <span className="text-sm font-semibold text-[#231F20]">{user?.username || "Invitado"}</span>
          </div>
          
          <div className="relative group">
            <button
              onClick={handleLogout}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FAF3E9] text-[#231F20] transition-all hover:bg-[#E11B22] hover:text-white"
              title="Cerrar Sesión"
            >
              <IoLogOutSharp className="text-xl" />
            </button>
          </div>
        </div>
      </div>

      {/* Navegación Mobile (Simple scroll horizontal) */}
      <div className="flex w-full overflow-x-auto border-t border-[#E1D6C8]/50 lg:hidden no-scrollbar">
        <div className="flex items-center gap-1 p-2">
          {links.map((link) => {
            const Icon = link.icon;
            const isCurrent = location.pathname.startsWith(link.to);
            const label = link.label === "KYLOW" ? <span className="font-brand">KYLOW</span> : link.label;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-tight transition-colors ${
                  isCurrent ? "bg-[#E11B22]/10 text-[#E11B22]" : "text-[#6b6b6b]"
                }`}
              >
                <Icon />
                {label}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
