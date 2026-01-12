const TZ_GUAYAQUIL = "America/Guayaquil";
const TZ_UTC = "UTC";
const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:?\d{2})$/;
const DEFAULT_LOCALE = "es-EC";
const DATE_TIME_OPTIONS = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

function normalizeSnapshotTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.includes(".") ? raw.replace(/(\.\d{3})\d+/, "$1") : raw;
  const withZone = TZ_SUFFIX_RE.test(cleaned) ? cleaned : `${cleaned}Z`;
  const parsed = new Date(withZone);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeLocalTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateTime(date, { locale = DEFAULT_LOCALE, timeZone } = {}) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const options = timeZone ? { ...DATE_TIME_OPTIONS, timeZone } : DATE_TIME_OPTIONS;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatSnapshotTimes(value, locale = DEFAULT_LOCALE) {
  const parsed = normalizeSnapshotTimestamp(value);
  if (!parsed) return null;
  return {
    guayaquil: formatDateTime(parsed, { locale, timeZone: TZ_GUAYAQUIL }),
    utc: formatDateTime(parsed, { locale, timeZone: TZ_UTC }),
  };
}

export function formatLocalDateTime(value, locale = DEFAULT_LOCALE) {
  const parsed = normalizeLocalTimestamp(value);
  if (!parsed) return null;
  return formatDateTime(parsed, { locale });
}
