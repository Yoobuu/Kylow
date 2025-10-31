import api from "./axios";

export const NOTIFICATION_STATUS = Object.freeze({
  OPEN: "OPEN",
  ACK: "ACK",
  CLEARED: "CLEARED",
});

export function listNotifications(params = {}) {
  return api.get("/notifications/", { params });
}

export function ackNotification(id) {
  return api.post(`/notifications/${id}/ack/`);
}

export function clearResolved(payload = {}) {
  return api.post("/notifications/clear-resolved/", payload);
}
