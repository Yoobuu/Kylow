import api from "./axios";

export async function getOvirtHostsSnapshot() {
  const response = await api.get("/ovirt/hosts/snapshot");
  if (response.status === 204) {
    return { empty: true };
  }
  return response.data;
}

export async function postOvirtHostsRefresh(body = { force: false }) {
  const { data } = await api.post("/ovirt/hosts/refresh", body);
  return data;
}

export async function getOvirtHostsJob(jobId) {
  const { data } = await api.get(`/ovirt/hosts/jobs/${jobId}`);
  return data;
}

export async function getOvirtHostDetail(hostId) {
  const { data } = await api.get(`/ovirt/hosts/${hostId}`);
  return data;
}

export async function getOvirtHostDeep(hostId) {
  const { data } = await api.get(`/ovirt/hosts/${hostId}/deep`);
  return data;
}
