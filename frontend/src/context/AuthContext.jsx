/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import {
  getMustChangePassword,
  getToken,
  setMustChangePassword as persistMustChangeStorage,
  setToken as persistTokenStorage,
  MUST_CHANGE_STORAGE_KEY,
  TOKEN_KEY,
} from "../auth/tokenStorage";

const AuthContext = createContext(null);
const normalizeUser = (rawUser) => (rawUser ? { ...rawUser } : null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [mustChangePassword, setMustChangePassword] = useState(
    () => getMustChangePassword() === "true"
  );
  const [initializing, setInitializing] = useState(!!getToken());

  const persistToken = useCallback((value) => {
    persistTokenStorage(value);
    setToken(value || null);
  }, []);

  const persistMustChange = useCallback((value) => {
    persistMustChangeStorage(value);
    setMustChangePassword(Boolean(value));
  }, []);

  const applySession = useCallback(
    ({ token: nextToken, user: nextUser, permissions: nextPermissions, requirePasswordChange }) => {
      if (typeof nextToken === "string" && nextToken.length > 0) {
        persistToken(nextToken);
      } else if (nextToken === null) {
        persistToken(null);
      }
      setUser(nextUser ? normalizeUser(nextUser) : null);
      setPermissions(Array.isArray(nextPermissions) ? nextPermissions : []);
      if (requirePasswordChange !== undefined) {
        persistMustChange(Boolean(requirePasswordChange));
      }
    },
    [persistToken, persistMustChange]
  );

  const logout = useCallback(() => {
    persistToken(null);
    setUser(null);
    setPermissions([]);
    persistMustChange(false);
  }, [persistToken, persistMustChange]);

  const login = useCallback(
    ({ token: nextToken, user: nextUser, permissions: nextPermissions, requirePasswordChange }) => {
      applySession({
        token: nextToken,
        user: nextUser,
        permissions: nextPermissions,
        requirePasswordChange: Boolean(requirePasswordChange),
      });
    },
    [applySession]
  );

  const applyLoginResponse = useCallback(
    (payload) => {
      if (!payload) return null;
      const accessToken = payload.access_token ?? payload.token ?? payload.accessToken ?? null;
      const user = payload.user ?? null;
      const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
      const requirePasswordChange =
        payload.require_password_change ?? payload.requirePasswordChange ?? false;
      applySession({
        token: accessToken,
        user,
        permissions,
        requirePasswordChange,
      });
      return {
        accessToken,
        user,
        permissions,
        requirePasswordChange: Boolean(requirePasswordChange),
      };
    },
    [applySession]
  );

  const applyNewToken = useCallback(
    (nextToken, nextUser, nextPermissions = [], requirePasswordChange = false) => {
      applySession({
        token: nextToken,
        user: nextUser,
        permissions: nextPermissions,
        requirePasswordChange,
      });
    },
    [applySession]
  );

  const refreshMe = useCallback(async () => {
    if (!token) {
      setUser(null);
      persistMustChange(false);
      return null;
    }
    try {
      const { data } = await api.get("/auth/me");
      const normalized = normalizeUser(data);
      setUser(normalized);
      setPermissions(Array.isArray(data?.permissions) ? data.permissions : []);
      persistMustChange(Boolean(data?.must_change_password));
      return normalized;
    } catch (error) {
      logout();
      throw error;
    }
  }, [token, persistMustChange, logout]);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setInitializing(false);
      setUser(null);
      return undefined;
    }

    setInitializing(true);
    refreshMe()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setInitializing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, refreshMe]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === TOKEN_KEY) {
        setToken(event.newValue);
      }
      if (event.key === MUST_CHANGE_STORAGE_KEY) {
        setMustChangePassword(event.newValue === "true");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const handleForcedLogout = () => logout();
    window.addEventListener("auth:logout", handleForcedLogout);
    return () => window.removeEventListener("auth:logout", handleForcedLogout);
  }, [logout]);

  const permissionSet = useMemo(() => new Set(permissions || []), [permissions]);

  const hasPermission = useCallback(
    (code) => {
      const value = typeof code === "string" ? code : code?.value;
      if (!value) return false;
      return permissionSet.has(value);
    },
    [permissionSet],
  );

  const canManagePower = useMemo(
    () => hasPermission("vms.power") || hasPermission("hyperv.power"),
    [hasPermission],
  );

  const value = useMemo(
    () => ({
      token,
      user,
      permissions,
      mustChangePassword,
      login,
      applyLoginResponse,
      logout,
      applyNewToken,
      refreshMe,
      hasPermission,
      canManagePower,
      initializing,
    }),
    [
      token,
      user,
      permissions,
      mustChangePassword,
      login,
      applyLoginResponse,
      logout,
      applyNewToken,
      refreshMe,
      hasPermission,
      canManagePower,
      initializing,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
