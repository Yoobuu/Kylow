import { useEffect, useMemo, useState } from "react";
import { getVmwareSnapshot } from "../../../api/vmware";
import { getVmwareHostsSnapshot } from "../../../api/hosts";
import { getHypervSnapshot, getHypervConfig, getHypervHosts } from "../../../api/hypervHosts";
import { getOvirtSnapshot } from "../../../api/ovirt";
import { getOvirtHostsSnapshot } from "../../../api/ovirtHosts";
import { getCediaSnapshot } from "../../../api/cedia";
import { getAzureSnapshot } from "../../../api/azure";
import { normalizeAzure, normalizeHyperV, normalizeVMware } from "../../../lib/normalize";
import { normalizeHostSummary } from "../../../lib/normalizeHost";

const PROVIDER_LABELS = {
  vmware: "VMware",
  hyperv: "Hyper-V",
  ovirt: "oVirt",
  cedia: "CEDIA",
  azure: "Azure",
};

const safeNumber = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeCediaStatus = (raw) => {
  if (!raw) return "UNKNOWN";
  const upper = String(raw).toUpperCase();
  if (upper === "8") return "POWERED_OFF";
  if (upper === "3") return "SUSPENDED";
  if (upper.includes("ON") || upper === "4") return "POWERED_ON";
  if (upper.includes("OFF")) return "POWERED_OFF";
  if (upper.includes("SUSP")) return "SUSPENDED";
  if (upper === "2") return "DEPLOYED";
  if (upper === "1") return "RESOLVED";
  return upper;
};

const normalizeCediaVm = (vm, idx) => {
  const status = normalizeCediaStatus(vm?.status);
  const id = vm?.id || (vm?.href ? String(vm.href).split("/").pop() : null) || `cedia-${idx}`;
  return {
    id,
    name: vm?.name || "VM",
    provider: "cedia",
    power_state: status,
    cpu_usage_pct: safeNumber(vm?.cpu_pct ?? vm?.cpu_usage_pct),
    ram_usage_pct: safeNumber(vm?.mem_pct ?? vm?.ram_usage_pct),
    memory_size_MiB: safeNumber(vm?.memoryMB),
    host: vm?.vdcName || null,
    cluster: vm?.containerName || vm?.vdcName || null,
    environment: vm?.orgName || "cedia",
  };
};

const toUnifiedVm = (vm, fallbackProvider) => ({
  id: vm?.id,
  name: vm?.name,
  provider: vm?.provider || fallbackProvider,
  power_state: vm?.power_state || null,
  cpu_usage_pct: safeNumber(vm?.cpu_usage_pct),
  ram_usage_pct: safeNumber(vm?.ram_usage_pct),
  memory_size_MiB: safeNumber(vm?.memory_size_MiB),
  host: vm?.host || null,
  cluster: vm?.cluster || null,
  environment: vm?.environment || "desconocido",
});

const toUnifiedHost = (host, provider) => ({
  id: host?.id,
  name: host?.name,
  provider,
  cluster: host?.cluster || null,
  cpu_usage_pct: safeNumber(host?.cpu_usage_pct),
  memory_usage_pct: safeNumber(host?.memory_usage_pct),
  health: host?.health || null,
  connection_state: host?.connection_state || null,
  total_vms: safeNumber(host?.total_vms),
});

const isPoweredOn = (state) => {
  const value = String(state || "").toUpperCase();
  return value === "POWERED_ON" || value === "RUNNING";
};

const isPoweredOff = (state) => {
  const value = String(state || "").toUpperCase();
  return value === "POWERED_OFF" || value === "OFF";
};

const formatError = (err, fallback) => {
  const status = err?.response?.status;
  const detailRaw = err?.response?.data?.detail ?? err?.response?.data?.message;
  const detail =
    typeof detailRaw === "string"
      ? detailRaw
      : typeof detailRaw?.detail === "string"
        ? detailRaw.detail
        : null;
  if (status) {
    return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
  }
  return detail || err?.message || fallback;
};

const flattenHypervSnapshot = (snapshot) => {
  if (!snapshot) return [];
  if (Array.isArray(snapshot)) return snapshot;
  const data = snapshot?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.vms)) return data.vms;
    return Object.values(data)
      .flatMap((value) => {
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object") {
          if (Array.isArray(value.data)) return value.data;
          if (Array.isArray(value.results)) return value.results;
          if (Array.isArray(value.items)) return value.items;
          if (Array.isArray(value.vms)) return value.vms;
        }
        return [];
      })
      .filter(Boolean);
  }
  if (Array.isArray(snapshot?.results)) return snapshot.results;
  if (Array.isArray(snapshot?.items)) return snapshot.items;
  if (Array.isArray(snapshot?.vms)) return snapshot.vms;
  return [];
};

const normalizeHostName = (value) => String(value || "").trim().toLowerCase();

const extractHostNames = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => (typeof entry === "string" ? entry : entry?.host || entry?.name || entry?.hostname))
      .filter(Boolean);
  }
  if (payload?.data) {
    const data = payload.data;
    if (Array.isArray(data)) {
      return data
        .map((entry) => (typeof entry === "string" ? entry : entry?.host || entry?.name || entry?.hostname))
        .filter(Boolean);
    }
    if (data && typeof data === "object") {
      const values = Object.values(data);
      if (values.length && values.every((value) => Array.isArray(value))) {
        return values
          .flat()
          .map((entry) => (typeof entry === "string" ? entry : entry?.host || entry?.name || entry?.hostname))
          .filter(Boolean);
      }
      const keys = Object.keys(data);
      if (keys.length) return keys;
    }
  }
  if (Array.isArray(payload?.results)) {
    return payload.results
      .map((entry) => (typeof entry === "string" ? entry : entry?.host || entry?.name || entry?.hostname))
      .filter(Boolean);
  }
  if (Array.isArray(payload?.items)) {
    return payload.items
      .map((entry) => (typeof entry === "string" ? entry : entry?.host || entry?.name || entry?.hostname))
      .filter(Boolean);
  }
  return [];
};

// Handles Hyper-V host snapshot shapes (list/dict/results/items).
const countHostsByProvider = (snapshot) => {
  const names = extractHostNames(snapshot).map(normalizeHostName).filter(Boolean);
  const unique = Array.from(new Set(names));
  return { count: unique.length, names: unique };
};

const buildKpis = ({ vms, hosts }) => {
  const total = vms.length;
  const poweredOn = vms.filter((vm) => isPoweredOn(vm.power_state)).length;
  const poweredOff = vms.filter((vm) => isPoweredOff(vm.power_state)).length;
  const cpuVals = vms.map((vm) => safeNumber(vm.cpu_usage_pct)).filter((v) => v != null);
  const ramVals = vms.map((vm) => safeNumber(vm.ram_usage_pct)).filter((v) => v != null);
  const avgCpu =
    cpuVals.length > 0 ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : null;
  const avgRam =
    ramVals.length > 0 ? ramVals.reduce((a, b) => a + b, 0) / ramVals.length : null;
  const providerSet = new Set(vms.map((vm) => vm.provider).filter(Boolean));

  return {
    total_vms: total,
    powered_on: poweredOn,
    powered_off: poweredOff,
    avg_cpu_usage_pct: avgCpu,
    avg_ram_usage_pct: avgRam,
    total_hosts: hosts.length ? hosts.length : null,
    providers_included: Array.from(providerSet),
  };
};

const buildEnvKpis = (vms) => {
  return vms.reduce((acc, vm) => {
    const env = vm.environment || "desconocido";
    if (!acc[env]) {
      acc[env] = { total: 0, on: 0, off: 0, providers: {} };
    }
    acc[env].total += 1;
    if (isPoweredOn(vm.power_state)) acc[env].on += 1;
    if (isPoweredOff(vm.power_state)) acc[env].off += 1;
    const provider = vm.provider || "unknown";
    acc[env].providers[provider] = (acc[env].providers[provider] || 0) + 1;
    return acc;
  }, {});
};

export function useMissionData() {
  const [state, setState] = useState({
    loading: true,
    errorSummary: null,
    vms: [],
    hosts: [],
    kpis: null,
    envKpis: {},
    providerMeta: {},
    providerStatus: {},
  });

  useEffect(() => {
    let cancelled = false;

    const discoverHypervHosts = async () => {
      let lastError = null;
      try {
        const cfg = await getHypervConfig();
        const list = Array.isArray(cfg?.hosts)
          ? cfg.hosts.map((h) => String(h || "").trim().toLowerCase()).filter(Boolean).sort()
          : [];
        if (list.length) return { hosts: list, error: null };
      } catch (err) {
        lastError = err;
      }
      try {
        const data = await getHypervHosts();
        const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        const hosts = Array.from(
          new Set(list.map((h) => String(h?.host || h?.name || "").trim().toLowerCase()).filter(Boolean))
        ).sort();
        return { hosts, error: null };
      } catch (err) {
        lastError = err;
        return { hosts: [], error: lastError };
      }
    };

    const fetchVmware = async () => {
      const meta = {};
      const status = { ok: false, errorMessage: null, empty: false, stale: false };
      let vms = [];
      let hosts = [];

      const [vmSnapResult, hostSnapResult] = await Promise.allSettled([
        getVmwareSnapshot(),
        getVmwareHostsSnapshot(),
      ]);

      if (vmSnapResult.status === "fulfilled") {
        const snapshot = vmSnapResult.value;
        if (snapshot?.empty) {
          status.empty = true;
        } else {
          meta.generated_at = snapshot?.generated_at || null;
          meta.source = snapshot?.source || null;
          meta.stale = Boolean(snapshot?.stale);
          meta.stale_reason = snapshot?.stale_reason || null;
          status.stale = Boolean(snapshot?.stale);
          const list = Array.isArray(snapshot?.data?.vmware) ? snapshot.data.vmware : [];
          vms = list
            .map((vm) => normalizeVMware(vm))
            .filter(Boolean)
            .map((vm) => toUnifiedVm(vm, "vmware"));
          status.ok = true;
        }
      } else {
        status.errorMessage = formatError(vmSnapResult.reason, "VMware no disponible.");
      }

      if (hostSnapResult.status === "fulfilled") {
        const snapshot = hostSnapResult.value;
        if (!snapshot?.empty) {
          const list = Array.isArray(snapshot?.data?.vmware) ? snapshot.data.vmware : [];
          hosts = list
            .map((host) => normalizeHostSummary(host))
            .filter(Boolean)
            .map((host) => toUnifiedHost(host, "vmware"));
        }
      }

      status.vmCount = vms.length;
      status.hostCount = hosts.length;
      return { provider: "vmware", vms, hosts, meta, status };
    };

    const fetchOvirt = async () => {
      const meta = {};
      const status = { ok: false, errorMessage: null, empty: false, stale: false };
      let vms = [];
      let hosts = [];

      const [vmSnapResult, hostSnapResult] = await Promise.allSettled([
        getOvirtSnapshot(),
        getOvirtHostsSnapshot(),
      ]);

      if (vmSnapResult.status === "fulfilled") {
        const snapshot = vmSnapResult.value;
        if (snapshot?.empty) {
          status.empty = true;
        } else {
          meta.generated_at = snapshot?.generated_at || null;
          meta.source = snapshot?.source || null;
          meta.stale = Boolean(snapshot?.stale);
          meta.stale_reason = snapshot?.stale_reason || null;
          status.stale = Boolean(snapshot?.stale);
          const list = Array.isArray(snapshot?.data?.ovirt) ? snapshot.data.ovirt : [];
          vms = list
            .map((vm) => normalizeVMware(vm))
            .filter(Boolean)
            .map((vm) => ({ ...toUnifiedVm(vm, "ovirt"), provider: "ovirt" }));
          status.ok = true;
        }
      } else {
        status.errorMessage = formatError(vmSnapResult.reason, "oVirt no disponible.");
      }

      if (hostSnapResult.status === "fulfilled") {
        const snapshot = hostSnapResult.value;
        if (!snapshot?.empty) {
          const list = Array.isArray(snapshot?.data?.ovirt) ? snapshot.data.ovirt : [];
          hosts = list
            .map((host) => normalizeHostSummary(host))
            .filter(Boolean)
            .map((host) => toUnifiedHost(host, "ovirt"));
        }
      }

      status.vmCount = vms.length;
      status.hostCount = hosts.length;
      return { provider: "ovirt", vms, hosts, meta, status };
    };

    const fetchHyperv = async () => {
      const meta = {};
      const status = { ok: false, errorMessage: null, empty: false, stale: false };
      let vms = [];
      let hostsCount = 0;
      let hosts = [];

      try {
        const { hosts: discoveredHosts, error: hostsError } = await discoverHypervHosts();
        if (!discoveredHosts.length) {
          status.errorMessage = formatError(hostsError, "Sin hosts configurados.");
          status.vmCount = 0;
          status.hostCount = 0;
          return { provider: "hyperv", vms, hosts: [], meta, status };
        }
        hostsCount = discoveredHosts.length;

        const attempt = async (level) => {
          const snap = await getHypervSnapshot("vms", discoveredHosts, level);
          if (!snap || typeof snap !== "object") return { snapshot: null, flattened: [] };
          const flattened = flattenHypervSnapshot(snap);
          return { snapshot: snap, flattened };
        };

        let { snapshot, flattened } = await attempt("detail");
        if (!flattened.length) {
          const fallback = await attempt("summary");
          snapshot = fallback.snapshot || snapshot;
          flattened = fallback.flattened;
        }

        if (!snapshot) {
          status.empty = true;
          status.vmCount = 0;
          status.hostCount = hostsCount;
          return { provider: "hyperv", vms, hosts: [], meta, status };
        }

        meta.generated_at = snapshot?.generated_at || null;
        meta.source = snapshot?.source || null;
        meta.stale = Boolean(snapshot?.stale);
        meta.stale_reason = snapshot?.stale_reason || null;
        status.stale = Boolean(snapshot?.stale);
        vms = flattened
          .map((vm) => normalizeHyperV(vm))
          .filter(Boolean)
          .map((vm) => toUnifiedVm(vm, "hyperv"));
        status.ok = flattened.length > 0;
        status.empty = flattened.length === 0;

        try {
          const hostSnapshot = await getHypervSnapshot("hosts", discoveredHosts, "summary");
          const hostInfo = countHostsByProvider(hostSnapshot);
          if (hostInfo.count) {
            hostsCount = hostInfo.count;
            hosts = hostInfo.names.map((name) =>
              toUnifiedHost({ id: name, name, cluster: null }, "hyperv")
            );
          }
        } catch {
          // ignore host snapshot errors; fallback to VM-derived hosts below
        }

        if (!hostsCount && vms.length) {
          const fromVms = Array.from(
            new Set(vms.map((vm) => normalizeHostName(vm.host)).filter(Boolean))
          );
          hostsCount = fromVms.length;
          hosts = fromVms.map((name) =>
            toUnifiedHost({ id: name, name, cluster: null }, "hyperv")
          );
        }
      } catch (err) {
        status.errorMessage = formatError(err, "Hyper-V no disponible.");
      }

      status.vmCount = vms.length;
      status.hostCount = hostsCount;
      return { provider: "hyperv", vms, hosts, meta, status };
    };

    const fetchCedia = async () => {
      const meta = {};
      const status = { ok: false, errorMessage: null, empty: false, stale: false };
      let vms = [];

      try {
        const snapshot = await getCediaSnapshot();
        if (snapshot?.empty) {
          status.empty = true;
        } else {
          meta.generated_at = snapshot?.generated_at || null;
          meta.source = snapshot?.source || null;
          meta.stale = Boolean(snapshot?.stale);
          meta.stale_reason = snapshot?.stale_reason || null;
          status.stale = Boolean(snapshot?.stale);
          const list = Array.isArray(snapshot?.data?.cedia) ? snapshot.data.cedia : [];
          vms = list.map((vm, idx) => normalizeCediaVm(vm, idx));
          status.ok = true;
        }
      } catch (err) {
        status.errorMessage = formatError(err, "CEDIA no disponible.");
      }

      status.vmCount = vms.length;
      status.hostCount = 0;
      return { provider: "cedia", vms, hosts: [], meta, status };
    };

    const fetchAzure = async () => {
      const meta = {};
      const status = { ok: false, errorMessage: null, empty: false, stale: false };
      let vms = [];

      try {
        const snapshot = await getAzureSnapshot();
        if (snapshot?.empty) {
          status.empty = true;
        } else {
          meta.generated_at = snapshot?.generated_at || null;
          meta.source = snapshot?.source || null;
          meta.stale = Boolean(snapshot?.stale);
          meta.stale_reason = snapshot?.stale_reason || null;
          status.stale = Boolean(snapshot?.stale);
          const list = Array.isArray(snapshot?.data?.azure)
            ? snapshot.data.azure
            : Array.isArray(snapshot?.data)
              ? snapshot.data
              : [];
          vms = list
            .map((vm) => normalizeAzure(vm))
            .filter(Boolean)
            .map((vm) => toUnifiedVm(vm, "azure"));
          status.ok = true;
        }
      } catch (err) {
        status.errorMessage = formatError(err, "Azure no disponible.");
      }

      status.vmCount = vms.length;
      status.hostCount = 0;
      return { provider: "azure", vms, hosts: [], meta, status };
    };

    const fetchAll = async () => {
      setState((prev) => ({ ...prev, loading: true }));
      const providers = [fetchVmware, fetchHyperv, fetchOvirt, fetchCedia, fetchAzure];
      const settled = await Promise.allSettled(providers.map((fn) => fn()));

      if (cancelled) return;

      const vms = [];
      const hosts = [];
      const providerMeta = {};
      const providerStatus = {};
      let okCount = 0;

      settled.forEach((result) => {
        if (result.status !== "fulfilled") {
          return;
        }
        const payload = result.value || {};
        const provider = payload.provider;
        if (!provider) return;
        if (Array.isArray(payload.vms)) vms.push(...payload.vms);
        if (Array.isArray(payload.hosts)) hosts.push(...payload.hosts);
        providerMeta[provider] = payload.meta || {};
        providerStatus[provider] = payload.status || {};
        if (payload.status?.ok) okCount += 1;
      });

      const kpis = buildKpis({ vms, hosts });
      const envKpis = buildEnvKpis(vms);
      const errorSummary = okCount === 0 ? "No se pudieron cargar datos de las fuentes." : null;

      if (import.meta?.env?.DEV) {
        const hostBreakdown = {
          vmware: providerStatus.vmware?.hostCount || 0,
          hyperv: providerStatus.hyperv?.hostCount || 0,
          ovirt: providerStatus.ovirt?.hostCount || 0,
          cedia: providerStatus.cedia?.hostCount || 0,
          azure: providerStatus.azure?.hostCount || 0,
        };
        hostBreakdown.total =
          hostBreakdown.vmware +
          hostBreakdown.hyperv +
          hostBreakdown.ovirt +
          hostBreakdown.cedia +
          hostBreakdown.azure;
        console.info("[MissionControl] host counts", hostBreakdown);
      }

      setState({
        loading: false,
        errorSummary,
        vms,
        hosts,
        kpis,
        envKpis,
        providerMeta,
        providerStatus,
      });
    };

    fetchAll();

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => state, [state]);
}

export const missionControlProviderLabels = PROVIDER_LABELS;
