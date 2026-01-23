import api from "./axios";

export async function getOvirtSnapshot() {
  const response = await api.get("/ovirt/snapshot");
  if (response.status === 204) {
    return { empty: true };
  }
  return response.data;
}

export async function postOvirtRefresh(body = { force: false }) {
  const { data } = await api.post("/ovirt/refresh", body);
  return data;
}

export async function getOvirtJob(jobId) {
  const { data } = await api.get(`/ovirt/jobs/${jobId}`);
  return data;
}

export async function getOvirtVmDetail(vmId) {
  const { data } = await api.get(`/ovirt/vms/${vmId}`);
  return data;
}

export async function getOvirtVmPerf(vmId, params = {}, signal) {
  const { data } = await api.get(`/ovirt/vms/${vmId}/perf`, { params, signal });
  return data;
}
