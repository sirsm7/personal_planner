// --- KONFIGURASI SUPABASE ---
const SUPABASE_URL = 'https://umzekpsayclptmhgzotf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtemVrcHNheWNscHRtaGd6b3RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NjMwNTAsImV4cCI6MjA3ODIzOTA1MH0.FbV1ESJrckyJ4kT4hR3DKh01GHeHoCTEfU5kgPWmIRs';

// PEMBETULAN: Gunakan nama 'supabaseClient' untuk elak konflik dengan library CDN
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- STATE MANAGEMENT ---
let allData = [];
let yearsAvailable = [];
let currentUser = null;

// Filter State
let filterYear = new Date().getFullYear();
let filterMonth = '__ALL__';
let filterDay = '__ALL__';
let filterType = '__ALL__';

// Helper Format Tarikh
const msMY = new Intl.DateTimeFormat('ms-MY', { month: 'long' });
const fullDate = (d) => new Date(d).toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const getMonthKey = (d) => { const dt = new Date(d); return `${String(dt.getMonth() + 1).padStart(2, '0')}`; };

// --- 1. AUTHENTICATION ---
const authContainer = document.getElementById('auth-container');
const btnShowLogin = document.getElementById('btn-show-login');
const btnLogout = document.getElementById('btn-logout');
const tabAddBtn = document.getElementById('tab-add-btn');

// Listener Session
supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    renderActivities();
});

function updateAuthUI() {
    if (currentUser) {
        if(btnShowLogin) btnShowLogin.classList.add('hidden');
        if(btnLogout) btnLogout.classList.remove('hidden');
        if(tabAddBtn) tabAddBtn.classList.remove('hidden');
    } else {
        if(btnShowLogin) btnShowLogin.classList.remove('hidden');
        if(btnLogout) btnLogout.classList.add('hidden');
        if(tabAddBtn) tabAddBtn.classList.add('hidden');
        
        // Jika user di tab add, tendang ke list
        const tabAdd = document.getElementById('tab-add');
        if(tabAdd && tabAdd.classList.contains('active')){
            switchTab('list');
        }
    }
}

// Login Action
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
            closeLoginModal();
            Swal.fire('Berjaya', 'Selamat kembali!', 'success');
            loginForm.reset();
        }
    });
}

// Logout Action
if(btnLogout) {
    btnLogout.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        Swal.fire('Log Keluar', 'Anda telah log keluar.', 'info');
    });
}

// Modal Login UI
if(btnShowLogin) btnShowLogin.addEventListener('click', () => document.getElementById('login-modal').classList.remove('hidden'));

// --- 2. DATA LOADING & FILTERING ---

async function initApp() {
    await fetchData();
    setupYearDropdown();
    setupFilterListeners();
    
    // Set default filter tahun terkini dalam data
    if(yearsAvailable.length > 0) {
        filterYear = Math.max(...yearsAvailable);
    } else {
        filterYear = new Date().getFullYear();
    }
    
    const yearJump = document.getElementById('year-jump');
    if(yearJump) yearJump.value = filterYear;
    
    updateMonthOptions(); 
    renderActivities();
    renderHeatmap();
}

async function fetchData() {
    try {
        let { data, error } = await supabaseClient
            .from('aktiviti')
            .select('*')
            .order('tarikh', { ascending: false });

        if (error) throw error;
        allData = data || [];

        const yearsSet = new Set(allData.map(item => new Date(item.tarikh).getFullYear()));
        yearsAvailable = Array.from(yearsSet).sort((a, b) => b - a); 
        
        const currentY = new Date().getFullYear();
        if(!yearsAvailable.includes(currentY)) {
            yearsAvailable.unshift(currentY);
            yearsAvailable.sort((a, b) => b - a);
        }

    } catch (err) {
        console.error(err);
        // Swal.fire('Ralat', 'Gagal memuatkan data.', 'error');
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

    if(yearJump) {
        yearJump.addEventListener('change', (e) => {
            filterYear = parseInt(e.target.value);
            filterMonth = '__ALL__'; 
            if(monthJump) monthJump.value = '__ALL__';
            updateMonthOptions();
            renderActivities();
            renderHeatmap();
        });
    }

    if(monthJump) {
        monthJump.addEventListener('change', (e) => {
            filterMonth = e.target.value;
            updateDayOptions(); 
            renderActivities();
        });
    }

    if(dayJump) {
        dayJump.addEventListener('change', (e) => {
            filterDay = e.target.value;
            renderActivities();
        });
    }
}

function updateMonthOptions() {
    const monthSelect = document.getElementById('month-jump');
    if(monthSelect) {
        monthSelect.value = '__ALL__';
        updateDayOptions();
    }
}

function updateDayOptions() {
    const daySelect = document.getElementById('day-jump');
    if(!daySelect) return;

    daySelect.innerHTML = '<option value="__ALL__">Semua Hari</option>';
    
    if (filterMonth === '__ALL__') {
        daySelect.disabled = true;
        filterDay = '__ALL__';
        return;
    }

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
    filterDay = '__ALL__'; 
}

// --- 3. RENDERING ---

function renderActivities() {
    const listEl = document.getElementById('activity-list');
    if(!listEl) return;
    listEl.innerHTML = '';

    let filtered = allData.filter(item => {
        const d = new Date(item.tarikh);
        const matchYear = d.getFullYear() === filterYear;
        const matchMonth = filterMonth === '__ALL__' || getMonthKey(item.tarikh) === filterMonth;
        const matchDay = filterDay === '__ALL__' || d.getDate() === parseInt(filterDay);
        const matchType = filterType === '__ALL__' || item.medium_aktiviti === filterType;
        return matchYear && matchMonth && matchDay && matchType;
    });

    const countBim = filtered.filter(i => i.medium_aktiviti === 'Bimbingan').length;
    const countAkt = filtered.filter(i => i.medium_aktiviti === 'Aktiviti').length;
    renderSummary(countBim, countAkt);

    const metaEl = document.getElementById('list-meta');
    if(metaEl) metaEl.innerText = `Menunjukkan ${filtered.length} rekod bagi Tahun ${filterYear}`;

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="text-center p-8 bg-gray-50 rounded-lg text-gray-500">Tiada rekod ditemui untuk tetapan ini.</div>`;
        return;
    }

    // Grouping Logic
    const groups = {};
    filtered.forEach(item => {
        const mKey = item.tarikh.substring(0, 7); 
        if (!groups[mKey]) groups[mKey] = [];
        groups[mKey].push(item);
    });

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
            
            let actionButtons = '';
            if (currentUser) {
                // escape quotes for HTML attribute safety
                const safeJson = JSON.stringify(act).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                actionButtons = `
                <div class="flex gap-2 mt-4 pt-3 border-t border-gray-100 no-print">
                    <button onclick='openEditModal(${safeJson}, false)' class="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                    <button onclick='openEditModal(${safeJson}, true)' class="text-sm text-purple-600 hover:text-purple-800 font-medium">Salin</button>
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
                    <p class="mb-2" style="overflow-wrap:anywhere;">${linkify(act.impak_catatan)}</p>
                    <p class="font-semibold text-xs text-gray-500 uppercase">Tindak Susul</p>
                    <p style="overflow-wrap:anywhere;">${linkify(act.tindak_susul)}</p>
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

// --- 4. CRUD OPERATIONS ---

const addForm = document.getElementById('add-activity-form');
if(addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return Swal.fire('Akses Ditolak', 'Sila log masuk dahulu.', 'warning');

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

        const { error } = await supabaseClient.from('aktiviti').insert([finalPayload]);
        if (error) {
            Swal.fire('Ralat', error.message, 'error');
        } else {
            Swal.fire('Berjaya', 'Aktiviti ditambah.', 'success');
            e.target.reset();
            await initApp(); 
            switchTab('list');
        }
    });
}

// --- FUNGSI GLOBAL UTAMA (Wajib Ada untuk HTML onclick) ---

// 1. Switch Tab
window.switchTab = function(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));
    
    const content = document.getElementById(`tab-${tab}`);
    const btn = document.getElementById(`tab-${tab}-btn`);
    
    if(content) content.classList.add('active');
    if(btn) btn.classList.add('active');
    
    if (tab === 'heatmap') renderHeatmap();
}

// 2. Toggle Filter
window.toggleTypeFilter = function(type) {
    filterType = (filterType === type) ? '__ALL__' : type;
    renderActivities();
}

// 3. Modal Actions (Login)
window.closeLoginModal = function() { 
    document.getElementById('login-modal').classList.add('hidden'); 
}

// 4. Modal Actions (Edit/Salin)
let isCopyMode = false;

window.openEditModal = function(item, copyMode) {
    // Check if item is a string (happens if JSON.stringify failed or passed oddly)
    if(typeof item === 'string') {
        try { item = JSON.parse(item); } catch(e){ console.error(e); }
    }
    
    isCopyMode = copyMode;
    const modal = document.getElementById('edit-modal');
    const title = document.getElementById('modal-title');
    const btn = document.getElementById('save-changes-btn');
    
    title.innerText = copyMode ? 'Salin Aktiviti' : 'Kemas Kini Aktiviti';
    btn.innerText = copyMode ? 'Simpan Salinan' : 'Simpan Perubahan';
    
    document.getElementById('edit-activity-id').value = item.id || '';
    document.getElementById('edit-medium_aktiviti').value = item.medium_aktiviti || 'Bimbingan';
    document.getElementById('edit-tarikh').value = item.tarikh || '';
    document.getElementById('edit-tajuk').value = item.tajuk || '';
    document.getElementById('edit-masa').value = item.masa || '';
    document.getElementById('edit-tempat').value = item.tempat || '';
    document.getElementById('edit-nama_guru').value = item.nama_guru || '';
    document.getElementById('edit-impak_catatan').value = item.impak_catatan || '';
    document.getElementById('edit-tindak_susul').value = item.tindak_susul || '';

    if(modal) modal.classList.remove('hidden');
};

window.closeEditModal = function() {
    const modal = document.getElementById('edit-modal');
    if(modal) modal.classList.add('hidden');
}

window.deleteActivity = async function(id) {
    const res = await Swal.fire({
        title: 'Anda Pasti?', text: "Data tidak boleh dikembalikan!", icon: 'warning',
        showCancelButton: true, confirmButtonText: 'Ya, Padam', cancelButtonText: 'Batal'
    });
    
    if (res.isConfirmed) {
        const { error } = await supabaseClient.from('aktiviti').delete().eq('id', id);
        if (error) Swal.fire('Gagal', error.message, 'error');
        else {
            Swal.fire('Berjaya', 'Data dipadam.', 'success');
            await initApp();
        }
    }
}

// Save Changes Button (Edit/Copy)
const saveBtn = document.getElementById('save-changes-btn');
if(saveBtn) {
    saveBtn.addEventListener('click', async () => {
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
            const { error: err } = await supabaseClient.from('aktiviti').insert([payload]);
            error = err;
        } else {
            const { error: err } = await supabaseClient.from('aktiviti').update(payload).eq('id', id);
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
}

// --- UTILITIES LAIN ---

function renderHeatmap() {
    const grid = document.getElementById('heatmap-grid');
    const label = document.getElementById('heatmap-year-label');
    if(!grid) return;
    
    if(label) label.textContent = filterYear;
    
    const months = Array.from({length: 12}, (_, i) => ({
        idx: i,
        name: new Date(2000, i, 1).toLocaleDateString('ms-MY', { month: 'long' }),
        count: 0,
        bim: 0,
        akt: 0
    }));

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

function linkify(text) {
    if (!text) return '-';
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    return text.replace(urlRegex, url => `<a href="${url}" target="_blank" class="text-blue-600 underline hover:text-blue-800 break-all">${url}</a>`);
}

const printBtn = document.getElementById('print-btn');
if(printBtn) printBtn.addEventListener('click', () => window.print());

window.addEventListener('scroll', () => {
    const h = document.getElementById('stickyHeader');
    if(h) {
        if (window.scrollY > 10) h.classList.add('scrolled');
        else h.classList.remove('scrolled');
    }
});

// INIT
document.addEventListener('DOMContentLoaded', initApp);