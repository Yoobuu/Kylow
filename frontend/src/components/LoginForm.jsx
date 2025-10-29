import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios"; // baseURL debe terminar en /api para usar .post("/login")

/**
 * LoginRedesign.jsx
 * Login oscuro con acentos por proveedor.
 * Redirige a /choose cuando las credenciales son correctas.
 */

const PROVIDERS = [
  { key: "vcenter", label: "VMware vCenter",  tone: "bg-emerald-600", ring: "ring-emerald-500", text: "text-emerald-400" },
  { key: "hyperv",  label: "Microsoft Hyper-V", tone: "bg-blue-600",    ring: "ring-blue-500",    text: "text-blue-400" },
  { key: "kvm",     label: "KVM / Libvirt",     tone: "bg-neutral-800", ring: "ring-neutral-500", text: "text-neutral-300" },
];

export default function LoginRedesign({ onLogin }) {
  const [provider, setProvider] = useState("vcenter");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [caps, setCaps] = useState(false);

  const navigate = useNavigate();
  const theme = useMemo(() => PROVIDERS.find(p => p.key === provider) || PROVIDERS[0], [provider]);

  useEffect(() => {
    const onKey = (e) => setCaps(e.getModifierState && e.getModifierState("CapsLock"));
    window.addEventListener("keyup", onKey);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keyup", onKey); window.removeEventListener("keydown", onKey); };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Si api.baseURL termina en /api, aquí debe ser "/login"
      const res = await api.post("/auth/login", { username, password, provider });

      // Guarda token (ajusta la clave según tu backend)
      if (res?.data?.access_token) localStorage.setItem("token", res.data.access_token);

      // Preferencias
      if (remember) {
        localStorage.setItem("provider", provider);
        localStorage.setItem("last_username", username);
      } else {
        localStorage.removeItem("provider");
        localStorage.removeItem("last_username");
      }

      // Notifica al padre (App.jsx) y navega
      onLogin?.();
      navigate("/choose", { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Error de autenticación";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedProvider = localStorage.getItem("provider");
    const savedUser = localStorage.getItem("last_username");
    if (savedProvider) setProvider(savedProvider);
    if (savedUser) setUsername(savedUser);
  }, []);

  const accentBtn = `${theme.tone} hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 ${theme.ring} text-white`;
  const accentSoft = `ring-1 ${theme.ring} ${theme.text}`;

  return (
    <div className="min-h-dvh w-full bg-black text-white relative">
      {/* Fondo en cuadrícula */}
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

      {/* Card centrada */}
      <div className="relative flex min-h-dvh items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-neutral-900/60 p-6 shadow-2xl backdrop-blur">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <div className={`h-9 w-9 rounded-xl ${theme.tone}`} />
            <div>
              <h1 className="text-xl font-semibold leading-5">Accede al Iventario</h1>
              <p className="text-xs text-neutral-400">Autenticate para acceder </p>
            </div>
          </div>

          {/* Selector proveedor */}
          <div className="mb-5 flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.key}
                onClick={() => setProvider(p.key)}
                className={`rounded-full px-3 py-1.5 text-xs ring-1 transition ${
                  provider === p.key ? `${p.tone} text-white ring-transparent`
                  : `bg-neutral-800 hover:bg-neutral-700 ${p.ring} text-neutral-200`
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Usuario</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-400 outline-none focus:ring-2 focus:ring-white/20"
                placeholder="usuario o dominio\\usuario"
                required
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm text-neutral-300">Contraseña</label>
                {caps && <span className="text-xs text-yellow-400">Caps Lock activo</span>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-400 outline-none focus:ring-2 focus:ring-white/20"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-700"
                >
                  {showPwd ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-neutral-400">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/10 bg-neutral-800"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Recordarme en este equipo
              </label>
              <a className={`underline-offset-4 hover:underline ${accentSoft}`} href="#">
                ¿Olvidaste tu contraseña?
              </a>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`group relative flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow ${accentBtn} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />}
              <span>Entrar</span>
              <span className="pointer-events-none absolute inset-x-0 -bottom-1 mx-auto h-px w-10 bg-white/50 opacity-0 transition group-hover:opacity-100" />
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 flex items-center justify-between text-xs text-neutral-500">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>vCenter</span>
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span>Hyper-V</span>
              <span className="h-2 w-2 rounded-full bg-neutral-700" />
              <span>KVM</span>
            </div>
            <div>Inventario DC • Seguridad primero</div>
          </div>
        </div>
      </div>
    </div>
  );
}
