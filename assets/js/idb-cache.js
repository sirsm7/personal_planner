(function () {
  const DB_NAME = 'pap_planner_cache_db';
  const DB_VERSION = 1;
  const STORE_RECORDS = 'records';
  const STORE_META = 'meta';
  const DEFAULT_TTL_MS = 300000;

  let dbInstance = null;
  let dbInitPromise = null;
  let useMemoryFallback = false;
  const inflightRevalidations = Object.create(null);

  if (!window.__memoryCache) {
    window.__memoryCache = {
      records: Object.create(null),
      meta: Object.create(null)
    };
  }

  function sortRecordsDesc(items) {
    return items.slice().sort(function (a, b) {
      const dateA = a && a.tarikh ? String(a.tarikh) : '';
      const dateB = b && b.tarikh ? String(b.tarikh) : '';
      if (dateB !== dateA) {
        return dateB.localeCompare(dateA);
      }
      const idA = Number(a && a.id ? a.id : 0);
      const idB = Number(b && b.id ? b.id : 0);
      return idB - idA;
    });
  }

  function isNewerOrEqualTimestamp(incomingTs, existingTs) {
    if (!existingTs || !incomingTs) {
      return true;
    }
    const incomingTime = Date.parse(incomingTs);
    const existingTime = Date.parse(existingTs);
    if (Number.isNaN(incomingTime) || Number.isNaN(existingTime)) {
      return true;
    }
    return incomingTime >= existingTime;
  }

  async function resolveNamespace() {
    const env = await window.ENV_READY;
    const url = env && env.SUPABASE_URL ? env.SUPABASE_URL : 'default';
    const schema = env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap';
    return url + '::' + schema;
  }

  function openDatabase() {
    if (dbInstance) {
      return Promise.resolve(dbInstance);
    }
    if (useMemoryFallback || typeof window.indexedDB === 'undefined') {
      useMemoryFallback = true;
      return Promise.resolve(null);
    }
    if (dbInitPromise) {
      return dbInitPromise;
    }

    dbInitPromise = new Promise(function (resolve) {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function (event) {
          const db = event.target.result;
          if (db.objectStoreNames.contains(STORE_RECORDS)) {
            db.deleteObjectStore(STORE_RECORDS);
          }
          if (db.objectStoreNames.contains(STORE_META)) {
            db.deleteObjectStore(STORE_META);
          }
          const recordStore = db.createObjectStore(STORE_RECORDS, { keyPath: 'cache_key' });
          recordStore.createIndex('by_namespace', 'namespace', { unique: false });
          db.createObjectStore(STORE_META, { keyPath: 'namespace' });
        };

        request.onsuccess = function (event) {
          dbInstance = event.target.result;
          dbInstance.onversionchange = function () {
            dbInstance.close();
            dbInstance = null;
            dbInitPromise = null;
          };
          dbInitPromise = null;
          resolve(dbInstance);
        };

        request.onerror = function () {
          useMemoryFallback = true;
          dbInitPromise = null;
          resolve(null);
        };

        request.onblocked = function () {
          useMemoryFallback = true;
          dbInitPromise = null;
          resolve(null);
        };
      } catch (_) {
        useMemoryFallback = true;
        dbInitPromise = null;
        resolve(null);
      }
    });

    return dbInitPromise;
  }

  function readFromMemory(namespace, ttlMs) {
    const bucket = window.__memoryCache.records[namespace] || Object.create(null);
    const meta = window.__memoryCache.meta[namespace] || null;
    const items = Object.keys(bucket).map(function (key) {
      return bucket[key];
    });
    const updatedAt = meta && typeof meta.updatedAt === 'number' ? meta.updatedAt : 0;
    const isStale = updatedAt === 0 || (Date.now() - updatedAt) > ttlMs;

    return {
      items: sortRecordsDesc(items),
      updatedAt: updatedAt,
      isStale: isStale,
      source: 'memory'
    };
  }

  function writeAllToMemory(namespace, items) {
    const bucket = Object.create(null);
    items.forEach(function (item) {
      if (item && item.id !== undefined && item.id !== null) {
        bucket[String(item.id)] = item;
      }
    });
    window.__memoryCache.records[namespace] = bucket;
    window.__memoryCache.meta[namespace] = {
      namespace: namespace,
      updatedAt: Date.now(),
      count: items.length
    };
  }

  async function getCachedActivities(ttlMs) {
    const effectiveTtl = typeof ttlMs === 'number' ? ttlMs : DEFAULT_TTL_MS;
    const namespace = await resolveNamespace();
    const db = await openDatabase();

    if (!db || useMemoryFallback) {
      return readFromMemory(namespace, effectiveTtl);
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_RECORDS, STORE_META], 'readonly');
        const recordStore = tx.objectStore(STORE_RECORDS);
        const metaStore = tx.objectStore(STORE_META);
        const index = recordStore.index('by_namespace');

        const recordsReq = index.getAll(IDBKeyRange.only(namespace));
        const metaReq = metaStore.get(namespace);

        let wrappedRecords = [];
        let metaRecord = null;

        recordsReq.onsuccess = function () {
          wrappedRecords = Array.isArray(recordsReq.result) ? recordsReq.result : [];
        };

        metaReq.onsuccess = function () {
          metaRecord = metaReq.result || null;
        };

        tx.oncomplete = function () {
          const items = wrappedRecords.map(function (entry) {
            return entry.data;
          });
          const updatedAt = metaRecord && typeof metaRecord.updatedAt === 'number' ? metaRecord.updatedAt : 0;
          const isStale = updatedAt === 0 || (Date.now() - updatedAt) > effectiveTtl;
          resolve({
            items: sortRecordsDesc(items),
            updatedAt: updatedAt,
            isStale: isStale,
            source: 'indexeddb'
          });
        };

        tx.onerror = function () {
          useMemoryFallback = true;
          resolve(readFromMemory(namespace, effectiveTtl));
        };

        tx.onabort = function () {
          useMemoryFallback = true;
          resolve(readFromMemory(namespace, effectiveTtl));
        };
      } catch (_) {
        useMemoryFallback = true;
        resolve(readFromMemory(namespace, effectiveTtl));
      }
    });
  }

  async function setCachedActivities(items) {
    const list = Array.isArray(items) ? items : [];
    const namespace = await resolveNamespace();
    writeAllToMemory(namespace, list);

    const db = await openDatabase();
    if (!db || useMemoryFallback) {
      return sortRecordsDesc(list);
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_RECORDS, STORE_META], 'readwrite');
        const recordStore = tx.objectStore(STORE_RECORDS);
        const metaStore = tx.objectStore(STORE_META);
        const index = recordStore.index('by_namespace');
        const keyCursorReq = index.openKeyCursor(IDBKeyRange.only(namespace));

        keyCursorReq.onsuccess = function (event) {
          const cursor = event.target.result;
          if (cursor) {
            recordStore.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            list.forEach(function (item) {
              if (item && item.id !== undefined && item.id !== null) {
                recordStore.put({
                  cache_key: namespace + '::' + String(item.id),
                  namespace: namespace,
                  id: item.id,
                  data: item
                });
              }
            });
            metaStore.put({
              namespace: namespace,
              updatedAt: Date.now(),
              count: list.length
            });
          }
        };

        tx.oncomplete = function () {
          resolve(sortRecordsDesc(list));
        };

        tx.onerror = function () {
          useMemoryFallback = true;
          resolve(sortRecordsDesc(list));
        };

        tx.onabort = function () {
          useMemoryFallback = true;
          resolve(sortRecordsDesc(list));
        };
      } catch (_) {
        useMemoryFallback = true;
        resolve(sortRecordsDesc(list));
      }
    });
  }

  async function upsertActivity(record) {
    if (!record || record.id === undefined || record.id === null) {
      return false;
    }

    const namespace = await resolveNamespace();
    const idKey = String(record.id);
    const cacheKey = namespace + '::' + idKey;

    if (!window.__memoryCache.records[namespace]) {
      window.__memoryCache.records[namespace] = Object.create(null);
    }
    const existingMem = window.__memoryCache.records[namespace][idKey];
    if (existingMem && !isNewerOrEqualTimestamp(record.updated_at, existingMem.updated_at)) {
      return false;
    }
    window.__memoryCache.records[namespace][idKey] = record;

    const db = await openDatabase();
    if (!db || useMemoryFallback) {
      return true;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_RECORDS], 'readwrite');
        const recordStore = tx.objectStore(STORE_RECORDS);
        const getReq = recordStore.get(cacheKey);
        let applied = false;

        getReq.onsuccess = function () {
          const existingEntry = getReq.result;
          const existingData = existingEntry ? existingEntry.data : null;
          if (existingData && !isNewerOrEqualTimestamp(record.updated_at, existingData.updated_at)) {
            applied = false;
            return;
          }
          recordStore.put({
            cache_key: cacheKey,
            namespace: namespace,
            id: record.id,
            data: record
          });
          applied = true;
        };

        tx.oncomplete = function () {
          resolve(applied);
        };

        tx.onerror = function () {
          useMemoryFallback = true;
          resolve(true);
        };

        tx.onabort = function () {
          useMemoryFallback = true;
          resolve(true);
        };
      } catch (_) {
        useMemoryFallback = true;
        resolve(true);
      }
    });
  }

  async function removeActivity(id) {
    if (id === undefined || id === null) {
      return false;
    }

    const namespace = await resolveNamespace();
    const idKey = String(id);
    const cacheKey = namespace + '::' + idKey;

    if (window.__memoryCache.records[namespace]) {
      delete window.__memoryCache.records[namespace][idKey];
    }

    const db = await openDatabase();
    if (!db || useMemoryFallback) {
      return true;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_RECORDS], 'readwrite');
        const recordStore = tx.objectStore(STORE_RECORDS);
        recordStore.delete(cacheKey);

        tx.oncomplete = function () {
          resolve(true);
        };

        tx.onerror = function () {
          useMemoryFallback = true;
          resolve(true);
        };

        tx.onabort = function () {
          useMemoryFallback = true;
          resolve(true);
        };
      } catch (_) {
        useMemoryFallback = true;
        resolve(true);
      }
    });
  }

  function triggerBackgroundRevalidate(namespace, fetcherFn, onRevalidated) {
    if (inflightRevalidations[namespace]) {
      return inflightRevalidations[namespace];
    }

    const task = Promise.resolve()
      .then(function () {
        return fetcherFn();
      })
      .then(async function (freshItems) {
        const sorted = await setCachedActivities(freshItems);
        if (typeof onRevalidated === 'function') {
          onRevalidated(sorted);
        }
        return sorted;
      })
      .catch(function () {
        return null;
      })
      .finally(function () {
        delete inflightRevalidations[namespace];
      });

    inflightRevalidations[namespace] = task;
    return task;
  }

  async function getWithSWR(fetcherFn, options) {
    const opts = options || {};
    const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_TTL_MS;
    const forceRefresh = Boolean(opts.forceRefresh);
    const onRevalidated = typeof opts.onRevalidated === 'function' ? opts.onRevalidated : null;
    const namespace = await resolveNamespace();

    if (forceRefresh) {
      const freshItems = await fetcherFn();
      const sortedFresh = await setCachedActivities(freshItems);
      return {
        items: sortedFresh,
        fromCache: false,
        isStale: false
      };
    }

    const cached = await getCachedActivities(ttlMs);
    if (cached.items.length > 0) {
      if (cached.isStale) {
        triggerBackgroundRevalidate(namespace, fetcherFn, onRevalidated);
      }
      return {
        items: cached.items,
        fromCache: true,
        isStale: cached.isStale
      };
    }

    const initialItems = await fetcherFn();
    const sortedInitial = await setCachedActivities(initialItems);
    return {
      items: sortedInitial,
      fromCache: false,
      isStale: false
    };
  }

  async function clearNamespace() {
    const namespace = await resolveNamespace();
    delete window.__memoryCache.records[namespace];
    delete window.__memoryCache.meta[namespace];

    const db = await openDatabase();
    if (!db || useMemoryFallback) {
      return true;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_RECORDS, STORE_META], 'readwrite');
        const recordStore = tx.objectStore(STORE_RECORDS);
        const metaStore = tx.objectStore(STORE_META);
        const index = recordStore.index('by_namespace');
        const cursorReq = index.openKeyCursor(IDBKeyRange.only(namespace));

        cursorReq.onsuccess = function (event) {
          const cursor = event.target.result;
          if (cursor) {
            recordStore.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            metaStore.delete(namespace);
          }
        };

        tx.oncomplete = function () {
          resolve(true);
        };

        tx.onerror = function () {
          resolve(false);
        };
      } catch (_) {
        resolve(false);
      }
    });
  }

  window.IdbCache = Object.freeze({
    init: openDatabase,
    getNamespace: resolveNamespace,
    getCachedActivities: getCachedActivities,
    setCachedActivities: setCachedActivities,
    upsertActivity: upsertActivity,
    removeActivity: removeActivity,
    getWithSWR: getWithSWR,
    clearNamespace: clearNamespace
  });
})();