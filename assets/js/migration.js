(function () {
  const TABLE_NAME = 'aktiviti';
  const PRIMARY_KEY = 'id';
  const TABLE_ORDER = ['aktiviti'];
  const SCHEMA_VERSION = '1.0.0';
  const APP_NAME = 'Pelaporan Aktiviti Pegawai';
  const DEFAULT_BATCH_SIZE = 50;
  const EXPECTED_HEADERS = [
    'id',
    'medium_aktiviti',
    'tarikh',
    'tajuk',
    'masa',
    'tempat',
    'nama_guru',
    'impak_catatan',
    'tindak_susul',
    'created_at',
    'updated_at'
  ];

  let activeOperation = null;
  let activeAbortController = null;

  function normalizeDateOnly(value) {
    if (!value) {
      return '';
    }
    const raw = String(value).trim();
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function normalizeTimestamp(value) {
    if (!value) {
      return null;
    }
    const text = String(value).trim();
    if (!text) {
      return null;
    }
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return text;
  }

  function normalizeMedium(value) {
    const text = normalizeText(value);
    if (!text) {
      return 'Bimbingan';
    }
    if (text.toLowerCase() === 'aktiviti') {
      return 'Aktiviti';
    }
    if (text.toLowerCase() === 'bimbingan') {
      return 'Bimbingan';
    }
    return text;
  }

  function sanitizeRecordForExport(item) {
    const numericId = Number(item && item.id);
    const normalized = {
      id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
      medium_aktiviti: normalizeMedium(item && item.medium_aktiviti),
      tarikh: normalizeDateOnly(item && item.tarikh),
      tajuk: normalizeText(item && item.tajuk),
      masa: normalizeText(item && item.masa),
      tempat: normalizeText(item && item.tempat),
      nama_guru: normalizeText(item && item.nama_guru),
      impak_catatan: normalizeText(item && item.impak_catatan),
      tindak_susul: normalizeText(item && item.tindak_susul),
      created_at: normalizeTimestamp(item && item.created_at),
      updated_at: normalizeTimestamp(item && item.updated_at)
    };

    const filtered = {};
    EXPECTED_HEADERS.forEach(function (header) {
      filtered[header] = Object.prototype.hasOwnProperty.call(normalized, header)
        ? normalized[header]
        : null;
    });
    return filtered;
  }

  function triggerDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 100);
  }

  function buildTimestampSuffix() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return yyyy + mm + dd + '_' + hh + min;
  }

  function attachAbortSignal(query, signal) {
    if (signal && query && typeof query.abortSignal === 'function') {
      return query.abortSignal(signal);
    }
    return query;
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) {
      throw new Error('Operasi migrasi telah dibatalkan.');
    }
  }

  function beginOperation(name, externalSignal) {
    if (activeOperation !== null) {
      throw new Error('Operasi migrasi sedang berjalan. Sila tunggu sehingga selesai.');
    }
    const controller = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else if (typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener(
          'abort',
          function () {
            controller.abort();
          },
          { once: true }
        );
      }
    }
    activeOperation = name;
    activeAbortController = controller;
    return controller;
  }

  function endOperation() {
    activeOperation = null;
    activeAbortController = null;
  }

  function abortActiveOperation() {
    if (activeAbortController) {
      activeAbortController.abort();
      return true;
    }
    return false;
  }

  function isBusy() {
    return activeOperation !== null;
  }

  async function fetchAllRecordsForExport(supabaseClient, fallbackRecords, signal) {
    throwIfAborted(signal);

    if (supabaseClient && typeof supabaseClient.from === 'function') {
      let query = supabaseClient
        .from(TABLE_NAME)
        .select('*')
        .order('tarikh', { ascending: false })
        .order('id', { ascending: true });

      query = attachAbortSignal(query, signal);
      const response = await query;
      throwIfAborted(signal);

      if (!response.error && Array.isArray(response.data)) {
        return response.data.map(sanitizeRecordForExport);
      }
    }

    if (Array.isArray(fallbackRecords)) {
      return fallbackRecords.map(sanitizeRecordForExport);
    }

    return [];
  }

  async function exportJson(supabaseClient, fallbackRecords, options) {
    const opts = options || {};
    const controller = beginOperation('export', opts.signal);

    try {
      const env = await window.ENV_READY;
      throwIfAborted(controller.signal);

      const rows = await fetchAllRecordsForExport(supabaseClient, fallbackRecords, controller.signal);
      if (rows.length === 0) {
        throw new Error('Tiada rekod ditemui untuk dieksport.');
      }

      const schemaName = env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap';
      const payload = {
        metadata: {
          app: APP_NAME,
          schema_version: SCHEMA_VERSION,
          exported_at: new Date().toISOString(),
          source_schema: schemaName,
          table_order: TABLE_ORDER.slice()
        },
        tables: {
          aktiviti: {
            table_name: TABLE_NAME,
            primary_key: PRIMARY_KEY,
            headers: EXPECTED_HEADERS.slice(),
            rows: rows
          }
        }
      };

      const jsonText = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const filename = 'backup_aktiviti_' + schemaName + '_' + buildTimestampSuffix() + '.json';
      triggerDownload(blob, filename);

      return {
        totalRecords: rows.length,
        filename: filename,
        sourceSchema: schemaName,
        tableOrder: TABLE_ORDER.slice()
      };
    } finally {
      endOperation();
    }
  }

  function readFileAsText(file) {
    if (file && typeof file.text === 'function') {
      return file.text();
    }
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(typeof reader.result === 'string' ? reader.result : '');
      };
      reader.onerror = function () {
        reject(new Error('Gagal membaca fail yang dipilih.'));
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  function validateSchemaHeaders(headers) {
    if (!Array.isArray(headers) || headers.length !== EXPECTED_HEADERS.length) {
      return false;
    }
    for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
      if (headers[i] !== EXPECTED_HEADERS[i]) {
        return false;
      }
    }
    return true;
  }

  function extractValidatedRowsFromPayload(parsed) {
    if (parsed && typeof parsed === 'object' && parsed.metadata && parsed.tables) {
      if (typeof parsed.metadata !== 'object' || !Array.isArray(parsed.metadata.table_order)) {
        throw new Error('Struktur metadata.table_order tidak sah dalam fail JSON.');
      }

      if (
        parsed.metadata.table_order.length !== TABLE_ORDER.length ||
        parsed.metadata.table_order[0] !== TABLE_NAME
      ) {
        throw new Error('Susunan jadual (table_order) tidak sepadan dengan skema sistem.');
      }

      if (typeof parsed.tables !== 'object' || !parsed.tables[TABLE_NAME]) {
        throw new Error('Definisi jadual aktiviti tidak ditemui dalam fail JSON.');
      }

      const tableDef = parsed.tables[TABLE_NAME];
      if (tableDef.table_name !== TABLE_NAME) {
        throw new Error('Nama jadual (table_name) tidak sah.');
      }

      if (tableDef.primary_key !== PRIMARY_KEY) {
        throw new Error('Kunci utama (primary_key) tidak sepadan dengan skema sistem.');
      }

      if (!validateSchemaHeaders(tableDef.headers)) {
        throw new Error('Senarai lajur (headers) tidak sepadan dengan skema jadual aktiviti.');
      }

      if (!Array.isArray(tableDef.rows)) {
        throw new Error('Struktur baris rekod (rows) tidak sah.');
      }

      return {
        rawRows: tableDef.rows,
        metadata: {
          app: typeof parsed.metadata.app === 'string' ? parsed.metadata.app : APP_NAME,
          schemaVersion: typeof parsed.metadata.schema_version === 'string' ? parsed.metadata.schema_version : SCHEMA_VERSION,
          sourceSchema: typeof parsed.metadata.source_schema === 'string' ? parsed.metadata.source_schema : '',
          exportedAt: typeof parsed.metadata.exported_at === 'string' ? parsed.metadata.exported_at : '',
          tableOrder: parsed.metadata.table_order.slice()
        }
      };
    }

    if (Array.isArray(parsed)) {
      return {
        rawRows: parsed,
        metadata: {
          app: APP_NAME,
          schemaVersion: 'legacy',
          sourceSchema: '',
          exportedAt: '',
          tableOrder: TABLE_ORDER.slice()
        }
      };
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records)) {
      return {
        rawRows: parsed.records,
        metadata: {
          app: typeof parsed.app === 'string' ? parsed.app : APP_NAME,
          schemaVersion: 'legacy',
          sourceSchema: typeof parsed.source_schema === 'string' ? parsed.source_schema : '',
          exportedAt: typeof parsed.exported_at === 'string' ? parsed.exported_at : '',
          tableOrder: TABLE_ORDER.slice()
        }
      };
    }

    throw new Error('Struktur fail JSON tidak mengandungi skema atau rekod aktiviti yang sah.');
  }

  function normalizeRowAgainstHeaders(entry) {
    const tarikh = normalizeDateOnly(entry.tarikh);
    const tajuk = normalizeText(entry.tajuk);

    if (!tarikh || !tajuk) {
      return null;
    }

    const numericId = Number(entry.id);
    const candidate = {
      id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
      medium_aktiviti: normalizeMedium(entry.medium_aktiviti),
      tarikh: tarikh,
      tajuk: tajuk,
      masa: normalizeText(entry.masa),
      tempat: normalizeText(entry.tempat),
      nama_guru: normalizeText(entry.nama_guru),
      impak_catatan: normalizeText(entry.impak_catatan),
      tindak_susul: normalizeText(entry.tindak_susul),
      created_at: normalizeTimestamp(entry.created_at),
      updated_at: normalizeTimestamp(entry.updated_at)
    };

    const strictRow = {};
    EXPECTED_HEADERS.forEach(function (header) {
      strictRow[header] = candidate[header];
    });
    return strictRow;
  }

  async function parseImportFile(file) {
    if (!file) {
      throw new Error('Sila pilih fail sandaran .json terlebih dahulu.');
    }

    const fileName = typeof file.name === 'string' ? file.name : '';
    const fileType = typeof file.type === 'string' ? file.type : '';
    if (!/\.json$/i.test(fileName) && fileType !== 'application/json') {
      throw new Error('Hanya fail format .json sahaja dibenarkan.');
    }

    const rawText = await readFileAsText(file);
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      throw new Error('Format fail JSON tidak sah atau rosak.');
    }

    const extracted = extractValidatedRowsFromPayload(parsed);
    const validRecords = [];
    let skippedCount = 0;

    extracted.rawRows.forEach(function (entry) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        skippedCount++;
        return;
      }
      const normalizedRow = normalizeRowAgainstHeaders(entry);
      if (!normalizedRow) {
        skippedCount++;
        return;
      }
      validRecords.push(normalizedRow);
    });

    if (validRecords.length === 0) {
      throw new Error('Tiada rekod sah ditemui dalam fail JSON (pastikan lajur tarikh dan tajuk wujud).');
    }

    return {
      validRecords: validRecords,
      skippedCount: skippedCount,
      metadata: extracted.metadata,
      tableOrder: TABLE_ORDER.slice(),
      headers: EXPECTED_HEADERS.slice()
    };
  }

  function buildDatabasePayloadRow(record, preserveIds) {
    const clean = normalizeRowAgainstHeaders(record);
    if (!clean) {
      throw new Error('Rekod tidak sah ditemui semasa penyediaan muatan pangkalan data.');
    }

    const row = {
      medium_aktiviti: clean.medium_aktiviti,
      tarikh: clean.tarikh,
      tajuk: clean.tajuk,
      masa: clean.masa || null,
      tempat: clean.tempat || null,
      nama_guru: clean.nama_guru || null,
      impak_catatan: clean.impak_catatan || null,
      tindak_susul: clean.tindak_susul || null
    };

    if (preserveIds && Number.isInteger(clean.id) && clean.id > 0) {
      row.id = clean.id;
      if (clean.created_at) {
        row.created_at = clean.created_at;
      }
      if (clean.updated_at) {
        row.updated_at = clean.updated_at;
      }
    }

    return row;
  }

  async function importRecords(supabaseClient, records, options) {
    const opts = options || {};
    const controller = beginOperation('import', opts.signal);

    try {
      const env = await window.ENV_READY;
      throwIfAborted(controller.signal);

      if (!supabaseClient || typeof supabaseClient.from !== 'function') {
        throw new Error('Sambungan klien Supabase tidak tersedia.');
      }

      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Tiada rekod untuk diimport.');
      }

      const sessionResult = await supabaseClient.auth.getSession();
      throwIfAborted(controller.signal);

      const activeSession = sessionResult && sessionResult.data ? sessionResult.data.session : null;
      if (!activeSession || !activeSession.user) {
        throw new Error('Sila log masuk sebagai pentadbir sebelum mengimport data.');
      }

      const preserveIds = opts.preserveIds !== undefined ? Boolean(opts.preserveIds) : true;
      const batchSize = typeof opts.batchSize === 'number' && opts.batchSize > 0
        ? Math.floor(opts.batchSize)
        : DEFAULT_BATCH_SIZE;
      const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

      let totalImported = 0;
      let totalBatchesExecuted = 0;

      for (let tIdx = 0; tIdx < TABLE_ORDER.length; tIdx++) {
        const currentTable = TABLE_ORDER[tIdx];
        const total = records.length;
        const totalBatches = Math.ceil(total / batchSize);
        let processed = 0;

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          throwIfAborted(controller.signal);

          const start = batchIndex * batchSize;
          const slice = records.slice(start, start + batchSize);
          const payloadBatch = slice.map(function (item) {
            return buildDatabasePayloadRow(item, preserveIds);
          });

          let query = preserveIds
            ? supabaseClient.from(currentTable).upsert(payloadBatch, { onConflict: PRIMARY_KEY })
            : supabaseClient.from(currentTable).insert(payloadBatch);

          query = attachAbortSignal(query, controller.signal);
          const result = await query;
          throwIfAborted(controller.signal);

          if (result.error) {
            throw new Error(
              'Gagal mengimport kelompok ' + (batchIndex + 1) + '/' + totalBatches + ': ' + result.error.message
            );
          }

          processed += payloadBatch.length;
          totalImported += payloadBatch.length;
          totalBatchesExecuted++;

          if (onProgress) {
            onProgress({
              tableName: currentTable,
              processed: processed,
              total: total,
              batchIndex: batchIndex + 1,
              totalBatches: totalBatches
            });
          }
        }
      }

      if (window.IdbCache && typeof window.IdbCache.clearNamespace === 'function') {
        await window.IdbCache.clearNamespace();
      }

      return {
        importedCount: totalImported,
        totalBatches: totalBatchesExecuted,
        targetSchema: env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap',
        tableOrder: TABLE_ORDER.slice()
      };
    } finally {
      endOperation();
    }
  }

  window.DataMigration = Object.freeze({
    SCHEMA_DEFINITION: Object.freeze({
      app: APP_NAME,
      schemaVersion: SCHEMA_VERSION,
      tableOrder: Object.freeze(TABLE_ORDER.slice()),
      tables: Object.freeze({
        aktiviti: Object.freeze({
          table_name: TABLE_NAME,
          primary_key: PRIMARY_KEY,
          headers: Object.freeze(EXPECTED_HEADERS.slice())
        })
      })
    }),
    exportJson: exportJson,
    parseImportFile: parseImportFile,
    importRecords: importRecords,
    abortActiveOperation: abortActiveOperation,
    isBusy: isBusy
  });
})();