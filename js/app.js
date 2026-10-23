/**
 * ============================================================
 * e-Arsip Surat — Frontend (JavaScript.html)
 * SPA murni di GitHub Pages: URL TIDAK PERNAH berubah, tanpa window.open / location.
 * Seluruh data lewat fetch() ke GAS REST API (js/config.js -> GAS_URL); token sesi disimpan di memori
 * (cadangan sessionStorage agar muat ulang tidak memaksa login).
 * ============================================================
 */

// ════════════════════════════════════════════════════════
// BAGIAN 1 — STATE, KONSTANTA, UTILITAS
// ════════════════════════════════════════════════════════
const AppState = {
  token: null, user: null,
  data: { surat: [], disposisi: [], pengguna: [], pengaturan: {} },
  loaded: false, kode: null,
  page: null, param: {},
  charts: {}, chartRedraw: null,
  f: {                                   // filter per halaman
    surat:   { jenis: 'Semua', q: '', kode: '', dari: '', sampai: '', status: 'Semua', page: 1 },
    laporan: { jenis: 'Semua', q: '', kode: '', dari: '', sampai: '', status: 'Semua', page: 1 },
    dispo:   { tab: '', q: '', page: 1 },
    kode:    { q: '', page: 1 }
  },
  formFiles: [], formKode: ''
};
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const KELOMPOK_KODE = {          // kode utama Permendagri 83/2022 (lingkungan Pemda)
  '000': 'Umum', '100': 'Pemerintahan', '200': 'Politik', '300': 'Keamanan dan Ketertiban',
  '400': 'Kesejahteraan Rakyat', '500': 'Perekonomian', '600': 'Pekerjaan Umum dan Ketenagaan',
  '700': 'Pengawasan', '800': 'Kepegawaian', '900': 'Keuangan'
};
const PERAN_LABEL = { ADMIN: 'Petugas Arsip / Admin', PIMPINAN: 'Pimpinan', STAF: 'Staf' };
const MAX_FILE_BYTES = 10 * 1024 * 1024, MAX_FILES = 10;
const EXT_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const PER_HALAMAN = 15;

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const ic = (name, cls) => '<span class="material-symbols-outlined ' + (cls || '') + '" aria-hidden="true">' + name + '</span>';
function fmtTgl(t) {                      // '2026-10-08' -> '8 Okt 2026'
  if (!t || t.length < 10) return t || '-';
  return parseInt(t.slice(8, 10), 10) + ' ' + BULAN[parseInt(t.slice(5, 7), 10) - 1] + ' ' + t.slice(0, 4);
}
function fmtWaktu(t) { return t && t.length >= 16 ? fmtTgl(t) + ', ' + t.slice(11, 16) : (t || '-'); }
function hariIni() { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
function fmtUkuran(kb) { kb = Number(kb) || 0; return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'; }
function inisial(n) { return (n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function cssColor(token) {                // baca token warna aktif (ikut mode gelap) untuk Chart.js
  const v = getComputedStyle(document.documentElement).getPropertyValue('--c-' + token).trim().split(/\s+/);
  return 'rgb(' + v.join(',') + ')';
}
function izin(aksi) {                     // matriks hak akses (PRD 3.2) — server tetap memeriksa ulang
  const p = AppState.user && AppState.user.peran;
  return ({
    tambah: p === 'ADMIN', ubah: p === 'ADMIN' || p === 'PIMPINAN', hapus: p === 'ADMIN' || p === 'PIMPINAN',
    disposisi: p === 'PIMPINAN', admin: p === 'ADMIN', pengguna: p === 'PIMPINAN'
  })[aksi] || false;
}
function setBusy(btn, busy, teks) {
  if (!btn) return;
  if (busy) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + esc(teks || 'Memproses…'); }
  else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}

// ════════════════════════════════════════════════════════
// BAGIAN 2 — PEMANGGIL SERVER (Promise) & SESI
// ════════════════════════════════════════════════════════
/**
 * Pemanggil REST API (menggantikan pemanggil bawaan Apps Script).
 * POST text/plain (tanpa preflight CORS) -> { action, token, args }.
 * Konvensi lama dipertahankan: call(nama, ...args) dengan token sebagai args[0].
 */
async function call(fn, ...args) {
  const isLogin = fn === 'apiLogin';
  const body = isLogin ? { action: fn, args: args } : { action: fn, token: args[0], args: args.slice(1) };
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 180000);
  let res;
  try {
    res = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'Server terlalu lama merespons. Coba lagi.' : 'Tidak dapat menghubungi server. Periksa koneksi internet dan GAS_URL di js/config.js.');
  } finally { clearTimeout(timer); }
  let r;
  try { r = await res.json(); }
  catch (e) { throw new Error('Server tidak mengembalikan JSON. Pastikan Web App di-deploy dengan akses "Anyone" dan memakai versi terbaru.'); }
  if (r && r.success === false && r.code === 'SESI') { paksaKeluar(r.message); throw new Error(r.message); }
  return r;
}
const callAuth = (fn, ...args) => call(fn, AppState.token, ...args);
function errMsg(e) { return (e && e.message) ? e.message.replace(/^Error:\s*/, '') : 'Terjadi kesalahan. Coba lagi.'; }

function simpanToken(t) { try { t ? sessionStorage.setItem('earsip_token', t) : sessionStorage.removeItem('earsip_token'); } catch (e) {} }
function bacaToken() { try { return sessionStorage.getItem('earsip_token'); } catch (e) { return null; } }

function paksaKeluar(pesan) {
  AppState.token = null; AppState.user = null; AppState.loaded = false; AppState.kode = null;
  simpanToken(null); hancurkanChart();
  $('#shell').classList.add('hidden');
  tampilLogin(pesan);
}

// ════════════════════════════════════════════════════════
// BAGIAN 3 — TOAST, MODAL, KONFIRMASI
// ════════════════════════════════════════════════════════
function toast(pesan, tipe) {
  const root = $('#toast-root'), el = document.createElement('div');
  const ikon = { ok: 'check_circle', bad: 'error', warn: 'warning' }[tipe] || 'info';
  el.className = 'toast ' + (tipe || '');
  el.innerHTML = ic(ikon) + '<div class="flex-1 text-body-md">' + esc(pesan) + '</div>' +
    '<button class="btn-icon !min-w-[28px] !min-h-[28px] !text-inverse-on-surface" aria-label="Tutup notifikasi">' + ic('close') + '</button>';
  const tutup = () => { el.remove(); };
  el.querySelector('button').onclick = tutup;
  root.appendChild(el);
  setTimeout(tutup, tipe === 'bad' ? 7000 : 4500);
}

let _fokusSebelum = [];
function bukaModal(o) {           // o: {judul, isi, footer, ukuran, onClose}
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.innerHTML =
    '<div class="modal-box ' + (o.ukuran || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.judul) + '">' +
    '<div class="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-border-subtle">' +
    '<h2 class="text-headline-sm text-text-primary truncate">' + esc(o.judul) + '</h2>' +
    '<button class="btn-icon" data-modal-close aria-label="Tutup">' + ic('close') + '</button></div>' +
    '<div class="modal-body">' + (o.isi || '') + '</div>' +
    (o.footer ? '<div class="px-5 py-3 border-t border-border-subtle flex flex-wrap justify-end gap-2">' + o.footer + '</div>' : '') +
    '</div>';
  layer._onClose = o.onClose;
  layer.addEventListener('mousedown', e => { if (e.target === layer) tutupModal(layer); });
  layer.addEventListener('click', e => { if (e.target.closest('[data-modal-close]')) tutupModal(layer); });
  _fokusSebelum.push(document.activeElement);
  $('#modal-root').appendChild(layer);
  const fokus = layer.querySelector('[autofocus], input, textarea, select, button:not([data-modal-close])') || layer.querySelector('button');
  if (fokus) setTimeout(() => fokus.focus(), 30);
  return layer;
}
function tutupModal(layer) {
  layer = layer || $('#modal-root').lastElementChild;
  if (!layer) return;
  if (layer._onClose) { try { layer._onClose(); } catch (e) {} }
  layer.remove();
  const f = _fokusSebelum.pop(); if (f && f.focus) f.focus();
}
function konfirmasi(judul, pesan, labelOk, bahaya) {
  return new Promise(res => {
    const m = bukaModal({
      judul: judul, isi: '<p class="text-body-lg text-text-secondary">' + pesan + '</p>',
      footer: '<button class="btn btn-ghost" data-modal-close>Batal</button>' +
              '<button class="btn ' + (bahaya ? 'btn-danger' : 'btn-primary') + '" data-ok autofocus>' + esc(labelOk || 'Ya, lanjutkan') + '</button>',
      onClose: () => res(false)
    });
    m.querySelector('[data-ok]').onclick = () => { m._onClose = null; m.remove(); const f = _fokusSebelum.pop(); if (f && f.focus) f.focus(); res(true); };
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#modal-root').lastElementChild) { tutupModal(); return; }
    tutupProfil(); tutupNav();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const q = $('#q-global'); if (q && !$('#shell').classList.contains('hidden')) q.focus(); }
});

// ════════════════════════════════════════════════════════
// BAGIAN 4 — TEMA (TERANG / GELAP)
// ════════════════════════════════════════════════════════
function terapkanTema(gelap) {
  document.documentElement.classList.toggle('dark', gelap);
  const i = $('#theme-icon'); if (i) i.textContent = gelap ? 'light_mode' : 'dark_mode';
  try { localStorage.setItem('theme', gelap ? 'dark' : 'light'); } catch (e) {}
  if (AppState.chartRedraw) AppState.chartRedraw();
}
function ubahTema() { terapkanTema(!document.documentElement.classList.contains('dark')); }

// ════════════════════════════════════════════════════════
// BAGIAN 5 — SHELL: NAVIGASI, PROFIL
// ════════════════════════════════════════════════════════
function menuUntukPeran() {
  const m = [
    { id: 'dashboard', ikon: 'dashboard', label: 'Beranda / Dashboard' },
    { id: 'surat', param: { jenis: 'Masuk' }, ikon: 'mark_email_unread', label: 'Surat Masuk' },
    { id: 'surat', param: { jenis: 'Keluar' }, ikon: 'send', label: 'Surat Keluar' },
    { id: 'disposisi', ikon: 'assignment_turned_in', label: 'Disposisi Surat', badge: 'dispo' },
    { grup: 'Klasifikasi & Laporan' },
    { id: 'kode', ikon: 'folder_special', label: 'Kode Arsip' },
    { id: 'laporan', ikon: 'analytics', label: 'Laporan & Rekap' }
  ];
  if (izin('pengguna') || izin('admin')) {
    m.push({ grup: 'Administrasi' });
    if (izin('pengguna')) m.push({ id: 'pengguna', ikon: 'manage_accounts', label: 'Pengguna & Hak Akses' });
    if (izin('admin')) m.push({ id: 'pengaturan', ikon: 'settings', label: 'Pengaturan' });
  }
  return m;
}
function menuAktif(item) {
  if (item.id !== AppState.page) return false;
  if (item.id === 'surat' && item.param) return (AppState.f.surat.jenis === item.param.jenis);
  return true;
}
function renderNav() {
  const belum = AppState.data.surat.filter(s => s.jenis_surat === 'Masuk' && s.status_disposisi === 'Belum').length;
  $('#nav').innerHTML = menuUntukPeran().map((it, i) => {
    if (it.grup) return '<div class="px-3 pt-4 pb-1"><span class="text-label-sm uppercase tracking-wider text-primary-fixed-dim">' + esc(it.grup) + '</span></div>';
    const a = menuAktif(it);
    return '<button class="nav-item' + (a ? ' active' : '') + '" data-act="nav" data-i="' + i + '"' + (a ? ' aria-current="page"' : '') + '>' +
      '<span class="flex items-center gap-3">' + ic(it.ikon) + '<span class="text-body-md">' + esc(it.label) + '</span></span>' +
      (it.badge === 'dispo' && belum ? '<span class="px-1.5 py-0.5 rounded-full bg-status-warning-bg text-status-warning-text text-label-sm">' + belum + '</span>' : '') +
      '</button>';
  }).join('');
}
function bukaNav() { $('#sidebar').classList.add('open'); $('#sidebar-scrim').classList.add('show'); }
function tutupNav() { $('#sidebar').classList.remove('open'); $('#sidebar-scrim').classList.remove('show'); }
function tutupProfil() {
  const m = $('#profile-menu'); if (!m) return;
  m.classList.add('hidden'); const b = $('[data-act="toggle-profile"]'); if (b) b.setAttribute('aria-expanded', 'false');
}
function terapkanIdentitas() {
  const cfg = AppState.data.pengaturan || {}, u = AppState.user;
  $('#brand-name').textContent = cfg.nama_aplikasi || 'e-Arsip Surat';
  $('#brand-unit').textContent = cfg.nama_unit || '—';
  document.title = cfg.nama_aplikasi || 'e-Arsip Surat';
  const logo = $('#brand-logo');
  if (cfg.logo_url && /^https:\/\//i.test(cfg.logo_url)) {
    logo.innerHTML = '<img alt="Logo" class="w-full h-full object-contain" referrerpolicy="no-referrer" src="' + esc(cfg.logo_url) + '">';
  }
  $('#avatar').textContent = inisial(u.nama);
  $('#user-name').textContent = u.nama;
  $('#user-role').textContent = PERAN_LABEL[u.peran] || u.peran;
  $('#today-label').textContent = 'Hari ini: ' + fmtTgl(hariIni());
}

/** SATU-SATUNYA cara berpindah halaman. Tidak menyentuh URL. */
function navigateTo(halaman, param, opsi) {
  hancurkanChart();
  AppState.chartRedraw = null;
  AppState.page = halaman;
  AppState.param = param || {};
  if (halaman === 'surat' && param && param.jenis) { AppState.f.surat.jenis = param.jenis; if (!param.keep) { AppState.f.surat.page = 1; } }
  if (halaman === 'surat' && param && param.q !== undefined) { AppState.f.surat.q = param.q; AppState.f.surat.page = 1; }
  renderNav(); tutupNav(); tutupProfil();
  const wadah = $('#app-container');
  wadah.innerHTML = skeletonHalaman();
  const peta = {
    dashboard: renderDashboard, surat: renderSurat, detail: renderDetail, form: renderForm, disposisi: renderDisposisi,
    kode: renderKode, laporan: renderLaporan, pengguna: renderPengguna, pengaturan: renderPengaturan
  };
  const fn = peta[halaman] || renderDashboard;
  Promise.resolve(fn()).catch(e => {
    wadah.innerHTML = '<div class="card p-6 text-center"><p class="text-status-danger-text mb-3">' + esc(errMsg(e)) + '</p>' +
      '<button class="btn btn-ghost" data-act="muat-ulang">' + ic('refresh') + ' Muat ulang data</button></div>';
  });
  if (!opsi || !opsi.tetap) { window.scrollTo(0, 0); }
}
function skeletonHalaman() {
  return '<div class="flex flex-col gap-4"><div class="skel h-8 w-64"></div><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">' +
    '<div class="skel h-28"></div><div class="skel h-28"></div><div class="skel h-28"></div><div class="skel h-28"></div></div><div class="skel h-72"></div></div>';
}

/** Muat data utama (satu panggilan). paksa=true setelah ada perubahan data. */
async function pastikanData(paksa) {
  if (AppState.loaded && !paksa) return;
  const r = await callAuth('apiLoadAll');
  if (!r.success) throw new Error(r.message);
  AppState.data = r.data; AppState.user = r.data.user; AppState.loaded = true;
  terapkanIdentitas(); renderNav();
}
async function segarkan() { await pastikanData(true); renderNav(); }
async function pastikanKode() {
  if (AppState.kode) return;
  const r = await callAuth('apiListKode');
  if (!r.success) throw new Error(r.message);
  AppState.kode = r.data;
}
function namaKode(kode) {
  const k = (AppState.kode || []).find(x => x.kode === kode);
  return k ? k.uraian : (KELOMPOK_KODE[(kode || '').slice(0, 3)] || '');
}
function namaPengguna(email) {
  const u = (AppState.data.pengguna || []).find(x => x.email.toLowerCase() === String(email).toLowerCase());
  return u ? u.nama : email;
}
function hancurkanChart() { Object.keys(AppState.charts).forEach(k => { try { AppState.charts[k].destroy(); } catch (e) {} }); AppState.charts = {}; }

// ════════════════════════════════════════════════════════
// BAGIAN 6 — KOMPONEN UMUM (chip, tabel surat, paginasi)
// ════════════════════════════════════════════════════════
function chipStatus(s) {
  if (s.jenis_surat === 'Keluar') return '<span class="chip chip-info">Diarsipkan</span>';
  return s.status_disposisi === 'Sudah' ? '<span class="chip chip-ok">Terdisposisi</span>' : '<span class="chip chip-warn">Belum disposisi</span>';
}
const chipJenis = j => j === 'Masuk' ? '<span class="chip chip-info">Masuk</span>' : '<span class="chip chip-ok">Keluar</span>';

function filterSurat(daftar, f) {
  const q = (f.q || '').toLowerCase().trim();
  return daftar.filter(s => {
    if (f.jenis && f.jenis !== 'Semua' && s.jenis_surat !== f.jenis) return false;
    if (f.status && f.status !== 'Semua' && s.status_disposisi !== f.status) return false;
    if (f.kode && s.kode_arsip.indexOf(f.kode.trim()) !== 0) return false;
    if (f.dari && s.tanggal_surat < f.dari) return false;
    if (f.sampai && s.tanggal_surat > f.sampai) return false;
    if (q && (s.id_surat + ' ' + s.nomor_surat + ' ' + s.perihal + ' ' + s.pengirim_tujuan + ' ' + s.kode_arsip).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort((a, b) => b.tanggal_surat.localeCompare(a.tanggal_surat) || b.id_surat.localeCompare(a.id_surat));
}
function paginasi(scope, total, halaman, per) {
  const n = Math.max(1, Math.ceil(total / (per || PER_HALAMAN)));
  if (n <= 1) return '';
  return '<div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-border-subtle">' +
    '<span class="text-body-sm text-text-secondary">Halaman ' + halaman + ' dari ' + n + '</span>' +
    '<div class="flex gap-2"><button class="btn btn-ghost btn-sm" data-act="halaman" data-scope="' + scope + '" data-arah="-1"' + (halaman <= 1 ? ' disabled' : '') + '>' + ic('chevron_left') + ' Sebelumnya</button>' +
    '<button class="btn btn-ghost btn-sm" data-act="halaman" data-scope="' + scope + '" data-arah="1"' + (halaman >= n ? ' disabled' : '') + '>Berikutnya ' + ic('chevron_right') + '</button></div></div>';
}
/** Daftar surat: tabel (desktop) + kartu (HP). opsi.aksi=true menampilkan tombol ubah/hapus. */
function daftarSuratHtml(daftar, opsi) {
  opsi = opsi || {};
  if (!daftar.length) {
    return '<div class="p-10 text-center text-text-secondary">' + ic('inbox', '!text-[40px] text-text-muted') +
      '<p class="mt-2 text-body-lg">Tidak ada surat yang cocok.</p><p class="text-body-sm">Ubah kata kunci atau filter pencarian.</p></div>';
  }
  const aksi = s => '<div class="flex items-center gap-1 justify-end">' +
    '<button class="btn-icon" data-act="detail" data-id="' + esc(s.id_surat) + '" aria-label="Lihat detail ' + esc(s.nomor_surat) + '" title="Lihat">' + ic('visibility') + '</button>' +
    (opsi.aksi && izin('ubah') ? '<button class="btn-icon" data-act="form" data-id="' + esc(s.id_surat) + '" aria-label="Ubah ' + esc(s.nomor_surat) + '" title="Ubah">' + ic('edit') + '</button>' : '') +
    (opsi.aksi && izin('hapus') ? '<button class="btn-icon !text-status-danger-text" data-act="hapus-surat" data-id="' + esc(s.id_surat) + '" aria-label="Hapus ' + esc(s.nomor_surat) + '" title="Hapus">' + ic('delete') + '</button>' : '') + '</div>';
  const tabel = '<div class="hidden md:block overflow-x-auto"><table class="tbl"><thead><tr>' +
    '<th>ID</th><th>Nomor &amp; Tanggal</th><th>Pengirim / Tujuan</th><th>Perihal</th><th>Kode</th><th>Status</th><th class="text-right">Aksi</th></tr></thead><tbody>' +
    daftar.map(s => '<tr><td class="whitespace-nowrap">' + '<button class="link num" data-act="detail" data-id="' + esc(s.id_surat) + '">' + esc(s.id_surat) + '</button>' +
      '<div class="mt-1">' + chipJenis(s.jenis_surat) + '</div></td>' +
      '<td><div class="font-semibold text-text-primary">' + esc(s.nomor_surat) + '</div><div class="text-body-sm text-text-secondary">' + fmtTgl(s.tanggal_surat) + '</div></td>' +
      '<td class="max-w-[200px]"><div class="clamp2">' + esc(s.pengirim_tujuan) + '</div></td>' +
      '<td class="max-w-[320px]"><div class="clamp2">' + esc(s.perihal) + '</div>' +
      (s.jml_lampiran ? '<div class="text-body-sm text-text-muted mt-1 flex items-center gap-1">' + ic('attach_file', '!text-[14px]') + s.jml_lampiran + ' lampiran</div>' : '') + '</td>' +
      '<td><span class="kode-badge" title="' + esc(namaKode(s.kode_arsip)) + '">' + esc(s.kode_arsip) + '</span></td>' +
      '<td>' + chipStatus(s) + '</td><td>' + aksi(s) + '</td></tr>').join('') + '</tbody></table></div>';
  const kartu = '<div class="md:hidden divide-y divide-border-subtle">' + daftar.map(s =>
    '<div class="p-4 flex flex-col gap-2"><div class="flex items-start justify-between gap-2"><div>' +
    '<button class="link num" data-act="detail" data-id="' + esc(s.id_surat) + '">' + esc(s.id_surat) + '</button>' +
    '<div class="font-semibold text-text-primary mt-0.5">' + esc(s.nomor_surat) + '</div></div>' + chipStatus(s) + '</div>' +
    '<div class="text-body-md text-text-primary">' + esc(s.perihal) + '</div>' +
    '<div class="text-body-sm text-text-secondary">' + esc(s.pengirim_tujuan) + ' · ' + fmtTgl(s.tanggal_surat) + '</div>' +
    '<div class="flex items-center justify-between"><span class="kode-badge">' + esc(s.kode_arsip) + '</span>' + aksi(s) + '</div></div>').join('') + '</div>';
  return tabel + kartu;
}

// ════════════════════════════════════════════════════════
// BAGIAN 7 — EVENT DELEGASI (tanpa onclick inline)
// ════════════════════════════════════════════════════════
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (!e.target.closest('#profile-menu')) tutupProfil(); if (!e.target.closest('.combo')) tutupCombo(); return; }
  const id = el.dataset.id, act = el.dataset.act;
  switch (act) {
    case 'skip': $('#mainContent').focus(); break;
    case 'open-nav': bukaNav(); break;
    case 'close-nav': tutupNav(); break;
    case 'toggle-theme': ubahTema(); break;
    case 'toggle-profile': { const m = $('#profile-menu'); const buka = m.classList.toggle('hidden') === false; el.setAttribute('aria-expanded', String(buka)); break; }
    case 'logout': keluar(); break;
    case 'ganti-pin': tutupProfil(); dialogGantiPin(); break;
    case 'nav': { const it = menuUntukPeran()[parseInt(el.dataset.i, 10)]; if (it) navigateTo(it.id, it.param); break; }
    case 'muat-ulang': segarkan().then(() => navigateTo(AppState.page, AppState.param)).catch(x => toast(errMsg(x), 'bad')); break;
    case 'dashboard': navigateTo('dashboard'); break;
    case 'daftar-surat': navigateTo('surat', { jenis: el.dataset.jenis || 'Semua' }); break;
    case 'detail': navigateTo('detail', { id: id }); break;
    case 'form': navigateTo('form', { id: id, jenis: el.dataset.jenis }); break;
    case 'hapus-surat': hapusSurat(id); break;
    case 'halaman': ubahHalaman(el.dataset.scope, parseInt(el.dataset.arah, 10)); break;
    case 'reset-filter': resetFilter(el.dataset.scope); break;
    case 'lihat-lampiran': pratinjauLampiran(id, false); break;
    case 'unduh-lampiran': pratinjauLampiran(id, true); break;
    case 'hapus-lampiran': hapusLampiran(id, el.dataset.surat); break;
    case 'beri-disposisi': dialogDisposisi(id); break;
    case 'pdf-disposisi': pratinjauDisposisi(id); break;
    case 'tab-dispo': AppState.f.dispo.tab = el.dataset.tab; AppState.f.dispo.page = 1; renderDisposisi(); break;
    case 'hapus-berkas-form': AppState.formFiles.splice(parseInt(el.dataset.i, 10), 1); renderDaftarBerkas(); break;
    case 'pilih-berkas': $('#inp-berkas').click(); break;
    case 'dialog-kode': dialogKode(el.dataset.kode); break;
    case 'dialog-impor-kode': dialogImporKode(); break;
    case 'dialog-user': dialogUser(el.dataset.email); break;
    case 'reset-pin': resetPin(el.dataset.email); break;
    case 'simpan-pengaturan': simpanPengaturan(el); break;
    case 'toggle-pin': { const i = $('#login-pin'); i.type = i.type === 'password' ? 'text' : 'password'; el.querySelector('span').textContent = i.type === 'password' ? 'visibility' : 'visibility_off'; break; }
    case 'kode-pilih': pilihKode(el.dataset.kode); break;
    case 'bulan-ini': break;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'form-login') prosesLogin(e.target);
  else if (id === 'form-surat') kirimSurat(e.target);
  else if (id === 'global-search') { const q = $('#q-global').value.trim(); AppState.f.surat.status = 'Semua'; AppState.f.surat.kode = ''; AppState.f.surat.dari = ''; AppState.f.surat.sampai = ''; navigateTo('surat', { jenis: 'Semua', q: q }); }
});
/** Filter/field berpola data-f="scope.kunci" — render ulang hanya hasilnya agar fokus input tidak hilang. */
const _terapFilter = debounce((scope) => { if (scope === 'surat') renderHasilSurat(); else if (scope === 'laporan') renderLaporanHasil(); else if (scope === 'dispo') renderHasilDispo(); else if (scope === 'kode') renderHasilKode(); }, 200);
function _filterEvt(e) {
  const el = e.target.closest('[data-f]'); if (!el) return;
  const [scope, kunci] = el.dataset.f.split('.');
  AppState.f[scope][kunci] = el.value; AppState.f[scope].page = 1;
  if (scope === 'surat' && kunci === 'jenis') renderNav();
  _terapFilter(scope);
}
document.addEventListener('input', _filterEvt);
document.addEventListener('change', e => { if (e.target.matches('select[data-f], input[type="date"][data-f]')) _filterEvt(e); });

function ubahHalaman(scope, arah) {
  AppState.f[scope].page = Math.max(1, (AppState.f[scope].page || 1) + arah);
  ({ surat: renderHasilSurat, laporan: renderLaporanHasil, dispo: renderHasilDispo, kode: renderHasilKode })[scope]();
  const h = $('#hasil-' + scope); if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function resetFilter(scope) {
  const f = AppState.f[scope], jenis = scope === 'surat' ? f.jenis : 'Semua';
  Object.assign(f, { jenis: jenis, q: '', kode: '', dari: '', sampai: '', status: 'Semua', page: 1 });
  navigateTo(scope === 'surat' ? 'surat' : 'laporan', scope === 'surat' ? { jenis: jenis, keep: true } : {});
}

// ════════════════════════════════════════════════════════
// BAGIAN 8 — LOGIN / LOGOUT
// ════════════════════════════════════════════════════════
function tampilLogin(pesan) {
  const ov = $('#loadingOverlay'); if (ov) ov.style.display = 'none';
  const v = $('#login-view');
  v.classList.remove('hidden');
  v.innerHTML =
    '<div class="min-h-screen flex items-center justify-center px-4 py-10 relative">' +
    '<button class="btn-icon absolute top-4 right-4" data-act="toggle-theme" aria-label="Ganti mode terang atau gelap">' + ic('dark_mode') + '</button>' +
    '<div class="card w-full max-w-md p-6 sm:p-8">' +
    '<div class="flex flex-col items-center text-center mb-6">' +
    '<div class="w-14 h-14 rounded-xl bg-sidebar-bg flex items-center justify-center mb-3">' + ic('inventory_2', 'ms-fill !text-[30px] text-on-primary') + '</div>' +
    '<h1 class="text-headline-lg-mobile sm:text-headline-lg text-text-primary">e-Arsip Surat</h1>' +
    '<p class="text-body-md text-text-secondary mt-1">Pengarsipan surat masuk &amp; surat keluar sesuai kode klasifikasi arsip</p></div>' +
    '<form id="form-login" novalidate class="flex flex-col gap-4">' +
    '<div><label class="field-label" for="login-email">Email <span class="req">*</span></label>' +
    '<input id="login-email" class="input" type="email" inputmode="email" autocomplete="username" placeholder="nama@instansi.go.id" required></div>' +
    '<div><label class="field-label" for="login-pin">PIN <span class="req">*</span></label>' +
    '<div class="relative"><input id="login-pin" class="input pr-12" type="password" autocomplete="current-password" placeholder="6–12 angka" required>' +
    '<button type="button" class="btn-icon absolute right-1 top-1/2 -translate-y-1/2" data-act="toggle-pin" aria-label="Tampilkan atau sembunyikan PIN">' + ic('visibility') + '</button></div></div>' +
    '<p id="login-err" class="field-error min-h-[18px]" role="alert">' + esc(pesan || '') + '</p>' +
    '<button class="btn btn-primary w-full" type="submit">' + ic('login') + ' Masuk</button>' +
    '<p class="hint text-center">Lupa PIN? Hubungi petugas arsip (Admin) untuk mengatur ulang.</p></form></div></div>';
  setTimeout(() => { const e = $('#login-email'); if (e) e.focus(); }, 50);
}
async function prosesLogin(form) {
  const email = $('#login-email').value.trim(), pin = $('#login-pin').value, err = $('#login-err');
  err.textContent = '';
  if (!email || !pin) { err.textContent = 'Email dan PIN wajib diisi.'; return; }
  const btn = form.querySelector('button[type="submit"]'); setBusy(btn, true, 'Memeriksa…');
  try {
    const r = await call('apiLogin', email, pin);
    if (!r.success) { err.textContent = r.message; setBusy(btn, false); return; }
    AppState.token = r.data.token; AppState.user = r.data.user; simpanToken(r.data.token);
    await masukAplikasi();
  } catch (e) { err.textContent = errMsg(e); setBusy(btn, false); }
}
async function masukAplikasi() {
  $('#login-view').classList.add('hidden'); $('#login-view').innerHTML = '';
  $('#shell').classList.remove('hidden');
  const ov = $('#loadingOverlay'); if (ov) ov.style.display = 'none';
  $('#theme-icon').textContent = document.documentElement.classList.contains('dark') ? 'light_mode' : 'dark_mode';
  AppState.loaded = false;
  try { await pastikanData(true); navigateTo('dashboard'); }
  catch (e) { if (AppState.token) toast(errMsg(e), 'bad'); }
}
function keluar() {
  const t = AppState.token;
  call('apiLogout', t).catch(() => {});
  paksaKeluar('Anda sudah keluar.');
}

// ════════════════════════════════════════════════════════
// BAGIAN 9 — DASHBOARD
// ════════════════════════════════════════════════════════
function sparkline(vals, cls) {
  const max = Math.max.apply(null, vals.concat([1])), w = 64, h = 20;
  const pts = vals.map((v, i) => (2 + i * ((w - 4) / Math.max(1, vals.length - 1))).toFixed(1) + ',' + (h - 3 - (v / max) * (h - 6)).toFixed(1)).join(' ');
  return '<svg class="w-16 h-5 ' + cls + '" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 64 20" aria-hidden="true"><polyline points="' + pts + '" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>';
}
function kpi(o) {
  return '<div class="card card-hover p-space-md flex flex-col justify-between overflow-hidden"><div class="flex items-start justify-between"><div class="flex flex-col">' +
    '<span class="text-label-md uppercase tracking-wider text-text-secondary">' + o.label + '</span>' +
    '<span class="text-display-lg num mt-1 ' + (o.warna || 'text-text-primary') + '">' + o.nilai + '</span></div>' +
    '<div class="w-11 h-11 rounded-lg flex items-center justify-center ' + o.ikonBg + '">' + ic(o.ikon, '!text-[24px]') + '</div></div>' +
    '<div class="flex items-center justify-between mt-4 pt-3 -mx-space-md -mb-space-md px-space-md pb-space-sm ' + (o.footBg || 'bg-surface-container-low/50') + '">' + o.foot + '</div></div>';
}
function deltaHtml(cur, prev) {
  if (!prev) return '<span class="text-text-muted text-body-sm">belum ada data bulan lalu</span>';
  const p = Math.round((cur - prev) / prev * 100), naik = p >= 0;
  return '<span class="flex items-center gap-1 text-label-md ' + (naik ? 'text-status-success-text' : 'text-status-danger-text') + '">' + ic(naik ? 'trending_up' : 'trending_down', '!text-[16px]') + Math.abs(p) + '%' +
    '<span class="text-text-muted text-body-sm font-normal">vs bulan lalu</span></span>';
}
function gambarBar(id, labels, a, b) {
  const el = $('#' + id); if (!el || !window.Chart) return;
  if (AppState.charts[id]) AppState.charts[id].destroy();
  const tick = cssColor('text-secondary'), grid = cssColor('border-subtle');
  AppState.charts[id] = new Chart(el, {
    type: 'bar',
    data: { labels: labels, datasets: [
      { label: 'Surat Masuk', data: a, backgroundColor: cssColor('primary-container'), borderRadius: 4, maxBarThickness: 22 },
      { label: 'Surat Keluar', data: b, backgroundColor: cssColor('secondary-fixed-dim'), borderRadius: 4, maxBarThickness: 22 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: tick, usePointStyle: true, boxWidth: 8, font: { family: 'Plus Jakarta Sans' } } } },
      scales: { x: { ticks: { color: tick }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } } } }
  });
}
function gambarDonat(id, labels, values) {
  const el = $('#' + id); if (!el || !window.Chart) return;
  if (AppState.charts[id]) AppState.charts[id].destroy();
  const pal = ['primary-container', 'secondary', 'status-info-text', 'tertiary', 'secondary-fixed-dim', 'outline', 'status-warning-text', 'status-success-text', 'outline-variant', 'primary-fixed-dim'].map(cssColor);
  AppState.charts[id] = new Chart(el, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: values, backgroundColor: pal, borderColor: cssColor('surface-card'), borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { color: cssColor('text-secondary'), usePointStyle: true, boxWidth: 8, font: { family: 'Plus Jakarta Sans' } } } } }
  });
}
function hitungBulanan(daftar, n, akhir) {         // n bulan terakhir hingga 'akhir' (Date)
  const lab = [], kunci = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(akhir.getFullYear(), akhir.getMonth() - i, 1); kunci.push(ymd(d)); lab.push(BULAN[d.getMonth()] + (n > 6 ? ' ' + String(d.getFullYear()).slice(2) : '')); }
  const a = kunci.map(() => 0), b = kunci.map(() => 0);
  daftar.forEach(s => { const i = kunci.indexOf(s.tanggal_surat.slice(0, 7)); if (i >= 0) (s.jenis_surat === 'Masuk' ? a : b)[i]++; });
  return { lab: lab, a: a, b: b };
}
function hitungKelompok(daftar) {
  const m = {}; daftar.forEach(s => { const k = s.kode_arsip.slice(0, 3); m[k] = (m[k] || 0) + 1; });
  return Object.keys(m).map(k => ({ kode: k, n: m[k], nama: KELOMPOK_KODE[k] || 'Lainnya' })).sort((x, y) => y.n - x.n);
}
function umurHari(tgl) { return Math.floor((new Date(hariIni() + 'T00:00:00') - new Date(tgl.slice(0, 10) + 'T00:00:00')) / 86400000); }
function buatInsight(d) {
  const out = [], now = new Date(), cur = ymd(now), prev = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const c = d.filter(s => s.tanggal_surat.slice(0, 7) === cur).length, p = d.filter(s => s.tanggal_surat.slice(0, 7) === prev).length;
  if (d.length === 0) return ['Belum ada surat tercatat. Mulai dengan mencatat surat masuk atau surat keluar.'];
  out.push('Bulan ini tercatat <b>' + c + ' surat</b>' + (p ? ', ' + (c >= p ? 'naik' : 'turun') + ' ' + Math.abs(Math.round((c - p) / p * 100)) + '% dibanding bulan lalu (' + p + ').' : '.'));
  const g = hitungKelompok(d)[0];
  if (g) out.push('Kelompok kode <b>' + g.kode + ' – ' + esc(g.nama) + '</b> paling banyak digunakan (' + Math.round(g.n / d.length * 100) + '% dari seluruh arsip).');
  const masuk = d.filter(s => s.jenis_surat === 'Masuk'), belum = masuk.filter(s => s.status_disposisi === 'Belum');
  if (masuk.length) {
    const lama = belum.filter(s => umurHari(s.tanggal_dicatat) > 3).length;
    out.push(belum.length ? '<b>' + belum.length + ' surat masuk</b> menunggu disposisi' + (lama ? ', ' + lama + ' di antaranya lebih dari 3 hari.' : '.')
                          : 'Semua surat masuk sudah didisposisi. Kerja bagus!');
    out.push('Tingkat disposisi surat masuk: <b>' + Math.round((masuk.length - belum.length) / masuk.length * 100) + '%</b>.');
  }
  const tanpa = d.filter(s => !s.jml_lampiran).length;
  if (tanpa) out.push('<b>' + tanpa + ' surat</b> belum memiliki file lampiran. Lengkapi agar arsip utuh.');
  return out;
}

async function renderDashboard() {
  await pastikanData(); await pastikanKode().catch(() => {});
  const d = AppState.data.surat, now = new Date(), cur = ymd(now), prev = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const masuk = d.filter(s => s.jenis_surat === 'Masuk'), keluar = d.filter(s => s.jenis_surat === 'Keluar');
  const bln = a => a.filter(s => s.tanggal_surat.slice(0, 7) === cur).length, blnLalu = a => a.filter(s => s.tanggal_surat.slice(0, 7) === prev).length;
  const belum = masuk.filter(s => s.status_disposisi === 'Belum').length;
  const hari = hariIni(), masukHariIni = masuk.filter(s => s.tanggal_surat === hari).length, keluarHariIni = keluar.filter(s => s.tanggal_surat === hari).length;
  const bul = hitungBulanan(d, 6, now), tot6 = bul.a.map((v, i) => v + bul.b[i]);
  const kel = hitungKelompok(d), top = kel.slice(0, 5), lain = kel.slice(5).reduce((x, y) => x + y.n, 0);
  const warna = ['bg-primary', 'bg-secondary', 'bg-status-info-text', 'bg-outline', 'bg-outline-variant', 'bg-surface-container-highest'];
  const barKlas = top.concat(lain ? [{ kode: '', n: lain, nama: 'Kelompok lainnya' }] : []).map((k, i) =>
    '<div class="flex flex-col gap-1"><div class="flex items-center justify-between text-label-md"><span class="text-text-primary">' + (k.kode ? k.kode + ' – ' : '') + esc(k.nama) + '</span>' +
    '<span class="font-bold text-text-primary num">' + k.n + ' <span class="text-text-muted font-normal">(' + Math.round(k.n / Math.max(1, d.length) * 100) + '%)</span></span></div>' +
    '<div class="w-full h-2 rounded-full bg-surface-container-high overflow-hidden" role="presentation"><div class="h-full rounded-full ' + warna[i] + '" style="width:' + Math.round(k.n / Math.max(1, d.length) * 100) + '%"></div></div></div>').join('') ||
    '<p class="text-body-md text-text-muted">Belum ada data.</p>';
  const tombol = izin('tambah')
    ? '<button class="btn btn-ghost" data-act="form" data-jenis="Keluar">' + ic('outgoing_mail', 'text-secondary') + ' Catat Surat Keluar</button>' +
      '<button class="btn btn-primary" data-act="form" data-jenis="Masuk">' + ic('move_to_inbox') + ' Catat Surat Masuk</button>'
    : (izin('disposisi') ? '<button class="btn btn-primary" data-act="nav-dispo">' + ic('assignment_turned_in') + ' Surat menunggu disposisi</button>' : '');
  const terbaru = filterSurat(d, {}).slice(0, 5);

  $('#app-container').innerHTML =
    '<div class="flex flex-col gap-space-lg">' +
    '<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md"><div><h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary">Dashboard e-Arsip</h1>' +
    '<p class="text-body-md text-text-secondary mt-0.5">Ringkasan penatausahaan surat, klasifikasi arsip, dan monitoring disposisi unit kerja.</p></div>' +
    '<div class="flex flex-wrap items-center gap-space-sm">' + tombol + '</div></div>' +

    '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">' +
    kpi({ label: 'Total Surat Terdata', nilai: d.length, ikon: 'folder_managed', ikonBg: 'bg-surface-container text-primary-container',
          foot: deltaHtml(bln(d), blnLalu(d)) + sparkline(tot6, 'text-primary-container/50') }) +
    kpi({ label: 'Surat Masuk', nilai: masuk.length, ikon: 'mark_email_unread', ikonBg: 'bg-status-info-bg text-status-info-text',
          foot: '<span class="px-1.5 py-0.5 rounded bg-status-info-bg text-status-info-text text-label-sm">+' + masukHariIni + ' hari ini</span>' + sparkline(bul.a, 'text-status-info-text/50') }) +
    kpi({ label: 'Surat Keluar', nilai: keluar.length, ikon: 'send_and_archive', ikonBg: 'bg-status-success-bg text-status-success-text',
          foot: '<span class="px-1.5 py-0.5 rounded bg-status-success-bg text-status-success-text text-label-sm">' + keluarHariIni + ' dicatat hari ini</span>' + sparkline(bul.b, 'text-status-success-text/50') }) +
    kpi({ label: 'Menunggu Disposisi', nilai: belum, warna: belum ? 'text-status-warning-text' : 'text-text-primary', ikon: 'pending_actions', ikonBg: 'bg-status-warning-bg text-status-warning-text',
          footBg: belum ? 'bg-status-warning-bg/40' : 'bg-surface-container-low/50',
          foot: belum ? '<span class="flex items-center gap-1.5 text-label-md text-status-warning-text">' + ic('priority_high', '!text-[16px]') + 'Perlu tindak lanjut Pimpinan</span>'
                      : '<span class="flex items-center gap-1.5 text-label-md text-status-success-text">' + ic('check_circle', '!text-[16px]') + 'Semua sudah didisposisi</span>' }) +
    '</div>' +

    '<div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">' +
    '<section class="lg:col-span-7 card p-space-lg" aria-labelledby="h-tren"><div class="mb-3"><h2 id="h-tren" class="text-headline-md text-text-primary">Tren Volume Surat</h2>' +
    '<p class="text-body-sm text-text-secondary">Surat masuk dibanding surat keluar, 6 bulan terakhir</p></div>' +
    '<div class="h-60"><canvas id="grafik-bulanan" role="img" aria-label="Grafik batang surat masuk dan keluar per bulan"></canvas></div></section>' +
    '<section class="lg:col-span-5 card p-space-lg flex flex-col" aria-labelledby="h-klas"><div class="flex items-start justify-between mb-3"><div><h2 id="h-klas" class="text-headline-md text-text-primary">Kode Klasifikasi Arsip</h2>' +
    '<p class="text-body-sm text-text-secondary">Berdasarkan Permendagri No. 83 Tahun 2022</p></div>' + ic('folder_zip', 'text-primary-container') + '</div>' +
    '<div class="flex flex-col gap-3.5 my-auto py-2">' + barKlas + '</div></section></div>' +

    '<section class="rounded-xl bg-gradient-to-br from-primary-container to-tertiary-container text-on-primary p-space-lg" aria-labelledby="h-ai">' +
    '<h2 id="h-ai" class="text-headline-sm flex items-center gap-2 mb-3">' + ic('auto_awesome') + ' Ringkasan Otomatis</h2>' +
    '<ul class="grid md:grid-cols-2 gap-x-8 gap-y-2 text-body-md list-disc pl-5">' + buatInsight(d).map(t => '<li>' + t + '</li>').join('') + '</ul></section>' +

    '<section class="card overflow-hidden" aria-labelledby="h-baru"><div class="p-space-md sm:p-space-lg flex items-center justify-between gap-3">' +
    '<div><h2 id="h-baru" class="text-headline-md text-text-primary">Surat Terbaru</h2><p class="text-body-sm text-text-secondary">Lima surat terakhir yang dicatat</p></div>' +
    '<button class="btn btn-ghost btn-sm" data-act="daftar-surat" data-jenis="Semua">Lihat semua ' + ic('arrow_forward', '!text-[16px]') + '</button></div>' +
    daftarSuratHtml(terbaru) + '</section></div>';

  const gambar = () => { gambarBar('grafik-bulanan', bul.lab, bul.a, bul.b); };
  gambar(); AppState.chartRedraw = gambar;
}
document.addEventListener('click', e => { if (e.target.closest('[data-act="nav-dispo"]')) navigateTo('disposisi'); });

// ════════════════════════════════════════════════════════
// BAGIAN 10 — DAFTAR SURAT (Masuk / Keluar / Semua)
// ════════════════════════════════════════════════════════
async function renderSurat() {
  await pastikanData(); await pastikanKode().catch(() => {});
  const f = AppState.f.surat;
  $('#app-container').innerHTML =
    '<div class="flex flex-col gap-space-lg">' +
    '<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md"><div><h1 id="judul-surat" class="text-headline-lg-mobile md:text-headline-lg text-text-primary"></h1>' +
    '<p class="text-body-md text-text-secondary mt-0.5">Cari, saring, dan buka arsip surat beserta lampirannya.</p></div>' +
    (izin('tambah') ? '<button class="btn btn-primary" data-act="form" data-jenis="' + (f.jenis === 'Keluar' ? 'Keluar' : 'Masuk') + '">' + ic('add') + ' Catat surat</button>' : '') + '</div>' +
    '<form class="card p-space-md grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onsubmit="return false" aria-label="Filter surat">' +
    '<div class="lg:col-span-2"><label class="field-label" for="f-q">Pencarian</label><input id="f-q" class="input" data-f="surat.q" value="' + esc(f.q) + '" placeholder="Nomor, perihal, pengirim, kode…"></div>' +
    '<div><label class="field-label" for="f-jenis">Jenis</label><select id="f-jenis" class="select" data-f="surat.jenis">' +
    ['Semua', 'Masuk', 'Keluar'].map(x => '<option' + (f.jenis === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
    '<div><label class="field-label" for="f-kode">Kode arsip</label><input id="f-kode" class="input" data-f="surat.kode" value="' + esc(f.kode) + '" placeholder="mis. 800 atau 000.1"></div>' +
    '<div><label class="field-label" for="f-dari">Dari tanggal</label><input id="f-dari" type="date" class="input" data-f="surat.dari" value="' + esc(f.dari) + '"></div>' +
    '<div><label class="field-label" for="f-sampai">Sampai tanggal</label><input id="f-sampai" type="date" class="input" data-f="surat.sampai" value="' + esc(f.sampai) + '"></div>' +
    '<div class="sm:col-span-2 lg:col-span-6 flex items-center justify-between gap-3 flex-wrap"><div><label class="field-label !mb-1" for="f-status">Status disposisi</label><select id="f-status" class="select !w-auto" data-f="surat.status">' +
    ['Semua', 'Belum', 'Sudah'].map(x => '<option value="' + x + '"' + (f.status === x ? ' selected' : '') + '>' + (x === 'Semua' ? 'Semua' : x === 'Belum' ? 'Belum didisposisi' : 'Sudah didisposisi') + '</option>').join('') + '</select></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-act="reset-filter" data-scope="surat">' + ic('restart_alt', '!text-[18px]') + ' Atur ulang filter</button></div></form>' +
    '<section class="card overflow-hidden" id="hasil-surat" aria-live="polite"></section></div>';
  renderHasilSurat();
}
function renderHasilSurat() {
  const f = AppState.f.surat, h = $('#hasil-surat'); if (!h) return;
  const hasil = filterSurat(AppState.data.surat, f), total = hasil.length;
  const maks = Math.max(1, Math.ceil(total / PER_HALAMAN)); if (f.page > maks) f.page = maks;
  const irisan = hasil.slice((f.page - 1) * PER_HALAMAN, f.page * PER_HALAMAN);
  $('#judul-surat').textContent = f.jenis === 'Masuk' ? 'Surat Masuk' : f.jenis === 'Keluar' ? 'Surat Keluar' : 'Semua Surat';
  h.innerHTML = '<div class="px-4 py-3 border-b border-border-subtle text-body-sm text-text-secondary">' + total + ' surat ditemukan</div>' +
    daftarSuratHtml(irisan, { aksi: true }) + paginasi('surat', total, f.page);
}
async function hapusSurat(id) {
  const s = AppState.data.surat.find(x => x.id_surat === id); if (!s) return;
  const ok = await konfirmasi('Hapus surat?', 'Surat <b>' + esc(s.nomor_surat) + '</b> beserta seluruh lampiran dan disposisinya akan dihapus. Tindakan ini tidak dapat dibatalkan.', 'Ya, hapus', true);
  if (!ok) return;
  try {
    const r = await callAuth('apiDeleteSurat', id);
    if (!r.success) { toast(r.message, 'bad'); return; }
    toast(r.message, 'ok'); await segarkan();
    if (AppState.page === 'detail') navigateTo('surat', { jenis: s.jenis_surat, keep: true });
    else if (AppState.page === 'surat') renderHasilSurat(); else navigateTo(AppState.page, AppState.param);
  } catch (e) { toast(errMsg(e), 'bad'); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 11 — DETAIL SURAT
// ════════════════════════════════════════════════════════
function ikonBerkas(m) { return m === 'application/pdf' ? 'picture_as_pdf' : /^image\//.test(m) ? 'image' : 'description'; }
async function renderDetail() {
  await pastikanData(); await pastikanKode().catch(() => {});
  const id = AppState.param.id;
  const r = await callAuth('apiGetDetail', id);
  if (!r.success) throw new Error(r.message);
  const s = r.data.surat, lamp = r.data.lampiran, disp = r.data.disposisi;
  const baris = (k, v) => '<div class="grid sm:grid-cols-[170px_1fr] gap-1 sm:gap-3 py-2.5 border-b border-border-subtle last:border-0"><dt class="text-label-md text-text-secondary uppercase tracking-wide">' + k + '</dt><dd class="text-body-md text-text-primary break-words">' + v + '</dd></div>';
  const aksi = '<div class="flex flex-wrap gap-2">' +
    (izin('disposisi') && s.jenis_surat === 'Masuk' ? '<button class="btn btn-primary" data-act="beri-disposisi" data-id="' + esc(s.id_surat) + '">' + ic('assignment_turned_in') + ' Beri disposisi</button>' : '') +
    (izin('ubah') ? '<button class="btn btn-ghost" data-act="form" data-id="' + esc(s.id_surat) + '">' + ic('edit') + ' Ubah</button>' : '') +
    (izin('hapus') ? '<button class="btn btn-danger" data-act="hapus-surat" data-id="' + esc(s.id_surat) + '">' + ic('delete') + ' Hapus</button>' : '') + '</div>';
  const lampHtml = lamp.length ? '<ul class="divide-y divide-border-subtle">' + lamp.map(l =>
    '<li class="py-3 flex items-center gap-3"><div class="w-10 h-10 rounded-lg bg-surface-container text-primary-container flex items-center justify-center flex-shrink-0">' + ic(ikonBerkas(l.tipe_file)) + '</div>' +
    '<div class="min-w-0 flex-1"><div class="text-label-lg text-text-primary truncate">' + esc(l.nama_file) + '</div>' +
    '<div class="text-body-sm text-text-secondary">' + fmtUkuran(l.ukuran_kb) + ' · ' + esc(namaPengguna(l.diunggah_oleh)) + ' · ' + fmtWaktu(l.tanggal_unggah) + '</div></div>' +
    '<div class="flex gap-1"><button class="btn-icon" data-act="lihat-lampiran" data-id="' + esc(l.id_lampiran) + '" aria-label="Lihat ' + esc(l.nama_file) + '" title="Lihat">' + ic('visibility') + '</button>' +
    '<button class="btn-icon" data-act="unduh-lampiran" data-id="' + esc(l.id_lampiran) + '" aria-label="Unduh ' + esc(l.nama_file) + '" title="Unduh">' + ic('download') + '</button>' +
    (izin('hapus') ? '<button class="btn-icon !text-status-danger-text" data-act="hapus-lampiran" data-id="' + esc(l.id_lampiran) + '" data-surat="' + esc(s.id_surat) + '" aria-label="Hapus ' + esc(l.nama_file) + '" title="Hapus">' + ic('delete') + '</button>' : '') +
    '</div></li>').join('') + '</ul>' : '<p class="text-body-md text-text-muted py-4">Belum ada lampiran.</p>';
  const dispHtml = disp.length ? disp.map(x =>
    '<div class="rounded-lg border border-border-subtle p-3 mb-3 last:mb-0"><div class="flex items-center justify-between gap-2 mb-1"><span class="text-label-md text-text-secondary">' + fmtWaktu(x.tanggal_disposisi) + '</span>' +
    (x.pdf_file_id ? '<button class="btn btn-ghost btn-sm" data-act="pdf-disposisi" data-id="' + esc(x.id_disposisi) + '">' + ic('picture_as_pdf', '!text-[16px]') + ' Lembar PDF</button>' : '') + '</div>' +
    '<div class="text-body-sm text-text-secondary">Oleh <b class="text-text-primary">' + esc(x.diberikan_nama) + '</b> kepada <b class="text-text-primary">' + esc(x.tujuan_nama) + '</b></div>' +
    '<p class="text-body-md text-text-primary mt-2 whitespace-pre-wrap break-words">' + esc(x.instruksi) + '</p>' +
    '<p class="text-body-sm text-text-muted mt-2 flex items-center gap-1">' + ic('mail', '!text-[14px]') + esc(x.status_email || '-') + '</p></div>').join('')
    : '<p class="text-body-md text-text-muted">' + (s.jenis_surat === 'Masuk' ? 'Belum ada disposisi.' : 'Surat keluar tidak memerlukan disposisi.') + '</p>';

  $('#app-container').innerHTML =
    '<div class="flex flex-col gap-space-lg">' +
    '<div><button class="btn btn-ghost btn-sm mb-3" data-act="daftar-surat" data-jenis="' + esc(s.jenis_surat) + '">' + ic('arrow_back', '!text-[18px]') + ' Kembali ke daftar</button>' +
    '<div class="flex flex-col md:flex-row md:items-start justify-between gap-3"><div class="min-w-0">' +
    '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="num text-label-md text-text-secondary">' + esc(s.id_surat) + '</span>' + chipJenis(s.jenis_surat) + chipStatus(s) + '</div>' +
    '<h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary break-words">' + esc(s.perihal) + '</h1></div>' + aksi + '</div></div>' +
    '<div class="grid lg:grid-cols-5 gap-space-lg"><div class="lg:col-span-3 flex flex-col gap-space-lg">' +
    '<section class="card p-space-lg" aria-labelledby="h-info"><h2 id="h-info" class="text-headline-md text-text-primary mb-2">Informasi Surat</h2><dl>' +
    baris('Nomor surat', esc(s.nomor_surat)) + baris('Tanggal surat', fmtTgl(s.tanggal_surat)) +
    baris(s.jenis_surat === 'Masuk' ? 'Pengirim' : 'Tujuan', esc(s.pengirim_tujuan)) +
    baris('Kode arsip', '<span class="kode-badge">' + esc(s.kode_arsip) + '</span> <span class="text-text-secondary">' + esc(namaKode(s.kode_arsip)) + '</span>') +
    baris('Dicatat', esc(namaPengguna(s.dicatat_oleh)) + ' · ' + fmtWaktu(s.tanggal_dicatat)) +
    (s.diubah_oleh ? baris('Terakhir diubah', esc(namaPengguna(s.diubah_oleh)) + ' · ' + fmtWaktu(s.diubah_pada)) : '') + '</dl></section>' +
    '<section class="card p-space-lg" aria-labelledby="h-lamp"><h2 id="h-lamp" class="text-headline-md text-text-primary mb-1">Lampiran <span class="text-text-muted text-body-md">(' + lamp.length + ')</span></h2>' + lampHtml + '</section></div>' +
    '<section class="lg:col-span-2 card p-space-lg self-start" aria-labelledby="h-dsp"><h2 id="h-dsp" class="text-headline-md text-text-primary mb-3">Disposisi</h2>' + dispHtml + '</section></div></div>';
}
async function hapusLampiran(idLamp, idSurat) {
  const ok = await konfirmasi('Hapus lampiran?', 'File lampiran akan dipindahkan ke tempat sampah Google Drive.', 'Ya, hapus', true);
  if (!ok) return;
  try {
    const r = await callAuth('apiDeleteLampiran', idLamp);
    if (!r.success) { toast(r.message, 'bad'); return; }
    toast(r.message, 'ok'); await segarkan(); navigateTo(AppState.page, AppState.param, { tetap: true });
  } catch (e) { toast(errMsg(e), 'bad'); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 12 — FORM TAMBAH / UBAH SURAT + UNGGAH LAMPIRAN
// ════════════════════════════════════════════════════════
let _kodeAktif = -1;
async function renderForm() {
  await pastikanData(); await pastikanKode();
  const id = AppState.param.id; let s = null, lamp = [];
  if (id) {
    if (!izin('ubah')) throw new Error('Anda tidak berwenang mengubah surat.');
    const r = await callAuth('apiGetDetail', id); if (!r.success) throw new Error(r.message);
    s = r.data.surat; lamp = r.data.lampiran;
  } else if (!izin('tambah')) throw new Error('Hanya petugas arsip yang dapat mencatat surat baru.');
  const jenis = s ? s.jenis_surat : (AppState.param.jenis === 'Keluar' ? 'Keluar' : 'Masuk');
  AppState.formFiles = []; AppState.formKode = s ? s.kode_arsip : '';
  const k0 = s ? (AppState.kode.find(k => k.kode === s.kode_arsip) || null) : null;
  const v = (n, d) => esc(s ? s[n] : (d || ''));
  const lampLama = lamp.length ? '<div class="mb-3"><div class="field-label">Lampiran tersimpan</div><ul class="divide-y divide-border-subtle rounded-lg border border-border-subtle">' + lamp.map(l =>
    '<li class="p-3 flex items-center gap-3">' + ic(ikonBerkas(l.tipe_file), 'text-primary-container') + '<span class="flex-1 truncate text-body-md">' + esc(l.nama_file) + '</span><span class="text-body-sm text-text-muted">' + fmtUkuran(l.ukuran_kb) + '</span>' +
    '<button type="button" class="btn-icon !text-status-danger-text" data-act="hapus-lampiran" data-id="' + esc(l.id_lampiran) + '" data-surat="' + esc(id) + '" aria-label="Hapus ' + esc(l.nama_file) + '">' + ic('delete') + '</button></li>').join('') + '</ul></div>' : '';

  $('#app-container').innerHTML =
    '<div class="max-w-3xl mx-auto flex flex-col gap-space-lg">' +
    '<div><button class="btn btn-ghost btn-sm mb-3" data-act="' + (id ? 'detail' : 'daftar-surat') + '" data-id="' + esc(id || '') + '" data-jenis="' + jenis + '">' + ic('arrow_back', '!text-[18px]') + ' Batal</button>' +
    '<h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary">' + (id ? 'Ubah Surat' : 'Catat Surat Baru') + '</h1>' +
    '<p class="text-body-md text-text-secondary mt-0.5">' + (id ? esc(s.id_surat) : 'ID surat dibuat otomatis. Kolom bertanda <span class="text-error">*</span> wajib diisi.') + '</p></div>' +
    '<form id="form-surat" class="card p-space-lg flex flex-col gap-5" novalidate data-id="' + esc(id || '') + '">' +
    '<fieldset class="flex gap-3"' + (id ? ' disabled' : '') + '><legend class="field-label">Jenis surat <span class="req">*</span></legend>' +
    ['Masuk', 'Keluar'].map(j => '<label class="flex-1 flex items-center gap-2 border rounded-lg px-4 py-3 cursor-pointer ' + (j === jenis ? 'border-border-focus bg-surface-container-low' : 'border-outline-variant') + '" style="min-height:48px">' +
      '<input type="radio" name="jenis_surat" value="' + j + '"' + (j === jenis ? ' checked' : '') + '> <span class="text-label-lg">Surat ' + j + '</span></label>').join('') + '</fieldset>' +
    '<div class="grid sm:grid-cols-2 gap-4">' +
    '<div><label class="field-label" for="nomor_surat">Nomor surat <span class="req">*</span></label><input class="input" id="nomor_surat" name="nomor_surat" maxlength="100" value="' + v('nomor_surat') + '" required></div>' +
    '<div><label class="field-label" for="tanggal_surat">Tanggal surat <span class="req">*</span></label><input class="input" type="date" id="tanggal_surat" name="tanggal_surat" value="' + v('tanggal_surat', hariIni()) + '" required></div></div>' +
    '<div><label class="field-label" for="pengirim_tujuan" id="lbl-pt">' + (jenis === 'Masuk' ? 'Pengirim' : 'Tujuan surat') + ' <span class="req">*</span></label><input class="input" id="pengirim_tujuan" name="pengirim_tujuan" maxlength="200" value="' + v('pengirim_tujuan') + '" required></div>' +
    '<div><label class="field-label" for="perihal">Perihal <span class="req">*</span></label><textarea class="textarea" id="perihal" name="perihal" maxlength="500" required>' + v('perihal') + '</textarea></div>' +
    '<div><label class="field-label" for="kode-input">Kode arsip (Permendagri 83/2022) <span class="req">*</span></label>' +
    '<div class="combo relative"><input id="kode-input" class="input" role="combobox" aria-expanded="false" aria-controls="kode-list" aria-autocomplete="list" autocomplete="off" placeholder="Ketik kode atau uraian, mis. 800.1 atau kepegawaian" value="' + esc(k0 ? k0.kode + ' — ' + k0.uraian : (s ? s.kode_arsip : '')) + '">' +
    '<div id="kode-list" class="combo-list hidden" role="listbox"></div></div><p id="kode-hint" class="hint">' + (AppState.kode.length ? AppState.kode.length + ' kode tersedia. Pilih dari daftar.' : 'Daftar kode masih kosong. Minta Admin mengimpor kode di menu Kode Arsip.') + '</p></div>' +
    '<div><div class="field-label">Berkas surat (scan) <span class="req">*</span></div>' + lampLama +
    '<div class="dropzone" id="dropzone" data-act="pilih-berkas" tabindex="0" role="button" aria-label="Pilih atau tarik file ke sini">' + ic('cloud_upload', '!text-[36px] text-primary-container') +
    '<p class="text-label-lg text-text-primary mt-1">Tarik file ke sini atau klik untuk memilih</p><p class="text-body-sm text-text-secondary">PDF, JPG, PNG, WEBP, Word, Excel · maks. 10 MB per file · hingga 10 file</p></div>' +
    '<input id="inp-berkas" type="file" class="hidden" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"><ul id="daftar-berkas" class="mt-3 flex flex-col gap-2"></ul></div>' +
    '<p id="form-err" class="field-error min-h-[18px]" role="alert"></p>' +
    '<div class="flex justify-end gap-2"><button type="submit" class="btn btn-primary" id="btn-simpan">' + ic('save') + ' ' + (id ? 'Simpan perubahan' : 'Simpan surat') + '</button></div></form></div>';

  AppState.param._lampLama = lamp.length;
  $$('input[name="jenis_surat"]').forEach(r => r.addEventListener('change', () => {
    $('#lbl-pt').innerHTML = (r.value === 'Masuk' ? 'Pengirim' : 'Tujuan surat') + ' <span class="req">*</span>';
    $$('input[name="jenis_surat"]').forEach(x => x.closest('label').className = x.closest('label').className.replace(/border-border-focus bg-surface-container-low|border-outline-variant/, x.checked ? 'border-border-focus bg-surface-container-low' : 'border-outline-variant'));
  }));
  pasangCombo(); pasangDropzone();
}

/* ── Combobox kode arsip ── */
function pasangCombo() {
  const inp = $('#kode-input'); if (!inp) return;
  inp.addEventListener('input', () => { AppState.formKode = ''; tampilOpsiKode(inp.value); });
  inp.addEventListener('focus', () => tampilOpsiKode(inp.value));
  inp.addEventListener('keydown', e => {
    const opts = $$('#kode-list .combo-opt'); if (!opts.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); _kodeAktif = Math.min(opts.length - 1, _kodeAktif + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _kodeAktif = Math.max(0, _kodeAktif - 1); }
    else if (e.key === 'Enter' && _kodeAktif >= 0) { e.preventDefault(); pilihKode(opts[_kodeAktif].dataset.kode); return; }
    else return;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === _kodeAktif)));
    opts[_kodeAktif].scrollIntoView({ block: 'nearest' });
  });
}
function tampilOpsiKode(q) {
  const list = $('#kode-list'); if (!list) return;
  q = (q || '').toLowerCase().trim(); _kodeAktif = -1;
  const sudahPilih = q.indexOf(' — ') > 0; if (sudahPilih) q = q.split(' — ')[0];
  let hasil = AppState.kode;
  if (q) hasil = hasil.filter(k => k.kode.indexOf(q) === 0 || k.uraian.toLowerCase().indexOf(q) >= 0);
  hasil = hasil.slice(0, 40);
  list.innerHTML = hasil.length ? hasil.map(k => '<div class="combo-opt" role="option" aria-selected="false" data-act="kode-pilih" data-kode="' + esc(k.kode) + '"><span class="kode-badge flex-shrink-0">' + esc(k.kode) + '</span><span class="text-body-md text-text-primary">' + esc(k.uraian) + '</span></div>').join('')
    : '<div class="p-3 text-body-md text-text-muted">Kode tidak ditemukan.</div>';
  list.classList.remove('hidden'); $('#kode-input').setAttribute('aria-expanded', 'true');
}
function tutupCombo() { const l = $('#kode-list'); if (l) l.classList.add('hidden'); const i = $('#kode-input'); if (i) i.setAttribute('aria-expanded', 'false'); }
function pilihKode(kode) {
  const k = AppState.kode.find(x => x.kode === kode); if (!k) return;
  AppState.formKode = k.kode; $('#kode-input').value = k.kode + ' — ' + k.uraian;
  $('#kode-input').classList.remove('invalid'); tutupCombo();
}

/* ── Dropzone ── */
function pasangDropzone() {
  const dz = $('#dropzone'), inp = $('#inp-berkas');
  inp.addEventListener('change', () => { tambahBerkas(inp.files); inp.value = ''; });
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => tambahBerkas(e.dataTransfer.files));
}
function tambahBerkas(files) {
  Array.from(files).forEach(f => {
    const ext = (f.name.split('.').pop() || '').toLowerCase(), mime = EXT_MIME[ext];
    if (!mime) { toast('“' + f.name + '” dilewati: jenis file tidak didukung.', 'warn'); return; }
    if (f.size > MAX_FILE_BYTES) { toast('“' + f.name + '” dilewati: lebih dari 10 MB.', 'warn'); return; }
    if (AppState.formFiles.length + (AppState.param._lampLama || 0) >= MAX_FILES) { toast('Maksimal ' + MAX_FILES + ' lampiran per surat.', 'warn'); return; }
    if (AppState.formFiles.some(x => x.name === f.name && x.size === f.size)) return;
    f._mime = f.type && EXT_MIME[ext] === f.type ? f.type : mime;
    AppState.formFiles.push(f);
  });
  renderDaftarBerkas();
}
function renderDaftarBerkas() {
  const ul = $('#daftar-berkas'); if (!ul) return;
  ul.innerHTML = AppState.formFiles.map((f, i) =>
    '<li class="rounded-lg border border-border-subtle p-3"><div class="flex items-center gap-3">' + ic(ikonBerkas(f._mime), 'text-primary-container') +
    '<div class="flex-1 min-w-0"><div class="truncate text-body-md text-text-primary">' + esc(f.name) + '</div><div class="text-body-sm text-text-muted num">' + fmtUkuran(Math.round(f.size / 1024)) + ' · <span id="up-st-' + i + '">siap diunggah</span></div></div>' +
    '<button type="button" class="btn-icon" data-act="hapus-berkas-form" data-i="' + i + '" aria-label="Buang ' + esc(f.name) + '">' + ic('close') + '</button></div>' +
    '<div class="progress mt-2" aria-hidden="true"><i id="up-bar-' + i + '"></i></div></li>').join('');
}
function bacaBase64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Gagal membaca file.')); r.readAsDataURL(file); });
}
async function kirimSurat(form) {
  const err = $('#form-err'); err.textContent = '';
  const id = form.dataset.id || '', g = n => (form.elements[n] ? form.elements[n].value : '').trim();
  const jenisEl = form.querySelector('input[name="jenis_surat"]:checked');
  ['nomor_surat', 'tanggal_surat', 'pengirim_tujuan', 'perihal'].forEach(n => form.elements[n].classList.remove('invalid'));
  const kosong = ['nomor_surat', 'tanggal_surat', 'pengirim_tujuan', 'perihal'].find(n => !g(n));
  if (kosong) { form.elements[kosong].classList.add('invalid'); form.elements[kosong].focus(); err.textContent = 'Lengkapi kolom yang wajib diisi.'; return; }
  if (!AppState.formKode) { $('#kode-input').classList.add('invalid'); $('#kode-input').focus(); err.textContent = 'Pilih kode arsip dari daftar yang tersedia.'; return; }
  if (!AppState.formFiles.length && !(AppState.param._lampLama > 0)) { err.textContent = 'Unggah minimal satu file scan surat.'; return; }
  const btn = $('#btn-simpan'); setBusy(btn, true, 'Menyimpan…');
  try {
    const r = await callAuth('apiSaveSurat', { id_surat: id, jenis_surat: jenisEl ? jenisEl.value : 'Masuk', nomor_surat: g('nomor_surat'),
      tanggal_surat: g('tanggal_surat'), pengirim_tujuan: g('pengirim_tujuan'), perihal: g('perihal'), kode_arsip: AppState.formKode });
    if (!r.success) { err.textContent = r.message; setBusy(btn, false); return; }
    const idSurat = r.data.id_surat; let gagal = 0;
    for (let i = 0; i < AppState.formFiles.length; i++) {
      const f = AppState.formFiles[i], st = $('#up-st-' + i), bar = $('#up-bar-' + i);
      try {
        if (st) st.textContent = 'mengunggah…'; if (bar) bar.style.width = '35%';
        const b64 = await bacaBase64(f); if (bar) bar.style.width = '65%';
        const u = await callAuth('apiUploadLampiran', idSurat, f.name, f._mime, b64);
        if (!u.success) throw new Error(u.message);
        if (st) st.textContent = 'selesai'; if (bar) bar.style.width = '100%';
      } catch (e) { gagal++; if (st) st.textContent = 'gagal: ' + errMsg(e); }
    }
    await segarkan();
    if (gagal) { toast('Surat tersimpan, tetapi ' + gagal + ' file gagal diunggah. Unggah ulang lewat halaman Ubah.', 'warn'); navigateTo('form', { id: idSurat }); }
    else { toast(r.message, 'ok'); navigateTo('detail', { id: idSurat }); }
  } catch (e) { err.textContent = errMsg(e); setBusy(btn, false); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 13 — PRATINJAU BERKAS (modal, bukan tab baru)
// ════════════════════════════════════════════════════════
function b64ToBytes(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function unduhBerkas(nama, mime, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = nama; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}
async function gambarPdf(wadah, bytes) {
  if (!window.pdfjsLib) throw new Error('Pustaka PDF belum termuat. Gunakan tombol Unduh.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  wadah.innerHTML = '';
  const lebar = Math.max(280, wadah.clientWidth - 8), dpr = Math.min(2, window.devicePixelRatio || 1);
  for (let i = 1; i <= pdf.numPages; i++) {
    const hal = await pdf.getPage(i), v0 = hal.getViewport({ scale: 1 }), skala = lebar / v0.width, vp = hal.getViewport({ scale: skala * dpr });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    c.style.cssText = 'width:100%;height:auto;margin-bottom:10px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.2);background:#fff';
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Halaman ' + i + ' dari ' + pdf.numPages);
    wadah.appendChild(c);
    await hal.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
}
async function tampilkanBerkas(judul, ambil, langsungUnduh) {
  const m = bukaModal({ judul: judul, ukuran: 'lg', isi: '<div id="pv" class="min-h-[240px] flex items-center justify-center text-text-secondary"><span class="spin"></span>&nbsp; Memuat berkas…</div>',
    footer: '<button class="btn btn-ghost" data-modal-close>' + ic('close') + ' Tutup</button><button class="btn btn-primary" id="pv-unduh" disabled>' + ic('download') + ' Unduh</button>' });
  try {
    const r = await ambil();
    if (!r.success) throw new Error(r.message);
    const bytes = b64ToBytes(r.data.base64), mime = r.data.mime, nama = r.data.nama;
    const tbl = $('#pv-unduh', m); tbl.disabled = false; tbl.onclick = () => unduhBerkas(nama, mime, bytes);
    if (langsungUnduh) { unduhBerkas(nama, mime, bytes); tutupModal(m); toast('Mengunduh ' + nama, 'ok'); return; }
    const pv = $('#pv', m); pv.className = 'block';
    if (/^image\//.test(mime)) pv.innerHTML = '<img class="max-w-full mx-auto rounded" alt="' + esc(nama) + '" src="data:' + mime + ';base64,' + r.data.base64 + '">';
    else if (mime === 'application/pdf') { pv.innerHTML = '<div class="text-center text-text-secondary py-6"><span class="spin"></span>&nbsp; Menyiapkan halaman…</div>'; await gambarPdf(pv, bytes); }
    else pv.innerHTML = '<div class="text-center py-10 text-text-secondary">' + ic('description', '!text-[40px] text-text-muted') + '<p class="mt-2">Pratinjau tidak tersedia untuk jenis file ini.</p><p class="text-body-sm">Gunakan tombol Unduh untuk membukanya.</p></div>';
  } catch (e) {
    const pv = $('#pv', m); if (pv) pv.innerHTML = '<p class="text-status-danger-text text-center">' + esc(errMsg(e)) + '</p>';
  }
}
const pratinjauLampiran = (id, unduh) => tampilkanBerkas('Pratinjau Lampiran', () => callAuth('apiGetFile', id), unduh);
const pratinjauDisposisi = id => tampilkanBerkas('Lembar Disposisi', () => callAuth('apiGetDisposisiPdf', id), false);

// ════════════════════════════════════════════════════════
// BAGIAN 14 — DISPOSISI
// ════════════════════════════════════════════════════════
async function renderDisposisi() {
  await pastikanData();
  const f = AppState.f.dispo; if (!f.tab) f.tab = izin('disposisi') ? 'menunggu' : 'riwayat';
  const belum = AppState.data.surat.filter(s => s.jenis_surat === 'Masuk' && s.status_disposisi === 'Belum').length;
  const tab = (id, label, n) => '<button class="px-4 py-2.5 rounded-lg text-label-lg ' + (f.tab === id ? 'bg-primary-container text-on-primary' : 'text-text-secondary hover:bg-surface-container-low') + '" data-act="tab-dispo" data-tab="' + id + '" role="tab" aria-selected="' + (f.tab === id) + '">' + label + (n !== undefined ? ' <span class="opacity-80">(' + n + ')</span>' : '') + '</button>';
  $('#app-container').innerHTML = '<div class="flex flex-col gap-space-lg">' +
    '<div><h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary">Disposisi Surat</h1><p class="text-body-md text-text-secondary mt-0.5">Lembar disposisi dibuat otomatis dalam PDF dan dikirim ke email staf tujuan.</p></div>' +
    '<div class="flex flex-wrap items-center justify-between gap-3"><div class="flex gap-1 p-1 card" role="tablist">' + tab('menunggu', 'Menunggu disposisi', belum) + tab('riwayat', 'Riwayat disposisi') + '</div>' +
    (f.tab === 'riwayat' ? '<div class="w-full sm:w-72"><label class="sr-only" for="d-q">Cari disposisi</label><input id="d-q" class="input" data-f="dispo.q" value="' + esc(f.q) + '" placeholder="Cari perihal, tujuan, instruksi…"></div>' : '') + '</div>' +
    '<section class="card overflow-hidden" id="hasil-dispo" aria-live="polite"></section></div>';
  renderHasilDispo();
}
function renderHasilDispo() {
  const f = AppState.f.dispo, h = $('#hasil-dispo'); if (!h) return;
  if (f.tab === 'menunggu') {
    const l = AppState.data.surat.filter(s => s.jenis_surat === 'Masuk' && s.status_disposisi === 'Belum').sort((a, b) => a.tanggal_dicatat.localeCompare(b.tanggal_dicatat));
    h.innerHTML = l.length ? '<ul class="divide-y divide-border-subtle">' + l.map(s => { const u = umurHari(s.tanggal_dicatat);
      return '<li class="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><button class="link num" data-act="detail" data-id="' + esc(s.id_surat) + '">' + esc(s.id_surat) + '</button>' +
        (u > 3 ? '<span class="chip chip-bad">' + u + ' hari</span>' : '<span class="chip chip-warn">' + (u <= 0 ? 'hari ini' : u + ' hari') + '</span>') + '</div>' +
        '<div class="text-label-lg text-text-primary mt-1">' + esc(s.perihal) + '</div><div class="text-body-sm text-text-secondary">' + esc(s.nomor_surat) + ' · ' + esc(s.pengirim_tujuan) + ' · ' + fmtTgl(s.tanggal_surat) + '</div></div>' +
        '<div class="flex gap-2"><button class="btn btn-ghost btn-sm" data-act="detail" data-id="' + esc(s.id_surat) + '">' + ic('visibility', '!text-[18px]') + ' Lihat</button>' +
        (izin('disposisi') ? '<button class="btn btn-primary btn-sm" data-act="beri-disposisi" data-id="' + esc(s.id_surat) + '">' + ic('assignment_turned_in', '!text-[18px]') + ' Beri disposisi</button>' : '') + '</div></li>'; }).join('') + '</ul>'
      : '<div class="p-10 text-center text-text-secondary">' + ic('task_alt', '!text-[40px] text-status-success-text') + '<p class="mt-2 text-body-lg">Semua surat masuk sudah didisposisi.</p></div>';
    return;
  }
  const q = (f.q || '').toLowerCase().trim();
  let l = AppState.data.disposisi.map(d => ({ d: d, s: AppState.data.surat.find(x => x.id_surat === d.id_surat) })).filter(x => x.s)
    .filter(x => !q || (x.s.perihal + ' ' + x.s.nomor_surat + ' ' + x.d.tujuan_nama + ' ' + x.d.instruksi + ' ' + x.d.diberikan_nama).toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => b.d.tanggal_disposisi.localeCompare(a.d.tanggal_disposisi));
  const total = l.length, maks = Math.max(1, Math.ceil(total / PER_HALAMAN)); if (f.page > maks) f.page = maks;
  l = l.slice((f.page - 1) * PER_HALAMAN, f.page * PER_HALAMAN);
  h.innerHTML = total ? '<ul class="divide-y divide-border-subtle">' + l.map(x =>
    '<li class="p-4"><div class="flex flex-wrap items-center justify-between gap-2"><span class="text-label-md text-text-secondary">' + fmtWaktu(x.d.tanggal_disposisi) + ' · oleh ' + esc(x.d.diberikan_nama) + '</span>' +
    '<div class="flex gap-2">' + (x.d.pdf_file_id ? '<button class="btn btn-ghost btn-sm" data-act="pdf-disposisi" data-id="' + esc(x.d.id_disposisi) + '">' + ic('picture_as_pdf', '!text-[16px]') + ' PDF</button>' : '') +
    '<button class="btn btn-ghost btn-sm" data-act="detail" data-id="' + esc(x.s.id_surat) + '">' + ic('visibility', '!text-[16px]') + ' Surat</button></div></div>' +
    '<div class="text-label-lg text-text-primary mt-1">' + esc(x.s.perihal) + '</div><div class="text-body-sm text-text-secondary">' + esc(x.s.nomor_surat) + ' → <b>' + esc(x.d.tujuan_nama) + '</b></div>' +
    '<p class="text-body-md text-text-primary mt-2 whitespace-pre-wrap break-words clamp2">' + esc(x.d.instruksi) + '</p>' +
    '<p class="text-body-sm text-text-muted mt-1 flex items-center gap-1">' + ic('mail', '!text-[14px]') + esc(x.d.status_email || '-') + '</p></li>').join('') + '</ul>' + paginasi('dispo', total, f.page)
    : '<div class="p-10 text-center text-text-secondary">' + ic('inbox', '!text-[40px] text-text-muted') + '<p class="mt-2">Belum ada riwayat disposisi.</p></div>';
}
async function dialogDisposisi(id) {
  const s = AppState.data.surat.find(x => x.id_surat === id); if (!s) return;
  let pen;
  try { const r = await callAuth('apiListPenerima'); if (!r.success) throw new Error(r.message); pen = r.data; } catch (e) { toast(errMsg(e), 'bad'); return; }
  const m = bukaModal({ judul: 'Beri Disposisi', ukuran: 'md',
    isi: '<form id="form-dispo" class="flex flex-col gap-4"><div class="rounded-lg bg-surface-container-low p-3"><div class="num text-label-md text-text-secondary">' + esc(s.id_surat) + ' · ' + esc(s.nomor_surat) + '</div><div class="text-label-lg text-text-primary">' + esc(s.perihal) + '</div><div class="text-body-sm text-text-secondary">' + esc(s.pengirim_tujuan) + '</div></div>' +
      '<fieldset><legend class="field-label">Diteruskan kepada <span class="req">*</span></legend><div class="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg border border-border-subtle p-2">' +
      (pen.length ? pen.map((u, i) => '<label class="flex items-center gap-3 p-2 rounded-md hover:bg-surface-container-low cursor-pointer" style="min-height:44px"><input type="checkbox" name="tujuan" value="' + esc(u.email) + '"><span><span class="text-label-lg text-text-primary">' + esc(u.nama) + '</span> <span class="text-body-sm text-text-secondary">' + esc(u.jabatan || PERAN_LABEL[u.peran] || '') + '</span></span></label>').join('') : '<p class="p-2 text-text-muted">Belum ada pengguna lain yang aktif.</p>') +
      '</div></fieldset><div><label class="field-label" for="d-instruksi">Instruksi / arahan <span class="req">*</span></label><textarea id="d-instruksi" class="textarea" maxlength="1500" placeholder="Tulis arahan untuk staf tujuan…"></textarea></div>' +
      '<p class="hint flex items-start gap-1">' + ic('mail', '!text-[16px]') + 'Lembar disposisi PDF akan dibuat otomatis dan dikirim ke email setiap staf tujuan.</p><p id="d-err" class="field-error min-h-[18px]" role="alert"></p></form>',
    footer: '<button class="btn btn-ghost" data-modal-close>Batal</button><button class="btn btn-primary" id="d-simpan">' + ic('send') + ' Simpan &amp; kirim</button>' });
  $('#d-simpan', m).onclick = async () => {
    const em = $$('input[name="tujuan"]:checked', m).map(x => x.value), ins = $('#d-instruksi', m).value.trim(), err = $('#d-err', m);
    if (!em.length) { err.textContent = 'Pilih minimal satu staf tujuan.'; return; }
    if (!ins) { err.textContent = 'Instruksi wajib diisi.'; return; }
    const b = $('#d-simpan', m); setBusy(b, true, 'Membuat PDF & mengirim…');
    try {
      const r = await callAuth('apiSaveDisposisi', id, em, ins);
      if (!r.success) { err.textContent = r.message; setBusy(b, false); return; }
      tutupModal(m); toast(r.message, r.data && r.data.email.indexOf('gagal') >= 0 ? 'warn' : 'ok');
      await segarkan(); navigateTo(AppState.page, AppState.param, { tetap: true });
    } catch (e) { err.textContent = errMsg(e); setBusy(b, false); }
  };
}

// ════════════════════════════════════════════════════════
// BAGIAN 15 — KODE ARSIP
// ════════════════════════════════════════════════════════
const PER_KODE = 30;
async function renderKode() {
  await pastikanData(); await pastikanKode();
  const f = AppState.f.kode;
  $('#app-container').innerHTML = '<div class="flex flex-col gap-space-lg">' +
    '<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md"><div><h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary">Kode Klasifikasi Arsip</h1>' +
    '<p class="text-body-md text-text-secondary mt-0.5">Acuan: Permendagri Nomor 83 Tahun 2022 · <span class="num" id="jml-kode"></span> kode</p></div>' +
    (izin('admin') ? '<div class="flex gap-2 flex-wrap"><button class="btn btn-ghost" data-act="dialog-kode">' + ic('add') + ' Tambah kode</button><button class="btn btn-primary" data-act="dialog-impor-kode">' + ic('upload_file') + ' Impor CSV</button></div>' : '') + '</div>' +
    '<div class="card p-space-md"><label class="field-label" for="k-q">Cari kode atau uraian</label><input id="k-q" class="input" data-f="kode.q" value="' + esc(f.q) + '" placeholder="mis. 800.1 atau perjalanan dinas"></div>' +
    '<section class="card overflow-hidden" id="hasil-kode" aria-live="polite"></section></div>';
  renderHasilKode();
}
function renderHasilKode() {
  const f = AppState.f.kode, h = $('#hasil-kode'); if (!h) return;
  const q = f.q.toLowerCase().trim(); $('#jml-kode').textContent = AppState.kode.length;
  const l = q ? AppState.kode.filter(k => k.kode.indexOf(q) === 0 || (k.kode + ' ' + k.uraian).toLowerCase().indexOf(q) >= 0) : AppState.kode;
  const maks = Math.max(1, Math.ceil(l.length / PER_KODE)); if (f.page > maks) f.page = maks;
  const irisan = l.slice((f.page - 1) * PER_KODE, f.page * PER_KODE);
  h.innerHTML = !l.length ? '<div class="p-10 text-center text-text-secondary">' + (AppState.kode.length ? 'Kode tidak ditemukan.' : 'Daftar kode masih kosong. ' + (izin('admin') ? 'Gunakan Impor CSV untuk memuat daftar lengkap.' : 'Hubungi Admin.')) + '</div>' :
    '<div class="overflow-x-auto"><table class="tbl"><thead><tr><th>Kode</th><th>Uraian</th>' + (izin('admin') ? '<th class="text-right">Aksi</th>' : '') + '</tr></thead><tbody>' +
    irisan.map(k => '<tr><td class="whitespace-nowrap" style="padding-left:' + (16 + (k.kode.split('.').length - 1) * 14) + 'px"><span class="kode-badge">' + esc(k.kode) + '</span></td><td><div class="text-text-primary">' + esc(k.uraian) + '</div>' +
      (k.keterangan ? '<div class="text-body-sm text-text-muted clamp2 mt-0.5">' + esc(k.keterangan) + '</div>' : '') + '</td>' +
      (izin('admin') ? '<td class="text-right"><button class="btn-icon" data-act="dialog-kode" data-kode="' + esc(k.kode) + '" aria-label="Ubah kode ' + esc(k.kode) + '">' + ic('edit') + '</button></td>' : '') + '</tr>').join('') + '</tbody></table></div>' +
    paginasi('kode', l.length, f.page, PER_KODE);
}
function dialogKode(kode) {
  const k = kode ? AppState.kode.find(x => x.kode === kode) : null;
  const m = bukaModal({ judul: k ? 'Ubah Kode Arsip' : 'Tambah Kode Arsip',
    isi: '<form class="flex flex-col gap-4"><div><label class="field-label" for="kk-kode">Kode <span class="req">*</span></label><input id="kk-kode" class="input num" ' + (k ? 'readonly' : '') + ' value="' + esc(k ? k.kode : '') + '" placeholder="mis. 000.1.2" maxlength="30"><p class="hint">Format angka dipisah titik, kode utama 3 digit.</p></div>' +
      '<div><label class="field-label" for="kk-ur">Uraian <span class="req">*</span></label><textarea id="kk-ur" class="textarea" maxlength="300">' + esc(k ? k.uraian : '') + '</textarea></div><p id="kk-err" class="field-error min-h-[18px]" role="alert"></p></form>',
    footer: '<button class="btn btn-ghost" data-modal-close>Batal</button><button class="btn btn-primary" id="kk-simpan">' + ic('save') + ' Simpan</button>' });
  $('#kk-simpan', m).onclick = async () => {
    const b = $('#kk-simpan', m); setBusy(b, true);
    try {
      const r = await callAuth('apiSaveKode', $('#kk-kode', m).value, $('#kk-ur', m).value);
      if (!r.success) { $('#kk-err', m).textContent = r.message; setBusy(b, false); return; }
      tutupModal(m); toast(r.message, 'ok'); AppState.kode = null; await pastikanKode(); renderHasilKode();
    } catch (e) { $('#kk-err', m).textContent = errMsg(e); setBusy(b, false); }
  };
}
function dialogImporKode() {
  let teks = '';
  const opsi = (v, jud, ket, cek) => '<label class="flex items-start gap-3 p-3 rounded-lg border border-outline-variant cursor-pointer"><input type="radio" name="imp-mode" value="' + v + '"' + (cek ? ' checked' : '') + ' class="mt-1"><span><b>' + jud + '</b><br><span class="text-body-sm text-text-secondary">' + ket + '</span></span></label>';
  const m = bukaModal({ judul: 'Impor Kode Arsip (CSV)', ukuran: 'md',
    isi: '<div class="flex flex-col gap-3"><p class="text-body-md text-text-secondary">Pilih file CSV dengan kolom <b>kode, uraian, keterangan</b> (baris pertama boleh judul kolom).</p>' +
      '<input id="imp-file" type="file" accept=".csv,text/csv" class="input"><p id="imp-info" class="hint"></p>' +
      '<fieldset class="flex flex-col gap-2"><legend class="field-label">Cara impor</legend>' +
      opsi('tambah', 'Tambah / perbarui', 'Kode lama tetap ada. Kode yang sama diperbarui uraiannya, kode baru ditambahkan.', true) +
      opsi('ganti', 'Ganti seluruh daftar', 'Daftar lama dicadangkan otomatis ke sheet baru, lalu diganti seluruhnya dengan isi file. Gunakan saat beralih ke peraturan kode klasifikasi yang baru.', false) +
      '</fieldset><p id="imp-err" class="field-error min-h-[18px]" role="alert"></p></div>',
    footer: '<button class="btn btn-ghost" data-modal-close>Batal</button><button class="btn btn-primary" id="imp-go" disabled>' + ic('upload_file') + ' Impor</button>' });
  $('#imp-file', m).onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { teks = String(rd.result); $('#imp-info', m).textContent = f.name + ' · sekitar ' + Math.max(0, teks.split(/\r?\n/).length - 1) + ' baris'; $('#imp-go', m).disabled = false; };
    rd.readAsText(f, 'utf-8');
  };
  $('#imp-go', m).onclick = async () => {
    const mode = ($('input[name="imp-mode"]:checked', m) || {}).value || 'tambah';
    if (mode === 'ganti') {
      const ok = await konfirmasi('Ganti seluruh daftar kode?', 'Daftar kode yang sekarang akan diganti dengan isi file. Daftar lama tetap tersimpan sebagai cadangan di Spreadsheet. Surat yang memakai kode lama perlu disesuaikan kodenya.', 'Ya, ganti', true);
      if (!ok) return;
    }
    const b = $('#imp-go', m); setBusy(b, true, 'Mengimpor…');
    try {
      const r = await callAuth('apiImportKode', teks, mode);
      if (!r.success) { $('#imp-err', m).textContent = r.message; setBusy(b, false); return; }
      tutupModal(m); toast(r.message, 'ok'); AppState.kode = null; await pastikanKode(); renderHasilKode();
      const y = (r.data && r.data.yatim) || [];
      if (y.length) {
        bukaModal({ judul: 'Surat dengan kode lama', ukuran: 'md',
          isi: '<p class="text-body-md text-text-secondary mb-3">Kode berikut masih dipakai surat, tetapi tidak ada di daftar baru. Buka surat terkait (menu Ubah) lalu pilih kode yang baru.</p>' +
            '<ul class="divide-y divide-border-subtle">' + y.map(x => '<li class="py-2 flex items-center justify-between"><span class="kode-badge">' + esc(x.kode) + '</span><span class="text-body-md text-text-secondary">' + x.jumlah + ' surat</span></li>').join('') + '</ul>',
          footer: '<button class="btn btn-primary" data-modal-close>Mengerti</button>' });
      }
    } catch (e) { $('#imp-err', m).textContent = errMsg(e); setBusy(b, false); }
  };
}

// ════════════════════════════════════════════════════════
// BAGIAN 16 — LAPORAN & REKAP (grafik + tabel terfilter)
// ════════════════════════════════════════════════════════
async function renderLaporan() {
  await pastikanData(); await pastikanKode().catch(() => {});
  const f = AppState.f.laporan;
  $('#app-container').innerHTML = '<div class="flex flex-col gap-space-lg">' +
    '<div><h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary">Laporan &amp; Rekapitulasi</h1><p class="text-body-md text-text-secondary mt-0.5">Grafik dan tabel mengikuti filter di bawah.</p></div>' +
    '<form class="card p-space-md grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onsubmit="return false" aria-label="Filter laporan">' +
    '<div class="lg:col-span-2"><label class="field-label" for="l-q">Pencarian</label><input id="l-q" class="input" data-f="laporan.q" value="' + esc(f.q) + '" placeholder="Nomor, perihal, pengirim…"></div>' +
    '<div><label class="field-label" for="l-jenis">Jenis surat</label><select id="l-jenis" class="select" data-f="laporan.jenis">' + ['Semua', 'Masuk', 'Keluar'].map(x => '<option' + (f.jenis === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
    '<div><label class="field-label" for="l-kode">Kode arsip</label><input id="l-kode" class="input" data-f="laporan.kode" value="' + esc(f.kode) + '" placeholder="mis. 800 atau 000.1"></div>' +
    '<div><label class="field-label" for="l-status">Status disposisi</label><select id="l-status" class="select" data-f="laporan.status">' + [['Semua', 'Semua'], ['Belum', 'Belum didisposisi'], ['Sudah', 'Sudah didisposisi']].map(x => '<option value="' + x[0] + '"' + (f.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></div>' +
    '<div><label class="field-label" for="l-dari">Dari tanggal</label><input id="l-dari" type="date" class="input" data-f="laporan.dari" value="' + esc(f.dari) + '"></div>' +
    '<div><label class="field-label" for="l-sampai">Sampai tanggal</label><input id="l-sampai" type="date" class="input" data-f="laporan.sampai" value="' + esc(f.sampai) + '"></div>' +
    '<div class="sm:col-span-2 flex items-end justify-end"><button type="button" class="btn btn-ghost btn-sm" data-act="reset-filter" data-scope="laporan">' + ic('restart_alt', '!text-[18px]') + ' Atur ulang filter</button></div></form>' +
    '<div id="lap-ringkas" class="grid grid-cols-2 lg:grid-cols-4 gap-space-md"></div>' +
    '<div class="grid lg:grid-cols-12 gap-space-lg"><section class="lg:col-span-7 card p-space-lg"><h2 class="text-headline-md text-text-primary mb-3">Surat per Bulan</h2><div class="h-64"><canvas id="lap-bulan" role="img" aria-label="Grafik batang surat per bulan"></canvas></div></section>' +
    '<section class="lg:col-span-5 card p-space-lg"><h2 class="text-headline-md text-text-primary mb-3">Per Kelompok Kode Arsip</h2><div class="h-64"><canvas id="lap-kode" role="img" aria-label="Grafik donat surat per kelompok kode arsip"></canvas></div></section></div>' +
    '<section class="card overflow-hidden" id="hasil-laporan" aria-live="polite"></section></div>';
  renderLaporanHasil();
}
function renderLaporanHasil() {
  const f = AppState.f.laporan, h = $('#hasil-laporan'); if (!h) return;
  const hasil = filterSurat(AppState.data.surat, f), total = hasil.length;
  const masuk = hasil.filter(s => s.jenis_surat === 'Masuk'), keluar = hasil.filter(s => s.jenis_surat === 'Keluar'), belum = masuk.filter(s => s.status_disposisi === 'Belum').length;
  const kartu = (l, n, c) => '<div class="card p-space-md"><div class="text-label-md uppercase tracking-wider text-text-secondary">' + l + '</div><div class="text-display-lg num ' + (c || 'text-text-primary') + '">' + n + '</div></div>';
  $('#lap-ringkas').innerHTML = kartu('Total surat', total) + kartu('Surat masuk', masuk.length) + kartu('Surat keluar', keluar.length) + kartu('Belum didisposisi', belum, belum ? 'text-status-warning-text' : '');
  // rentang bulan grafik
  const akhir = f.sampai ? new Date(f.sampai + 'T00:00:00') : new Date(), awal = f.dari ? new Date(f.dari + 'T00:00:00') : new Date(akhir.getFullYear(), akhir.getMonth() - 11, 1);
  const n = Math.min(24, Math.max(1, (akhir.getFullYear() - awal.getFullYear()) * 12 + akhir.getMonth() - awal.getMonth() + 1));
  const bul = hitungBulanan(hasil, n, akhir), kel = hitungKelompok(hasil);
  const gambar = () => { gambarBar('lap-bulan', bul.lab, bul.a, bul.b); gambarDonat('lap-kode', kel.map(k => k.kode + ' ' + k.nama), kel.map(k => k.n)); };
  gambar(); AppState.chartRedraw = gambar;
  const maks = Math.max(1, Math.ceil(total / PER_HALAMAN)); if (f.page > maks) f.page = maks;
  h.innerHTML = '<div class="px-4 py-3 border-b border-border-subtle text-body-sm text-text-secondary">' + total + ' surat sesuai filter</div>' +
    daftarSuratHtml(hasil.slice((f.page - 1) * PER_HALAMAN, f.page * PER_HALAMAN)) + paginasi('laporan', total, f.page);
}

// ════════════════════════════════════════════════════════
// BAGIAN 17 — PENGGUNA & PIN
// ════════════════════════════════════════════════════════
async function renderPengguna() {
  await pastikanData();
  const r = await callAuth('apiListUsers'); if (!r.success) throw new Error(r.message);
  const l = r.data, chipP = p => '<span class="chip ' + (p === 'ADMIN' ? 'chip-bad' : p === 'PIMPINAN' ? 'chip-warn' : 'chip-info') + '">' + esc(p) + '</span>';
  $('#app-container').innerHTML = '<div class="flex flex-col gap-space-lg">' +
    '<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md"><div><h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary">Pengguna &amp; Hak Akses</h1>' +
    '<p class="text-body-md text-text-secondary mt-0.5">Kelola akun, peran, dan PIN pegawai.</p></div><button class="btn btn-primary" data-act="dialog-user">' + ic('person_add') + ' Tambah pengguna</button></div>' +
    '<section class="card overflow-hidden"><div class="overflow-x-auto"><table class="tbl"><thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Status</th><th class="text-right">Aksi</th></tr></thead><tbody>' +
    l.map(u => '<tr><td><div class="text-label-lg text-text-primary">' + esc(u.nama) + '</div><div class="text-body-sm text-text-secondary">' + esc(u.jabatan) + '</div></td><td class="break-all">' + esc(u.email) + '</td><td>' + chipP(u.peran) + '</td>' +
      '<td>' + (u.status_aktif === 'Aktif' ? '<span class="chip chip-ok">Aktif</span>' : '<span class="chip chip-bad">Nonaktif</span>') + '</td>' +
      '<td><div class="flex justify-end gap-1"><button class="btn-icon" data-act="dialog-user" data-email="' + esc(u.email) + '" aria-label="Ubah ' + esc(u.nama) + '">' + ic('edit') + '</button>' +
      '<button class="btn-icon" data-act="reset-pin" data-email="' + esc(u.email) + '" aria-label="Atur ulang PIN ' + esc(u.nama) + '" title="Atur ulang PIN">' + ic('lock_reset') + '</button></div></td></tr>').join('') + '</tbody></table></div></section>' +
    '<div class="card p-space-md text-body-sm text-text-secondary"><b class="text-text-primary">Hak akses:</b> Admin mencatat, mengubah, dan menghapus surat · Pimpinan memberi disposisi, mengubah/menghapus surat, serta mengelola pengguna &amp; hak akses · Staf melihat dan mengunduh.</div></div>';
  AppState._users = l;
}
function tampilPin(judul, pin, nama) {
  bukaModal({ judul: judul, isi: '<div class="text-center"><p class="text-body-md text-text-secondary">PIN untuk <b>' + esc(nama) + '</b>. Catat dan sampaikan secara aman. PIN ini <b>hanya tampil sekali</b>.</p>' +
    '<div class="my-4 py-4 rounded-lg bg-surface-container-low num text-display-lg tracking-[0.3em] select-all text-primary-container" style="font-family:ui-monospace,monospace">' + esc(pin) + '</div>' +
    '<p class="hint">Pengguna dapat menggantinya sendiri lewat menu profil → Ganti PIN.</p></div>', footer: '<button class="btn btn-primary" data-modal-close autofocus>Sudah dicatat</button>' });
}
function dialogUser(email) {
  const u = email ? (AppState._users || []).find(x => x.email === email) : null;
  const m = bukaModal({ judul: u ? 'Ubah Pengguna' : 'Tambah Pengguna',
    isi: '<form class="flex flex-col gap-4"><div><label class="field-label" for="u-email">Email <span class="req">*</span></label><input id="u-email" class="input" type="email" ' + (u ? 'readonly' : '') + ' value="' + esc(u ? u.email : '') + '" placeholder="nama@instansi.go.id"></div>' +
      '<div><label class="field-label" for="u-nama">Nama <span class="req">*</span></label><input id="u-nama" class="input" maxlength="100" value="' + esc(u ? u.nama : '') + '"></div>' +
      '<div><label class="field-label" for="u-jab">Jabatan</label><input id="u-jab" class="input" maxlength="100" value="' + esc(u ? u.jabatan : '') + '"></div>' +
      '<div class="grid grid-cols-2 gap-3"><div><label class="field-label" for="u-peran">Peran</label><select id="u-peran" class="select">' + ['STAF', 'PIMPINAN', 'ADMIN'].map(p => '<option value="' + p + '"' + (u && u.peran === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' +
      '<div><label class="field-label" for="u-stat">Status</label><select id="u-stat" class="select">' + ['Aktif', 'Nonaktif'].map(p => '<option' + (u && u.status_aktif === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div></div>' +
      (u ? '' : '<p class="hint">PIN awal dibuat otomatis dan ditampilkan sekali setelah disimpan.</p>') + '<p id="u-err" class="field-error min-h-[18px]" role="alert"></p></form>',
    footer: '<button class="btn btn-ghost" data-modal-close>Batal</button><button class="btn btn-primary" id="u-simpan">' + ic('save') + ' Simpan</button>' });
  $('#u-simpan', m).onclick = async () => {
    const b = $('#u-simpan', m); setBusy(b, true);
    try {
      const r = await callAuth('apiSaveUser', { email: $('#u-email', m).value, nama: $('#u-nama', m).value, jabatan: $('#u-jab', m).value, peran: $('#u-peran', m).value, status_aktif: $('#u-stat', m).value });
      if (!r.success) { $('#u-err', m).textContent = r.message; setBusy(b, false); return; }
      const nama = $('#u-nama', m).value; tutupModal(m); toast(r.message, 'ok');
      await segarkan(); await renderPengguna(); if (r.data && r.data.pin) tampilPin('PIN Awal Pengguna', r.data.pin, nama);
    } catch (e) { $('#u-err', m).textContent = errMsg(e); setBusy(b, false); }
  };
}
async function resetPin(email) {
  const u = (AppState._users || []).find(x => x.email === email); if (!u) return;
  if (!(await konfirmasi('Atur ulang PIN?', 'PIN lama <b>' + esc(u.nama) + '</b> tidak berlaku lagi. PIN baru dibuat otomatis.', 'Ya, atur ulang'))) return;
  try { const r = await callAuth('apiResetPin', email); if (!r.success) { toast(r.message, 'bad'); return; } tampilPin('PIN Baru', r.data.pin, u.nama); } catch (e) { toast(errMsg(e), 'bad'); }
}
function dialogGantiPin() {
  const m = bukaModal({ judul: 'Ganti PIN',
    isi: '<form class="flex flex-col gap-4"><div><label class="field-label" for="p-lama">PIN lama</label><input id="p-lama" class="input" type="password" autocomplete="current-password"></div>' +
      '<div><label class="field-label" for="p-baru">PIN baru (6–12 angka)</label><input id="p-baru" class="input" type="password" inputmode="numeric" autocomplete="new-password"></div>' +
      '<div><label class="field-label" for="p-ulang">Ulangi PIN baru</label><input id="p-ulang" class="input" type="password" inputmode="numeric" autocomplete="new-password"></div><p id="p-err" class="field-error min-h-[18px]" role="alert"></p></form>',
    footer: '<button class="btn btn-ghost" data-modal-close>Batal</button><button class="btn btn-primary" id="p-simpan">' + ic('key') + ' Simpan PIN</button>' });
  $('#p-simpan', m).onclick = async () => {
    const lama = $('#p-lama', m).value, baru = $('#p-baru', m).value, err = $('#p-err', m);
    if (!/^\d{6,12}$/.test(baru)) { err.textContent = 'PIN baru harus 6–12 angka.'; return; }
    if (baru !== $('#p-ulang', m).value) { err.textContent = 'Pengulangan PIN tidak sama.'; return; }
    const b = $('#p-simpan', m); setBusy(b, true);
    try { const r = await callAuth('apiGantiPin', lama, baru); if (!r.success) { err.textContent = r.message; setBusy(b, false); return; } tutupModal(m); toast(r.message, 'ok'); }
    catch (e) { err.textContent = errMsg(e); setBusy(b, false); }
  };
}

// ════════════════════════════════════════════════════════
// BAGIAN 18 — PENGATURAN (Admin)
// ════════════════════════════════════════════════════════
async function renderPengaturan() {
  await pastikanData();
  const [rs, rl] = await Promise.all([callAuth('apiGetSettings'), callAuth('apiListLog')]);
  if (!rs.success) throw new Error(rs.message);
  const c = rs.data, log = rl.success ? rl.data : [];
  const fld = (id, label, val, ph, maks) => '<div><label class="field-label" for="' + id + '">' + label + '</label><input id="' + id + '" class="input" maxlength="' + maks + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"></div>';
  $('#app-container').innerHTML = '<div class="max-w-3xl mx-auto flex flex-col gap-space-lg">' +
    '<div><h1 class="text-headline-lg-mobile md:text-headline-lg text-text-primary">Pengaturan</h1><p class="text-body-md text-text-secondary mt-0.5">Identitas aplikasi dan kop lembar disposisi.</p></div>' +
    '<section class="card p-space-lg flex flex-col gap-4"><h2 class="text-headline-md text-text-primary">Identitas &amp; Kop Surat</h2>' +
    fld('s-app', 'Nama aplikasi', c.nama_aplikasi, '', 80) + fld('s-inst', 'Nama instansi (kop disposisi)', c.nama_instansi, 'PEMERINTAH KABUPATEN …', 120) +
    fld('s-unit', 'Nama unit kerja', c.nama_unit, 'Sekretariat …', 120) + fld('s-alamat', 'Alamat (kop disposisi)', c.alamat_kop, 'Jl. … Telp. …', 250) +
    fld('s-logo', 'URL logo (https, opsional)', c.logo_url, 'https://…', 500) +
    fld('s-url', 'URL aplikasi / alamat GitHub Pages (untuk tautan di email)', c.url_aplikasi, 'https://username.github.io/e-arsip-frontend/', 500) +
    '<div class="flex justify-end"><button class="btn btn-primary" data-act="simpan-pengaturan">' + ic('save') + ' Simpan pengaturan</button></div></section>' +
    '<section class="card p-space-lg"><h2 class="text-headline-md text-text-primary mb-2">Penyimpanan</h2><dl class="text-body-md grid gap-2">' +
    '<div><dt class="text-label-md text-text-secondary uppercase">Folder Google Drive</dt><dd class="break-all select-all">' + esc(c.folder_url) + '</dd></div>' +
    '<div><dt class="text-label-md text-text-secondary uppercase">Database (Spreadsheet)</dt><dd class="break-all select-all">' + esc(c.spreadsheet_url) + '</dd></div></dl>' +
    '<p class="hint">Salin tautan ke tab baru browser untuk membukanya. Berkas surat hanya dapat dibuka lewat aplikasi ini.</p></section>' +
    '<section class="card overflow-hidden"><div class="p-space-lg pb-2"><h2 class="text-headline-md text-text-primary">Log Aktivitas Terbaru</h2><p class="text-body-sm text-text-secondary">100 aktivitas terakhir</p></div>' +
    '<div class="overflow-x-auto max-h-96 overflow-y-auto"><table class="tbl"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Surat</th><th>Keterangan</th></tr></thead><tbody>' +
    (log.length ? log.map(x => '<tr><td class="whitespace-nowrap num">' + fmtWaktu(x.waktu) + '</td><td class="break-all">' + esc(x.pengguna) + '</td><td><span class="kode-badge">' + esc(x.aksi) + '</span></td><td class="num">' + esc(x.id_surat) + '</td><td>' + esc(x.keterangan) + '</td></tr>').join('') : '<tr><td colspan="5" class="text-center text-text-muted">Belum ada aktivitas.</td></tr>') +
    '</tbody></table></div></section></div>';
}
async function simpanPengaturan(btn) {
  setBusy(btn, true);
  try {
    const r = await callAuth('apiSaveSettings', { nama_aplikasi: $('#s-app').value, nama_instansi: $('#s-inst').value, nama_unit: $('#s-unit').value, alamat_kop: $('#s-alamat').value, logo_url: $('#s-logo').value, url_aplikasi: $('#s-url').value });
    setBusy(btn, false);
    if (!r.success) { toast(r.message, 'bad'); return; }
    AppState.data.pengaturan = Object.assign(AppState.data.pengaturan, r.data); terapkanIdentitas(); toast(r.message, 'ok');
  } catch (e) { setBusy(btn, false); toast(errMsg(e), 'bad'); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 19 — INISIALISASI
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const ov = $('#loadingOverlay');
  const selesai = () => { if (ov) { ov.style.opacity = '0'; setTimeout(() => { ov.style.display = 'none'; }, 300); } };
  if (!GAS_URL || /ISI_URL/.test(GAS_URL)) { selesai(); tampilLogin('GAS_URL belum diisi. Edit file js/config.js lalu push ulang ke GitHub.'); return; }
  const t = bacaToken();
  if (!t) { selesai(); tampilLogin(); return; }
  try {
    const r = await call('apiResume', t);
    if (r.success) { AppState.token = t; AppState.user = r.data.user; selesai(); await masukAplikasi(); }
    else { simpanToken(null); selesai(); tampilLogin(); }
  } catch (e) { selesai(); tampilLogin(); }
});
