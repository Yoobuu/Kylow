import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { AnimatePresence, motion } from "framer-motion";
import { FaLinkedin } from "react-icons/fa";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import { loginRequest } from "../auth/msalConfig";
import logoUsfq from "../assets/images/logo-usfq.svg";
import loginImg from "../assets/images/lowtario-login.jpg";
import BackgroundAnimation from "./BackgroundAnimation";

/**
 * LoginRedesign.jsx
 * Login oscuro con acentos por proveedor.
 * Redirige a /choose cuando las credenciales son correctas.
 */

export default function LoginRedesign() {
  const provider = "vcenter";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [caps, setCaps] = useState(false);
  const [msalLoading, setMsalLoading] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const idleTimeoutRef = useRef(null);
  const msRedirectHandledRef = useRef(false);
  const [showBrand, setShowBrand] = useState(false);

  const navigate = useNavigate();
  const { instance } = useMsal();
  const { applyLoginResponse } = useAuth();

  useEffect(() => {
    const id = setInterval(() => {
      setShowBrand((prev) => !prev);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e) => setCaps(e.getModifierState && e.getModifierState("CapsLock"));
    window.addEventListener("keyup", onKey);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const itemsCount = 3;
    const id = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % itemsCount);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { username, password, provider }, { skipAuthRedirect: true });
      const applied = applyLoginResponse(res?.data);

      if (remember) {
        localStorage.setItem("last_username", username);
      } else {
        localStorage.removeItem("last_username");
      }

      navigate(applied?.requirePasswordChange ? "/change-password" : "/choose", { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Error de autenticación";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem("last_username");
    if (savedUser) setUsername(savedUser);
  }, []);

  const exchangeMicrosoftToken = useCallback(
    async (idToken) => {
      if (!idToken) {
        throw new Error("No se recibió id_token de Microsoft.");
      }
      const res = await api.post(
        "/auth/microsoft/token-exchange",
        { id_token: idToken },
        { skipAuthRedirect: true }
      );
      const applied = applyLoginResponse(res?.data);
      navigate(applied?.requirePasswordChange ? "/change-password" : "/choose", { replace: true });
    },
    [applyLoginResponse, navigate]
  );

  const handleMicrosoftError = useCallback(
    (code, message) => {
      if (code === "pending_access") {
        navigate("/access-pending", { replace: true });
        return;
      }
      if (code === "tenant_not_allowed") {
        navigate("/access-denied-tenant", { replace: true });
        return;
      }
      if (code === "disabled") {
        setError("La cuenta Microsoft está deshabilitada.");
        return;
      }
      if (code === "invalid_token") {
        setError("No se pudo verificar tu cuenta.");
        return;
      }
      setError(message || "No se pudo iniciar sesión con Microsoft.");
    },
    [navigate]
  );

  const handleMicrosoftClick = useCallback(async () => {
    setError("");
    setMsalLoading(true);
    try {
      // Sync state before popup
      await instance.handleRedirectPromise();
      const result = await instance.loginPopup(loginRequest);
      await exchangeMicrosoftToken(result?.idToken);
    } catch (err) {
      if (err.errorCode === "interaction_in_progress") {
        setError("Microsoft sigue ocupado. Intenta de nuevo.");
        await instance.handleRedirectPromise();
      } else if (err.errorCode === "user_cancelled" || err.errorCode === "popup_window_error") {
        setError("Inicio de sesión cancelado.");
        await instance.handleRedirectPromise();
      } else {
        setError(err.message || "Error con Microsoft.");
      }
    } finally {
      setTimeout(() => setMsalLoading(false), 500);
    }
  }, [exchangeMicrosoftToken, instance]);

  useEffect(() => {
    if (!instance || msRedirectHandledRef.current) {
      return;
    }
    msRedirectHandledRef.current = true;
    let active = true;
    instance
      .handleRedirectPromise()
      .then((result) => {
        if (!active || !result?.idToken) {
          return;
        }
        return exchangeMicrosoftToken(result.idToken);
      })
      .catch((err) => {
        if (!active) return;
        const code = err?.response?.data?.code;
        const msg = err?.response?.data?.message || err?.message;
        handleMicrosoftError(code, msg);
      });
    return () => {
      active = false;
    };
  }, [exchangeMicrosoftToken, handleMicrosoftError, instance]);

  const accentBtn =
    "bg-[#E11B22] text-white hover:bg-[#c9161c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11B22]/40";

  const carouselItems = [
    {
      key: "linkedin",
      content: (
        <a
          href="https://www.linkedin.com/in/paulo-cantos-riera-7658a9206/"
          target="_blank"
          rel="noreferrer"
          className="relative z-10 inline-flex items-center gap-2 text-lg font-semibold text-[#E1E1E1] hover:text-white transition-colors"
        >
          Realizado por Paulo Cantos
          <FaLinkedin className="text-xl" />
        </a>
      ),
    },
    {
      key: "scope",
      content: (
        <div className="text-lg text-[#E1E1E1] leading-snug">
          Inventario de VMs y hosts de CEDIA, Hyper-V, ESXi, KVM y Azure
        </div>
      ),
    },
    {
      key: "brand",
      content: (
        <div className="font-brand text-2xl font-semibold uppercase tracking-[0.2em] text-[#E1E1E1]">
          KYLOW
        </div>
      ),
    },
  ];

  return (
    <div className="min-h-screen w-full bg-white font-usfqBody text-[#231F20]">
      <div className="grid min-h-screen w-full lg:grid-cols-2">
        {/* COLUMNA IZQUIERDA: FORMULARIO + ANIMACIÓN DE FONDO */}
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-6">
          <BackgroundAnimation />
          
          <div className="relative z-10 w-full max-w-md space-y-0">
            {/* Carrusel Logo / Texto animado */}
            <div className="flex h-80 items-center justify-center -mt-20 -mb-16">
              <AnimatePresence mode="wait">
                {!showBrand ? (
                  <motion.img
                    key="logo"
                    src={logoUsfq}
                    alt="USFQ"
                    className="h-80 w-auto object-contain"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.5 }}
                  />
                ) : (
                  <motion.div
                    key="text"
                    className="flex h-80 w-full items-center justify-center"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.5 }}
                  >
                    <span className="font-brand text-[8rem] font-normal leading-none tracking-widest text-[#E11B22]">
                      KYLOW
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Caja del Formulario */}
            <div className="rounded-3xl border border-[#E1D6C8] bg-white/90 p-8 shadow-xl backdrop-blur-sm -mt-8">
              <div className="space-y-3">
                <h1 className="text-3xl font-usfqTitle font-semibold text-[#E11B22]">Inicia sesión</h1>
                <div className="h-1 w-16 rounded-full bg-[#E11B22]" />
                <p className="text-sm font-usfqBody text-[#3b3b3b]">
                  Accede al inventario con tus credenciales institucionales.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4 font-usfqBody">
                <div>
                  <label className="mb-1 block text-sm text-[#E11B22]">Usuario</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    className="w-full rounded-xl border border-usfq-gray/40 bg-white px-4 py-3 text-sm text-usfq-black placeholder:text-usfq-gray/70 outline-none caret-[#E11B22] focus:outline-none focus:ring-0 focus:border-[#E11B22] focus-visible:ring-2 focus-visible:ring-[#E11B22]/40"
                    placeholder="usuario o dominio\\usuario"
                    required
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-sm text-[#E11B22]">Contraseña</label>
                    {caps && <span className="text-xs text-[#7A5E00]">Caps Lock activo</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPwd ? "text" : "password"}
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-usfq-gray/40 bg-white px-4 py-3 text-sm text-usfq-black placeholder:text-usfq-gray/70 outline-none caret-[#E11B22] focus:outline-none focus:ring-0 focus:border-[#E11B22] focus-visible:ring-2 focus-visible:ring-[#E11B22]/40"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="rounded-xl border border-usfq-gray/40 bg-white px-3 py-3 text-xs text-[#E11B22] hover:bg-[#FAF3E9]"
                    >
                      {showPwd ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 text-xs text-usfq-gray">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-usfq-gray/40 bg-white text-usfq-red"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    Recordarme en este equipo
                  </label>
                  <div className="text-right leading-snug">
                    <p>¿No tienes usuario o olvidaste tu contraseña?</p>
                    <a 
                      href="mailto:cramosm@usfq.edu.ec" 
                      className="font-bold text-[#E11B22] hover:underline"
                    >
                      Contactar a Soporte
                    </a>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border border-usfq-red/40 bg-usfq-red/10 p-3 text-sm text-usfq-red">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className={`group relative flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow ${accentBtn} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {loading && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
                  )}
                  <span>Entrar</span>
                </button>

                <button
                  type="button"
                  onClick={handleMicrosoftClick}
                  disabled={msalLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-usfq-gray/30 bg-white px-4 py-3 text-sm font-medium text-usfq-black transition hover:bg-[#FAF3E9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {msalLoading && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                  )}
                  <span className="grid h-4 w-4 grid-cols-2 gap-[2px]" aria-hidden="true">
                    <span className="block h-2 w-2 bg-[#f25022]" />
                    <span className="block h-2 w-2 bg-[#7fba00]" />
                    <span className="block h-2 w-2 bg-[#00a4ef]" />
                    <span className="block h-2 w-2 bg-[#ffb900]" />
                  </span>
                  <span>Iniciar sesión con Microsoft</span>
                </button>
              </form>

              <div className="mt-6 text-xs text-usfq-gray">
                Inventario DC · Seguridad primero
              </div>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: FOTO ESTÁTICA (Restaurada) */}
        <div className="relative hidden min-h-screen lg:block">
          <img src={loginImg} alt="Login visual" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/55 pointer-events-none" />
          <div className="relative z-20 flex h-full items-end p-10">
            <div className="w-full max-w-lg font-usfqBody pointer-events-auto">
              <div className="relative h-24 overflow-hidden">
                                {carouselItems.map((item, index) => {
                                  const active = index === carouselIndex;
                                  return (
                                    <div
                                      key={item.key}
                                      className={`absolute inset-0 flex items-center transition-all duration-700 ${
                                        active ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none"
                                      }`}
                                    >
                                      {item.content}
                                    </div>
                                  );
                                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}