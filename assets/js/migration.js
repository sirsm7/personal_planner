(function () {
  const TABLE_NAME = 'aktiviti';
  const DEFAULT_BATCH_SIZE = 50;
  const EXPORT_VERSION = 1;

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
    return {
      id: item && item.id !== undefined && item.id !== null ? item.id : null,
      medium_aktiviti: normalizeMedium(item && item.medium_aktiviti),
      tarikh: normalizeDateOnly(item && item.tarikh),
      tajuk: normalizeText(item && item.tajuk),
      masa: normalizeText(item && item.masa),
      tempat: normalizeText(item && item.tempat),
      nama_guru: normalizeText(item && item.nama_guru),
      impak_catatan: normalizeText(item && item.impak_catatan),
      tindak_susul: normalizeText(item && item.tindak_susul),
      created_at: item && item.created_at ? String(item.created_at) : null,
      updated_at: item && item.updated_at ? String(item.updated_at) : null
    };
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
    }, 1000);
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

  async function fetchAllRecordsForExport(supabaseClient, fallbackRecords) {
    if (supabaseClient && typeof supabaseClient.from === 'function') {
      const response = await supabaseClient
        .from(TABLE_NAME)
        .select('*')
        .order('tarikh', { ascending: false })
        .order('id', { ascending: true });

      if (!response.error && Array.isArray(response.data)) {
        return response.data.map(sanitizeRecordForExport);
      }
    }

    if (Array.isArray(fallbackRecords)) {
      return fallbackRecords.map(sanitizeRecordForExport);
    }

    return [];
  }

  async function exportJson(supabaseClient, fallbackRecords) {
    const env = await window.ENV_READY;
    const records = await fetchAllRecordsForExport(supabaseClient, fallbackRecords);

    if (records.length === 0) {
      throw new Error('Tiada rekod ditemui untuk dieksport.');
    }

    const schemaName = env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap';
    const payload = {
      app: 'Pelaporan Aktiviti Pegawai',
      export_version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      source_url: env && env.SUPABASE_URL ? env.SUPABASE_URL : '',
      source_schema: schemaName,
      table: TABLE_NAME,
      total_records: records.length,
      records: records
    };

    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const filename = 'backup_aktiviti_' + schemaName + '_' + buildTimestampSuffix() + '.json';
    triggerDownload(blob, filename);

    return {
      totalRecords: records.length,
      filename: filename,
      sourceSchema: schemaName
    };
  }

  function escapeCsvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  async function exportCsv(supabaseClient, fallbackRecords) {
    const env = await window.ENV_READY;
    const records = await fetchAllRecordsForExport(supabaseClient, fallbackRecords);

    if (records.length === 0) {
      throw new Error('Tiada rekod ditemui untuk dieksport.');
    }

    const headers = [
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

    const lines = [headers.join(',')];
    records.forEach(function (rec) {
      const row = headers.map(function (key) {
        return escapeCsvCell(rec[key]);
      });
      lines.push(row.join(','));
    });

    const schemaName = env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap';
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const filename = 'backup_aktiviti_' + schemaName + '_' + buildTimestampSuffix() + '.csv';
    triggerDownload(blob, filename);

    return {
      totalRecords: records.length,
      filename: filename,
      sourceSchema: schemaName
    };
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

  async function parseImportFile(file) {
    if (!file) {
      throw new Error('Sila pilih fail sandaran JSON terlebih dahulu.');
    }

    const rawText = await readFileAsText(file);
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      throw new Error('Format fail JSON tidak sah atau rosak.');
    }

    let rawRecords = [];
    let metadata = {
      sourceSchema: '',
      exportedAt: ''
    };

    if (Array.isArray(parsed)) {
      rawRecords = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records)) {
      rawRecords = parsed.records;
      metadata = {
        sourceSchema: typeof parsed.source_schema === 'string' ? parsed.source_schema : '',
        exportedAt: typeof parsed.exported_at === 'string' ? parsed.exported_at : ''
      };
    } else {
      throw new Error('Struktur JSON tidak mengandungi senarai rekod aktiviti yang sah.');
    }

    const validRecords = [];
    let skippedCount = 0;

    rawRecords.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') {
        skippedCount++;
        return;
      }

      const tarikh = normalizeDateOnly(entry.tarikh);
      const tajuk = normalizeText(entry.tajuk);

      if (!tarikh || !tajuk) {
        skippedCount++;
        return;
      }

      const numericId = Number(entry.id);
      validRecords.push({
        id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
        medium_aktiviti: normalizeMedium(entry.medium_aktiviti),
        tarikh: tarikh,
        tajuk: tajuk,
        masa: normalizeText(entry.masa),
        tempat: normalizeText(entry.tempat),
        nama_guru: normalizeText(entry.nama_guru),
        impak_catatan: normalizeText(entry.impak_catatan),
        tindak_susul: normalizeText(entry.tindak_susul)
      });
    });

    if (validRecords.length === 0) {
      throw new Error('Tiada rekod sah ditemui dalam fail JSON (pastikan lajur tarikh dan tajuk wujud).');
    }

    return {
      validRecords: validRecords,
      skippedCount: skippedCount,
      metadata: metadata
    };
  }

  function buildInsertRow(record, preserveIds) {
    const row = {
      medium_aktiviti: record.medium_aktiviti,
      tarikh: record.tarikh,
      tajuk: record.tajuk,
      masa: record.masa || null,
      tempat: record.tempat || null,
      nama_guru: record.nama_guru || null,
      impak_catatan: record.impak_catatan || null,
      tindak_susul: record.tindak_susul || null
    };

    if (preserveIds && Number.isInteger(record.id) && record.id > 0) {
      row.id = record.id;
    }

    return row;
  }

  async function importRecords(supabaseClient, records, options) {
    const env = await window.ENV_READY;
    if (!supabaseClient || typeof supabaseClient.from !== 'function') {
      throw new Error('Sambungan klien Supabase tidak tersedia.');
    }

    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Tiada rekod untuk diimport.');
    }

    const sessionResult = await supabaseClient.auth.getSession();
    const activeSession = sessionResult && sessionResult.data ? sessionResult.data.session : null;
    if (!activeSession || !activeSession.user) {
      throw new Error('Sila log masuk sebagai pentadbir sebelum mengimport data.');
    }

    const opts = options || {};
    const preserveIds = Boolean(opts.preserveIds);
    const batchSize = typeof opts.batchSize === 'number' && opts.batchSize > 0
      ? Math.floor(opts.batchSize)
      : DEFAULT_BATCH_SIZE;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    const total = records.length;
    const totalBatches = Math.ceil(total / batchSize);
    let processed = 0;

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const slice = records.slice(start, start + batchSize);
      const payloadBatch = slice.map(function (item) {
        return buildInsertRow(item, preserveIds);
      });

      const query = preserveIds
        ? supabaseClient.from(TABLE_NAME).upsert(payloadBatch, { onConflict: 'id' })
        : supabaseClient.from(TABLE_NAME).insert(payloadBatch);

      const result = await query;
      if (result.error) {
        throw new Error(
          'Gagal mengimport kelompok ' + (batchIndex + 1) + '/' + totalBatches + ': ' + result.error.message
        );
      }

      processed += payloadBatch.length;
      if (onProgress) {
        onProgress({
          processed: processed,
          total: total,
          batchIndex: batchIndex + 1,
          totalBatches: totalBatches
        });
      }
    }

    if (window.IdbCache && typeof window.IdbCache.clearNamespace === 'function') {
      await window.IdbCache.clearNamespace();
    }

    return {
      importedCount: processed,
      totalBatches: totalBatches,
      targetSchema: env && env.SUPABASE_SCHEMA ? env.SUPABASE_SCHEMA : 'pap'
    };
  }

  window.DataMigration = Object.freeze({
    exportJson: exportJson,
    exportCsv: exportCsv,
    parseImportFile: parseImportFile,
    importRecords: importRecords
  });
})();