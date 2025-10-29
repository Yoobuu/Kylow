const DEFAULT_TTL_MS = (() => {
  const raw = import.meta.env?.VITE_INVENTORY_TTL_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000
})()

const PREFIX = 'inv-cache:'
const memoryStore = new Map()

const getStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const readFromStorage = (key) => {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(`${PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'ts' in parsed) {
      return parsed
    }
  } catch {
    // ignore malformed cache entries
  }
  return null
}

const writeToStorage = (key, entry) => {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(`${PREFIX}${key}`, JSON.stringify(entry))
  } catch {
    // ignore quota / serialization errors
  }
}

function get(key) {
  if (memoryStore.has(key)) {
    return memoryStore.get(key)
  }
  const entry = readFromStorage(key)
  if (entry) {
    memoryStore.set(key, entry)
    return entry
  }
  return null
}

function set(key, data) {
  const entry = { data, ts: Date.now() }
  memoryStore.set(key, entry)
  writeToStorage(key, entry)
}

function resolveTtl(ttlMs) {
  const parsed = Number(ttlMs)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return DEFAULT_TTL_MS
}

function isFresh(key, ttlMs) {
  const entry = get(key)
  if (!entry) return false
  const ttl = resolveTtl(ttlMs)
  return Date.now() - entry.ts <= ttl
}

export { get, set, isFresh, DEFAULT_TTL_MS }
