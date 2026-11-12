(function () {
  const TABLE_NAME = 'aktiviti';
  let activeClient = null;
  let activeChannel = null;
  let activeHandlers = null;
  let currentStatus = 'IDLE';
  let teardownBound = false;
  const latestTimestamps = Object.create(null);

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

  function emitRealtimeEvent(detail) {
    try {
      window.dispatchEvent(new CustomEvent('pap:realtime-change', { detail: detail }));
    } catch (_) {
    }
  }

  async function handlePostgresChange(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const eventType = payload.eventType;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const record = payload.new;
      if (!record || record.id === undefined || record.id === null) {
        return;
      }

      const idKey = String(record.id);
      const knownTs = latestTimestamps[idKey];
      if (knownTs && !isNewerOrEqualTimestamp(record.updated_at, knownTs)) {
        return;
      }

      if (window.IdbCache && typeof window.IdbCache.upsertActivity === 'function') {
        const applied = await window.IdbCache.upsertActivity(record);
        if (!applied) {
          return;
        }
      }

      if (record.updated_at) {
        latestTimestamps[idKey] = record.updated_at;
      }

      if (activeHandlers && typeof activeHandlers.onUpsert === 'function') {
        activeHandlers.onUpsert(record, eventType);
      }

      emitRealtimeEvent({
        type: eventType,
        record: record
      });
      return;
    }

    if (eventType === 'DELETE') {
      const oldRecord = payload.old;
      if (!oldRecord || oldRecord.id === undefined || oldRecord.id === null) {
        return;
      }

      const deletedId = oldRecord.id;
      delete latestTimestamps[String(deletedId)];

      if (window.IdbCache && typeof window.IdbCache.removeActivity === 'function') {
        await window.IdbCache.removeActivity(deletedId);
      }

      if (activeHandlers && typeof activeHandlers.onDelete === 'function') {
        activeHandlers.onDelete(deletedId);
      }

      emitRealtimeEvent({
        type: 'DELETE',
        id: deletedId
      });
    }
  }

  async function stop() {
    const client = activeClient;
    const channel = activeChannel;
    activeChannel = null;
    activeHandlers = null;
    currentStatus = 'STOPPED';

    if (client && channel && typeof client.removeChannel === 'function') {
      try {
        await client.removeChannel(channel);
      } catch (_) {
      }
    }
    activeClient = null;
  }

  function bindTeardownOnce() {
    if (teardownBound) {
      return;
    }
    teardownBound = true;
    window.addEventListener('pagehide', function () {
      stop();
    });
  }

  async function start(supabaseClient, handlers) {
    const env = await window.ENV_READY;
    if (!supabaseClient || typeof supabaseClient.channel !== 'function') {
      currentStatus = 'UNAVAILABLE';
      return null;
    }

    await stop();
    bindTeardownOnce();

    const schema = env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap';
    const channelName = 'realtime:' + schema + ':' + TABLE_NAME + ':' + Date.now();

    activeClient = supabaseClient;
    activeHandlers = handlers || null;
    currentStatus = 'SUBSCRIBING';

    const channel = supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: schema,
          table: TABLE_NAME
        },
        function (payload) {
          handlePostgresChange(payload);
        }
      )
      .subscribe(function (status) {
        currentStatus = status || 'UNKNOWN';
        if (activeHandlers && typeof activeHandlers.onStatusChange === 'function') {
          activeHandlers.onStatusChange(currentStatus);
        }
      });

    activeChannel = channel;
    return channel;
  }

  function seedTimestamps(records) {
    if (!Array.isArray(records)) {
      return;
    }
    records.forEach(function (item) {
      if (item && item.id !== undefined && item.id !== null && item.updated_at) {
        latestTimestamps[String(item.id)] = item.updated_at;
      }
    });
  }

  function getStatus() {
    return currentStatus;
  }

  window.RealtimeSync = Object.freeze({
    start: start,
    stop: stop,
    seedTimestamps: seedTimestamps,
    getStatus: getStatus
  });
})();