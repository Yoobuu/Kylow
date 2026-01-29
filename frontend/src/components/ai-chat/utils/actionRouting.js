const buildUrl = ({ path, query }) => {
  if (!path) return "";
  const [base, existingQuery] = path.split("?");
  const params = new URLSearchParams(existingQuery || "");
  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
};

const labelForAction = (action) => {
  const type = (action?.type || "").toUpperCase();
  if (action?.label) return action.label;
  if (type === "NAVIGATE") return "Abrir detalle";
  if (type === "OPEN_VM") return "Abrir VM";
  if (type === "OPEN_HOST") return "Abrir host";
  if (type === "OPEN_HYPERV_VM") return "Abrir VM Hyper-V";
  if (type === "OPEN_HYPERV_HOST") return "Abrir host Hyper-V";
  return "Acción";
};

const actionToNavigate = (action) => {
  if (!action || typeof action !== "object") return null;
  const type = (action.type || "").toUpperCase();
  const payload = action.payload || {};

  if (type === "NAVIGATE") {
    return {
      path: payload.path,
      query: payload.query || {},
    };
  }

  if (type === "OPEN_VM") {
    const provider = (payload.provider || "vmware").toLowerCase();
    if (provider === "ovirt" || provider === "kvm") {
      return { path: "/kvm", query: { view: "vms", vmId: payload.id } };
    }
    if (provider === "hyperv" || provider === "hyper-v") {
      return {
        path: "/hyperv",
        query: { view: "vms", vm: payload.name || payload.vm || payload.id, host: payload.host },
      };
    }
    if (provider === "cedia") {
      return { path: "/cedia", query: { vmId: payload.id } };
    }
    if (provider === "azure") {
      return { path: "/azure", query: { vmId: payload.id } };
    }
    return { path: "/vmware", query: { vmId: payload.id } };
  }

  if (type === "OPEN_HOST") {
    const provider = (payload.provider || "vmware").toLowerCase();
    if (provider === "ovirt" || provider === "kvm") {
      return { path: "/kvm", query: { view: "hosts", hostId: payload.id } };
    }
    if (provider === "hyperv" || provider === "hyper-v") {
      return { path: "/hyperv", query: { view: "hosts", host: payload.name || payload.host } };
    }
    return { path: "/hosts", query: { hostId: payload.id } };
  }

  if (type === "OPEN_HYPERV_VM") {
    return {
      path: "/hyperv",
      query: { view: "vms", vm: payload.name || payload.vm, host: payload.host },
    };
  }

  if (type === "OPEN_HYPERV_HOST") {
    return {
      path: "/hyperv",
      query: { view: "hosts", host: payload.host || payload.name },
    };
  }

  return null;
};

export { actionToNavigate, buildUrl, labelForAction };
