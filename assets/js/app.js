let allData = [];
let yearsAvailable = [];
let currentUser = null;
let supabaseClient = null;

let filterYear = new Date().getFullYear();
let filterMonth = '__ALL__';
let filterDay = '__ALL__';
let filterType = '__ALL__';

const msMY = new Intl.DateTimeFormat('ms-MY', { month: 'long' });
const getMonthKey = function (d) {
  const dt = new Date(d);
  return String(dt.getMonth() + 1).padStart(2, '0');
};

const btnShowLogin = document.getElementById('btn-show-login');
const btnLogout = document.getElementById('btn-logout');
const btnConnectionProfile = document.getElementById('btn-connection-profile');
const tabAddBtn = document.getElementById('tab-add-btn');
const tabMigrationBtn = document.getElementById('tab-migration-btn');

function updateAuthUI() {
  if (currentUser) {
    if (btnShowLogin) btnShowLogin.classList.add('hidden');
    if (btnLogout) btnLogout.classList.remove('hidden');
    if (btnConnectionProfile) btnConnectionProfile.classList.remove('hidden');
    if (tabAddBtn) tabAddBtn.classList.remove('hidden');
    if (tabMigrationBtn) tabMigrationBtn.classList.remove('hidden');
  } else {
    if (btnShowLogin) btnShowLogin.classList.remove('hidden');
    if (btnLogout) btnLogout.classList.add('hidden');
    if (btnConnectionProfile) btnConnectionProfile.classList.add('hidden');
    if (tabAddBtn) tabAddBtn.classList.add('hidden');
    if (tabMigrationBtn) tabMigrationBtn.classList.add('hidden');

    window.closeConnectionModal();

    const tabAdd = document.getElementById('tab-add');
    const tabMigration = document.getElementById('tab-migration');
    if (tabAdd && tabAdd.classList.contains('active')) {
      window.switchTab('list');
    }
    if (tabMigration && tabMigration.classList.contains('active')) {
      window.switchTab('list');
    }
  }
}

async function initApp() {
  try {
    const env = await window.ENV_READY;
    supabaseClient = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      db: { schema: env.SUPABASE_SCHEMA }
    });

    supabaseClient.auth.onAuthStateChange(function (event, session) {
      currentUser = session && session.user ? session.user : null;
      updateAuthUI();
      renderActivities();
    });

    if (window.IdbCache && typeof window.IdbCache.init === 'function') {
      await window.IdbCache.init();
    }

    await loadInitialData();
    setupYearDropdown();
    setupFilterListeners();
    updateMonthOptions();
    renderActivities();
    renderHeatmap();

    if (window.RealtimeSync && typeof window.RealtimeSync.start === 'function') {
      window.RealtimeSync.start(supabaseClient, {
        onUpsert: function () { },
        onDelete: function () { },
        onStatusChange: updateRealtimeStatusUI
      });
    }

    window.addEventListener('pap:realtime-change', function () {
      refreshDataSilently();
    });

  } catch (err) {
    if (window.Swal) {
      window.Swal.fire('Ralat Permulaan', err.message, 'error');
    }
  }
}

async function fetchFromSupabase() {
  const response = await supabaseClient
    .from('aktiviti')
    .select('*')
    .order('tarikh', { ascending: false });
  if (response.error) {
    throw response.error;
  }
  return response.data || [];
}

async function loadInitialData() {
  try {
    if (window.IdbCache && typeof window.IdbCache.getWithSWR === 'function') {
      const cacheResult = await window.IdbCache.getWithSWR(fetchFromSupabase, { ttlMs: 300000 });
      allData = cacheResult.items;
      if (window.RealtimeSync && typeof window.RealtimeSync.seedTimestamps === 'function') {
        window.RealtimeSync.seedTimestamps(allData);
      }
    } else {
      allData = await fetchFromSupabase();
    }

    const yearsSet = new Set(allData.map(function (item) {
      return new Date(item.tarikh).getFullYear();
    }));
    yearsAvailable = Array.from(yearsSet).sort(function (a, b) {
      return b - a;
    });

    const currentY = new Date().getFullYear();
    if (!yearsAvailable.includes(currentY)) {
      yearsAvailable.unshift(currentY);
      yearsAvailable.sort(function (a, b) {
        return b - a;
      });
    }
    if (yearsAvailable.length > 0 && filterYear === new Date().getFullYear() && !yearsAvailable.includes(filterYear)) {
      filterYear = Math.max.apply(null, yearsAvailable);
    }
  } catch (_) {
    if (window.Swal) {
      window.Swal.fire('Ralat', 'Gagal memuatkan data dari pelayan.', 'error');
    }
  }
}

async function refreshDataSilently() {
  try {
    if (window.IdbCache && typeof window.IdbCache.getCachedActivities === 'function') {
      const cacheResult = await window.IdbCache.getCachedActivities();
      allData = cacheResult.items;
    }
    renderActivities();
    renderHeatmap();
    updateMonthOptions();
  } catch (_) {
  }
}

function updateRealtimeStatusUI(status) {
  const dot = document.getElementById('realtime-status-dot');
  const text = document.getElementById('realtime-status-text');
  if (!dot || !text) return;

  dot.className = 'status-dot';
  if (status === 'SUBSCRIBED') {
    dot.classList.add('connected');
    text.textContent = window.__ENV.IS_OVERRIDE ? 'Mod Eksport' : 'Talian Aktif';
    text.title = 'Bersambung ke: ' + window.__ENV.SUPABASE_SCHEMA;
  } else if (status === 'SUBSCRIBING') {
    dot.classList.add('connecting');
    text.textContent = 'Menyambung...';
  } else {
    dot.classList.add('offline');
    text.textContent = 'Luar Talian';
  }
}

function setupYearDropdown() {
  const yearSelect = document.getElementById('year-jump');
  if (yearSelect) {
    yearSelect.innerHTML = '';
    const frag = document.createDocumentFragment();
    yearsAvailable.forEach(function (y) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === filterYear) {
        opt.selected = true;
      }
      frag.appendChild(opt);
    });
    yearSelect.appendChild(frag);
  }
}

function setupFilterListeners() {
  const yearJump = document.getElementById('year-jump');
  const monthJump = document.getElementById('month-jump');
  const dayJump = document.getElementById('day-jump');

  if (yearJump) {
    yearJump.addEventListener('change', function (e) {
      filterYear = parseInt(e.target.value, 10);
      filterMonth = '__ALL__';
      updateMonthOptions();
      renderActivities();
      renderHeatmap();
    });
  }

  if (monthJump) {
    monthJump.addEventListener('change', function (e) {
      filterMonth = e.target.value;
      updateDayOptions();
      renderActivities();
    });
  }

  if (dayJump) {
    dayJump.addEventListener('change', function (e) {
      filterDay = e.target.value;
      renderActivities();
    });
  }
}

function updateMonthOptions() {
  const monthSelect = document.getElementById('month-jump');
  if (!monthSelect) return;

  const currentVal = filterMonth;
  monthSelect.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '__ALL__';
  defaultOpt.textContent = 'Semua Bulan';
  monthSelect.appendChild(defaultOpt);

  const monthNames = [
    "Januari", "Februari", "Mac", "April", "Mei", "Jun",
    "Julai", "Ogos", "September", "Oktober", "November", "Disember"
  ];

  const frag = document.createDocumentFragment();
  monthNames.forEach(function (name, index) {
    const monthKey = String(index + 1).padStart(2, '0');
    const count = allData.filter(function (item) {
      const d = new Date(item.tarikh);
      return d.getFullYear() === filterYear && String(d.getMonth() + 1).padStart(2, '0') === monthKey;
    }).length;

    const opt = document.createElement('option');
    opt.value = monthKey;
    if (count > 0) {
      opt.textContent = name + ' (' + count + ')';
      opt.className = 'font-semibold text-gray-900';
    } else {
      opt.textContent = name;
      opt.className = 'text-gray-400';
    }
    frag.appendChild(opt);
  });

  monthSelect.appendChild(frag);
  updateDayOptions();
  if (currentVal !== '__ALL__') {
    monthSelect.value = currentVal;
  }
}

function updateDayOptions() {
  const daySelect = document.getElementById('day-jump');
  if (!daySelect) return;

  daySelect.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '__ALL__';
  defaultOpt.textContent = 'Semua Hari';
  daySelect.appendChild(defaultOpt);

  if (filterMonth === '__ALL__') {
    daySelect.disabled = true;
    filterDay = '__ALL__';
    return;
  }

  const relevantData = allData.filter(function (item) {
    const d = new Date(item.tarikh);
    return d.getFullYear() === filterYear && getMonthKey(item.tarikh) === filterMonth;
  });

  const daysSet = new Set(relevantData.map(function (d) {
    return new Date(d.tarikh).getDate();
  }));
  const days = Array.from(daysSet).sort(function (a, b) { return a - b; });

  if (days.length === 0) {
    daySelect.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'Tiada Data';
    daySelect.appendChild(emptyOpt);
    daySelect.disabled = true;
  } else {
    const frag = document.createDocumentFragment();
    days.forEach(function (d) {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = String(d);
      frag.appendChild(opt);
    });
    daySelect.appendChild(frag);
    daySelect.disabled = false;
  }

  filterDay = '__ALL__';
  daySelect.value = '__ALL__';
}

function linkifySafe(text) {
  if (!text) {
    const span = document.createElement('span');
    span.textContent = '-';
    return span;
  }

  const container = document.createDocumentFragment();
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = String(text).split(urlRegex);

  parts.forEach(function (part) {
    if (/^https?:\/\//i.test(part)) {
      const anchor = document.createElement('a');
      anchor.href = part;
      anchor.target = '_blank';
      anchor.className = 'text-blue-600 underline hover:text-blue-800 break-all';
      anchor.textContent = part;
      container.appendChild(anchor);
    } else if (part) {
      container.appendChild(document.createTextNode(part));
    }
  });

  return container;
}

function createTextElement(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content) el.textContent = content;
  return el;
}

function createIcon(pathD) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'w-4 h-4 text-gray-400');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('viewBox', '0 0 24 24');

  const paths = Array.isArray(pathD) ? pathD : [pathD];
  paths.forEach(function (d) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

function renderActivities() {
  const listEl = document.getElementById('activity-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const filtered = allData.filter(function (item) {
    const d = new Date(item.tarikh);
    const matchYear = d.getFullYear() === filterYear;
    const matchMonth = filterMonth === '__ALL__' || getMonthKey(item.tarikh) === filterMonth;
    const matchDay = filterDay === '__ALL__' || String(d.getDate()) === String(filterDay);
    const matchType = filterType === '__ALL__' || item.medium_aktiviti === filterType;
    return matchYear && matchMonth && matchDay && matchType;
  });

  const countBim = filtered.filter(function (i) { return i.medium_aktiviti === 'Bimbingan'; }).length;
  const countAkt = filtered.filter(function (i) { return i.medium_aktiviti === 'Aktiviti'; }).length;
  renderSummary(countBim, countAkt);

  const metaEl = document.getElementById('list-meta');
  if (metaEl) {
    metaEl.textContent = 'Memaparkan ' + filtered.length + ' rekod bagi Tahun ' + filterYear;
  }

  if (filtered.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'flex flex-col items-center justify-center p-8 bg-gray-50 rounded-lg border border-gray-200 text-center';
    const icon = createIcon(['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2']);
    icon.setAttribute('class', 'w-12 h-12 text-gray-300 mb-3');
    emptyState.appendChild(icon);
    emptyState.appendChild(createTextElement('p', 'text-gray-500 font-medium', 'Tiada rekod ditemui untuk tetapan ini.'));
    listEl.appendChild(emptyState);
    return;
  }

  const groups = Object.create(null);
  filtered.forEach(function (item) {
    const mKey = item.tarikh.substring(0, 7);
    if (!groups[mKey]) groups[mKey] = [];
    groups[mKey].push(item);
  });

  const frag = document.createDocumentFragment();

  Object.keys(groups).sort().reverse().forEach(function (key) {
    const items = groups[key];
    const dt = new Date(key + '-01');
    const monthLabel = typeof msMY.format === 'function'
      ? msMY.format(dt)
      : dt.toLocaleDateString('ms-MY', { month: 'long' });

    const section = document.createElement('section');

    const headerDiv = document.createElement('div');
    headerDiv.className = 'sticky top-16 bg-gray-50/95 backdrop-blur z-10 py-2 border-b border-gray-200 mb-4';
    const h3 = createTextElement('h3', 'text-lg font-bold text-gray-700 flex items-center gap-2', '');
    const dotSpan = document.createElement('span');
    dotSpan.className = 'w-2 h-2 rounded-full bg-gray-400';
    h3.appendChild(dotSpan);
    h3.appendChild(document.createTextNode(' ' + monthLabel + ' ' + filterYear));
    headerDiv.appendChild(h3);
    section.appendChild(headerDiv);

    const grid = document.createElement('div');
    grid.className = 'grid gap-4';

    items.forEach(function (act) {
      const isBimbingan = act.medium_aktiviti === 'Bimbingan';
      const badgeColor = isBimbingan ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';

      const card = document.createElement('div');
      card.className = 'bg-white p-5 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200';

      const metaRow = document.createElement('div');
      metaRow.className = 'flex justify-between items-start mb-2';
      metaRow.appendChild(createTextElement('span', 'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ' + badgeColor, act.medium_aktiviti));

      const dtObj = new Date(act.tarikh);
      const formattedDate = dtObj.toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      metaRow.appendChild(createTextElement('span', 'text-xs font-mono text-gray-400', formattedDate));
      card.appendChild(metaRow);

      card.appendChild(createTextElement('h4', 'text-lg font-bold text-gray-900 leading-snug mb-2 uppercase', act.tajuk || '(Tiada Tajuk)'));

      const infoDiv = document.createElement('div');
      infoDiv.className = 'text-sm text-gray-600 space-y-1 mb-3';

      const timeP = document.createElement('p');
      timeP.className = 'flex items-center gap-2 uppercase';
      timeP.appendChild(createIcon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'));
      timeP.appendChild(document.createTextNode(' ' + (act.masa || '-')));
      infoDiv.appendChild(timeP);

      const placeP = document.createElement('p');
      placeP.className = 'flex items-center gap-2 uppercase';
      placeP.appendChild(createIcon(['M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z', 'M15 11a3 3 0 11-6 0 3 3 0 016 0z']));
      placeP.appendChild(document.createTextNode(' ' + (act.tempat || '-')));
      infoDiv.appendChild(placeP);

      if (act.nama_guru) {
        const teacherP = document.createElement('p');
        teacherP.className = 'flex items-center gap-2 uppercase';
        teacherP.appendChild(createIcon(['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z']));
        teacherP.appendChild(document.createTextNode(' ' + act.nama_guru));
        infoDiv.appendChild(teacherP);
      }
      card.appendChild(infoDiv);

      const remarksDiv = document.createElement('div');
      remarksDiv.className = 'bg-gray-50 p-3 rounded-lg text-sm border border-gray-100';

      const impakWrap = document.createElement('div');
      impakWrap.className = 'mb-2';
      impakWrap.appendChild(createTextElement('span', 'text-xs font-bold text-gray-400 uppercase', 'Impak / Catatan'));
      const impakContent = document.createElement('div');
      impakContent.className = 'text-gray-700 mt-0.5 uppercase';
      impakContent.style.overflowWrap = 'anywhere';
      impakContent.appendChild(linkifySafe(act.impak_catatan));
      impakWrap.appendChild(impakContent);
      remarksDiv.appendChild(impakWrap);

      const susulWrap = document.createElement('div');
      susulWrap.appendChild(createTextElement('span', 'text-xs font-bold text-gray-400 uppercase', 'Tindak Susul'));
      const susulContent = document.createElement('div');
      susulContent.className = 'text-gray-700 mt-0.5 uppercase';
      susulContent.style.overflowWrap = 'anywhere';
      susulContent.appendChild(linkifySafe(act.tindak_susul));
      susulWrap.appendChild(susulContent);
      remarksDiv.appendChild(susulWrap);

      card.appendChild(remarksDiv);

      if (currentUser) {
        const actionRow = document.createElement('div');
        actionRow.className = 'flex gap-2 mt-4 pt-3 border-t border-gray-100 no-print';

        const btnEdit = createTextElement('button', 'flex-1 py-1.5 rounded text-sm text-blue-600 hover:bg-blue-50 font-medium transition', '✏️ Edit');
        btnEdit.onclick = function () { window.openEditModal(act, false); };

        const btnCopy = createTextElement('button', 'flex-1 py-1.5 rounded text-sm text-purple-600 hover:bg-purple-50 font-medium transition', '📋 Salin');
        btnCopy.onclick = function () { window.openEditModal(act, true); };

        const btnDel = createTextElement('button', 'flex-1 py-1.5 rounded text-sm text-red-600 hover:bg-red-50 font-medium transition', '🗑️ Padam');
        btnDel.onclick = function () { window.deleteActivity(act.id); };

        actionRow.appendChild(btnEdit);
        actionRow.appendChild(btnCopy);
        actionRow.appendChild(btnDel);
        card.appendChild(actionRow);
      }

      grid.appendChild(card);
    });
    section.appendChild(grid);
    frag.appendChild(section);
  });

  listEl.appendChild(frag);
}

function createSummaryBox(type, total, isActive) {
  const isBimbingan = type === 'Bimbingan';
  const colorPrefix = isBimbingan ? 'green' : 'blue';

  const box = document.createElement('div');
  box.className = 'summary-box cursor-pointer p-4 rounded-xl border transition-all duration-200 ';
  box.className += isActive
    ? 'ring-2 ring-' + colorPrefix + '-500 bg-' + colorPrefix + '-50 shadow-md'
    : 'bg-white border-' + colorPrefix + '-200 hover:shadow-sm';
  box.onclick = function () { window.toggleTypeFilter(type); };

  const topRow = document.createElement('div');
  topRow.className = 'flex justify-between items-start';
  topRow.appendChild(createTextElement('div', 'text-xs font-bold text-' + colorPrefix + '-600 uppercase tracking-wide', type));

  if (isActive) {
    topRow.appendChild(createTextElement('span', 'text-' + colorPrefix + '-600 font-bold', '✓'));
  }
  box.appendChild(topRow);
  box.appendChild(createTextElement('div', 'text-3xl font-extrabold text-' + colorPrefix + '-800 mt-1', String(total)));

  return box;
}

function renderSummary(totalBim, totalAkt) {
  const boxEl = document.getElementById('summary-boxes');
  if (!boxEl) return;
  boxEl.innerHTML = '';

  const isBimActive = filterType === 'Bimbingan';
  const isAktActive = filterType === 'Aktiviti';

  boxEl.appendChild(createSummaryBox('Bimbingan', totalBim, isBimActive));
  boxEl.appendChild(createSummaryBox('Aktiviti', totalAkt, isAktActive));
}

function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  const label = document.getElementById('heatmap-year-label');
  if (!grid) return;

  if (label) label.textContent = filterYear;

  const months = Array.from({ length: 12 }, function (_, i) {
    return {
      idx: i,
      name: new Date(2000, i, 1).toLocaleDateString('ms-MY', { month: 'long' }),
      count: 0,
      bim: 0,
      akt: 0
    };
  });

  allData.forEach(function (item) {
    const d = new Date(item.tarikh);
    if (d.getFullYear() === filterYear) {
      const m = d.getMonth();
      months[m].count++;
      if (item.medium_aktiviti === 'Bimbingan') months[m].bim++;
      else months[m].akt++;
    }
  });

  let maxCount = 1;
  months.forEach(function (m) {
    if (m.count > maxCount) maxCount = m.count;
  });

  grid.innerHTML = '';
  const frag = document.createDocumentFragment();

  months.forEach(function (m) {
    const opacity = m.count === 0 ? 0.05 : (m.count / maxCount);
    const bgColor = 'rgba(212, 175, 55, ' + Math.max(0.05, opacity) + ')';
    const borderColor = m.count > 0 ? 'border-yellow-400' : 'border-yellow-100';

    const card = document.createElement('div');
    card.className = 'rounded-xl p-3 border ' + borderColor + ' transition-transform hover:scale-105';
    card.style.backgroundColor = bgColor;

    card.appendChild(createTextElement('div', 'text-sm font-bold text-gray-800', m.name));

    const countDiv = document.createElement('div');
    countDiv.className = 'text-xs text-gray-600 mt-1';
    countDiv.appendChild(document.createTextNode('Jumlah: '));
    countDiv.appendChild(createTextElement('b', '', String(m.count)));
    card.appendChild(countDiv);

    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'flex gap-1 mt-2 flex-wrap';
    if (m.count > 0) {
      tagsDiv.appendChild(createTextElement('span', 'text-[10px] bg-white/80 px-1.5 py-0.5 rounded text-green-800 font-medium', 'B: ' + m.bim));
      tagsDiv.appendChild(createTextElement('span', 'text-[10px] bg-white/80 px-1.5 py-0.5 rounded text-blue-800 font-medium', 'A: ' + m.akt));
    }
    card.appendChild(tagsDiv);
    frag.appendChild(card);
  });

  grid.appendChild(frag);
}

const addForm = document.getElementById('add-activity-form');
if (addForm) {
  addForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!currentUser) return window.Swal.fire('Akses Ditolak', 'Sila log masuk dahulu.', 'warning');

    const finalPayload = {
      medium_aktiviti: document.getElementById('medium_aktiviti').value,
      tajuk: document.getElementById('tajuk').value.toUpperCase(),
      tarikh: document.getElementById('tarikh').value,
      masa: document.getElementById('masa').value.toUpperCase(),
      tempat: document.getElementById('tempat').value.toUpperCase(),
      nama_guru: document.getElementById('nama_guru').value.toUpperCase(),
      impak_catatan: safeUpperCase(document.getElementById('impak_catatan').value),
      tindak_susul: safeUpperCase(document.getElementById('tindak_susul').value)
    };

    const response = await supabaseClient.from('aktiviti').insert([finalPayload]);
    if (response.error) {
      window.Swal.fire('Ralat', response.error.message, 'error');
    } else {
      window.Swal.fire('Berjaya', 'Aktiviti berjaya ditambah.', 'success');
      e.target.reset();
      await loadInitialData();
      window.switchTab('list');
    }
  });
}

const saveBtn = document.getElementById('save-changes-btn');
if (saveBtn) {
  saveBtn.addEventListener('click', async function () {
    if (!currentUser) return window.Swal.fire('Akses Ditolak', 'Sila log masuk dahulu.', 'warning');

    const id = document.getElementById('edit-activity-id').value;
    const payload = {
      medium_aktiviti: document.getElementById('edit-medium_aktiviti').value,
      tajuk: document.getElementById('edit-tajuk').value.toUpperCase(),
      tarikh: document.getElementById('edit-tarikh').value,
      masa: document.getElementById('edit-masa').value.toUpperCase(),
      tempat: document.getElementById('edit-tempat').value.toUpperCase(),
      nama_guru: document.getElementById('edit-nama_guru').value.toUpperCase(),
      impak_catatan: safeUpperCase(document.getElementById('edit-impak_catatan').value),
      tindak_susul: safeUpperCase(document.getElementById('edit-tindak_susul').value)
    };

    let response;
    if (window.isCopyMode) {
      response = await supabaseClient.from('aktiviti').insert([payload]);
    } else {
      response = await supabaseClient.from('aktiviti').update(payload).eq('id', id);
    }

    if (response.error) {
      window.Swal.fire('Gagal', response.error.message, 'error');
    } else {
      window.Swal.fire('Berjaya', 'Tindakan berjaya disimpan.', 'success');
      window.closeEditModal();
      await loadInitialData();
      refreshDataSilently();
    }
  });
}

window.promptExportJson = async function () {
  if (!currentUser) return window.Swal.fire('Akses Ditolak', 'Sila log masuk.', 'warning');
  try {
    const result = await window.DataMigration.exportJson(supabaseClient, allData);
    window.Swal.fire('Eksport Selesai', result.totalRecords + ' rekod disimpan ke ' + result.filename, 'success');
  } catch (err) {
    window.Swal.fire('Ralat Eksport', err.message, 'error');
  }
};

window.promptExportCsv = async function () {
  if (!currentUser) return window.Swal.fire('Akses Ditolak', 'Sila log masuk.', 'warning');
  try {
    const result = await window.DataMigration.exportCsv(supabaseClient, allData);
    window.Swal.fire('Eksport Selesai', result.totalRecords + ' rekod CSV disimpan ke ' + result.filename, 'success');
  } catch (err) {
    window.Swal.fire('Ralat Eksport', err.message, 'error');
  }
};

window.handleImportSelection = async function (event) {
  if (!currentUser) return window.Swal.fire('Akses Ditolak', 'Sila log masuk.', 'warning');
  const file = event.target.files[0];
  if (!file) return;

  try {
    const parsed = await window.DataMigration.parseImportFile(file);
    const summary = 'Rekod Sah: ' + parsed.validRecords.length + '\nDisingkirkan: ' + parsed.skippedCount;

    const res = await window.Swal.fire({
      title: 'Sahkan Import',
      text: summary + '\n\nPilih mod import:',
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Kekalkan ID Lama',
      denyButtonText: 'Jana ID Baharu',
      cancelButtonText: 'Batal'
    });

    if (res.isConfirmed || res.isDenied) {
      const preserveIds = res.isConfirmed;
      window.Swal.fire({
        title: 'Mengimport Data...',
        html: 'Sila tunggu. Jangan tutup halaman ini.',
        allowOutsideClick: false,
        didOpen: function () { window.Swal.showLoading(); }
      });

      const result = await window.DataMigration.importRecords(supabaseClient, parsed.validRecords, {
        preserveIds: preserveIds,
        onProgress: function () { }
      });

      await loadInitialData();
      refreshDataSilently();

      window.Swal.fire('Berjaya', 'Import selesai (' + result.importedCount + ' rekod).', 'success');
    }
  } catch (err) {
    window.Swal.fire('Ralat Import', err.message, 'error');
  } finally {
    event.target.value = '';
  }
};

const loginFormEl = document.getElementById('login-form');
if (loginFormEl) {
  loginFormEl.addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const response = await supabaseClient.auth.signInWithPassword({ email: email, password: pass });
    if (response.error) {
      window.Swal.fire('Gagal', 'Emel atau kata laluan salah.', 'error');
    } else {
      window.closeLoginModal();
      window.Swal.fire('Berjaya', 'Selamat kembali!', 'success');
      loginFormEl.reset();
    }
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', async function () {
    await supabaseClient.auth.signOut();
    window.Swal.fire('Log Keluar', 'Anda telah log keluar.', 'info');
  });
}

if (btnShowLogin) {
  btnShowLogin.addEventListener('click', function () {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.remove('hidden');
  });
}

window.switchTab = function (tab) {
  document.querySelectorAll('.tab-content').forEach(function (el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab-button').forEach(function (el) { el.classList.remove('active'); });

  const content = document.getElementById('tab-' + tab);
  const btn = document.getElementById('tab-' + tab + '-btn');

  if (content) content.classList.add('active');
  if (btn) btn.classList.add('active');

  if (tab === 'heatmap') renderHeatmap();
};

window.toggleTypeFilter = function (type) {
  filterType = (filterType === type) ? '__ALL__' : type;
  renderActivities();
};

window.closeLoginModal = function () {
  const modal = document.getElementById('login-modal');
  if (modal) modal.classList.add('hidden');
};

window.openConnectionModal = function () {
  if (!currentUser) {
    if (window.Swal) {
      window.Swal.fire('Akses Ditolak', 'Sila log masuk sebagai admin terlebih dahulu.', 'warning');
    }
    return;
  }
  const modal = document.getElementById('connection-modal');
  if (!modal) return;
  const currentEnv = window.__ENV || {};
  document.getElementById('override-url').value = currentEnv.SUPABASE_URL || '';
  document.getElementById('override-key').value = currentEnv.SUPABASE_ANON_KEY || '';
  document.getElementById('override-schema').value = currentEnv.SUPABASE_SCHEMA || 'pap';
  modal.classList.remove('hidden');
};

window.closeConnectionModal = function () {
  const modal = document.getElementById('connection-modal');
  if (modal) modal.classList.add('hidden');
};

window.saveConnectionOverride = function () {
  if (!currentUser) {
    if (window.Swal) {
      window.Swal.fire('Akses Ditolak', 'Sila log masuk sebagai admin terlebih dahulu.', 'warning');
    }
    return;
  }
  const url = document.getElementById('override-url').value;
  const key = document.getElementById('override-key').value;
  const schema = document.getElementById('override-schema').value;
  try {
    window.AppConfig.setOverride({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, SUPABASE_SCHEMA: schema });
    window.Swal.fire('Berjaya', 'Profil sambungan telah ditukar. Memuat semula...', 'success').then(function () {
      window.location.reload();
    });
  } catch (err) {
    window.Swal.fire('Ralat', err.message, 'error');
  }
};

window.clearConnectionOverride = function () {
  if (!currentUser) {
    if (window.Swal) {
      window.Swal.fire('Akses Ditolak', 'Sila log masuk sebagai admin terlebih dahulu.', 'warning');
    }
    return;
  }
  window.AppConfig.clearOverride();
  window.Swal.fire('Ditetapkan Semula', 'Kembali ke konfigurasi asal. Memuat semula...', 'info').then(function () {
    window.location.reload();
  });
};

window.isCopyMode = false;

window.openEditModal = function (item, copyMode) {
  let parsedItem = item;
  if (typeof item === 'string') {
    try { parsedItem = JSON.parse(item); } catch (_) { }
  }

  window.isCopyMode = copyMode;
  const modal = document.getElementById('edit-modal');
  const title = document.getElementById('modal-title');
  const btn = document.getElementById('save-changes-btn');

  if (!modal) return;

  title.textContent = copyMode ? 'Salin Aktiviti Baharu' : 'Kemas Kini Aktiviti';
  btn.textContent = copyMode ? 'Simpan Salinan' : 'Simpan Perubahan';

  document.getElementById('edit-activity-id').value = parsedItem.id || '';
  document.getElementById('edit-medium_aktiviti').value = parsedItem.medium_aktiviti || 'Bimbingan';
  document.getElementById('edit-tarikh').value = parsedItem.tarikh ? String(parsedItem.tarikh).split('T')[0] : '';
  document.getElementById('edit-tajuk').value = parsedItem.tajuk || '';
  document.getElementById('edit-masa').value = parsedItem.masa || '';
  document.getElementById('edit-tempat').value = parsedItem.tempat || '';
  document.getElementById('edit-nama_guru').value = parsedItem.nama_guru || '';
  document.getElementById('edit-impak_catatan').value = parsedItem.impak_catatan || '';
  document.getElementById('edit-tindak_susul').value = parsedItem.tindak_susul || '';

  modal.classList.remove('hidden');
};

window.closeEditModal = function () {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.add('hidden');
};

window.deleteActivity = async function (id) {
  const res = await window.Swal.fire({
    title: 'Anda Pasti?',
    text: "Rekod yang dipadam tidak boleh dikembalikan!",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6',
    confirmButtonText: 'Ya, Padam',
    cancelButtonText: 'Batal'
  });

  if (res.isConfirmed) {
    const response = await supabaseClient.from('aktiviti').delete().eq('id', id);
    if (response.error) {
      window.Swal.fire('Gagal', response.error.message, 'error');
    } else {
      window.Swal.fire('Berjaya', 'Rekod telah dipadam.', 'success');
      await loadInitialData();
      refreshDataSilently();
    }
  }
};

function safeUpperCase(text) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s<]+)/gi;
  const parts = String(text).split(urlRegex);
  return parts.map(function (part) {
    if (/^https?:\/\//i.test(part)) {
      return part;
    }
    return part.toUpperCase();
  }).join('');
}

const printBtn = document.getElementById('print-btn');
if (printBtn) {
  printBtn.addEventListener('click', function () { window.print(); });
}

window.addEventListener('scroll', function () {
  const h = document.getElementById('stickyHeader');
  if (h) {
    if (window.scrollY > 10) h.classList.add('scrolled');
    else h.classList.remove('scrolled');
  }
});

document.addEventListener('DOMContentLoaded', initApp);