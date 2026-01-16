// =================================================================
// 1. KONFIGURASI SUPABASE & PEMBOLEHUBAH GLOBAL
// =================================================================

// URL Server Hostinger Anda
const SUPABASE_URL = 'https://appppdag.cloud';

// Kunci ANON (Public Key) - Pastikan ini sama dengan fail .env anda
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzYzMzczNjQ1LCJleHAiOjIwNzg3MzM2NDV9.vZOedqJzUn01PjwfaQp7VvRzSm4aRMr21QblPDK8AoY';

// INI BAHAGIAN PALING PENTING: Setting Schema 'rekod_aktiviti'
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true, // Simpan session supaya tak logout bila refresh
        autoRefreshToken: true,
    },
    db: {
        schema: 'rekod_aktiviti' // <--- Kita paksa app cari dalam schema ini
    }
});

// State Data
let allData = [];
let yearsAvailable = [];
let currentUser = null;

// Filter State (Default)
let filterYear = new Date().getFullYear();
let filterMonth = '__ALL__';
let filterDay = '__ALL__';
let filterType = '__ALL__';

// Helper Format Tarikh (Bahasa Melayu)
const msMY = new Intl.DateTimeFormat('ms-MY', { month: 'long' });
const fullDate = (d) => new Date(d).toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const getMonthKey = (d) => { const dt = new Date(d); return `${String(dt.getMonth() + 1).padStart(2, '0')}`; };

// =================================================================
// 2. LOGIK PENGESAHAN (AUTH / LOGIN)
// =================================================================

const authContainer = document.getElementById('auth-container');
const btnShowLogin = document.getElementById('btn-show-login');
const btnLogout = document.getElementById('btn-logout');
const tabAddBtn = document.getElementById('tab-add-btn');

// Pendengar Status Sesi (Session Listener)
supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    renderActivities(); // Render semula supaya butang Edit/Padam muncul/hilang
});

function updateAuthUI() {
    if (currentUser) {
        // Jika Login
        if(btnShowLogin) btnShowLogin.classList.add('hidden');
        if(btnLogout) btnLogout.classList.remove('hidden');
        if(tabAddBtn) tabAddBtn.classList.remove('hidden');
    } else {
        // Jika Pelawat (Guest)
        if(btnShowLogin) btnShowLogin.classList.remove('hidden');
        if(btnLogout) btnLogout.classList.add('hidden');
        if(tabAddBtn) tabAddBtn.classList.add('hidden');
        
        // Jika pengguna berada di tab 'Tambah', alihkan ke 'Senarai'
        const tabAdd = document.getElementById('tab-add');
        if(tabAdd && tabAdd.classList.contains('active')){
            window.switchTab('list');
        }
    }
}

// Log Masuk (Submit Form)
const loginForm = document.getElementById('login-form');
if(loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
        if (error) {
            Swal.fire('Gagal', 'Emel atau kata laluan salah.', 'error');
        } else {
            window.closeLoginModal();
            Swal.fire('Berjaya', 'Selamat kembali, Tuan!', 'success');
            loginForm.reset();
        }
    });
}

// Log Keluar
if(btnLogout) {
    btnLogout.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        Swal.fire('Log Keluar', 'Anda telah log keluar.', 'info');
    });
}

// Buka Modal Login
if(btnShowLogin) {
    btnShowLogin.addEventListener('click', () => {
        const modal = document.getElementById('login-modal');
        if(modal) modal.classList.remove('hidden');
    });
}

// =================================================================
// 3. PENGURUSAN DATA & PENAPIS (DATA & FILTERS)
// =================================================================

async function initApp() {
    await fetchData();
    setupYearDropdown();
    setupFilterListeners();
    
    // Tetapkan tahun filter kepada tahun terkini yang ada dalam data
    if(yearsAvailable.length > 0) {
        filterYear = Math.max(...yearsAvailable);
    } else {
        filterYear = new Date().getFullYear();
    }
    
    // Set nilai dropdown tahun
    const yearJump = document.getElementById('year-jump');
    if(yearJump) yearJump.value = filterYear;
    
    // Jana dropdown bulan dan render
    updateMonthOptions(); 
    renderActivities();
    renderHeatmap();
}

async function fetchData() {
    try {
        // PERUBAHAN: Menggunakan table 'aktiviti_rows'
        let { data, error } = await supabaseClient
            .from('aktiviti_rows')
            .select('*')
            .order('tarikh', { ascending: false });

        if (error) throw error;
        allData = data || [];

        // Dapatkan senarai tahun unik dari data
        const yearsSet = new Set(allData.map(item => new Date(item.tarikh).getFullYear()));
        yearsAvailable = Array.from(yearsSet).sort((a, b) => b - a); 
        
        // Pastikan tahun semasa sentiasa ada dalam senarai
        const currentY = new Date().getFullYear();
        if(!yearsAvailable.includes(currentY)) {
            yearsAvailable.unshift(currentY);
            yearsAvailable.sort((a, b) => b - a);
        }

    } catch (err) {
        console.error(err);
        // Jika error 404, mungkin schema belum set atau table salah nama
        Swal.fire('Ralat', 'Gagal memuatkan data. Pastikan table "aktiviti_rows" wujud dalam schema "rekod_aktiviti".', 'error');
    }
}

function setupYearDropdown() {
    const yearSelect = document.getElementById('year-jump');
    if(yearSelect) yearSelect.innerHTML = yearsAvailable.map(y => `<option value="${y}">${y}</option>`).join('');
}

function setupFilterListeners() {
    const yearJump = document.getElementById('year-jump');
    const monthJump = document.getElementById('month-jump');
    const dayJump = document.getElementById('day-jump');

    // Ubah Tahun
    if(yearJump) {
        yearJump.addEventListener('change', (e) => {
            filterYear = parseInt(e.target.value);
            filterMonth = '__ALL__'; // Reset bulan
            updateMonthOptions();    // Jana semula bulan ikut tahun baru
            renderActivities();
            renderHeatmap();
        });
    }

    // Ubah Bulan
    if(monthJump) {
        monthJump.addEventListener('change', (e) => {
            filterMonth = e.target.value;
            updateDayOptions(); // Jana hari ikut bulan baru
            renderActivities();
        });
    }

    // Ubah Hari
    if(dayJump) {
        dayJump.addEventListener('change', (e) => {
            filterDay = e.target.value;
            renderActivities();
        });
    }
}

// FUNGSI PENTING: Jana Dropdown Bulan (FIXED)
function updateMonthOptions() {
    const monthSelect = document.getElementById('month-jump');
    if(!monthSelect) return;

    // Simpan nilai semasa (jika ada) untuk elak reset tak sengaja
    const currentVal = filterMonth;

    // Reset Dropdown
    monthSelect.innerHTML = '<option value="__ALL__">Semua Bulan</option>';
    
    // Nama Bulan Bahasa Melayu
    const monthNames = [
        "Januari", "Februari", "Mac", "April", "Mei", "Jun",
        "Julai", "Ogos", "September", "Oktober", "November", "Disember"
    ];

    // Loop 12 Bulan
    monthNames.forEach((name, index) => {
        // Format bulan jadi "01", "02" ... "12"
        const monthKey = String(index + 1).padStart(2, '0');
        
        // Kira bilangan aktiviti untuk Bulan & Tahun semasa
        const count = allData.filter(item => {
            const d = new Date(item.tarikh);
            return d.getFullYear() === filterYear && 
                   String(d.getMonth() + 1).padStart(2, '0') === monthKey;
        }).length;

        // Cipta Option
        const option = document.createElement('option');
        option.value = monthKey;
        
        if (count > 0) {
            option.text = `${name} (${count})`; // Cth: Oktober (5)
            option.classList.add('font-semibold', 'text-gray-900');
        } else {
            option.text = name; // Cth: Januari
            option.classList.add('text-gray-400');
        }
        
        monthSelect.appendChild(option);
    });

    // Reset dropdown hari juga
    updateDayOptions();

    // Kembalikan nilai asal jika pengguna tak tukar tahun (UX improvement)
    if(currentVal !== '__ALL__') {
        monthSelect.value = currentVal;
    }
}

// FUNGSI PENTING: Jana Dropdown Hari
function updateDayOptions() {
    const daySelect = document.getElementById('day-jump');
    if(!daySelect) return;

    daySelect.innerHTML = '<option value="__ALL__">Semua Hari</option>';
    
    // Jika tiada bulan dipilih, disable dropdown hari
    if (filterMonth === '__ALL__') {
        daySelect.disabled = true;
        filterDay = '__ALL__';
        return;
    }

    // Tapis data untuk bulan yang dipilih sahaja
    const relevantData = allData.filter(item => {
        const d = new Date(item.tarikh);
        return d.getFullYear() === filterYear && getMonthKey(item.tarikh) === filterMonth;
    });

    // Dapatkan senarai hari unik
    const days = [...new Set(relevantData.map(d => new Date(d.tarikh).getDate()))].sort((a,b)=>a-b);
    
    if (days.length === 0) {
        daySelect.innerHTML = '<option value="">Tiada Data</option>';
        daySelect.disabled = true;
    } else {
        days.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            daySelect.appendChild(opt);
        });
        daySelect.disabled = false;
    }
    // Reset hari ke 'Semua' bila bulan bertukar
    filterDay = '__ALL__'; 
    daySelect.value = '__ALL__';
}

// =================================================================
// 4. RENDERING (PAPARAN SENARAI & HEATMAP)
// =================================================================

function renderActivities() {
    const listEl = document.getElementById('activity-list');
    if(!listEl) return;
    listEl.innerHTML = '';

    // Tapis Data Utama
    let filtered = allData.filter(item => {
        const d = new Date(item.tarikh);
        const matchYear = d.getFullYear() === filterYear;
        const matchMonth = filterMonth === '__ALL__' || getMonthKey(item.tarikh) === filterMonth;
        const matchDay = filterDay === '__ALL__' || d.getDate() === parseInt(filterDay);
        const matchType = filterType === '__ALL__' || item.medium_aktiviti === filterType;
        return matchYear && matchMonth && matchDay && matchType;
    });

    // Kira Statistik Ringkas
    const countBim = filtered.filter(i => i.medium_aktiviti === 'Bimbingan').length;
    const countAkt = filtered.filter(i => i.medium_aktiviti === 'Aktiviti').length;
    renderSummary(countBim, countAkt);

    // Update Label Meta
    const metaEl = document.getElementById('list-meta');
    if(metaEl) metaEl.innerText = `Memaparkan ${filtered.length} rekod bagi Tahun ${filterYear}`;

    // Jika Tiada Data
    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-lg border border-gray-200 text-center">
                <svg class="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                <p class="text-gray-500 font-medium">Tiada rekod ditemui untuk tetapan ini.</p>
            </div>`;
        return;
    }

    // Kumpul Data Mengikut Bulan (Grouping)
    const groups = {};
    filtered.forEach(item => {
        const mKey = item.tarikh.substring(0, 7); // Format: YYYY-MM
        if (!groups[mKey]) groups[mKey] = [];
        groups[mKey].push(item);
    });

    // Susun Bulan Terkini Dahulu
    Object.keys(groups).sort().reverse().forEach(key => {
        const items = groups[key];
        const monthLabel = msMY.format(new Date(key + '-01'));

        const section = document.createElement('section');
        // Sticky Month Header
        section.innerHTML = `
            <div class="sticky top-16 bg-gray-50/95 backdrop-blur z-10 py-2 border-b border-gray-200 mb-4">
                <h3 class="text-lg font-bold text-gray-700 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-gray-400"></span>
                    ${monthLabel} ${filterYear}
                </h3>
            </div>`;
        
        const grid = document.createElement('div');
        grid.className = 'grid gap-4';

        items.forEach(act => {
            const isBimbingan = act.medium_aktiviti === 'Bimbingan';
            const badgeColor = isBimbingan ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
            
            // Butang Edit/Salin/Padam (Hanya jika Login)
            let actionButtons = '';
            if (currentUser) {
                // Escape JSON untuk elak error quote
                const safeJson = JSON.stringify(act).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                actionButtons = `
                <div class="flex gap-2 mt-4 pt-3 border-t border-gray-100 no-print">
                    <button onclick='window.openEditModal(${safeJson}, false)' class="flex-1 py-1.5 rounded text-sm text-blue-600 hover:bg-blue-50 font-medium transition">✏️ Edit</button>
                    <button onclick='window.openEditModal(${safeJson}, true)' class="flex-1 py-1.5 rounded text-sm text-purple-600 hover:bg-purple-50 font-medium transition">📋 Salin</button>
                    <button onclick="window.deleteActivity('${act.id}')" class="flex-1 py-1.5 rounded text-sm text-red-600 hover:bg-red-50 font-medium transition">🗑️ Padam</button>
                </div>
                `;
            }

            const card = document.createElement('div');
            card.className = 'bg-white p-5 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200';
            card.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${badgeColor}">${act.medium_aktiviti}</span>
                    <span class="text-xs font-mono text-gray-400">${fullDate(act.tarikh)}</span>
                </div>
                <h4 class="text-lg font-bold text-gray-900 leading-snug mb-2">${act.tajuk || '(Tiada Tajuk)'}</h4>
                <div class="text-sm text-gray-600 space-y-1 mb-3">
                    <p class="flex items-center gap-2"><svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> ${act.masa || '-'}</p>
                    <p class="flex items-center gap-2"><svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg> ${act.tempat || '-'}</p>
                    ${act.nama_guru ? `<p class="flex items-center gap-2"><svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg> ${act.nama_guru}</p>` : ''}
                </div>
                <div class="bg-gray-50 p-3 rounded-lg text-sm border border-gray-100">
                    <div class="mb-2">
                        <span class="text-xs font-bold text-gray-400 uppercase">Impak / Catatan</span>
                        <div class="text-gray-700 mt-0.5" style="overflow-wrap:anywhere;">${linkify(act.impak_catatan)}</div>
                    </div>
                    <div>
                        <span class="text-xs font-bold text-gray-400 uppercase">Tindak Susul</span>
                        <div class="text-gray-700 mt-0.5" style="overflow-wrap:anywhere;">${linkify(act.tindak_susul)}</div>
                    </div>
                </div>
                ${actionButtons}
            `;
            grid.appendChild(card);
        });
        section.appendChild(grid);
        listEl.appendChild(section);
    });
}

function renderSummary(totalBim, totalAkt) {
    const boxEl = document.getElementById('summary-boxes');
    if(!boxEl) return;

    const isBimActive = filterType === 'Bimbingan';
    const isAktActive = filterType === 'Aktiviti';
    
    boxEl.innerHTML = `
        <div onclick="window.toggleTypeFilter('Bimbingan')" class="summary-box cursor-pointer p-4 rounded-xl border transition-all duration-200 ${isBimActive ? 'ring-2 ring-green-500 bg-green-50 shadow-md' : 'bg-white border-green-200 hover:shadow-sm'}">
            <div class="flex justify-between items-start">
                <div class="text-xs font-bold text-green-600 uppercase tracking-wide">Bimbingan</div>
                ${isBimActive ? '<span class="text-green-600 font-bold">✓</span>' : ''}
            </div>
            <div class="text-3xl font-extrabold text-green-800 mt-1">${totalBim}</div>
        </div>
        <div onclick="window.toggleTypeFilter('Aktiviti')" class="summary-box cursor-pointer p-4 rounded-xl border transition-all duration-200 ${isAktActive ? 'ring-2 ring-blue-500 bg-blue-50 shadow-md' : 'bg-white border-blue-200 hover:shadow-sm'}">
            <div class="flex justify-between items-start">
                <div class="text-xs font-bold text-blue-600 uppercase tracking-wide">Aktiviti</div>
                ${isAktActive ? '<span class="text-blue-600 font-bold">✓</span>' : ''}
            </div>
            <div class="text-3xl font-extrabold text-blue-800 mt-1">${totalAkt}</div>
        </div>
    `;
}

function renderHeatmap() {
    const grid = document.getElementById('heatmap-grid');
    const label = document.getElementById('heatmap-year-label');
    if(!grid) return;
    
    if(label) label.textContent = filterYear;
    
    // Init array 12 bulan
    const months = Array.from({length: 12}, (_, i) => ({
        idx: i,
        name: new Date(2000, i, 1).toLocaleDateString('ms-MY', { month: 'long' }),
        count: 0,
        bim: 0,
        akt: 0
    }));

    // Isi data heatmap
    allData.forEach(item => {
        const d = new Date(item.tarikh);
        if (d.getFullYear() === filterYear) {
            const m = d.getMonth();
            months[m].count++;
            if (item.medium_aktiviti === 'Bimbingan') months[m].bim++;
            else months[m].akt++;
        }
    });

    const maxVal = Math.max(1, ...months.map(m => m.count));

    grid.innerHTML = months.map(m => {
        const opacity = m.count === 0 ? 0.05 : (m.count / maxVal);
        const bgColor = `rgba(212, 175, 55, ${Math.max(0.05, opacity)})`; 
        const borderColor = m.count > 0 ? 'border-yellow-400' : 'border-yellow-100';
        
        return `
            <div class="rounded-xl p-3 border ${borderColor} transition-transform hover:scale-105" style="background-color: ${bgColor}">
                <div class="text-sm font-bold text-gray-800">${m.name}</div>
                <div class="text-xs text-gray-600 mt-1">Jumlah: <b>${m.count}</b></div>
                <div class="flex gap-1 mt-2 flex-wrap">
                    ${m.count > 0 ? `<span class="text-[10px] bg-white/80 px-1.5 py-0.5 rounded text-green-800 font-medium">B: ${m.bim}</span>` : ''}
                    ${m.count > 0 ? `<span class="text-[10px] bg-white/80 px-1.5 py-0.5 rounded text-blue-800 font-medium">A: ${m.akt}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// =================================================================
// 5. OPERASI CRUD (TAMBAH / KEMAS KINI / PADAM)
// =================================================================

// Tambah Aktiviti
const addForm = document.getElementById('add-activity-form');
if(addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return Swal.fire('Akses Ditolak', 'Sila log masuk dahulu.', 'warning');

        // Kutip data form manual untuk kepastian
        const finalPayload = {
            medium_aktiviti: document.getElementById('medium_aktiviti').value,
            tajuk: document.getElementById('tajuk').value,
            tarikh: document.getElementById('tarikh').value,
            masa: document.getElementById('masa').value,
            tempat: document.getElementById('tempat').value,
            nama_guru: document.getElementById('nama_guru').value,
            impak_catatan: document.getElementById('impak_catatan').value,
            tindak_susul: document.getElementById('tindak_susul').value
        };

        // PERUBAHAN: Guna table 'aktiviti_rows'
        const { error } = await supabaseClient.from('aktiviti_rows').insert([finalPayload]);
        if (error) {
            Swal.fire('Ralat', error.message, 'error');
        } else {
            Swal.fire('Berjaya', 'Aktiviti berjaya ditambah.', 'success');
            e.target.reset();
            await initApp(); // Refresh data
            window.switchTab('list');
        }
    });
}

// Simpan Perubahan (Edit / Salin)
const saveBtn = document.getElementById('save-changes-btn');
if(saveBtn) {
    saveBtn.addEventListener('click', async () => {
        if (!currentUser) return Swal.fire('Akses Ditolak', 'Sila log masuk dahulu.', 'warning');

        const id = document.getElementById('edit-activity-id').value;
        const payload = {
            medium_aktiviti: document.getElementById('edit-medium_aktiviti').value,
            tajuk: document.getElementById('edit-tajuk').value,
            tarikh: document.getElementById('edit-tarikh').value,
            masa: document.getElementById('edit-masa').value,
            tempat: document.getElementById('edit-tempat').value,
            nama_guru: document.getElementById('edit-nama_guru').value,
            impak_catatan: document.getElementById('edit-impak_catatan').value,
            tindak_susul: document.getElementById('edit-tindak_susul').value
        };

        let error;
        // PERUBAHAN: Guna table 'aktiviti_rows'
        if (window.isCopyMode) {
            const { error: err } = await supabaseClient.from('aktiviti_rows').insert([payload]);
            error = err;
        } else {
            const { error: err } = await supabaseClient.from('aktiviti_rows').update(payload).eq('id', id);
            error = err;
        }

        if (error) {
            Swal.fire('Gagal', error.message, 'error');
        } else {
            Swal.fire('Berjaya', 'Tindakan berjaya disimpan.', 'success');
            window.closeEditModal();
            await initApp();
        }
    });
}

// =================================================================
// 6. FUNGSI GLOBAL (WINDOW EXPORTS)
// =================================================================
// Fungsi ini dilekatkan pada objek 'window' supaya boleh dipanggil 
// dari atribut HTML onclick="window.functionName()"

// Navigasi Tab
window.switchTab = function(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));
    
    const content = document.getElementById(`tab-${tab}`);
    const btn = document.getElementById(`tab-${tab}-btn`);
    
    if(content) content.classList.add('active');
    if(btn) btn.classList.add('active');
    
    if (tab === 'heatmap') renderHeatmap();
}

// Tapis Jenis (Bimbingan/Aktiviti)
window.toggleTypeFilter = function(type) {
    filterType = (filterType === type) ? '__ALL__' : type;
    renderActivities();
}

// Tutup Modal Login
window.closeLoginModal = function() { 
    const modal = document.getElementById('login-modal');
    if(modal) modal.classList.add('hidden'); 
}

// Buka Modal Edit/Salin
window.isCopyMode = false;
window.openEditModal = function(item, copyMode) {
    // Pastikan item adalah objek valid
    if(typeof item === 'string') {
        try { item = JSON.parse(item); } catch(e){ console.error(e); }
    }
    
    window.isCopyMode = copyMode;
    const modal = document.getElementById('edit-modal');
    const title = document.getElementById('modal-title');
    const btn = document.getElementById('save-changes-btn');
    
    if(!modal) return;

    title.innerText = copyMode ? 'Salin Aktiviti Baharu' : 'Kemas Kini Aktiviti';
    btn.innerText = copyMode ? 'Simpan Salinan' : 'Simpan Perubahan';
    
    // Isi Borang
    document.getElementById('edit-activity-id').value = item.id || '';
    document.getElementById('edit-medium_aktiviti').value = item.medium_aktiviti || 'Bimbingan';
    // Potong timestamp jika ada, ambil YYYY-MM-DD
    document.getElementById('edit-tarikh').value = item.tarikh ? item.tarikh.split('T')[0] : '';
    document.getElementById('edit-tajuk').value = item.tajuk || '';
    document.getElementById('edit-masa').value = item.masa || '';
    document.getElementById('edit-tempat').value = item.tempat || '';
    document.getElementById('edit-nama_guru').value = item.nama_guru || '';
    document.getElementById('edit-impak_catatan').value = item.impak_catatan || '';
    document.getElementById('edit-tindak_susul').value = item.tindak_susul || '';

    modal.classList.remove('hidden');
};

// Tutup Modal Edit
window.closeEditModal = function() {
    const modal = document.getElementById('edit-modal');
    if(modal) modal.classList.add('hidden');
}

// Padam Aktiviti
window.deleteActivity = async function(id) {
    const res = await Swal.fire({
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
        // PERUBAHAN: Guna table 'aktiviti_rows'
        const { error } = await supabaseClient.from('aktiviti_rows').delete().eq('id', id);
        if (error) Swal.fire('Gagal', error.message, 'error');
        else {
            Swal.fire('Berjaya', 'Rekod telah dipadam.', 'success');
            await initApp();
        }
    }
}

// Utiliti Linkify (Tukar teks URL jadi Link)
function linkify(text) {
    if (!text) return '-';
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    return text.replace(urlRegex, url => `<a href="${url}" target="_blank" class="text-blue-600 underline hover:text-blue-800 break-all">${url}</a>`);
}

// Butang Cetak
const printBtn = document.getElementById('print-btn');
if(printBtn) printBtn.addEventListener('click', () => window.print());

// Header Scroll Effect
window.addEventListener('scroll', () => {
    const h = document.getElementById('stickyHeader');
    if(h) {
        if (window.scrollY > 10) h.classList.add('scrolled');
        else h.classList.remove('scrolled');
    }
});

// INIT APLIKASI
document.addEventListener('DOMContentLoaded', initApp);