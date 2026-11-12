(function () {
  const OVERRIDE_STORAGE_KEY = 'pap_supabase_override';
  const CONFIG_ENDPOINT = '/api/config';
  const FETCH_TIMEOUT_MS = 8000;
  const URL_REGEX = /^https?:\/\/.+/i;
  const SCHEMA_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  function normalizeUrl(url) {
    if (typeof url !== 'string') {
      return '';
    }
    return url.trim().replace(/\/+$/, '');
  }

  function normalizeSchema(schema) {
    if (typeof schema !== 'string') {
      return 'pap';
    }
    const trimmed = schema.trim();
    if (trimmed === '') {
      return 'pap';
    }
    return SCHEMA_REGEX.test(trimmed) ? trimmed : '';
  }

  function parseConfigPayload(raw, strictMode) {
    if (!raw || typeof raw !== 'object') {
      if (strictMode) {
        throw new Error('Payload konfigurasi tidak sah.');
      }
      return null;
    }

    const url = normalizeUrl(raw.SUPABASE_URL);
    const anonKey = typeof raw.SUPABASE_ANON_KEY === 'string' ? raw.SUPABASE_ANON_KEY.trim() : '';
    const schema = normalizeSchema(raw.SUPABASE_SCHEMA);
    const gasUrl = normalizeUrl(raw.GAS_ENDPOINT_URL);

    if (!URL_REGEX.test(url)) {
      if (strictMode) {
        throw new Error('Format SUPABASE_URL tidak sah.');
      }
      return null;
    }

    if (!anonKey) {
      if (strictMode) {
        throw new Error('SUPABASE_ANON_KEY diperlukan.');
      }
      return null;
    }

    if (!schema) {
      if (strictMode) {
        throw new Error('Format nama skema tidak sah.');
      }
      return null;
    }

    if (gasUrl && !URL_REGEX.test(gasUrl)) {
      if (strictMode) {
        throw new Error('Format GAS_ENDPOINT_URL tidak sah.');
      }
      return null;
    }

    return {
      SUPABASE_URL: url,
      SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SCHEMA: schema,
      GAS_ENDPOINT_URL: gasUrl
    };
  }

  function readLocalOverride() {
    try {
      const raw = window.localStorage.getItem(OVERRIDE_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parseConfigPayload(parsed, false);
    } catch (_) {
      return null;
    }
  }

  function setOverride(config) {
    const payload = parseConfigPayload(config, true);
    try {
      window.localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {
      throw new Error('Storan pelayar disekat. Tidak dapat menyimpan profil sambungan.');
    }
    return payload;
  }

  function clearOverride() {
    try {
      window.localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    } catch (_) {
    }
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
      return parseConfigPayload(data, false);
    } catch (_) {
      return null;
    } finally {
      window.clearTimeout(timerId);
    }
  }

  async function resolveEnvironment() {
    const override = readLocalOverride();
    const active = override || (await fetchRemoteConfig());

    if (!active) {
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
      SUPABASE_SCHEMA: active.SUPABASE_SCHEMA,
      GAS_ENDPOINT_URL: active.GAS_ENDPOINT_URL,
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