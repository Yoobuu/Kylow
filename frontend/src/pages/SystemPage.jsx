import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postSystemRestart } from "../api/system";
import { getSystemSettings, updateSystemSettings } from "../api/systemSettings";
import AccessDenied from "../components/AccessDenied";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 60 * 1000;

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-[#E11B22]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6b6b6b] transition hover:text-[#E11B22]"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6 text-center text-[#231F20]">
      <div className="max-w-md space-y-3">
        <h2 className="text-xl font-semibold">
          {isReady ? "Servicio listo" : "Reiniciando backend..."}
        </h2>
        <p className="text-sm text-[#3b3b3b]">
          {isReady
            ? "Redirigiendo a login para revalidar sesión."
            : "La UI quedará temporalmente inactiva mientras el servicio se reinicia."}
        </p>
        {isTimeout && (
          <div className="space-y-3">
            <p className="text-sm text-[#7A5E00]">
              El reinicio está tardando más de lo esperado.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-[#E11B22] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#c9161c]"
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 bg-white">
      <header data-tutorial-id="system-header">
        <h1 className="text-3xl font-semibold text-[#E11B22]">Sistema</h1>
        <p className="mt-2 text-sm text-[#3b3b3b]">
          Cambios de configuración requieren reiniciar el backend para aplicar nuevos valores.
        </p>
      </header>

      <section className="rounded-xl border border-[#E1D6C8] bg-[#FAF3E9] p-6 shadow" data-tutorial-id="system-settings">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-[#E11B22]">Configuración</h2>
          <p className="text-sm text-[#3b3b3b]">
            Ajusta los parámetros base. Los cambios requieren reinicio del backend.
          </p>
          {loading && <p className="text-sm text-[#6b6b6b]">Cargando...</p>}
          {settings && (
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div className="space-y-3 rounded-xl border border-[#E1D6C8] bg-white p-4">
                <h3 className="text-sm font-semibold text-[#231F20]">Global</h3>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-[#231F20]">Warmup automatico</span>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
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
                    <span className="font-medium text-[#231F20]">Scheduler de notificaciones</span>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
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

              <div className="space-y-3 rounded-xl border border-[#E1D6C8] bg-white p-4">
                <h3 className="text-sm font-semibold text-[#231F20]">Providers</h3>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-[#231F20]">Hyper-V habilitado</span>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
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
                {"hyperv_winrm_https_enabled" in settings && (
                  <label className="flex items-start justify-between gap-4 text-sm">
                    <div className="max-w-md">
                      <span className="font-medium text-[#231F20]">WinRM HTTPS (5986)</span>
                      <p className="mt-1 text-xs text-[#6b6b6b]">
                        Recomendado. Requiere TLS válido (usa HYPERV_CA_BUNDLE si aplica).
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(settings.hyperv_winrm_https_enabled)}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          hyperv_winrm_https_enabled: event.target.checked,
                        }))
                      }
                      disabled={!canEdit}
                    />
                  </label>
                )}
                {"hyperv_winrm_http_enabled" in settings && (
                  <label className="flex items-start justify-between gap-4 text-sm">
                    <div className="max-w-md">
                      <span className="font-medium text-[#231F20]">WinRM HTTP (5985) — temporal</span>
                      <p className="mt-1 text-xs text-[#6b6b6b]">
                        Menos seguro. Usa solo como fallback temporal mientras habilitas 5986.
                      </p>
                      {Boolean(settings.hyperv_winrm_http_enabled) && (
                        <p className="mt-1 text-xs font-semibold text-[#7A5E00]">
                          Advertencia: WinRM HTTP está habilitado (menos seguro).
                        </p>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(settings.hyperv_winrm_http_enabled)}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          hyperv_winrm_http_enabled: event.target.checked,
                        }))
                      }
                      disabled={!canEdit}
                    />
                  </label>
                )}
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-[#231F20]">VMware habilitado</span>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
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
                    <span className="font-medium text-[#231F20]">oVirt / KVM habilitado</span>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
                      Permite jobs y refresh de oVirt (requiere credenciales configuradas).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.ovirt_enabled)}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, ovirt_enabled: event.target.checked }))
                    }
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-[#231F20]">Cedia habilitado</span>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
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
                <label className="flex items-start justify-between gap-4 text-sm">
                  <div className="max-w-md">
                    <span className="font-medium text-[#231F20]">Azure habilitado</span>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
                      Permite jobs y refresh de Azure (requiere credenciales configuradas).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.azure_enabled)}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, azure_enabled: event.target.checked }))
                    }
                    disabled={!canEdit}
                  />
                </label>
              </div>

              <div className="space-y-3 rounded-xl border border-[#E1D6C8] bg-white p-4 md:col-span-2">
                <h3 className="text-sm font-semibold text-[#231F20]">Intervalos (minutos)</h3>
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
                    "ovirt_refresh_interval_minutes",
                    "oVirt VMs refresh",
                    "Intervalo entre refresh automaticos de oVirt VMs (min 10).",
                  ],
                  [
                    "ovirt_hosts_refresh_interval_minutes",
                    "oVirt Hosts refresh",
                    "Intervalo entre refresh automaticos de oVirt Hosts (min 10).",
                  ],
                  [
                    "cedia_refresh_interval_minutes",
                    "Cedia refresh",
                    "Intervalo entre refresh automaticos de Cedia (min 10).",
                  ],
                  [
                    "azure_refresh_interval_minutes",
                    "Azure refresh",
                    "Intervalo entre refresh automaticos de Azure (min 10).",
                  ],
                ].map(([key, label, helpText]) => (
                  <label key={key} className="flex items-start justify-between gap-4 text-sm">
                    <div className="max-w-md">
                      <span className="font-medium text-[#231F20]">{label}</span>
                      <p className="mt-1 text-xs text-[#6b6b6b]">{helpText}</p>
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
                      className="w-28 rounded border border-[#D6C7B8] bg-white px-2 py-1 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
                      disabled={!canEdit}
                    />
                  </label>
                ))}
                {"ovirt_host_vm_count_mode" in settings && (
                  <label className="flex items-start justify-between gap-4 text-sm">
                    <div className="max-w-md">
                      <span className="font-medium text-[#231F20]">oVirt conteo de VMs por host</span>
                      <p className="mt-1 text-xs text-[#6b6b6b]">
                        runtime = solo VMs con host asignado; cluster = contar por cluster.
                      </p>
                    </div>
                    <select
                      value={settings.ovirt_host_vm_count_mode ?? ""}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          ovirt_host_vm_count_mode: event.target.value || null,
                        }))
                      }
                      className="w-48 rounded border border-[#D6C7B8] bg-white px-2 py-1 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
                      disabled={!canEdit}
                    >
                      <option value="">—</option>
                      <option value="runtime">runtime</option>
                      <option value="cluster">cluster</option>
                    </select>
                  </label>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
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
                    canSave ? "bg-[#E11B22] hover:bg-[#c9161c]" : "bg-[#E1E1E1] text-[#6b6b6b]"
                  }`}
                >
                  Guardar
                </button>
                {saveMessage && <span className="text-sm text-[#7A5E00]">{saveMessage}</span>}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-[#E11B22]">{error}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-[#E1D6C8] bg-[#FAF3E9] p-6 shadow">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-[#E11B22]">Reinicio del backend</h2>
          <p className="text-sm text-[#3b3b3b]">
            El reinicio detendrá el proceso actual y Kubernetes lo levantará nuevamente.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={!canRestart}
            className={`mt-2 inline-flex w-fit items-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow transition ${
              canRestart ? "bg-[#E11B22] hover:bg-[#c9161c]" : "bg-[#E1E1E1] text-[#6b6b6b]"
            }`}
          >
            Aplicar cambios (reiniciar backend)
          </button>
          {!canRestart && (
            <p className="text-xs text-[#6b6b6b]">Necesitas el permiso system.restart para reiniciar.</p>
          )}
        </div>
      </section>

      {modalOpen && (
        <Modal title="Confirmar reinicio" onClose={() => setModalOpen(false)}>
          <p className="text-sm text-[#3b3b3b]">
            El backend se reiniciará. La UI quedará temporalmente inactiva.
          </p>
          <div className="mt-4">
            <label className="text-xs font-semibold text-[#231F20]">Escribe RESTART para confirmar</label>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              className="mt-2 w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
              placeholder="RESTART"
            />
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-[#D6C7B8] bg-white px-4 py-2 text-sm font-semibold text-[#E11B22] hover:bg-[#FAF3E9]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={!canSubmit}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                canSubmit ? "bg-[#E11B22] hover:bg-[#c9161c]" : "bg-[#E1E1E1] text-[#6b6b6b]"
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
