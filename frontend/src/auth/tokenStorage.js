const TOKEN_KEY = "token";
const MUST_CHANGE_STORAGE_KEY = "mustChangePassword";

const memoryStore = (() => {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  };
})();

const storageMode = (import.meta.env.VITE_TOKEN_STORAGE || "sessionStorage").toLowerCase();

function resolveWebStorage(mode) {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const storage = window[mode];
    if (!storage) return null;
    const testKey = "__storage_test__";
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return storage;
  } catch (err) {
    return null;
  }
}

const resolvedStorage =
  (storageMode === "localstorage" && resolveWebStorage("localStorage")) ||
  (storageMode === "sessionstorage" && resolveWebStorage("sessionStorage")) ||
  resolveWebStorage("sessionStorage") ||
  memoryStore;

export function getAuthStorage() {
  return resolvedStorage;
}

export function getToken() {
  return resolvedStorage.getItem(TOKEN_KEY);
}

export function setToken(value) {
  if (value) {
    resolvedStorage.setItem(TOKEN_KEY, value);
  } else {
    resolvedStorage.removeItem(TOKEN_KEY);
  }
}

export function getMustChangePassword() {
  return resolvedStorage.getItem(MUST_CHANGE_STORAGE_KEY);
}

export function setMustChangePassword(value) {
  if (value) {
    resolvedStorage.setItem(MUST_CHANGE_STORAGE_KEY, "true");
  } else {
    resolvedStorage.removeItem(MUST_CHANGE_STORAGE_KEY);
  }
}

export { TOKEN_KEY, MUST_CHANGE_STORAGE_KEY };
