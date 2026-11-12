(function () {
  const TABLE_NAME = 'aktiviti';
  let activeClient = null;
  let activeChannel = null;
  let activeHandlers = null;
  let savedClient = null;
  let savedHandlers = null;
  let currentStatus = 'IDLE';
  let lifecycleBound = false;
  let subscriptionGeneration = 0;
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

  function notifyStatusChange(status) {
    if (activeHandlers && typeof activeHandlers.onStatusChange === 'function') {
      activeHandlers.onStatusChange(status);
    }
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

  async function teardown(preserveSessionConfig) {
    subscriptionGeneration++;
    const client = activeClient;
    const channel = activeChannel;

    activeChannel = null;
    activeClient = null;
    currentStatus = 'STOPPED';

    if (!preserveSessionConfig) {
      savedClient = null;
      savedHandlers = null;
      activeHandlers = null;
    }

    if (client && channel && typeof client.removeChannel === 'function') {
      try {
        await client.removeChannel(channel);
      } catch (_) {
      }
    }
  }

  async function stop() {
    await teardown(false);
  }

  function isChannelHealthy() {
    if (!activeChannel || currentStatus !== 'SUBSCRIBED') {
      return false;
    }
    if (typeof activeChannel.state === 'string' && activeChannel.state !== 'joined') {
      return false;
    }
    return true;
  }

  function isChannelConnecting() {
    if (currentStatus === 'SUBSCRIBING') {
      return true;
    }
    if (activeChannel && activeChannel.state === 'joining') {
      return true;
    }
    return false;
  }

  async function syncLifecycleState(reason) {
    if (!savedClient) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      currentStatus = 'OFFLINE';
      notifyStatusChange('OFFLINE');
      return;
    }

    if (!isChannelHealthy() && !isChannelConnecting()) {
      await start(savedClient, savedHandlers);
    }

    if (
      savedHandlers &&
      typeof savedHandlers.fetcher === 'function' &&
      window.IdbCache &&
      typeof window.IdbCache.revalidate === 'function'
    ) {
      window.IdbCache.revalidate(savedHandlers.fetcher, function (freshItems) {
        if (Array.isArray(freshItems)) {
          seedTimestamps(freshItems);
        }
        emitRealtimeEvent({
          type: 'SYNC',
          reason: reason
        });
      });
    }
  }

  function bindLifecycleListenersOnce() {
    if (lifecycleBound) {
      return;
    }
    lifecycleBound = true;

    window.addEventListener('pagehide', function () {
      teardown(true);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        syncLifecycleState('visibilitychange');
      }
    });

    window.addEventListener('online', function () {
      syncLifecycleState('online');
    });

    window.addEventListener('offline', function () {
      currentStatus = 'OFFLINE';
      notifyStatusChange('OFFLINE');
    });
  }

  async function start(supabaseClient, handlers) {
    const env = await window.ENV_READY;
    if (!supabaseClient || typeof supabaseClient.channel !== 'function') {
      currentStatus = 'UNAVAILABLE';
      return null;
    }

    await teardown(true);
    bindLifecycleListenersOnce();

    const generation = ++subscriptionGeneration;
    const schema = env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap';
    const channelName = 'realtime:' + schema + ':' + TABLE_NAME + ':' + Date.now() + ':' + generation;

    savedClient = supabaseClient;
    savedHandlers = handlers || null;
    activeClient = supabaseClient;
    activeHandlers = savedHandlers;
    currentStatus = 'SUBSCRIBING';
    notifyStatusChange(currentStatus);

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
          if (generation !== subscriptionGeneration) {
            return;
          }
          handlePostgresChange(payload);
        }
      )
      .subscribe(function (status) {
        if (generation !== subscriptionGeneration) {
          return;
        }
        currentStatus = status || 'UNKNOWN';
        notifyStatusChange(currentStatus);
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