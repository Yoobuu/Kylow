import api from "./axios";

export async function getSystemSettings() {
  const { data } = await api.get("/admin/system/settings");
  return data;
}

export async function updateSystemSettings(payload) {
  const { data } = await api.put("/admin/system/settings", payload);
  return data;
}
