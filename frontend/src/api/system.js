import api from "./axios";

export async function postSystemRestart(confirm) {
  const { data } = await api.post("/admin/system/restart", { confirm });
  return data;
}
