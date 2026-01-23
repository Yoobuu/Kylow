import api from "./axios";

export function listAudit({ limit = 25, offset = 0, action, actor_username, target_type } = {}) {
  const params = { limit, offset };
  if (action) {
    params.action = action;
  }
  if (actor_username) {
    params.actor_username = actor_username;
  }
  if (target_type) {
    params.target_type = target_type;
  }
  return api.get("/audit/", { params });
}
