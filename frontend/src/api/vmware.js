import api from "./axios";

export async function getVmwareSnapshot() {
  const response = await api.get("/vmware/snapshot");
  if (response.status === 204) {
    return { empty: true };
  }
  return response.data;
}
