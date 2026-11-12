(function () {
  const OVERRIDE_STORAGE_KEY = 'pap_supabase_override';
  const CONFIG_ENDPOINT = '/api/config';
  const FETCH_TIMEOUT_MS = 8000;

  function normalizeUrl(url) {
    if (typeof url !== 'string') return '';
    return url.trim().replace(/\/+$/, '');
  }

  function readLocalOverride() {
    try {
      const raw = window.localStorage.getItem(OVERRIDE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      const url = normalizeUrl(parsed.SUPABASE_URL);
      const anonKey = typeof parsed.SUPABASE_ANON_KEY === 'string' ? parsed.SUPABASE_ANON_KEY.trim() : '';
      const schema = typeof parsed.SUPABASE_SCHEMA === 'string' && parsed.SUPABASE_SCHEMA.trim() !== ''
        ? parsed.SUPABASE_SCHEMA.trim()
        : 'pap';
      const gasUrl = normalizeUrl(parsed.GAS_ENDPOINT_URL);

      if (!url || !anonKey) return null;

      return {
        SUPABASE_URL: url,
        SUPABASE_ANON_KEY: anonKey,
        SUPABASE_SCHEMA: schema,
        GAS_ENDPOINT_URL: gasUrl
      };
    } catch (_) {
      return null;
    }
  }

  function setOverride(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid override configuration payload.');
    }
    const url = normalizeUrl(config.SUPABASE_URL);
    const anonKey = typeof config.SUPABASE_ANON_KEY === 'string' ? config.SUPABASE_ANON_KEY.trim() : '';
    const schema = typeof config.SUPABASE_SCHEMA === 'string' && config.SUPABASE_SCHEMA.trim() !== ''
      ? config.SUPABASE_SCHEMA.trim()
      : 'pap';
    const gasUrl = normalizeUrl(config.GAS_ENDPOINT_URL);

    if (!/^https?:\/\/.+/i.test(url)) {
      throw new Error('Invalid SUPABASE_URL format.');
    }
    if (!anonKey) {
      throw new Error('SUPABASE_ANON_KEY is required.');
    }

    const payload = {
      SUPABASE_URL: url,
      SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SCHEMA: schema,
      GAS_ENDPOINT_URL: gasUrl
    };

    window.localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  }

  function clearOverride() {
    window.localStorage.removeItem(OVERRIDE_STORAGE_KEY);
  }

  function isOverrideActive() {
    return readLocalOverride() !== null;
  }

  async function fetchRemoteConfig() {
    const controller = new AbortController();
    const timerId = window.setTimeout(function () {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const response = await window.fetch(CONFIG_ENDPOINT, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        return null;
      }

      return {
        SUPABASE_URL: normalizeUrl(data.SUPABASE_URL),
        SUPABASE_ANON_KEY: typeof data.SUPABASE_ANON_KEY === 'string' ? data.SUPABASE_ANON_KEY.trim() : '',
        SUPABASE_SCHEMA: typeof data.SUPABASE_SCHEMA === 'string' && data.SUPABASE_SCHEMA.trim() !== ''
          ? data.SUPABASE_SCHEMA.trim()
          : 'pap',
        GAS_ENDPOINT_URL: normalizeUrl(data.GAS_ENDPOINT_URL)
      };
    } catch (_) {
      return null;
    } finally {
      window.clearTimeout(timerId);
    }
  }

  async function resolveEnvironment() {
    const remote = await fetchRemoteConfig();
    const override = readLocalOverride();
    const active = override || remote;

    if (!active || !/^https?:\/\/.+/i.test(active.SUPABASE_URL) || !active.SUPABASE_ANON_KEY) {
      window.__ENV = Object.freeze({
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: '',
        SUPABASE_SCHEMA: 'pap',
        GAS_ENDPOINT_URL: '',
        IS_OVERRIDE: false
      });
      throw new Error('Konfigurasi Supabase tidak lengkap. Sila semak Cloudflare Environment Variables atau tetapan sambungan.');
    }

    const frozenEnv = Object.freeze({
      SUPABASE_URL: active.SUPABASE_URL,
      SUPABASE_ANON_KEY: active.SUPABASE_ANON_KEY,
      SUPABASE_SCHEMA: active.SUPABASE_SCHEMA || 'pap',
      GAS_ENDPOINT_URL: active.GAS_ENDPOINT_URL || '',
      IS_OVERRIDE: Boolean(override)
    });

    window.__ENV = frozenEnv;
    return frozenEnv;
  }

  window.AppConfig = Object.freeze({
    getOverride: readLocalOverride,
    setOverride: setOverride,
    clearOverride: clearOverride,
    isOverrideActive: isOverrideActive
  });

  window.ENV_READY = resolveEnvironment();
})();