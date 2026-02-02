import api from "./axios";

export async function postSystemRestart(confirm) {
  const { data } = await api.post("/admin/system/restart", { confirm });
  return data;
}

export async function getSystemDiagnostics() {
  const { data } = await api.get("/admin/system/diagnostics");
  return data;
}
