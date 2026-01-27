// —————— Módulo de configuración de Axios con manejo de JWT ——————
import axios from "axios";
import { jwtDecode } from "jwt-decode";
import { getToken, setToken } from "../auth/tokenStorage";

// —————— Instancia base de Axios ——————
const api = axios.create({
  // URL base configurada desde variable de entorno o /api por defecto
  baseURL: import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || "/api",
});

// —————— Interceptor de petición: inyecta y valida el token JWT ——————
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    try {
      // Decodifica la expiración del token para forzar logout si ya caducó
      const { exp } = jwtDecode(token);
      if (exp * 1000 < Date.now()) {
        setToken(null);
        window.dispatchEvent(new Event("auth:logout"));
        window.location.href = "/login";  // Redirige al login si expiró
        return Promise.reject(new Error("Token expirado"));
      }
    } catch (err) {
      // Si el token no es decodificable, se elimina y se redirige evitando bloqueos
      setToken(null);
      window.dispatchEvent(new Event("auth:logout"));
      window.location.href = "/login";
      return Promise.reject(err);
    }
    // Añade el header Authorization con el Bearer token
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// —————— Interceptor de respuesta: detecta 401 para forzar logout ——————
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.skipAuthRedirect) {
      // Si la API responde con 401, limpia el token y redirige al login
      setToken(null);
      window.dispatchEvent(new Event("auth:logout"));
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

// —————— Exportación de la instancia para su uso en toda la app ——————
export default api;
