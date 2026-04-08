const cache = new Map();

function now() {
  return Date.now();
}

async function getCached(key, ttlMs, loader) {
  const entry = cache.get(key);
  const ts = now();

  if (entry && entry.value !== undefined && entry.expiresAt > ts) {
    return entry.value;
  }

  if (entry && entry.pending) {
    return entry.pending;
  }

  const pending = (async () => {
    try {
      const value = await loader();
      cache.set(key, {
        value,
        expiresAt: now() + ttlMs
      });
      return value;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  })();

  cache.set(key, {
    pending,
    expiresAt: ts + ttlMs
  });

  return pending;
}

function clearCache(prefix = '') {
  for (const key of cache.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

module.exports = {
  getCached,
  clearCache
};
