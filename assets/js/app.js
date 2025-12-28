// --- KONFIGURASI SUPABASE ---
const SUPABASE_URL = 'https://umzekpsayclptmhgzotf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtemVrcHNheWNscHRtaGd6b3RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NjMwNTAsImV4cCI6MjA3ODIzOTA1MH0.FbV1ESJrckyJ4kT4hR3DKh01GHeHoCTEfU5kgPWmIRs';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- STATE MANAGEMENT ---
let allData = []; // Data mentah dari DB
let yearsAvailable = []; // Senarai tahun yang wujud dalam data
let currentUser = null; // Status login

// Filter State
let filterYear = new Date().getFullYear();
let filterMonth = '__ALL__';
let filterDay = '__ALL__';
let filterType = '__ALL__';

// Helper Format Tarikh
const msMY = new Intl.DateTimeFormat('ms-MY', { month: 'long' });
const fullDate = (d) => new Date(d).toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const getMonthKey = (d) => { const dt = new Date(d); return `${String(dt.getMonth() + 1).padStart(2, '0')}`; };

// --- 1. AUTHENTICATION (LOGIC LOGIN) ---
const authContainer = document.getElementById('auth-container');
const btnShowLogin = document.getElementById('btn-show-login');
const btnLogout = document.getElementById('btn-logout');
const tabAddBtn = document.getElementById('tab-add-btn');

// Listener untuk perubahan sesi
supabase.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    renderActivities(); // Render semula untuk tunjuk/sorok butang edit
});

function updateAuthUI() {
    if (currentUser) {
        // User logged in
        btnShowLogin.classList.add('hidden');
        btnLogout.classList.remove('hidden');
        tabAddBtn.classList.remove('hidden'); // Tunjuk tab Tambah
    } else {
        // User guest
        btnShowLogin.classList.remove('hidden');
        btnLogout.classList.add('hidden');
        tabAddBtn.classList.add('hidden'); // Sorok tab Tambah
        // Jika sedang di tab Tambah, tendang ke tab Senarai
        if(document.getElementById('tab-add').classList.contains('active')){
            switchTab('list');
        }
    }
}

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
        Swal.fire('Gagal', 'Emel atau kata laluan salah.', 'error');
    } else {
        closeLoginModal();
        Swal.fire('Berjaya', 'Selamat kembali!', 'success');
        document.getElementById('login-form').reset();
    }
});

// Logout
btnLogout.addEventListener('click', async () => {
    await supabase.auth.signOut();
    Swal.fire('Log Keluar', 'Anda telah log keluar.', 'info');
});

// Modal Login UI
btnShowLogin.addEventListener('click', () => document.getElementById('login-modal').classList.remove('hidden'));
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }

// --- 2. DATA LOADING & FILTERING ---

async function initApp() {
    await fetchData();
    setupYearDropdown();
    setupFilterListeners();
    // Set default filters
    filterYear = yearsAvailable.length > 0 ? Math.max(...yearsAvailable) : new Date().getFullYear();
    document.getElementById('year-jump').value = filterYear;
    
    updateMonthOptions(); 
    renderActivities();
    renderHeatmap();
}

async function fetchData() {
    try {
        // Ambil semua data. Untuk aplikasi kecil/sederhana, ini okay.
        // Jika data > 5000 baris, perlu pagination.
        let { data, error } = await supabase
            .from('aktiviti')
            .select('*')
            .order('tarikh', { ascending: false });

        if (error) throw error;
        allData = data || [];

        // Cari tahun unik
        const yearsSet = new Set(allData.map(item => new Date(item.tarikh).getFullYear()));
        yearsAvailable = Array.from(yearsSet).sort((a, b) => b - a); // Descending
        
        // Pastikan tahun semasa sentiasa ada dalam senarai drop down walaupun belum ada data
        const currentY = new Date().getFullYear();
        if(!yearsAvailable.includes(currentY)) {
            yearsAvailable.unshift(currentY);
            yearsAvailable.sort((a, b) => b - a);
        }

    } catch (err) {
        console.error(err);
        Swal.fire('Ralat', 'Gagal memuatkan data.', 'error');
    }
}

function setupYearDropdown() {
    const yearSelect = document.getElementById('year-jump');
    yearSelect.innerHTML = yearsAvailable.map(y => `<option value="${y}">${y}</option>`).join('');
}

function setupFilterListeners() {
    document.getElementById('year-jump').addEventListener('change', (e) => {
        filterYear = parseInt(e.target.value);
        filterMonth = '__ALL__'; // Reset bulan bila tukar tahun
        document.getElementById('month-jump').value = '__ALL__';
        updateMonthOptions();
        renderActivities();
        renderHeatmap();
    });

    document.getElementById('month-jump').addEventListener('change', (e) => {
        filterMonth = e.target.value;
        updateDayOptions(); // Kemaskini hari berdasarkan bulan baru
        renderActivities();
    });

    document.getElementById('day-jump').addEventListener('change', (e) => {
        filterDay = e.target.value;
        renderActivities();
    });
}

// Kemas kini dropdown bulan (Reset bila tahun tukar, boleh di-optimize jika perlu)
function updateMonthOptions() {
    // Di sini kita kekalkan statik 12 bulan atau filter ikut data.
    // Untuk UX konsisten, kita biar 12 bulan pilihan.
    const monthSelect = document.getElementById('month-jump');
    // Kekalkan opsyen, cuma reset value
    monthSelect.value = '__ALL__';
    updateDayOptions();
}

// Kemas kini dropdown hari secara dinamik berdasarkan data tahun & bulan dipilih
function updateDayOptions() {
    const daySelect = document.getElementById('day-jump');
    daySelect.innerHTML = '<option value="__ALL__">Semua Hari</option>';
    
    if (filterMonth === '__ALL__') {
        daySelect.disabled = true;
        filterDay = '__ALL__';
        return;
    }

    // Filter data untuk dapatkan hari yang wujud sahaja
    const relevantData = allData.filter(item => {
        const d = new Date(item.tarikh);
        return d.getFullYear() === filterYear && getMonthKey(item.tarikh) === filterMonth;
    });

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
    filterDay = '__ALL__'; // Reset hari
}

// --- 3. RENDERING (PAPARAN) ---

function renderActivities() {
    const listEl = document.getElementById('activity-list');
    listEl.innerHTML = '';

    // 1. FILTERING
    let filtered = allData.filter(item => {
        const d = new Date(item.tarikh);
        const matchYear = d.getFullYear() === filterYear;
        const matchMonth = filterMonth === '__ALL__' || getMonthKey(item.tarikh) === filterMonth;
        const matchDay = filterDay === '__ALL__' || d.getDate() === parseInt(filterDay);
        const matchType = filterType === '__ALL__' || item.medium_aktiviti === filterType;
        return matchYear && matchMonth && matchDay && matchType;
    });

    // 2. SUMMARY COUNTS
    const countBim = filtered.filter(i => i.medium_aktiviti === 'Bimbingan').length;
    const countAkt = filtered.filter(i => i.medium_aktiviti === 'Aktiviti').length;
    renderSummary(countBim, countAkt);

    document.getElementById('list-meta').innerText = `Menunjukkan ${filtered.length} rekod bagi Tahun ${filterYear}`;

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="text-center p-8 bg-gray-50 rounded-lg text-gray-500">Tiada rekod ditemui untuk tetapan ini.</div>`;
        return;
    }

    // 3. GROUP BY MONTH (Visual Separation)
    const groups = {};
    filtered.forEach(item => {
        const mKey = item.tarikh.substring(0, 7); // YYYY-MM
        if (!groups[mKey]) groups[mKey] = [];
        groups[mKey].push(item);
    });

    // Sort Keys Descending (Latest month first)
    Object.keys(groups).sort().reverse().forEach(key => {
        const items = groups[key];
        const monthLabel = msMY.format(new Date(key + '-01'));

        const section = document.createElement('section');
        section.innerHTML = `<h3 class="text-lg font-bold text-gray-700 border-b pb-2 mb-4 sticky top-16 bg-gray-50 pt-2 z-10">${monthLabel} ${filterYear}</h3>`;
        
        const grid = document.createElement('div');
        grid.className = 'grid gap-4';

        items.forEach(act => {
            const isBimbingan = act.medium_aktiviti === 'Bimbingan';
            const badgeColor = isBimbingan ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
            
            // Butang Action (Hanya jika Login)
            let actionButtons = '';
            if (currentUser) {
                actionButtons = `
                <div class="flex gap-2 mt-4 pt-3 border-t border-gray-100 no-print">
                    <button onclick='openEditModal(${JSON.stringify(act).replace(/'/g, "&#39;")}, false)' class="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                    <button onclick='openEditModal(${JSON.stringify(act).replace(/'/g, "&#39;")}, true)' class="text-sm text-purple-600 hover:text-purple-800 font-medium">Salin</button>
                    <button onclick="deleteActivity('${act.id}')" class="text-sm text-red-600 hover:text-red-800 font-medium ml-auto">Padam</button>
                </div>
                `;
            }

            const card = document.createElement('div');
            card.className = 'bg-white p-5 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow';
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeColor}">${act.medium_aktiviti}</span>
                    <span class="text-xs text-gray-400">${fullDate(act.tarikh)}</span>
                </div>
                <h4 class="text-lg font-bold text-gray-900 mt-2">${act.tajuk}</h4>
                <div class="text-sm text-gray-600 mt-1 flex flex-col gap-1">
                    <p>🕒 ${act.masa || '-'}</p>
                    <p>📍 ${act.tempat || '-'}</p>
                    ${act.nama_guru ? `<p>👤 ${act.nama_guru}</p>` : ''}
                </div>
                <div class="mt-3 text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">
                    <p class="font-semibold text-xs text-gray-500 uppercase">Impak / Catatan</p>
                    <p class="mb-2">${linkify(act.impak_catatan)}</p>
                    <p class="font-semibold text-xs text-gray-500 uppercase">Tindak Susul</p>
                    <p>${linkify(act.tindak_susul)}</p>
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
    const isBimActive = filterType === 'Bimbingan';
    const isAktActive = filterType === 'Aktiviti';
    
    boxEl.innerHTML = `
        <div onclick="toggleTypeFilter('Bimbingan')" class="summary-box cursor-pointer p-4 rounded-xl border ${isBimActive ? 'ring-2 ring-green-500 bg-green-50' : 'bg-white border-green-200'}">
            <div class="text-xs font-bold text-green-600 uppercase">Bimbingan ${isBimActive ? '✓' : ''}</div>
            <div class="text-3xl font-extrabold text-green-800 mt-1">${totalBim}</div>
        </div>
        <div onclick="toggleTypeFilter('Aktiviti')" class="summary-box cursor-pointer p-4 rounded-xl border ${isAktActive ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-white border-blue-200'}">
            <div class="text-xs font-bold text-blue-600 uppercase">Aktiviti ${isAktActive ? '✓' : ''}</div>
            <div class="text-3xl font-extrabold text-blue-800 mt-1">${totalAkt}</div>
        </div>
    `;
}

function toggleTypeFilter(type) {
    filterType = (filterType === type) ? '__ALL__' : type;
    renderActivities();
}

function renderHeatmap() {
    const grid = document.getElementById('heatmap-grid');
    document.getElementById('heatmap-year-label').textContent = filterYear;
    
    // Init array 12 bulan
    const months = Array.from({length: 12}, (_, i) => ({
        idx: i,
        name: new Date(2000, i, 1).toLocaleDateString('ms-MY', { month: 'long' }),
        count: 0,
        bim: 0,
        akt: 0
    }));

    // Isi data berdasarkan TAHUN yang dipilih
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
        const bgColor = `rgba(212, 175, 55, ${Math.max(0.05, opacity)})`; // Gold color base
        
        return `
            <div class="rounded-xl p-3 border border-yellow-400/20" style="background-color: ${bgColor}">
                <div class="text-sm font-bold text-gray-800">${m.name}</div>
                <div class="text-xs text-gray-600 mt-1">Total: <b>${m.count}</b></div>
                <div class="flex gap-1 mt-2">
                    <span class="text-[10px] bg-white/60 px-1 rounded text-green-800">B: ${m.bim}</span>
                    <span class="text-[10px] bg-white/60 px-1 rounded text-blue-800">A: ${m.akt}</span>
                </div>
            </div>
        `;
    }).join('');
}

// --- 4. CRUD OPERATIONS (Authenticated Only) ---

// Tambah
document.getElementById('add-activity-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return Swal.fire('Akses Ditolak', 'Sila log masuk dahulu.', 'warning');

    const payload = getFormPayload('add-activity-form'); // Helper function bawah
    // Override manual fields
    payload.medium_aktiviti = document.getElementById('medium_aktiviti').value;
    payload.tarikh = document.getElementById('tarikh').value;
    // ... capture other IDs explicitly if helper not perfect or just map manually:
    
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

    const { error } = await supabase.from('aktiviti').insert([finalPayload]);
    if (error) {
        Swal.fire('Ralat', error.message, 'error');
    } else {
        Swal.fire('Berjaya', 'Aktiviti ditambah.', 'success');
        e.target.reset();
        await initApp(); // Reload data
        switchTab('list');
    }
});

// Padam
async function deleteActivity(id) {
    const res = await Swal.fire({
        title: 'Anda Pasti?', text: "Data tidak boleh dikembalikan!", icon: 'warning',
        showCancelButton: true, confirmButtonText: 'Ya, Padam', cancelButtonText: 'Batal'
    });
    
    if (res.isConfirmed) {
        const { error } = await supabase.from('aktiviti').delete().eq('id', id);
        if (error) Swal.fire('Gagal', error.message, 'error');
        else {
            Swal.fire('Berjaya', 'Data dipadam.', 'success');
            await initApp();
        }
    }
}

// Edit & Salin Modal Logic
let isCopyMode = false;
window.openEditModal = (item, copyMode) => {
    isCopyMode = copyMode;
    const modal = document.getElementById('edit-modal');
    const title = document.getElementById('modal-title');
    const btn = document.getElementById('save-changes-btn');
    
    title.innerText = copyMode ? 'Salin Aktiviti' : 'Kemas Kini Aktiviti';
    btn.innerText = copyMode ? 'Simpan Salinan' : 'Simpan Perubahan';
    
    // Populate Form
    document.getElementById('edit-activity-id').value = item.id;
    document.getElementById('edit-medium_aktiviti').value = item.medium_aktiviti;
    document.getElementById('edit-tarikh').value = item.tarikh;
    document.getElementById('edit-tajuk').value = item.tajuk;
    document.getElementById('edit-masa').value = item.masa;
    document.getElementById('edit-tempat').value = item.tempat;
    document.getElementById('edit-nama_guru').value = item.nama_guru;
    document.getElementById('edit-impak_catatan').value = item.impak_catatan;
    document.getElementById('edit-tindak_susul').value = item.tindak_susul;

    modal.classList.remove('hidden');
};

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

document.getElementById('save-changes-btn').addEventListener('click', async () => {
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
    if (isCopyMode) {
        // Insert new
        const { error: err } = await supabase.from('aktiviti').insert([payload]);
        error = err;
    } else {
        // Update existing
        const { error: err } = await supabase.from('aktiviti').update(payload).eq('id', id);
        error = err;
    }

    if (error) {
        Swal.fire('Gagal', error.message, 'error');
    } else {
        Swal.fire('Berjaya', 'Tindakan berjaya.', 'success');
        closeEditModal();
        await initApp();
    }
});


// --- UTILITIES ---
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`tab-${tab}-btn`).classList.add('active');
    
    if (tab === 'heatmap') renderHeatmap();
}

function linkify(text) {
    if (!text) return '-';
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    return text.replace(urlRegex, url => `<a href="${url}" target="_blank" class="text-blue-600 underline hover:text-blue-800 break-all">${url}</a>`);
}

// Print Handler
document.getElementById('print-btn').addEventListener('click', () => window.print());

// Scroll sticky header shadow
window.addEventListener('scroll', () => {
    const h = document.getElementById('stickyHeader');
    if (window.scrollY > 10) h.classList.add('scrolled');
    else h.classList.remove('scrolled');
});

// Init
document.addEventListener('DOMContentLoaded', initApp);