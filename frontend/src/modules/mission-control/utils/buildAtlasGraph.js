const normalizeKey = (value, fallback) => {
  const raw = value == null || value === "" ? fallback : value;
  return String(raw || "").trim();
};

const toSlug = (value) =>
  normalizeKey(value, "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9-_:.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

const sortByName = (a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

const isPoweredOn = (state) => String(state || "").toUpperCase() === "POWERED_ON";
const isPoweredOff = (state) => String(state || "").toUpperCase() === "POWERED_OFF";

const PROVIDER_LABELS = {
  vmware: "VMware",
  hyperv: "Hyper-V",
  ovirt: "oVirt",
  cedia: "CEDIA",
  unknown: "Unknown",
};

const safeNumber = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const accumulateCounts = (bucket, vm) => {
  bucket.total += 1;
  if (isPoweredOn(vm.power_state)) bucket.on += 1;
  if (isPoweredOff(vm.power_state)) bucket.off += 1;
  const provider = vm.provider || "unknown";
  bucket.providers[provider] = (bucket.providers[provider] || 0) + 1;
};

export function buildAtlasGraph({ vms = [], hosts = [], envKpis = {} } = {}) {
  const nodes = [];
  const links = [];
  const envMap = new Map();
  const providerMap = new Map();
  const clusterMap = new Map();
  const hostMap = new Map();
  const vmMap = new Map();
  const clusterEnvMap = new Map();

  const normalizeProvider = (value) => normalizeKey(value, "unknown").toLowerCase();

  const envNames = new Set(Object.keys(envKpis || {}).filter(Boolean));
  vms.forEach((vm) => {
    const envName = normalizeKey(vm.environment, "desconocido");
    envNames.add(envName);
    const clusterName = normalizeKey(vm.cluster, "Sin cluster");
    const provider = normalizeProvider(vm.provider);
    clusterEnvMap.set(`${provider}::${clusterName}`.toLowerCase(), envName);
  });
  if (!envNames.size && hosts.length) {
    envNames.add("desconocido");
  }

  Array.from(envNames)
    .sort(sortByName)
    .forEach((envName) => {
      const envId = `env:${toSlug(envName)}`;
      const metaSeed = envKpis?.[envName];
      const meta = metaSeed
        ? {
            total: metaSeed.total || 0,
            on: metaSeed.on || 0,
            off: metaSeed.off || 0,
            providers: metaSeed.providers || {},
          }
        : { total: 0, on: 0, off: 0, providers: {} };
      const node = {
        id: envId,
        type: "env",
        name: envName,
        environment: envName,
        meta,
        sizeHint: 48,
      };
      envMap.set(envId, node);
      nodes.push(node);
    });

  const ensureEnv = (envName) => {
    const envId = `env:${toSlug(envName)}`;
    if (!envMap.has(envId)) {
      const metaSeed = envKpis?.[envName];
      const meta = metaSeed
        ? {
            total: metaSeed.total || 0,
            on: metaSeed.on || 0,
            off: metaSeed.off || 0,
            providers: metaSeed.providers || {},
          }
        : { total: 0, on: 0, off: 0, providers: {} };
      const node = {
        id: envId,
        type: "env",
        name: envName,
        environment: envName,
        meta,
        sizeHint: 48,
      };
      envMap.set(envId, node);
      nodes.push(node);
    }
    return envId;
  };

  const ensureProvider = ({ envName, provider }) => {
    const envId = ensureEnv(envName);
    const providerSlug = toSlug(provider);
    const providerLabel = PROVIDER_LABELS[provider] || provider;
    const providerId = `prov:${envId}:${providerSlug}`;
    if (!providerMap.has(providerId)) {
      const node = {
        id: providerId,
        type: "provider",
        name: providerLabel,
        provider,
        environment: envName,
        envId,
        meta: { total: 0, on: 0, off: 0, providers: {} },
        sizeHint: 38,
      };
      providerMap.set(providerId, node);
      nodes.push(node);
      if (envMap.has(envId)) {
        links.push({ source: envId, target: providerId });
      }
    }
    return providerId;
  };

  const ensureCluster = ({ envName, clusterName, provider }) => {
    const providerId = ensureProvider({ envName, provider });
    const clusterKey = `${providerId}:${toSlug(clusterName)}`;
    const clusterId = `cluster:${clusterKey}`;
    if (!clusterMap.has(clusterId)) {
      const meta = { total: 0, on: 0, off: 0, providers: {} };
      const node = {
        id: clusterId,
        type: "cluster",
        name: clusterName,
        provider,
        environment: envName,
        envId: `env:${toSlug(envName)}`,
        providerId,
        cluster: clusterName,
        meta,
        sizeHint: 32,
      };
      clusterMap.set(clusterId, node);
      nodes.push(node);
      links.push({ source: providerId, target: clusterId });
    }
    return clusterId;
  };

  const ensureHost = ({ clusterId, hostName, provider, envName, clusterName, providerId }) => {
    const hostKey = `${clusterId}:${toSlug(hostName)}`;
    const hostId = `host:${hostKey}`;
    if (!hostMap.has(hostId)) {
      const node = {
        id: hostId,
        type: "host",
        name: hostName,
        provider,
        environment: envName,
        envId: `env:${toSlug(envName)}`,
        providerId,
        cluster: clusterName,
        clusterId,
        host: hostName,
        sourceId: null,
        meta: { vmCount: 0 },
        sizeHint: 20,
      };
      hostMap.set(hostId, node);
      nodes.push(node);
      links.push({ source: clusterId, target: hostId });
    }
    return hostId;
  };

  vms.forEach((vm) => {
    if (!vm) return;
    const envName = normalizeKey(vm.environment, "desconocido");
    const clusterName = normalizeKey(vm.cluster, "Sin cluster");
    const provider = normalizeProvider(vm.provider);
    const hostName = normalizeKey(vm.host, "Sin host");
    const clusterId = ensureCluster({ envName, clusterName, provider });
    const clusterNode = clusterMap.get(clusterId);
    const providerId = clusterNode?.providerId || ensureProvider({ envName, provider });
    const hostId = ensureHost({ clusterId, hostName, provider, envName, clusterName, providerId });
    const vmIdSeed = normalizeKey(vm.id || vm.name, `${provider}-${hostName}`);
    const vmId = `vm:${toSlug(provider)}:${toSlug(vmIdSeed)}`;
    if (!vmMap.has(vmId)) {
      const node = {
        id: vmId,
        type: "vm",
        name: normalizeKey(vm.name, vmIdSeed),
        provider,
        power_state: vm.power_state || null,
        cpu_usage_pct: safeNumber(vm.cpu_usage_pct),
        ram_usage_pct: safeNumber(vm.ram_usage_pct),
        memory_size_MiB: safeNumber(vm.memory_size_MiB),
        environment: envName,
        envId: `env:${toSlug(envName)}`,
        providerId,
        cluster: clusterName,
        clusterId,
        host: hostName,
        hostId,
        sourceId: vm.id || null,
        sizeHint: 6,
      };
      vmMap.set(vmId, node);
      nodes.push(node);
      links.push({ source: hostId, target: vmId });
    }
    const hostNode = hostMap.get(hostId);
    if (hostNode) {
      hostNode.meta.vmCount += 1;
    }
    if (clusterNode) {
      accumulateCounts(clusterNode.meta, vm);
    }
    const providerNode = providerMap.get(providerId);
    if (providerNode) {
      accumulateCounts(providerNode.meta, vm);
    }
    const envNode = envMap.get(`env:${toSlug(envName)}`);
    if (envNode && envNode.meta) {
      accumulateCounts(envNode.meta, vm);
    }
  });

  hosts.forEach((host) => {
    if (!host) return;
    const provider = normalizeProvider(host.provider);
    const clusterName = normalizeKey(host.cluster, "Sin cluster");
    const envName =
      clusterEnvMap.get(`${provider}::${clusterName}`.toLowerCase()) ||
      normalizeKey(host.environment, "desconocido");
    const clusterId = ensureCluster({ envName, clusterName, provider });
    const hostName = normalizeKey(host.name, "Sin host");
    const clusterNode = clusterMap.get(clusterId);
    const providerId = clusterNode?.providerId || ensureProvider({ envName, provider });
    const hostId = ensureHost({ clusterId, hostName, provider, envName, clusterName, providerId });
    const existing = hostMap.get(hostId);
    if (!existing) return;
    existing.sourceId = host.id || existing.sourceId;
    existing.cpu_usage_pct = safeNumber(host.cpu_usage_pct);
    existing.memory_usage_pct = safeNumber(host.memory_usage_pct);
    existing.health = host.health || null;
    existing.connection_state = host.connection_state || null;
    if (safeNumber(host.total_vms) != null) {
      existing.meta.vmCount = safeNumber(host.total_vms);
    }
  });

  const stats = {
    envCount: envMap.size,
    providerCount: providerMap.size,
    clusterCount: clusterMap.size,
    hostCount: hostMap.size,
    vmCount: vmMap.size,
  };

  return { nodes, links, stats };
}

export function filterAtlasGraphByFocus(graph, focusId) {
  if (!focusId || !graph?.nodes?.length) return graph;
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodeMap.has(focusId)) return graph;

  const childrenMap = new Map();
  const parentMap = new Map();
  graph.links.forEach((link) => {
    if (!childrenMap.has(link.source)) childrenMap.set(link.source, new Set());
    childrenMap.get(link.source).add(link.target);
    if (!parentMap.has(link.target)) parentMap.set(link.target, new Set());
    parentMap.get(link.target).add(link.source);
  });

  const include = new Set();
  const stack = [focusId];
  while (stack.length) {
    const current = stack.pop();
    if (!current || include.has(current)) continue;
    include.add(current);
    const children = childrenMap.get(current);
    if (children) {
      children.forEach((child) => stack.push(child));
    }
  }

  const ancestorStack = [focusId];
  while (ancestorStack.length) {
    const current = ancestorStack.pop();
    if (!current) continue;
    const parents = parentMap.get(current);
    if (!parents) continue;
    parents.forEach((parent) => {
      if (!include.has(parent)) {
        include.add(parent);
        ancestorStack.push(parent);
      }
    });
  }

  const nodes = graph.nodes.filter((node) => include.has(node.id));
  const links = graph.links.filter(
    (link) => include.has(link.source) && include.has(link.target)
  );
  const stats = nodes.reduce(
    (acc, node) => {
      if (node.type === "env") acc.envCount += 1;
      if (node.type === "provider") acc.providerCount += 1;
      if (node.type === "cluster") acc.clusterCount += 1;
      if (node.type === "host") acc.hostCount += 1;
      if (node.type === "vm") acc.vmCount += 1;
      return acc;
    },
    { envCount: 0, providerCount: 0, clusterCount: 0, hostCount: 0, vmCount: 0 }
  );

  return { nodes, links, stats };
}
