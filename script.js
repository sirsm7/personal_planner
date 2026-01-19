// --- 1. KONFIGURASI SUPABASE (DIKEMASKINI) ---
const SUPABASE_URL = 'https://appppdag.cloud';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzYzMzczNjQ1LCJleHAiOjIwNzg3MzM2NDV9.vZOedqJzUn01PjwfaQp7VvRzSm4aRMr21QblPDK8AoY';

const { createClient } = supabase;

// Kita menetapkan schema lalai kepada 'techlympics' di sini.
// Ini memastikan semua panggilan .from('peserta') akan mencari dalam 'techlympics.peserta'
const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    db: {
        schema: 'techlympics' 
    }
});

// --- 2. KONFIGURASI SIJIL ---
const POSISI_NAMA = '30%'; 

// --- 3. ELEMEN DOM ---
const tabButtons = {
    btn1: document.getElementById('tab-btn-1'),
    btn2: document.getElementById('tab-btn-2'),
    btn3: document.getElementById('tab-btn-3'),
    btn4: document.getElementById('tab-btn-4'),
};
const tabContents = {
    content1: document.getElementById('tab-content-1'),
    content2: document.getElementById('tab-content-2'),
    content3: document.getElementById('tab-content-3'),
    content4: document.getElementById('tab-content-4'),
};

// Borang Pendaftaran
const formPendaftaran = document.getElementById('form-pendaftaran');
const negeriSelect = document.getElementById('negeri');
const daerahContainer = document.getElementById('daerah-melaka-container');
const daerahSelect = document.getElementById('daerah');
const perananSelect = document.getElementById('peranan');
const sekolahInput = document.getElementById('sekolah');
const submitBtn = document.getElementById('submit-btn');

// Borang Semakan
const formSemakan = document.getElementById('form-semakan');
const nokpSemakInput = document.getElementById('nokp-semak');
const sijilContainer = document.getElementById('sijil-container');
const searchBtn = document.getElementById('search-btn');
const resetBtn = document.getElementById('reset-btn');

// Rumusan
const rumusanGlobalContainer = document.getElementById('rumusan-global-container');
const rumusanContainer = document.getElementById('rumusan-container');

// Data Statik
const perananWajibSekolah = ['MURID / PELAJAR', 'GURU', 'PEGAWAI DI JPN', 'PEGAWAI DI PPD'];
const senaraiNegeri = [
    'JOHOR', 'KEDAH', 'KELANTAN', 'MELAKA', 'NEGERI SEMBILAN', 'PAHANG', 'PERAK', 
    'PERLIS', 'PULAU PINANG', 'SABAH', 'SARAWAK', 'SELANGOR', 'TERENGGANU', 
    'WILAYAH PERSEKUTUAN KUALA LUMPUR', 'WILAYAH PERSEKUTUAN LABUAN', 'WILAYAH PERSEKUTUAN PUTRAJAYA'
];
const senaraiPeranan = ['MURID / PELAJAR', 'GURU', 'PEGAWAI DI JPN', 'PEGAWAI DI PPD', 'IBU BAPA'];
const namaPaparanPeranan = {
    'MURID / PELAJAR': 'MURID',
    'GURU': 'GURU',
    'PEGAWAI DI JPN': 'JPN',
    'PEGAWAI DI PPD': 'PPD',
    'IBU BAPA': 'IBU BAPA'
};

// --- 4. FUNGSI UTAMA ---

// Fungsi Tukar Tab
function showTab(tabId) {
    Object.values(tabContents).forEach(content => content.classList.add('hidden'));
    Object.values(tabButtons).forEach(btn => btn.classList.remove('bg-red-600', 'text-white')); 
    
    tabContents[`content${tabId}`].classList.remove('hidden');
    tabButtons[`btn${tabId}`].classList.add('bg-red-600', 'text-white');

    if (tabId === '4') {
        loadRumusan();
    }
}

// --- 5. LOGIK PENDAFTARAN ---

negeriSelect.addEventListener('change', () => {
    if (negeriSelect.value === 'MELAKA') {
        daerahContainer.classList.remove('hidden');
        daerahSelect.required = true;
    } else {
        daerahContainer.classList.add('hidden');
        daerahSelect.required = false;
        daerahSelect.value = '';
    }
});

perananSelect.addEventListener('change', () => {
    if (perananWajibSekolah.includes(perananSelect.value)) {
        sekolahInput.required = true;
        document.getElementById('sekolah-helper').classList.add('text-red-500', 'font-medium');
    } else {
        sekolahInput.required = false;
        document.getElementById('sekolah-helper').classList.remove('text-red-500', 'font-medium');
    }
});

formPendaftaran.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menghantar...';

    const formData = new FormData(formPendaftaran);
    const dataObj = {
        nama: formData.get('nama'),
        nokp: formData.get('nokp'),
        negeri: formData.get('negeri'),
        daerah: formData.get('negeri') === 'MELAKA' ? formData.get('daerah') : null,
        peranan: formData.get('peranan'),
        sekolah: formData.get('sekolah') || null,
    };

    if (perananWajibSekolah.includes(dataObj.peranan) && !dataObj.sekolah) {
        Swal.fire({
            icon: 'error',
            title: 'Borang Tidak Lengkap',
            text: 'Nama Sekolah / Jabatan wajib diisi untuk peranan anda.',
        });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Hantar Pendaftaran';
        return;
    }

    try {
        // Kerana kita set schema 'techlympics' pada 'db', ini akan akses 'techlympics.peserta'
        const { data, error } = await db
            .from('peserta')
            .upsert(dataObj, { onConflict: 'nokp' })
            .select();
        
        if (error) throw error;

        Swal.fire({
            icon: 'success',
            title: 'Pendaftaran Berjaya!',
            text: 'Maklumat anda telah disimpan/dikemas kini. Sila ke Tab "Semak Sijil".',
            timer: 2000,
            showConfirmButton: false
        });
        formPendaftaran.reset();
        daerahContainer.classList.add('hidden');
    
    } catch (error) {
        console.error('Ralat Pendaftaran:', error.message);
        Swal.fire({
            icon: 'error',
            title: 'Pendaftaran Gagal',
            text: error.message,
        });
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Hantar Pendaftaran';
    }
});

// --- 6. LOGIK SEMAKAN SIJIL ---

formSemakan.addEventListener('submit', async (e) => {
    e.preventDefault();
    sijilContainer.innerHTML = '';
    searchBtn.disabled = true;
    searchBtn.textContent = 'Mencari...';

    const nokp = nokpSemakInput.value;

    try {
        const { data, error } = await db
            .from('peserta')
            .select('*')
            .eq('nokp', nokp)
            .single();

        if (error || !data) {
            throw new Error('Data tidak ditemui. Sila pastikan No. KP anda betul atau daftar di Tab 1.');
        }

        generateCertificate(data);
        Swal.fire({
            icon: 'success',
            title: 'Sijil Ditemui',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true
        });

    } catch (error) {
        console.error('Ralat Semakan:', error.message);
        Swal.fire({
            icon: 'error',
            title: 'Semakan Gagal',
            text: error.message,
        });
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Cari';
    }
});

resetBtn.addEventListener('click', () => {
    nokpSemakInput.value = '';
    sijilContainer.innerHTML = '';
});

function generateCertificate(peserta) {
    sijilContainer.innerHTML = `
        <div class="flex justify-center mb-4" id="print-button-container">
            <button id="print-button" class="py-2 px-6 bg-green-600 text-white font-bold rounded-md shadow-md hover:bg-green-700 transition duration-150">
                Cetak / Simpan PDF
            </button>
        </div>
        <div id="sijil-wrapper">
            <div class="sijil-text" 
                 style="top: ${POSISI_NAMA}; 
                        font-family: Arial, sans-serif; 
                        line-height: 1.2;
                        left:12%;
                        width:94%">
                <div style="font-size: 32px; font-weight: bold;">
                    ${peserta.nama}
                </div>
                <div style="font-size: 16px; font-style: italic;"> 
                    (${peserta.nokp})
                </div>
            </div>
        </div>
    `;
    document.getElementById('print-button').addEventListener('click', () => {
        window.print();
    });
}

// --- 7. LOGIK RUMUSAN ---

async function loadRumusan() {
    const loadingHtml = '<p class="text-gray-500">Memuatkan data rumusan...</p>';
    rumusanContainer.innerHTML = loadingHtml;
    rumusanGlobalContainer.innerHTML = loadingHtml;
    
    try {
        let allData = [];
        const CHUNK_SIZE = 1000;
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await db
                .from('peserta')
                .select('negeri, peranan, nokp')
                .range(page * CHUNK_SIZE, (page + 1) * CHUNK_SIZE - 1);

            if (error) throw error;

            if (data) {
                allData.push(...data);
            }

            if (!data || data.length < CHUNK_SIZE) {
                hasMore = false;
            } else {
                page++;
            }
        }

        const summaryNegeri = {};
        senaraiNegeri.forEach(negeri => {
            summaryNegeri[negeri] = { TOTAL: 0 };
            senaraiPeranan.forEach(peranan => {
                summaryNegeri[negeri][peranan] = 0;
            });
        });
        
        let summaryGlobal = {
            TOTAL: 0,
            LELAKI: 0,
            PEREMPUAN: 0,
            ...Object.fromEntries(senaraiPeranan.map(p => [p, 0])) 
        };

        allData.forEach(item => {
            if (summaryNegeri[item.negeri] && summaryNegeri[item.negeri][item.peranan] !== undefined) {
                summaryNegeri[item.negeri][item.peranan]++;
                summaryNegeri[item.negeri]['TOTAL']++;
            }

            summaryGlobal.TOTAL++;
            
            if (summaryGlobal[item.peranan] !== undefined) {
                summaryGlobal[item.peranan]++;
            }

            if (item.nokp && item.nokp.length === 12) {
                const lastDigit = parseInt(item.nokp.slice(-1));
                if (lastDigit % 2 === 0) {
                    summaryGlobal.PEREMPUAN++;
                } else {
                    summaryGlobal.LELAKI++;
                }
            }
        });
        
        const negeriUnik = new Set(allData.map(item => item.negeri));

        // HTML Global
        let globalHtml = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div class="bg-white p-4 rounded-lg shadow">
                    <div class="text-sm font-medium text-gray-500">JUMLAH BESAR</div>
                    <div class="text-3xl font-bold text-red-600">${summaryGlobal.TOTAL}</div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow">
                    <div class="text-sm font-medium text-gray-500">LELAKI</div>
                    <div class="text-3xl font-bold text-blue-600">${summaryGlobal.LELAKI}</div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow">
                    <div class="text-sm font-medium text-gray-500">PEREMPUAN</div>
                    <div class="text-3xl font-bold text-pink-500">${summaryGlobal.PEREMPUAN}</div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow">
                    <div class="text-sm font-medium text-gray-500">NEGERI</div>
                    <div class="text-3xl font-bold text-green-600">${negeriUnik.size}</div>
                </div>
            </div>
            <hr class="my-6 border-gray-200">
            <h4 class="text-lg font-semibold mb-3">Pecahan Mengikut Peranan</h4>
            <ul class="space-y-2 text-gray-700">
                ${senaraiPeranan.map(peranan => `
                    <li class="flex justify-between items-center bg-white p-3 rounded-lg shadow-sm">
                        <span class="font-medium">${peranan}</span>
                        <span class="font-bold text-lg text-red-600">${summaryGlobal[peranan]}</span>
                    </li>
                `).join('')}
            </ul>
        `;
        rumusanGlobalContainer.innerHTML = globalHtml;

        // HTML Heatmap Negeri
        let heatmapHtml = '';
        const maxTotal = Math.max(...Object.values(summaryNegeri).map(n => n.TOTAL));
        
        senaraiNegeri.forEach(negeri => {
            const negeriData = summaryNegeri[negeri];
            const total = negeriData.TOTAL;
            
            let bgOpacity = 20;
            if (maxTotal > 0 && total > 0) {
                bgOpacity = 20 + Math.floor((total / maxTotal) * 80);
            }
            
            heatmapHtml += `
                <div class="border border-gray-200 rounded-lg shadow-md overflow-hidden bg-blue-600 flex flex-col" style="background-color: rgba(37, 99, 235, ${bgOpacity / 100});">
                    <div class="p-4 ${bgOpacity > 50 ? 'text-white' : 'text-gray-900'}">
                        <h4 class="text-lg font-bold">${negeri}</h4>
                        <p class="text-3xl font-extrabold">${total}</p>
                    </div>
                    <div class="bg-gray-50 p-4 border-t ${bgOpacity > 50 ? 'text-gray-700' : ''}">
                        <ul class="text-sm space-y-1">
                            ${senaraiPeranan.map(peranan => `
                                <li class="flex justify-between">
                                    <span>${namaPaparanPeranan[peranan] || peranan}</span>
                                    <span class="font-medium">${negeriData[peranan]}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            `;
        });
        rumusanContainer.innerHTML = heatmapHtml;

    } catch (error) {
        console.error('Ralat Memuatkan Rumusan:', error.message);
        const errorHtml = `<p class="text-red-500 font-bold">Gagal memuatkan data: ${error.message}</p>`;
        rumusanContainer.innerHTML = errorHtml;
        rumusanGlobalContainer.innerHTML = errorHtml;
        Swal.fire({
            icon: 'error',
            title: 'Gagal Muat Rumusan',
            text: error.message,
        });
    }
}

// --- 8. INITIALIZATION ---

tabButtons.btn1.addEventListener('click', () => showTab('1'));
tabButtons.btn2.addEventListener('click', () => showTab('2'));
tabButtons.btn3.addEventListener('click', () => showTab('3'));
tabButtons.btn4.addEventListener('click', () => showTab('4'));

// Default View
showTab('3');