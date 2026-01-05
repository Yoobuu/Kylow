const TZ_GUAYAQUIL = "America/Guayaquil";
const TZ_UTC = "UTC";
const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:?\d{2})$/;

function normalizeSnapshotTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.includes(".") ? raw.replace(/(\.\d{3})\d+/, "$1") : raw;
  const withZone = TZ_SUFFIX_RE.test(cleaned) ? cleaned : `${cleaned}Z`;
  const parsed = new Date(withZone);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatSnapshotTimes(value, locale = "es-EC") {
  const parsed = normalizeSnapshotTimestamp(value);
  if (!parsed) return null;
  return {
    guayaquil: parsed.toLocaleString(locale, { timeZone: TZ_GUAYAQUIL }),
    utc: parsed.toLocaleString(locale, { timeZone: TZ_UTC }),
  };
}
