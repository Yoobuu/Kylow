import api from "./axios";

export async function getVmwareSnapshot() {
  const response = await api.get("/vmware/snapshot");
  if (response.status === 204) {
    return { empty: true };
  }
  return response.data;
}

export async function postVmwareRefresh(body = { force: false }) {
  const { data } = await api.post("/vmware/refresh", body);
  return data;
}

export async function getVmwareJob(jobId) {
  const { data } = await api.get(`/vmware/jobs/${jobId}`);
  return data;
}
