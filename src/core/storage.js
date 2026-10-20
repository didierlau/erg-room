/**
 * JSON key/value storage on top of a Web Storage backend (localStorage).
 * Every call is wrapped so a blocked or full storage never crashes the app:
 * reads fall back to a default and writes report success as a boolean.
 */

/**
 * @param {Storage | null | undefined} backend  usually `globalThis.localStorage`
 * @param {string} prefix  namespace prepended to every key
 */
export function createStorage(backend, prefix = 'ergroom.') {
  return {
    get(key, fallback) {
      try {
        const raw = backend?.getItem(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    /** @returns {boolean} false when the value could not be stored (quota, private mode). */
    set(key, value) {
      try {
        if (!backend) return false;
        backend.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        backend?.removeItem(prefix + key);
      } catch {
        /* nothing to do: the key is gone or storage is unavailable */
      }
    },
  };
}

/** Synchronous in-memory backend with the Web Storage interface. Used by tests. */
export function createMemoryBackend({ quotaBytes = Infinity } = {}) {
  const map = new Map();
  const size = () => [...map.values()].reduce((n, v) => n + v.length, 0);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const previous = map.get(k);
      map.set(k, String(v));
      if (size() > quotaBytes) {
        if (previous == null) map.delete(k);
        else map.set(k, previous);
        throw new Error('QuotaExceededError');
      }
    },
    removeItem: (k) => map.delete(k),
  };
}
