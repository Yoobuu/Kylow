import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postSystemRestart } from "../api/system";
import { getSystemSettings, updateSystemSettings } from "../api/systemSettings";
import AccessDenied from "../components/AccessDenied";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 60 * 1000;

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 transition hover:text-gray-800"
            aria-label="Cerrar"
          >
            x
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function RestartOverlay({ state, onRetry }) {
  const isTimeout = state === "timeout";
  const isReady = state === "ready";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/90 px-6 text-center text-white">
      <div className="max-w-md space-y-3">
        <h2 className="text-xl font-semibold">
          {isReady ? "Servicio listo" : "Reiniciando backend..."}
        </h2>
        <p className="text-sm text-neutral-300">
          {isReady
            ? "Redirigiendo a login para revalidar sesión."
            : "La UI quedará temporalmente inactiva mientras el servicio se reinicia."}
        </p>
        {isTimeout && (
          <div className="space-y-3">
            <p className="text-sm text-amber-300">
              El reinicio está tardando más de lo esperado.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SystemPage() {
  const { hasPermission, token } = useAuth();
  const canView = hasPermission("system.settings.view");
  const canEdit = hasPermission("system.settings.edit");
  const canRestart = hasPermission("system.restart");
  const [confirmText, setConfirmText] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(null);
  const [initialSettings, setInitialSettings] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [restartState, setRestartState] = useState("idle");
  const pollRef = useRef(null);

  const confirmValid = useMemo(() => confirmText.trim() === "RESTART", [confirmText]);
  const canSubmit = confirmValid && restartState === "idle";
  const isDirty = useMemo(() => {
    if (!settings || !initialSettings) return false;
    return Object.keys(initialSettings).some((key) => settings[key] !== initialSettings[key]);
  }, [settings, initialSettings]);
  const canSave = canEdit && isDirty && !loading;

  const handleStart = useCallback(async () => {
    setError("");
    try {
      await postSystemRestart("RESTART");
      setModalOpen(false);
      setRestartState("restarting");
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudo iniciar el reinicio.";
      setError(detail);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const resp = await getSystemSettings();
      const payload = resp?.settings || resp;
      setSettings(payload);
      setInitialSettings(payload);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudo cargar configuración.";
      setError(detail);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const pollHealth = useCallback(async () => {
    try {
      const resp = await fetch("/healthz", { cache: "no-store" });
      if (resp.ok) {
        setRestartState("ready");
        return true;
      }
    } catch (err) {
      // ignore, still restarting
    }
    return false;
  }, []);

  const startPolling = useCallback(() => {
    const startedAt = Date.now();
    const tick = async () => {
      const ready = await pollHealth();
      if (ready) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        setRestartState("timeout");
        return;
      }
      pollRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  }, [pollHealth]);

  useEffect(() => {
    if (restartState !== "restarting") return undefined;
    startPolling();
    return () => {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
      }
    };
  }, [restartState, startPolling]);

  useEffect(() => {
    if (restartState !== "ready") return undefined;
    const target = token ? "/login" : "/login";
    const id = window.setTimeout(() => {
      window.location.href = target;
    }, 1000);
    return () => window.clearTimeout(id);
  }, [restartState, token]);

  if (!canView) {
    return <AccessDenied description="Necesitas el permiso system.settings.view para acceder." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold text-neutral-900">Sistema</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Cambios de configuración requieren reiniciar el backend para aplicar nuevos valores.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-neutral-900">Configuración</h2>
          <p className="text-sm text-neutral-600">
            Ajusta los parámetros base. Los cambios requieren reinicio del backend.
          </p>
          {loading && <p className="text-sm text-neutral-500">Cargando...</p>}
          {settings && (
            <div className="mt-4 space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-800">Global</h3>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-neutral-800">Warmup automatico</span>
                    <p className="mt-1 text-xs text-neutral-500">
                      Ejecuta refrescos automaticos al iniciar y mantiene el warmup activo.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.warmup_enabled)}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, warmup_enabled: event.target.checked }))
                    }
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-neutral-800">Scheduler de notificaciones</span>
                    <p className="mt-1 text-xs text-neutral-500">
                      Activa la tarea periodica que revisa y genera notificaciones.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.notif_sched_enabled)}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, notif_sched_enabled: event.target.checked }))
                    }
                    disabled={!canEdit}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-800">Providers</h3>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-neutral-800">Hyper-V habilitado</span>
                    <p className="mt-1 text-xs text-neutral-500">
                      Permite jobs y refresh de Hyper-V (requiere credenciales configuradas).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.hyperv_enabled)}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, hyperv_enabled: event.target.checked }))
                    }
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-neutral-800">VMware habilitado</span>
                    <p className="mt-1 text-xs text-neutral-500">
                      Permite jobs y refresh de VMware VMs (requiere credenciales configuradas).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.vmware_enabled)}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, vmware_enabled: event.target.checked }))
                    }
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-neutral-800">Cedia habilitado</span>
                    <p className="mt-1 text-xs text-neutral-500">
                      Permite jobs y refresh de Cedia (requiere credenciales configuradas).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.cedia_enabled)}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, cedia_enabled: event.target.checked }))
                    }
                    disabled={!canEdit}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-800">Intervalos (minutos)</h3>
                {[
                  [
                    "hyperv_refresh_interval_minutes",
                    "Hyper-V refresh",
                    "Intervalo entre refresh automaticos de Hyper-V (min 10).",
                  ],
                  [
                    "vmware_refresh_interval_minutes",
                    "VMware VMs refresh",
                    "Intervalo entre refresh automaticos de VMware VMs (min 10).",
                  ],
                  [
                    "vmware_hosts_refresh_interval_minutes",
                    "VMware Hosts refresh",
                    "Intervalo entre refresh automaticos de VMware Hosts (min 10).",
                  ],
                  [
                    "cedia_refresh_interval_minutes",
                    "Cedia refresh",
                    "Intervalo entre refresh automaticos de Cedia (min 10).",
                  ],
                ].map(([key, label, helpText]) => (
                  <label key={key} className="flex items-start justify-between gap-4 text-sm">
                    <div className="max-w-md">
                      <span className="font-medium text-neutral-800">{label}</span>
                      <p className="mt-1 text-xs text-neutral-500">{helpText}</p>
                    </div>
                    <input
                      type="number"
                      min={10}
                      max={4320}
                      value={settings[key]}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          [key]: Number(event.target.value || 0),
                        }))
                      }
                      className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
                      disabled={!canEdit}
                    />
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    setSaveMessage("");
                    setError("");
                    setLoading(true);
                    try {
                      const resp = await updateSystemSettings(settings);
                      const next = resp?.settings || settings;
                      setSettings(next);
                      setInitialSettings(next);
                      setSaveMessage("Guardado. Requiere reinicio.");
                    } catch (err) {
                      const detail =
                        err?.response?.data?.detail || err?.message || "No se pudo guardar configuración.";
                      setError(detail);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={!canSave}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                    canSave ? "bg-neutral-900 hover:bg-neutral-800" : "bg-neutral-400"
                  }`}
                >
                  Guardar
                </button>
                {saveMessage && <span className="text-sm text-amber-700">{saveMessage}</span>}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-neutral-900">Reinicio del backend</h2>
          <p className="text-sm text-neutral-600">
            El reinicio detendrá el proceso actual y Kubernetes lo levantará nuevamente.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={!canRestart}
            className={`mt-2 inline-flex w-fit items-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow transition ${
              canRestart ? "bg-amber-600 hover:bg-amber-500" : "bg-neutral-400"
            }`}
          >
            Aplicar cambios (reiniciar backend)
          </button>
          {!canRestart && (
            <p className="text-xs text-neutral-500">Necesitas el permiso system.restart para reiniciar.</p>
          )}
        </div>
      </section>

      {modalOpen && (
        <Modal title="Confirmar reinicio" onClose={() => setModalOpen(false)}>
          <p className="text-sm text-neutral-600">
            El backend se reiniciará. La UI quedará temporalmente inactiva.
          </p>
          <div className="mt-4">
            <label className="text-xs font-semibold text-neutral-700">Escribe RESTART para confirmar</label>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              placeholder="RESTART"
            />
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={!canSubmit}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                canSubmit ? "bg-neutral-900 hover:bg-neutral-800" : "bg-neutral-400"
              }`}
            >
              Reiniciar
            </button>
          </div>
        </Modal>
      )}

      {(restartState === "restarting" || restartState === "timeout" || restartState === "ready") && (
        <RestartOverlay
          state={restartState}
          onRetry={() => {
            setRestartState("restarting");
          }}
        />
      )}
    </div>
  );
}
