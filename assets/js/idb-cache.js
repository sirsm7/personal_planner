(function () {
  const DB_NAME = 'pap_planner_cache_db';
  const DB_VERSION = 2;
  const STORE_RECORDS = 'records';
  const STORE_META = 'meta';
  const DEFAULT_TTL_MS = 300000;

  let dbInstance = null;
  let dbInitPromise = null;
  let useMemoryFallback = false;
  const inflightRevalidations = Object.create(null);

  if (!window.__memoryCache || typeof window.__memoryCache !== 'object') {
    window.__memoryCache = {
      records: Object.create(null),
      meta: Object.create(null)
    };
  }

  function isValidRecord(item) {
    if (!item || typeof item !== 'object') {
      return false;
    }
    if (item.id === undefined || item.id === null || String(item.id).trim() === '') {
      return false;
    }
    if (typeof item.tarikh !== 'string' || item.tarikh.trim() === '') {
      return false;
    }
    return true;
  }

  function sortRecordsDesc(items) {
    return items.filter(isValidRecord).sort(function (a, b) {
      const dateA = String(a.tarikh);
      const dateB = String(b.tarikh);
      if (dateB !== dateA) {
        return dateB.localeCompare(dateA);
      }
      const idA = Number(a.id || 0);
      const idB = Number(b.id || 0);
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

  function resetDatabaseConnection() {
    dbInstance = null;
    dbInitPromise = null;
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
          const db = event.target.result;
          db.onversionchange = function () {
            try {
              db.close();
            } catch (_) {
            }
            resetDatabaseConnection();
          };
          db.onclose = function () {
            resetDatabaseConnection();
          };
          dbInstance = db;
          dbInitPromise = null;
          resolve(dbInstance);
        };

        request.onerror = function () {
          useMemoryFallback = true;
          resetDatabaseConnection();
          resolve(null);
        };

        request.onblocked = function () {
          useMemoryFallback = true;
          resetDatabaseConnection();
          resolve(null);
        };
      } catch (_) {
        useMemoryFallback = true;
        resetDatabaseConnection();
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
    let validCount = 0;
    items.forEach(function (item) {
      if (isValidRecord(item)) {
        bucket[String(item.id)] = item;
        validCount++;
      }
    });
    window.__memoryCache.records[namespace] = bucket;
    window.__memoryCache.meta[namespace] = {
      namespace: namespace,
      updatedAt: Date.now(),
      count: validCount
    };
  }

  function touchMemoryMeta(namespace) {
    const bucket = window.__memoryCache.records[namespace] || Object.create(null);
    window.__memoryCache.meta[namespace] = {
      namespace: namespace,
      updatedAt: Date.now(),
      count: Object.keys(bucket).length
    };
  }

  async function getCachedActivities(ttlMs) {
    const effectiveTtl = typeof ttlMs === 'number' && ttlMs >= 0 ? ttlMs : DEFAULT_TTL_MS;
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
            return entry && entry.data ? entry.data : null;
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
          resetDatabaseConnection();
          resolve(readFromMemory(namespace, effectiveTtl));
        };

        tx.onabort = function () {
          resetDatabaseConnection();
          resolve(readFromMemory(namespace, effectiveTtl));
        };
      } catch (_) {
        resetDatabaseConnection();
        resolve(readFromMemory(namespace, effectiveTtl));
      }
    });
  }

  async function setCachedActivities(items) {
    const list = Array.isArray(items) ? items.filter(isValidRecord) : [];
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
              recordStore.put({
                cache_key: namespace + '::' + String(item.id),
                namespace: namespace,
                id: item.id,
                data: item
              });
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
          resetDatabaseConnection();
          resolve(sortRecordsDesc(list));
        };

        tx.onabort = function () {
          resetDatabaseConnection();
          resolve(sortRecordsDesc(list));
        };
      } catch (_) {
        resetDatabaseConnection();
        resolve(sortRecordsDesc(list));
      }
    });
  }

  async function upsertActivity(record) {
    if (!isValidRecord(record)) {
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
    touchMemoryMeta(namespace);

    const db = await openDatabase();
    if (!db || useMemoryFallback) {
      return true;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_RECORDS, STORE_META], 'readwrite');
        const recordStore = tx.objectStore(STORE_RECORDS);
        const metaStore = tx.objectStore(STORE_META);
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
          metaStore.put({
            namespace: namespace,
            updatedAt: Date.now(),
            count: Object.keys(window.__memoryCache.records[namespace]).length
          });
          applied = true;
        };

        tx.oncomplete = function () {
          resolve(applied);
        };

        tx.onerror = function () {
          resetDatabaseConnection();
          resolve(true);
        };

        tx.onabort = function () {
          resetDatabaseConnection();
          resolve(true);
        };
      } catch (_) {
        resetDatabaseConnection();
        resolve(true);
      }
    });
  }

  async function removeActivity(id) {
    if (id === undefined || id === null || String(id).trim() === '') {
      return false;
    }

    const namespace = await resolveNamespace();
    const idKey = String(id);
    const cacheKey = namespace + '::' + idKey;

    if (window.__memoryCache.records[namespace]) {
      delete window.__memoryCache.records[namespace][idKey];
      touchMemoryMeta(namespace);
    }

    const db = await openDatabase();
    if (!db || useMemoryFallback) {
      return true;
    }

    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_RECORDS, STORE_META], 'readwrite');
        const recordStore = tx.objectStore(STORE_RECORDS);
        const metaStore = tx.objectStore(STORE_META);
        recordStore.delete(cacheKey);
        metaStore.put({
          namespace: namespace,
          updatedAt: Date.now(),
          count: window.__memoryCache.records[namespace]
            ? Object.keys(window.__memoryCache.records[namespace]).length
            : 0
        });

        tx.oncomplete = function () {
          resolve(true);
        };

        tx.onerror = function () {
          resetDatabaseConnection();
          resolve(true);
        };

        tx.onabort = function () {
          resetDatabaseConnection();
          resolve(true);
        };
      } catch (_) {
        resetDatabaseConnection();
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

  async function revalidate(fetcherFn, onRevalidated) {
    if (typeof fetcherFn !== 'function') {
      return null;
    }
    const namespace = await resolveNamespace();
    return triggerBackgroundRevalidate(namespace, fetcherFn, onRevalidated);
  }

  async function getWithSWR(fetcherFn, options) {
    const opts = options || {};
    const ttlMs = typeof opts.ttlMs === 'number' && opts.ttlMs >= 0 ? opts.ttlMs : DEFAULT_TTL_MS;
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
          resetDatabaseConnection();
          resolve(false);
        };

        tx.onabort = function () {
          resetDatabaseConnection();
          resolve(false);
        };
      } catch (_) {
        resetDatabaseConnection();
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
    revalidate: revalidate,
    getWithSWR: getWithSWR,
    clearNamespace: clearNamespace
  });
})();