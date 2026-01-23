import api from "./axios";

export async function getAzureSnapshot() {
  const response = await api.get("/azure/snapshot");
  if (response.status === 204) {
    return { empty: true };
  }
  return response.data;
}

export async function postAzureRefresh(body = { force: false }) {
  const { data } = await api.post("/azure/refresh", body);
  return data;
}

export async function getAzureJob(jobId) {
  const { data } = await api.get(`/azure/jobs/${jobId}`);
  return data;
}
