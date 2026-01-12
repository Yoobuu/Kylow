import api from "./axios";

export async function getHosts(params = {}) {
  const { data } = await api.get("/hosts/", { params });
  return data;
}

export async function getVmwareHostsSnapshot() {
  const response = await api.get("/vmware/hosts/snapshot");
  if (response.status === 204) {
    return { empty: true };
  }
  return response.data;
}

export async function postVmwareHostsRefresh(body = { force: false }) {
  const { data } = await api.post("/vmware/hosts/refresh", body);
  return data;
}

export async function getVmwareHostsJob(jobId) {
  const { data } = await api.get(`/vmware/hosts/jobs/${jobId}`);
  return data;
}

export async function getHostDetail(id, params = {}) {
  const { data } = await api.get(`/hosts/${id}`, { params });
  return data;
}

export async function getHostDeep(id, params = {}) {
  const { data } = await api.get(`/hosts/${id}/deep`, { params });
  return data;
}
