import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getCediaSnapshot, getCediaVm, getCediaVmMetrics } from "../api/cedia";
import { useAuth } from "../context/AuthContext";
import AccessDenied from "./AccessDenied";
import LoadingThreeDotsJumping from "./LoadingThreeDotsJumping";
import VMSummaryCards from "./VMTable/VMSummaryCards";
import { columnsVMware } from "./inventoryColumns.jsx";
import { exportCediaInventoryXlsx } from "../lib/exportXlsx";
import InventoryMetaBar from "./common/InventoryMetaBar";
import { formatGuayaquilDateTime } from "../lib/snapshotTime";

const STATUS_COLORS = {
  POWERED_ON: "text-emerald-600 bg-emerald-50 border-emerald-200",
  POWERED_OFF: "text-rose-600 bg-rose-50 border-rose-200",
  SUSPENDED: "text-amber-600 bg-amber-50 border-amber-200",
  "4": "text-emerald-600 bg-emerald-50 border-emerald-200",
  UNKNOWN: "text-gray-700 bg-gray-50 border-gray-200",
};

const STATUS_LABELS = {
  POWERED_ON: "Encendida",
  POWERED_OFF: "Apagada",
  SUSPENDED: "Suspendida",
  RESOLVED: "Resuelta",
  DEPLOYED: "Desplegada",
  MIXED: "Mixta",
  UNKNOWN: "Desconocido",
};

function normalizeStatus(raw) {
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
}

function formatDateTime(value) {
  return formatGuayaquilDateTime(value) || "—";
}

function formatNumber(value, options = {}) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString(undefined, options);
}

function normalizeCediaRecord(vm, idx = 0) {
  const status = normalizeStatus(vm?.status);
  const env = vm?.orgName || "CEDIA";
  const id = vm?.id || (vm?.href ? String(vm.href).split("/").pop() : null) || `cedia-${idx}`;
  const ipList = vm?.ipAddress
    ? String(vm.ipAddress)
        .split(/[,\s]+/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];
  const cpuMetricRaw = extractMetricValue(vm?.metrics, "cpu.usage.average");
  const ramMetricRaw = extractMetricValue(vm?.metrics, "mem.usage.average");
  const cpuPctRaw =
    sanitizeMetricNumber(vm?.cpu_pct ?? vm?.cpu_usage_pct) ??
    sanitizeMetricNumber(cpuMetricRaw === "—" ? undefined : cpuMetricRaw);
  const ramPctRaw =
    sanitizeMetricNumber(vm?.mem_pct ?? vm?.ram_usage_pct) ??
    sanitizeMetricNumber(ramMetricRaw === "—" ? undefined : ramMetricRaw);
  const diskBars = buildDiskBarsFromSnapshot(vm?.disks);

  return {
    id,
    name: vm?.name || "VM",
    power_state: status,
    environment: env,
    host: vm?.vdcName || "—",
    cluster: vm?.containerName || vm?.vdcName || "—",
    cpu_count: vm?.numberOfCpus,
    cpu_usage_pct: Number.isFinite(cpuPctRaw) ? cpuPctRaw : undefined,
    memory_size_MiB: vm?.memoryMB,
    ram_usage_pct: Number.isFinite(ramPctRaw) ? ramPctRaw : undefined,
    guest_os: vm?.detectedGuestOs || vm?.guestOs || "—",
    networks: [],
    vlans: [],
    ip_addresses: ipList,
    disks: diskBars,
    nics: [],
    status_raw: vm?.status,
    _rowId: id,
    _raw: vm,
  };
}

function buildDiskBars(detail, metrics) {
  const disks = extractDisks(detail);
  if (!Array.isArray(disks) || disks.length === 0) return [];

  const provisioned = extractMetricValue(metrics, "disk.provisioned.latest");
  const used = extractMetricValue(metrics, "disk.used.latest");

  const provNum = Number(provisioned);
  const usedNum = Number(used);
  const totalPct = Number.isFinite(provNum) && provNum > 0 && Number.isFinite(usedNum) ? (usedNum / provNum) * 100 : undefined;

  return disks.map((disk, idx) => {
    const label = disk?.name || disk?.id || disk?.label || `Disco ${idx + 1}`;
    const capacityKiB =
      pickNumber(
        disk?.provisionedKiB ??
        disk?.capacityKiB ??
        disk?.provisionedMB ??
        disk?.provisionedSizeMB ??
        disk?.capacityMB ??
        disk?.sizeMB ??
        disk?.provisionedSize ??
        disk?.capacity ??
        disk?.size
      ) ?? (Number.isFinite(provNum) ? provNum : undefined);
    const usedKiB =
      pickNumber(
        disk?.usedKiB ||
          disk?.usedMB ||
          disk?.consumedMB ||
          disk?.usedMiB ||
          disk?.consumedMiB ||
          disk?.used ||
          disk?.consumed
      ) ??
      (Number.isFinite(usedNum) ? usedNum : undefined);
    const pctFromDisk =
      Number.isFinite(usedKiB) && Number.isFinite(capacityKiB) && capacityKiB > 0
        ? (usedKiB / capacityKiB) * 100
        : undefined;
    const pct = pctFromDisk ?? totalPct;

    const parts = [label];
    if (Number.isFinite(capacityKiB)) parts.push(formatStorageKiB(capacityKiB));
    if (Number.isFinite(usedKiB)) parts.push(`Usado ${formatStorageKiB(usedKiB)}`);
    if (Number.isFinite(pct)) parts.push(`${pct.toFixed(1)}%`);

    return {
      text: parts.join(" · "),
      pct,
      provisionedKiB: capacityKiB,
      usedKiB: usedKiB,
      capacityDisplay: Number.isFinite(capacityKiB) ? formatStorageKiB(capacityKiB) : "—",
      usedDisplay: Number.isFinite(usedKiB) ? formatStorageKiB(usedKiB) : "—",
      label,
    };
  });
}

function buildDiskBarsFromSnapshot(disks) {
  if (!Array.isArray(disks) || disks.length === 0) return [];
  return disks.map((disk, idx) => {
    const usedKiB = pickNumber(disk?.used_kb ?? disk?.used_kib ?? disk?.usedKiB);
    const provisionedKiB = pickNumber(
      disk?.provisioned_kb ?? disk?.provisioned_kib ?? disk?.provisionedKiB
    );
    const pct =
      Number.isFinite(usedKiB) && Number.isFinite(provisionedKiB) && provisionedKiB > 0
        ? (usedKiB / provisionedKiB) * 100
        : undefined;
    const displayIndex =
      Number.isFinite(Number(disk?.index)) ? Number(disk.index) + 1 : idx + 1;
    const label = disk?.label || disk?.name || disk?.id || `Disco ${displayIndex}`;
    const parts = [label];
    if (Number.isFinite(provisionedKiB)) parts.push(formatStorageKiB(provisionedKiB));
    if (Number.isFinite(usedKiB)) parts.push(`Usado ${formatStorageKiB(usedKiB)}`);
    if (Number.isFinite(pct)) parts.push(`${pct.toFixed(1)}%`);
    return {
      text: parts.join(" · "),
      pct,
      provisionedKiB,
      usedKiB,
      capacityDisplay: Number.isFinite(provisionedKiB) ? formatStorageKiB(provisionedKiB) : "—",
      usedDisplay: Number.isFinite(usedKiB) ? formatStorageKiB(usedKiB) : "—",
      label,
    };
  });
}

function summarizeNetworks(detail) {
  const nics = extractNics(detail);
  const nets = nics
    .map((nic) => nic?.network || nic?.networkName || nic?.Network || nic?.NetworkName)
    .filter(Boolean);
  return Array.from(new Set(nets));
}

function normalizeVmId(vmOrId) {
  if (!vmOrId) return null;
  const raw =
    typeof vmOrId === "string"
      ? vmOrId
      : vmOrId._normalizedId ||
        vmOrId.id ||
        (vmOrId.href ? String(vmOrId.href).split("/").pop() : null) ||
        vmOrId._rowId;

  if (!raw) return null;

  const vmMatch = String(raw).match(/vm-[\w-]+/);
  if (vmMatch) return vmMatch[0];

  if (String(raw).startsWith("urn:")) {
    const tail = String(raw).split(":").pop();
    if (!tail) return null;
    return tail.startsWith("vm-") ? tail : `vm-${tail}`;
  }

  return raw;
}

function pickMetricValue(raw) {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number" || typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const candidate = pickMetricValue(item);
      if (candidate !== undefined) return candidate;
    }
    return undefined;
  }
  if (typeof raw === "object") {
    if ("value" in raw) return raw.value;
    if ("values" in raw) return pickMetricValue(raw.values);
    if ("sample" in raw) return pickMetricValue(raw.sample);
    if ("samples" in raw) return pickMetricValue(raw.samples);
    if ("entry" in raw && Array.isArray(raw.entry)) {
      for (const entry of raw.entry) {
        const candidate = pickMetricValue(entry);
        if (candidate !== undefined) return candidate;
      }
    }
    // Map/dict style: take first numeric-ish value
    const vals = Object.values(raw);
    for (const val of vals) {
      const candidate = pickMetricValue(val);
      if (candidate !== undefined) return candidate;
    }
  }
  return undefined;
}

function sanitizeMetricNumber(value) {
  const num = pickNumber(value);
  if (!Number.isFinite(num)) return undefined;
  if (num <= -0.0001) return undefined;
  return num;
}

function collectMetricEntries(metrics) {
  if (!metrics) return [];
  if (Array.isArray(metrics.metric)) return metrics.metric;
  if (metrics.metricSeries?.entry) return metrics.metricSeries.entry;
  if (Array.isArray(metrics.metricSeries)) return metrics.metricSeries;
  if (Array.isArray(metrics.metricSeries?.entry)) return metrics.metricSeries.entry;
  if (Array.isArray(metrics.metricSeries?.metric)) return metrics.metricSeries.metric;
  return [];
}

function normalizeMetrics(metrics) {
  const result = {
    cpuUsageAvg: undefined,
    cpuUsageMax: undefined,
    cpuUsageMhzAvg: undefined,
    memUsageAvg: undefined,
    memUsageMax: undefined,
    diskUsedLatest: undefined,
    diskProvisionedLatest: undefined,
    diskUnsharedLatest: undefined,
    diskLatencyAvg: undefined,
    netReceivedAvg: undefined,
    netTransmittedAvg: undefined,
    diskUsedByIndex: {},
    diskProvisionedByIndex: {},
  };

  const read = (key) => sanitizeMetricNumber(extractMetricValue(metrics, key));
  result.cpuUsageAvg = read("cpu.usage.average");
  result.cpuUsageMax = read("cpu.usage.maximum");
  result.cpuUsageMhzAvg = read("cpu.usagemhz.average");
  result.memUsageAvg = read("mem.usage.average");
  result.memUsageMax = read("mem.usage.maximum");
  result.diskUsedLatest = read("disk.used.latest");
  result.diskProvisionedLatest = read("disk.provisioned.latest");
  result.diskUnsharedLatest = read("disk.unshared.latest");
  result.diskLatencyAvg = read("disk.latency.total.average");
  result.netReceivedAvg = read("net.received.average");
  result.netTransmittedAvg = read("net.transmitted.average");

  const entries = collectMetricEntries(metrics);
  entries.forEach((entry) => {
    const name = entry?.name;
    if (!name) return;
    const value = sanitizeMetricNumber(entry?.value ?? entry?.values ?? entry?.sample ?? entry?.samples ?? entry?.data);
    if (value === undefined) return;
    const usedMatch = String(name).match(/^disk\.used\.latest\.(\d+)$/);
    if (usedMatch) {
      result.diskUsedByIndex[Number(usedMatch[1])] = value;
      return;
    }
    const provMatch = String(name).match(/^disk\.provisioned\.latest\.(\d+)$/);
    if (provMatch) {
      result.diskProvisionedByIndex[Number(provMatch[1])] = value;
    }
  });

  return result;
}

function extractMetricValue(metrics, key) {
  if (!metrics) return "—";

  const searchPrefix = (obj) => {
    if (!obj || typeof obj !== "object") return undefined;
    for (const [k, v] of Object.entries(obj)) {
      if (k === key || k.endsWith(`.${key}`) || k.startsWith(`${key}.`) || k.includes(`${key}.`)) {
        const candidate = pickMetricValue(v);
        if (candidate !== undefined) return candidate;
      }
    }
    return undefined;
  };

  const direct = pickMetricValue(metrics[key]);
  if (direct !== undefined) return direct;

  for (const group of [metrics.cpu, metrics.memory, metrics.disk, metrics.network]) {
    const fromGroup = pickMetricValue(group?.[key]);
    if (fromGroup !== undefined) return fromGroup;
    const fromPrefix = searchPrefix(group);
    if (fromPrefix !== undefined) return fromPrefix;
  }

  const candidates =
    (Array.isArray(metrics.metric) && metrics.metric) ||
    (metrics.metricSeries && (metrics.metricSeries.entry || metrics.metricSeries)) ||
    [];

  if (Array.isArray(candidates)) {
    const matched = candidates.filter(
      (item) => item?.name === key || String(item?.name || "").startsWith(`${key}.`) || String(item?.name || "").includes(key)
    );
    if (matched.length > 0) {
      const values = matched
        .map((entry) => pickMetricValue(entry.value ?? entry.values ?? entry.sample ?? entry.samples ?? entry.data))
        .filter((v) => v !== undefined);
      if (values.length === 1) return values[0];
      if (values.length > 1) {
        const sum = values.reduce((acc, curr) => (typeof curr === "number" ? acc + curr : acc), 0);
        if (sum !== 0) return sum;
        return values[0];
      }
    }
  }

  const prefixed = searchPrefix(metrics);
  if (prefixed !== undefined) return prefixed;

  return "—";
}

function deepFindArray(obj, predicate, depth = 0, seen = new Set()) {
  if (!obj || typeof obj !== "object" || depth > 4) return undefined;
  if (seen.has(obj)) return undefined;
  seen.add(obj);

  if (Array.isArray(obj)) {
    if (predicate(obj)) return obj;
    for (const item of obj) {
      const found = deepFindArray(item, predicate, depth + 1, seen);
      if (found) return found;
    }
    return undefined;
  }

  for (const value of Object.values(obj)) {
    const found = deepFindArray(value, predicate, depth + 1, seen);
    if (found) return found;
  }
  return undefined;
}

function pickNumber(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(num) ? num : undefined;
  }
  if (typeof value === "object") {
    if ("#text" in value) return pickNumber(value["#text"]);
    if ("value" in value) return pickNumber(value.value);
    if ("capacity" in value) return pickNumber(value.capacity);
    const vals = Object.values(value);
    for (const v of vals) {
      const num = pickNumber(v);
      if (num !== undefined) return num;
    }
  }
  return undefined;
}

function formatStorageKiB(value) {
  // Pure conversion: expects raw KiB, never pre-converted values or strings.
  if (typeof value !== "number") return "—";
  const kib = value;
  if (!Number.isFinite(kib) || kib < 0) return "—";
  const gib = kib / 1024 / 1024;
  if (gib >= 1024) {
    const tib = gib / 1024;
    return `${tib.toFixed(2)} TiB`;
  }
  return `${gib.toFixed(2)} GiB`;
}


function coerceBool(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (["true", "yes", "si", "sí", "1"].includes(lowered)) return true;
    if (["false", "no", "0"].includes(lowered)) return false;
  }
  return undefined;
}

function normalizeSizeToMB(value, unit) {
  const num = pickNumber(value);
  if (!Number.isFinite(num)) return undefined;
  const unitLower = String(unit || "").toLowerCase();
  if (unitLower.includes("byte") && !unitLower.includes("kilo") && !unitLower.includes("mega") && !unitLower.includes("giga")) {
    return num / 1024 / 1024;
  }
  if (unitLower.includes("kb") || unitLower.includes("kilo")) return num / 1024;
  if (unitLower.includes("gb") || unitLower.includes("giga")) return num * 1024;
  if (unitLower.includes("mb") || unitLower.includes("mega")) return num;
  return num;
}

function formatGiBFromMB(value) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "—";
  const gib = num / 1024;
  if (!Number.isFinite(gib)) return "—";
  return `${gib.toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;
}

function extractDiskSettings(detail) {
  if (!detail) return [];
  const sections = [];
  if (Array.isArray(detail.section)) sections.push(...detail.section);
  if (detail.section && !Array.isArray(detail.section)) sections.push(detail.section);

  const diskSections = sections
    .map((sec) => sec?.diskSection || sec?.DiskSection || sec?.disksection)
    .filter(Boolean);

  const settings = diskSections
    .flatMap((sec) => sec?.diskSettings || sec?.diskSetting || sec?.DiskSettings || [])
    .flat()
    .filter(Boolean);

  const directSettings = [
    detail.diskSettings,
    detail?.virtualHardwareSection?.diskSettings,
    detail?.hardware?.diskSettings,
  ]
    .filter(Array.isArray)
    .flat();

  return [...settings, ...directSettings];
}

function extractDisks(detail) {
  if (!detail) return [];

  const rasdItemToDisk = (item) => {
    const resourceType = item?.ResourceType ?? item?.resourceType ?? item?.["rasd:ResourceType"];
    if (String(resourceType) !== "17") return null;
    const host = item?.HostResource || item?.["rasd:HostResource"] || {};
    const elementName = item?.ElementName || item?.["rasd:ElementName"];
    const capacity =
      pickNumber(host?.capacity) ??
      pickNumber(host?.["rasd:capacity"]) ??
      pickNumber(host?.capacityMB) ??
      pickNumber(item?.VirtualQuantity) ??
      pickNumber(item?.["rasd:VirtualQuantity"]) ??
      pickNumber(host?.["ovf:capacity"]);

    return {
      id: item?.InstanceID || item?.["rasd:InstanceID"],
      name: elementName || item?.Description || item?.["rasd:Description"],
      unitNumber: item?.AddressOnParent || item?.["rasd:AddressOnParent"],
      busType: item?.ResourceSubType || item?.["rasd:ResourceSubType"],
      provisionedSize: capacity,
      usedMB: pickNumber(host?.consumedMB || host?.["rasd:consumedMB"]),
      controller: item?.Parent || item?.["rasd:Parent"],
    };
  };

  const fromRasdItems = () => {
    const sections = [
      detail.virtualHardwareSection,
      detail.virtualHardwareSectionDisks,
      detail.virtualHardware,
    ].filter(Boolean);
    const items = sections
      .flatMap((sec) => [
        sec?.Item,
        sec?.Items,
        sec?.RasdItemsList?.Item,
        sec?.RasdItemsList?.Items,
        sec?.VirtualHardwareSection?.Item,
      ])
      .flat()
      .filter(Boolean);

    const disks = items
      .map((item) => (Array.isArray(item) ? item : [item]))
      .flat()
      .map(rasdItemToDisk)
      .filter(Boolean);
    return disks;
  };

  const candidates = [
    detail.disks,
    detail.diskSettings,
    detail.virtualDisks,
    detail?.virtualHardwareSection?.diskSettings,
    detail?.hardware?.disks,
    detail?.hardware?.diskSettings,
    extractDiskSettings(detail),
  ].filter(Array.isArray).flat();
  if (candidates.length > 0) return candidates;

  const rasdDisks = fromRasdItems();
  if (rasdDisks.length > 0) return rasdDisks;

  const found = deepFindArray(
    detail,
    (arr) =>
      Array.isArray(arr) &&
      arr.some((item) => item && typeof item === "object" && ("unitNumber" in item || "provisionedSize" in item))
  );
  return Array.isArray(found) ? found : [];
}

function extractNics(detail) {
  if (!detail) return [];

  const fromNetworkSection = () => {
    const section =
      detail.networkConnectionSection ||
      detail.NetworkConnectionSection ||
      detail?.network ||
      detail?.NetworkConnection;
    const connections =
      section?.NetworkConnection ||
      section?.networkConnection ||
      section?.networkConnections ||
      (Array.isArray(section) ? section : []);
    return Array.isArray(connections) ? connections : [];
  };

  const nicsFromNetworkSection = fromNetworkSection();
  if (nicsFromNetworkSection.length > 0) return nicsFromNetworkSection;

  const candidates = [
    detail.networkAdapters,
    detail.nics,
    detail.networkConnections,
    detail?.virtualHardwareSection?.networkCards,
    detail?.hardware?.networkAdapters,
  ].filter(Array.isArray).flat();
  if (candidates.length > 0) return candidates;

  const found = deepFindArray(
    detail,
    (arr) =>
      Array.isArray(arr) &&
      arr.some((item) => item && typeof item === "object" && ("macAddress" in item || "network" in item || "ip" in item))
  );
  return Array.isArray(found) ? found : [];
}

function deriveCpuInfo(detail) {
  const cpuHotAdd =
    coerceBool(detail?.cpuHotAddEnabled) ??
    coerceBool(detail?.CpuHotAddEnabled) ??
    coerceBool(detail?.vmCapabilities?.cpuHotAddEnabled) ??
    coerceBool(detail?.hardware?.cpuHotAddEnabled) ??
    coerceBool(detail?.hardware?.CpuHotAddEnabled);
  const memHotAdd =
    coerceBool(detail?.memoryHotAddEnabled) ??
    coerceBool(detail?.MemoryHotAddEnabled) ??
    coerceBool(detail?.vmCapabilities?.memoryHotAddEnabled) ??
    coerceBool(detail?.hardware?.memoryHotAddEnabled) ??
    coerceBool(detail?.hardware?.MemoryHotAddEnabled);

  const sections = [
    detail?.virtualHardwareSection,
    detail?.virtualHardwareSectionDisks,
    detail?.virtualHardware,
    detail?.hardware,
  ].filter(Boolean);

  let coresPerSocket;
  let totalCpus = detail?.numberOfCpus ?? detail?.cpu;

  const cpuItems = sections
    .flatMap((sec) => [
      sec?.Item,
      sec?.Items,
      sec?.RasdItemsList?.Item,
      sec?.RasdItemsList?.Items,
      sec?.VirtualHardwareSection?.Item,
    ])
    .flat()
    .filter(Boolean)
    .map((item) => (Array.isArray(item) ? item : [item]))
    .flat()
    .filter((item) => {
      const rt = item?.ResourceType ?? item?.resourceType ?? item?.["rasd:ResourceType"];
      return String(rt) === "3";
    });

  if (cpuItems.length > 0) {
    const cpuItem = cpuItems[0];
    totalCpus =
      cpuItem?.VirtualQuantity ??
      cpuItem?.["rasd:VirtualQuantity"] ??
      cpuItem?.ElementName ??
      totalCpus;

    coresPerSocket =
      pickNumber(cpuItem?.coresPerSocket) ??
      pickNumber(cpuItem?.numCoresPerSocket) ??
      pickNumber(cpuItem?.["rasd:coresPerSocket"]) ??
      pickNumber(cpuItem?.["rasd:numCoresPerSocket"]) ??
      pickNumber(cpuItem?.["vmw:coresPerSocket"]);
  }

  return { totalCpus, coresPerSocket, cpuHotAdd, memHotAdd };
}

function normalizeDiskHardware(detail, metricsNormalized) {
  const disksRaw = extractDisks(detail);
  const disks = disksRaw.map((disk, idx) => {
    const unitNumber =
      pickNumber(disk?.unitNumber) ??
      pickNumber(disk?.unit) ??
      pickNumber(disk?.AddressOnParent) ??
      pickNumber(disk?.["rasd:AddressOnParent"]);
    const busNumber = pickNumber(disk?.busNumber) ?? pickNumber(disk?.bus);
    const adapterType = disk?.adapterType || disk?.busSubType || disk?.busType;
    const provisionedMB =
      normalizeSizeToMB(
        disk?.sizeMb ??
          disk?.sizeMB ??
          disk?.provisionedSizeMB ??
          disk?.provisionedSize ??
          disk?.capacityMB ??
          disk?.capacity ??
          disk?.provisionedSize ??
          disk?.VirtualQuantity ??
          disk?.["rasd:VirtualQuantity"],
        disk?.allocationUnits ?? disk?.AllocationUnits ?? disk?.allocationUnit
      ) ?? normalizeSizeToMB(disk?.virtualQuantity, disk?.allocationUnits);

    const index =
      pickNumber(disk?.diskIndex) ??
      pickNumber(disk?.index) ??
      pickNumber(disk?.diskId) ??
      (Number.isFinite(unitNumber) ? unitNumber : undefined) ??
      idx;

    const usedMetric = metricsNormalized?.diskUsedByIndex?.[index];
    const provMetric = metricsNormalized?.diskProvisionedByIndex?.[index];

    return {
      id: disk?.id || disk?.diskId || disk?.InstanceID || disk?.["rasd:InstanceID"],
      name: disk?.name || disk?.label || disk?.ElementName || disk?.Description,
      index,
      unitNumber,
      busNumber,
      adapterType,
      provisionedMB,
      usedKiB: usedMetric,
      provisionedKiB: provMetric,
      controller: disk?.controller || disk?.Parent || disk?.["rasd:Parent"],
    };
  });
  return disks;
}

function normalizeVMDetails(rawDetail, rawMetrics) {
  const detail = rawDetail || {};
  let metrics =
    rawMetrics ||
    detail?.metricsNormalized ||
    detail?.metrics ||
    detail?.metricSeries ||
    detail?.metric;
  if (Array.isArray(detail?.metric)) {
    metrics = { metric: detail.metric };
  }
  const metricsNormalized = normalizeMetrics(metrics);
  const cpuInfo = deriveCpuInfo(detail);
  const coresPerSocket =
    pickNumber(detail?.numCoresPerSocket) ??
    pickNumber(detail?.coresPerSocket) ??
    pickNumber(detail?.vmCapabilities?.numCoresPerSocket) ??
    cpuInfo.coresPerSocket;

  const createdAt =
    detail?.dateCreated ??
    detail?.createdDate ??
    detail?.created_at ??
    detail?.createdAt ??
    detail?.creationDate ??
    null;

  const osSectionFromArray = Array.isArray(detail?.section)
    ? detail.section.find(
        (sec) => sec?.operatingSystemSection || sec?.OperatingSystemSection
      )
    : null;
  const osDeclared =
    osSectionFromArray?.operatingSystemSection?.description?.value ??
    osSectionFromArray?.OperatingSystemSection?.description?.value ??
    detail?.section?.operatingSystemSection?.description?.value ??
    detail?.operatingSystemSection?.description?.value ??
    detail?.guestOs ??
    detail?.guestOS ??
    detail?.osType ??
    null;

  const osDetected =
    detail?.detectedGuestOs ??
    detail?.detectedGuestOS ??
    detail?.guest?.os ??
    detail?.guestOsDetected ??
    null;

  const status = normalizeStatus(detail?.status ?? detail?.power_state);
  const statusLabel = STATUS_LABELS[status] || status;
  const disks = normalizeDiskHardware(detail, metricsNormalized);
  const nics = extractNics(detail);

  return {
    raw: detail,
    metricsNormalized,
    cpuInfo: {
      totalCpus: cpuInfo.totalCpus,
      coresPerSocket,
      cpuHotAdd:
        coerceBool(detail?.vmCapabilities?.cpuHotAddEnabled) ??
        cpuInfo.cpuHotAdd ??
        coerceBool(detail?.cpuHotAddEnabled),
      memHotAdd:
        coerceBool(detail?.vmCapabilities?.memoryHotAddEnabled) ??
        cpuInfo.memHotAdd ??
        coerceBool(detail?.memoryHotAddEnabled),
    },
    createdAt,
    osDeclared,
    osDetected,
    status,
    statusLabel,
    disks,
    nics,
  };
}

function formatPercentValue(value) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "—";
  return `${num.toFixed(2)}%`;
}

function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  const tone = STATUS_COLORS[normalized] || "text-gray-700 bg-gray-50 border-gray-200";
  const label = STATUS_LABELS[normalized] || normalized || "—";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function DetailModal({ vmId, baseVm, detail, metrics, onClose, loading, error }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (import.meta?.env?.MODE === "production") return;
    if (!detail && !metrics && !baseVm) return;
    const merged = { ...(baseVm || {}), ...(detail || {}) };
    const normalized = normalizeVMDetails(merged, metrics);
    // eslint-disable-next-line no-console
    console.debug("cedia:vm-details", normalized);
  }, [baseVm, detail, metrics]);

  if (!vmId) return null;

  const normalizedId = normalizeVmId(vmId);
  const mergedDetail = { ...(baseVm || {}), ...(detail || {}) };
  const normalizedDetail = normalizeVMDetails(mergedDetail, metrics);
  const detailData = normalizedDetail.raw;
  const cpuInfo = normalizedDetail.cpuInfo;
  const disks = normalizedDetail.disks;
  const nics = normalizedDetail.nics;
  const metricsNormalized = normalizedDetail.metricsNormalized;
  const shortId =
    normalizedId && typeof normalizedId === "string" && normalizedId.startsWith("urn:")
      ? normalizedId.split(":").pop()
      : normalizedId;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4 py-10"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-200"
        >
          Cerrar
        </button>

        <div className="flex items-start justify-between gap-3 pr-14">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
              <span role="img" aria-label="vm">💠</span> Detalle de VM
            </div>
            <h2 className="mt-3 text-xl font-semibold text-gray-900">{detailData.name || "VM"}</h2>
            <p className="text-sm text-gray-500 break-all truncate" title={shortId || detailData.id || "—"}>
              {shortId || detailData.id || "—"}
            </p>
          </div>
        </div>

        {loading && (
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 space-y-3 animate-pulse">
            <div className="h-4 w-32 rounded bg-gray-200" />
            <div className="h-4 w-48 rounded bg-gray-200" />
            <div className="h-24 rounded bg-gray-200" />
          </div>
        )}
        {error && !loading && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            {error}
          </div>
        )}

        {!loading && (
          <div className="mt-6 grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7 space-y-3">
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800">Hardware</h3>
                <dl className="mt-2 grid grid-cols-2 gap-y-2 text-sm text-gray-700">
                  <DetailItem label="CPU" value={cpuInfo.totalCpus ?? detailData.cpu ?? detailData.numberOfCpus} />
                  <DetailItem label="RAM (MB)" value={formatNumber(detailData.memoryMB)} />
                  <DetailItem label="Cores/socket" value={cpuInfo.coresPerSocket} />
                  <DetailItem label="Hot add CPU" value={cpuInfo.cpuHotAdd ? "Sí" : cpuInfo.cpuHotAdd === false ? "No" : "—"} />
                  <DetailItem label="Hot add RAM" value={cpuInfo.memHotAdd ? "Sí" : cpuInfo.memHotAdd === false ? "No" : "—"} />
                  <DetailItem label="Estado" value={<StatusBadge status={normalizedDetail.status} />} />
                  <DetailItem label="OS declarado" value={normalizedDetail.osDeclared} />
                  <DetailItem label="OS detectado" value={normalizedDetail.osDetected} />
                </dl>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800">Discos</h3>
                <div className="mt-2 space-y-2">
                  {disks.map((disk, idx) => (
                    <div key={disk?.id || disk?.name || disk?.label || idx} className="rounded-md border border-gray-100 bg-gray-50 p-2 text-sm text-gray-700">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{disk?.name || disk?.id || disk?.label || `Disco ${idx + 1}`}</span>
                        <span className="text-xs text-gray-500">Unit {disk?.unitNumber ?? disk?.busNumber ?? "—"}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Provisionado:{" "}
                        {Number.isFinite(disk?.provisionedMB)
                          ? formatGiBFromMB(disk.provisionedMB)
                          : Number.isFinite(disk?.provisionedKiB)
                          ? formatStorageKiB(disk.provisionedKiB)
                          : "—"}{" "}
                        · Usado: {Number.isFinite(disk?.usedKiB) ? formatStorageKiB(disk.usedKiB) : "—"}
                      </div>
                      <div className="text-xs text-gray-500">Controlador: {disk?.controller ?? disk?.busSubType ?? disk?.busType ?? "—"}</div>
                    </div>
                  ))}
                  {disks.length === 0 && (
                    <div className="text-sm text-gray-500">Sin discos reportados.</div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800">NICs</h3>
                <div className="mt-2 space-y-2">
                  {nics.map((nic, idx) => (
                    <div key={nic?.macAddress || nic?.mac || nic?.id || idx} className="rounded-md border border-gray-100 bg-gray-50 p-2 text-sm text-gray-700">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">NIC {nic?.index ?? nic?.networkConnectionIndex ?? idx + 1}</span>
                        <span className="text-xs text-gray-500">{nic?.macAddress || nic?.mac || "—"}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Red: {nic?.network || nic?.networkName || nic?.networkConnection?.network || "—"} · IP:{" "}
                        {nic?.ipAddress ||
                          nic?.ip ||
                          nic?.IpAddress ||
                          (Array.isArray(nic?.ipAddresses) ? nic.ipAddresses[0] : undefined) ||
                          (Array.isArray(nic?.IpAddresses) ? nic.IpAddresses[0] : undefined) ||
                          (Array.isArray(nic?.ipAddressAllocationMode) ? nic.ipAddressAllocationMode[0] : undefined) ||
                          "—"}
                      </div>
                      <div className="text-xs text-gray-500">
                        Conectada:{" "}
                        {nic?.connected ??
                          nic?.isConnected ??
                          nic?.IsConnected ??
                          nic?.connectionState ??
                          nic?.LinkState ??
                          "—"}
                      </div>
                    </div>
                  ))}
                  {nics.length === 0 && (
                    <div className="text-sm text-gray-500">Sin NICs reportadas.</div>
                  )}
                </div>
              </section>
            </div>

            <div className="lg:col-span-5 space-y-3">
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800">Ubicación</h3>
                <dl className="mt-2 space-y-1 text-sm text-gray-700">
                  <DetailItem label="Org" value={detailData.orgName || detailData.org?.name} stacked />
                  <DetailItem label="VDC" value={detailData.vdcName || detailData.vdc?.name} stacked />
                  <DetailItem label="vApp" value={detailData.containerName || detailData.vAppParent || "—"} stacked />
                  <DetailItem label="Owner" value={detailData.ownerName || detailData.owner?.name} stacked />
                  <DetailItem label="Creada" value={formatDateTime(normalizedDetail.createdAt)} stacked />
                </dl>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800">Métricas actuales</h3>
                <dl className="mt-2 grid grid-cols-2 gap-y-2 text-sm text-gray-700">
                  <DetailItem label="CPU uso avg" value={formatPercentValue(metricsNormalized.cpuUsageAvg)} />
                  <DetailItem label="CPU uso max" value={formatPercentValue(metricsNormalized.cpuUsageMax)} />
                  <DetailItem label="CPU MHz avg" value={formatNumber(metricsNormalized.cpuUsageMhzAvg)} />
                  <DetailItem label="RAM uso avg" value={formatPercentValue(metricsNormalized.memUsageAvg)} />
                  <DetailItem label="RAM uso max" value={formatPercentValue(metricsNormalized.memUsageMax)} />
                  <DetailItem label="Disco usado" value={formatStorageKiB(metricsNormalized.diskUsedLatest)} />
                  <DetailItem label="Disco prov." value={formatStorageKiB(metricsNormalized.diskProvisionedLatest)} />
                  <DetailItem label="Disco unshared" value={formatStorageKiB(metricsNormalized.diskUnsharedLatest)} />
                  <DetailItem label="Disk latency" value={formatNumber(metricsNormalized.diskLatencyAvg)} />
                  <DetailItem label="Red RX avg" value={formatNumber(metricsNormalized.netReceivedAvg)} />
                  <DetailItem label="Red TX avg" value={formatNumber(metricsNormalized.netTransmittedAvg)} />
                </dl>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value, stacked = false }) {
  return (
    <div className={stacked ? "flex flex-col" : "flex"}>
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="text-sm text-gray-800">{value ?? "—"}</span>
    </div>
  );
}

function StatCard({ label, value, tone = "text-gray-900", bg = "bg-gray-50" }) {
  return (
    <div className={`rounded-xl border border-white/40 ${bg} px-4 py-3 shadow-sm`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold ${tone}`}>{value ?? "—"}</div>
    </div>
  );
}

export default function CediaPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("cedia.view");
  const [searchParams] = useSearchParams();
  const autoOpenRef = useRef(null);

  const [vms, setVms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState("");
  const [snapshotMessage, setSnapshotMessage] = useState("");
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState(null);
  const [snapshotSource, setSnapshotSource] = useState(null);
  const [snapshotStale, setSnapshotStale] = useState(false);
  const [snapshotStaleReason, setSnapshotStaleReason] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterEnv, setFilterEnv] = useState("");
  const [filterOs, setFilterOs] = useState("");
  const [selectedVm, setSelectedVm] = useState(null);
  const [vmDetail, setVmDetail] = useState(null);
  const [vmMetrics, setVmMetrics] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [enriched, setEnriched] = useState({});

  const fetchList = useCallback(() => {
    if (!canView) return;
    setLoading(true);
    setError("");
    setSnapshotMessage("");
    getCediaSnapshot()
      .then((snapshot) => {
        if (snapshot?.empty) {
          setVms([]);
          setSnapshotMessage("Esperando snapshot");
          setSnapshotGeneratedAt(null);
          setSnapshotSource(null);
          setSnapshotStale(false);
          setSnapshotStaleReason(null);
          return;
        }
        setSnapshotGeneratedAt(snapshot?.generated_at || null);
        setSnapshotSource(snapshot?.source || null);
        setSnapshotStale(Boolean(snapshot?.stale));
        setSnapshotStaleReason(snapshot?.stale_reason || null);
        const records = Array.isArray(snapshot?.data?.cedia) ? snapshot.data.cedia : [];
        setVms(records);
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail || err?.message || "No se pudo cargar CEDIA.";
        setError(detail);
      })
      .finally(() => setLoading(false));
  }, [canView]);
  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const normalized = useMemo(
    () => vms.map((vm, idx) => normalizeCediaRecord(vm, idx)),
    [vms]
  );

  useEffect(() => {
    let cancelled = false;
    if (!normalized.length) {
      setEnriched({});
      return undefined;
    }

    const fetchEnrichment = async () => {
      setEnriching(true);
      const results = {};
      const queue = [...normalized];
      const concurrency = 3;

      const worker = async () => {
        while (queue.length > 0 && !cancelled) {
          const vm = queue.pop();
          if (!vm || enriched[vm.id]) continue;
          try {
            const detailResp = await getCediaVm(vm.id);
            const detail = detailResp?.data || {};

            const diskBars = buildDiskBars(detail, vm?._raw?.metrics);
            const networks = summarizeNetworks(detail);

            results[vm.id] = {
              disks: diskBars,
              nics: extractNics(detail).map((nic) => nic?.network || nic?.networkName || nic?.ip || nic?.ipAddress).filter(Boolean),
              networks,
            };
          } catch {
            // ignore; keep base data
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, worker));
      if (!cancelled && Object.keys(results).length > 0) {
        setEnriched((prev) => ({ ...prev, ...results }));
      }
      if (!cancelled) setEnriching(false);
    };

    fetchEnrichment();
    return () => {
      cancelled = true;
      setEnriching(false);
    };
  }, [normalized, enriched]);

  const uniqueStatuses = useMemo(
    () => Array.from(new Set(normalized.map((vm) => vm.power_state).filter(Boolean))),
    [normalized]
  );
  const uniqueEnvs = useMemo(
    () => Array.from(new Set(normalized.map((vm) => vm.environment).filter(Boolean))),
    [normalized]
  );
  const uniqueOs = useMemo(
    () => Array.from(new Set(normalized.map((vm) => vm.guest_os).filter(Boolean))),
    [normalized]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return normalized.filter((vm) => {
      const matchesSearch =
        !term ||
        vm.name?.toLowerCase().includes(term) ||
        vm.environment?.toLowerCase().includes(term) ||
        vm.host?.toLowerCase().includes(term) ||
        vm.guest_os?.toLowerCase().includes(term);
      const matchesStatus = !filterStatus || vm.power_state === filterStatus;
      const matchesEnv = !filterEnv || vm.environment === filterEnv;
      const matchesOs = !filterOs || vm.guest_os === filterOs;
      return matchesSearch && matchesStatus && matchesEnv && matchesOs;
    });
  }, [normalized, search, filterStatus, filterEnv, filterOs]);

  const mergedFiltered = useMemo(
    () =>
      filtered.map((vm) => {
        const extra = enriched[vm.id] || {};
        const disks = Array.isArray(extra.disks) && extra.disks.length ? extra.disks : vm.disks;
        const networks = Array.isArray(extra.networks) && extra.networks.length ? extra.networks : vm.networks;
        const nics = Array.isArray(extra.nics) && extra.nics.length ? extra.nics : vm.nics;
        const cpuPct = extra.cpu_usage_pct ?? vm.cpu_usage_pct;
        const ramPct = extra.ram_usage_pct ?? vm.ram_usage_pct;
        return { ...vm, ...extra, disks, networks, nics, cpu_usage_pct: cpuPct, ram_usage_pct: ramPct };
      }),
    [filtered, enriched]
  );

  const summary = useMemo(() => {
    const total = filtered.length;
    const poweredOn = filtered.filter((vm) => vm.power_state === "POWERED_ON").length;
    const poweredOff = filtered.filter((vm) => vm.power_state === "POWERED_OFF").length;
    const ambientes = filtered.reduce((acc, vm) => {
      const env = vm.environment || "CEDIA";
      acc[env] = (acc[env] || 0) + 1;
      return acc;
    }, {});
    return { total, poweredOn, poweredOff, ambientes };
  }, [filtered]);

  const openDetail = async (vm) => {
    const baseVm = vm?._raw || vm;
    const normalizedId = normalizeVmId(baseVm);
    if (!normalizedId) return;
    setSelectedVm({ ...baseVm, _normalizedId: normalizedId });
    setDetailLoading(true);
    setDetailError("");
    setVmDetail(null);
    setVmMetrics(null);
    try {
      const [detailResp, metricsResp] = await Promise.allSettled([
        getCediaVm(normalizedId),
        getCediaVmMetrics(normalizedId),
      ]);
      if (detailResp.status === "fulfilled") setVmDetail(detailResp.value.data);
      if (metricsResp.status === "fulfilled") setVmMetrics(metricsResp.value.data);
      if (detailResp.status === "rejected") {
        setDetailError("No se pudo cargar el detalle de la VM.");
      }
      if (metricsResp.status === "rejected") {
        setDetailError((prev) => prev || "No se pudieron cargar las métricas.");
      }
    } catch (err) {
      setDetailError(err?.message || "No se pudo cargar el detalle.");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!canView) return;
    const vmIdParam = searchParams.get("vmId");
    if (!vmIdParam) return;
    if (autoOpenRef.current === vmIdParam) return;
    if (!normalized.length) return;
    const match = normalized.find((vm) => String(vm.id) === String(vmIdParam));
    autoOpenRef.current = vmIdParam;
    openDetail(match || { id: vmIdParam });
  }, [canView, normalized, openDetail, searchParams]);

  const closeDetail = () => {
    setSelectedVm(null);
    setVmDetail(null);
    setVmMetrics(null);
    setDetailError("");
  };

  if (!canView) {
    return <AccessDenied description="Necesitas el permiso cedia.view para acceder." />;
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-8" data-tutorial-id="cedia-root">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Inventario CEDIA</h2>
          <div className="mt-1 h-1 w-28 rounded-full bg-teal-500" />
          <p className="mt-2 text-sm text-gray-600">VMs consultadas en vCloud (puyu).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InventoryMetaBar
            generatedAt={snapshotGeneratedAt}
            source={snapshotSource}
            stale={snapshotStale}
            staleReason={snapshotStaleReason}
          />
          <input
            aria-label="Buscar en CEDIA"
            id="cedia-search"
            type="text"
            placeholder="Buscar por Nombre, OS, Org..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <select
            aria-label="Filtrar por estado"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">Estado</option>
            {uniqueStatuses.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por ambiente"
            value={filterEnv}
            onChange={(e) => setFilterEnv(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">Org/VDC</option>
            {uniqueEnvs.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por SO"
            value={filterOs}
            onChange={(e) => setFilterOs(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">SO</option>
            {uniqueOs.map((os) => (
              <option key={os} value={os}>
                {os}
              </option>
            ))}
          </select>
          <button
            aria-label="Refrescar inventario CEDIA"
            onClick={fetchList}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-teal-500 disabled:opacity-60"
          >
            {loading ? <span className="animate-spin">⏳</span> : null}
            Refrescar
          </button>
          <button
            aria-label="Exportar CEDIA a XLSX"
            onClick={() => exportCediaInventoryXlsx(mergedFiltered, "cedia_inventory")}
            disabled={!mergedFiltered.length || loading || enriching}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-teal-600 hover:text-teal-700 disabled:opacity-60"
          >
            {enriching ? <span className="animate-spin">⏳</span> : "⬇️"}
            Exportar XLSX
          </button>
        </div>
      </div>

      <VMSummaryCards summary={summary} />

      {(loading || error || enriching) && (
        <div className="mb-4 flex flex-wrap gap-3">
          {loading && (
            <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-700 shadow">
              <span className="animate-spin">⏳</span> Cargando VMs...
            </div>
          )}
          {enriching && !loading && (
            <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-700 shadow">
              <span className="animate-spin">✨</span> Actualizando detalle...
            </div>
          )}
          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 shadow">
              <span>⚠️ {error}</span>
              <button
                type="button"
                onClick={fetchList}
                className="rounded border border-amber-300 bg-white/80 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-white"
              >
                Reintentar
              </button>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow">
          <LoadingThreeDotsJumping className="text-teal-600" /> Cargando VMs...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 shadow">
          {error}
        </div>
      )}

      {snapshotMessage && !loading && !error && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 shadow">
          {snapshotMessage}
        </div>
      )}

      {!loading && !error && !snapshotMessage && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {columnsVMware.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-left font-medium text-gray-600">
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={columnsVMware.length + 1} className="px-4 py-6 text-center text-gray-500">
                    Sin resultados.
                  </td>
                </tr>
              ) : (
                mergedFiltered.map((vm) => (
                  <tr key={vm._rowId} className="hover:bg-gray-50">
                    {columnsVMware.map((col) => (
                      <td key={`${vm._rowId}-${col.key}`} className="px-3 py-2">
                        {col.render(vm)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(vm)}
                        aria-label={`Ver detalle de ${vm.name}`}
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-teal-600 hover:text-teal-700"
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <DetailModal
        vmId={normalizeVmId(selectedVm)}
        baseVm={selectedVm}
        detail={vmDetail}
        metrics={vmMetrics}
        loading={detailLoading}
        error={detailError}
        onClose={closeDetail}
      />
    </main>
  );
}
