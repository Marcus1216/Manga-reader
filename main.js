'use strict';

// ─── PDF.js ───────────────────────────────────────────────────────────────────
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './pdf.min.js'; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';
  _pdfjs = window.pdfjsLib;
  return _pdfjs;
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open('MangaReaderDB', 1);
    req.onupgradeneeded = ({ target: { result: db } }) => {
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = ({ target: { result } }) => { _db = result; res(_db); };
    req.onerror   = e => rej(e.target.error);
  });
}
const op = req => new Promise((res, rej) => { req.onsuccess = e => res(e.target.result); req.onerror = e => rej(e.target.error); });
const tx = (store, mode = 'readonly') => _db.transaction(store, mode).objectStore(store);

async function getBooks()          { await openDB(); return op(tx('books').getAll()); }
async function saveBook(book)      { await openDB(); return op(tx('books','readwrite').put(book)); }
async function deleteBookMeta(id)  { await openDB(); return op(tx('books','readwrite').delete(id)); }
async function saveFile(key, blob) { await openDB(); return op(tx('files','readwrite').put(blob, key)); }
async function getFile(key)        { await openDB(); return op(tx('files').get(key)); }
async function deleteFiles(keys)   {
  await openDB();
  const t = _db.transaction('files', 'readwrite'), s = t.objectStore('files');
  keys.forEach(k => s.delete(k));
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = e => rej(e.target.error); });
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentBook = null;
let mode = localStorage.getItem('readingMode') || 'vertical';
let blobURLs = [];

// ─── UI helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showLoading(msg = 'Processing…', sub = '') {
  $('loading-text').textContent = msg;
  $('loading-sub').textContent = sub;
  $('loading').style.display = 'flex';
}
function updateLoading(msg, sub) {
  if (msg !== undefined) $('loading-text').textContent = msg;
  if (sub !== undefined) $('loading-sub').textContent = sub;
}
function hideLoading() { $('loading').style.display = 'none'; }

function showAlert(msg) {
  return new Promise(res => {
    $('alert-message').textContent = msg;
    $('alert-modal').style.display = 'flex';
    $('alert-ok-btn').onclick = () => { $('alert-modal').style.display = 'none'; res(); };
  });
}

function showConfirm(title, msg) {
  return new Promise(res => {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = msg;
    $('confirm-modal').style.display = 'flex';
    $('confirm-yes-btn').onclick = () => { $('confirm-modal').style.display = 'none'; res(true); };
    $('confirm-no-btn').onclick  = () => { $('confirm-modal').style.display = 'none'; res(false); };
  });
}

function showAddModal()  { $('add-modal').style.display = 'flex'; }
function closeAddModal() { $('add-modal').style.display = 'none'; }

function toggleSettings() {
  const m = $('settings-modal');
  m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}

document.addEventListener('click', e => {
  const modal = $('settings-modal');
  if (modal.style.display === 'flex' && !modal.contains(e.target) && e.target.id !== 'settings-btn')
    modal.style.display = 'none';
});

// ─── Library ──────────────────────────────────────────────────────────────────
async function loadLibrary() {
  const books = await getBooks();
  const list  = $('book-list');
  const empty = $('empty-msg');
  list.innerHTML = '';

  if (!books.length) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  books.sort((a, b) => b.id - a.id).forEach(renderBookCard);
}

function renderBookCard(book) {
  const item = document.createElement('div');
  item.className = 'book-item';

  const saved = localStorage.getItem(`prog-${book.id}`);
  const badge = saved
    ? `<div class="book-progress">${JSON.parse(saved).p + 1}/${book.totalPages}</div>`
    : '';

  item.innerHTML = `
    ${badge}
    <img class="cover-image" src="${book.thumbnail || ''}" alt="" loading="lazy">
    <div class="book-title">${book.name}</div>
  `;

  item.addEventListener('click', () => openBook(book));

  let pressTimer;
  item.addEventListener('pointerdown',  () => { pressTimer = setTimeout(() => showContextMenu(book), 500); });
  item.addEventListener('pointerup',    () => clearTimeout(pressTimer));
  item.addEventListener('pointermove',  () => clearTimeout(pressTimer));
  item.addEventListener('contextmenu',  e  => { e.preventDefault(); showContextMenu(book); });

  $('book-list').appendChild(item);
}

// ─── Context menu ─────────────────────────────────────────────────────────────
function showContextMenu(book) {
  $('context-book-name').textContent = book.name;
  $('context-modal').style.display = 'flex';

  $('context-rename-btn').onclick = () => {
    $('context-modal').style.display = 'none';
    showRenameModal(book);
  };
  $('context-delete-btn').onclick = () => {
    $('context-modal').style.display = 'none';
    confirmDelete(book);
  };
  $('context-cancel-btn').onclick = () => {
    $('context-modal').style.display = 'none';
  };
}

function showRenameModal(book) {
  $('rename-input').value = book.name;
  $('rename-modal').style.display = 'flex';
  setTimeout(() => $('rename-input').focus(), 100);

  $('rename-save-btn').onclick = async () => {
    const newName = $('rename-input').value.trim();
    if (!newName) return;
    book.name = newName;
    await saveBook(book);
    $('rename-modal').style.display = 'none';
    loadLibrary();
  };
  $('rename-cancel-btn').onclick = () => { $('rename-modal').style.display = 'none'; };
}

async function confirmDelete(book) {
  const ok = await showConfirm('Delete Book', `Delete "${book.name}"? This cannot be undone.`);
  if (!ok) return;
  showLoading('Deleting…');
  const keys = book.type === 'pdf' ? [book.mainFile] : (book.pages || []);
  if (book.thumbnail) keys.push(`thumb-${book.id}`);
  await deleteFiles(keys);
  await deleteBookMeta(book.id);
  localStorage.removeItem(`prog-${book.id}`);
  hideLoading();
  loadLibrary();
}

// ─── Import ───────────────────────────────────────────────────────────────────
function triggerPDFImport()   { closeAddModal(); $('pdf-input').click(); }
function triggerImageImport() { closeAddModal(); $('image-input').click(); }

$('pdf-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await importPDF(file);
});

$('image-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (files.length) await importImages(files);
});

async function importPDF(file) {
  showLoading('Reading PDF…');
  try {
    const ts  = Date.now();
    const key = `pdf-${ts}`;
    await saveFile(key, file);

    const lib     = await getPdfjs();
    const buf     = await file.arrayBuffer();
    const pdfDoc  = await lib.getDocument({ data: buf }).promise;
    const total   = pdfDoc.numPages;
    const thumb   = await thumbFromPDF(pdfDoc);
    await pdfDoc.destroy();

    await saveBook({ id: ts, name: file.name.replace(/\.pdf$/i, ''), type: 'pdf', totalPages: total, thumbnail: thumb, mainFile: key });
    await loadLibrary();
  } catch (err) {
    await showAlert('Import failed: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function importImages(files) {
  const images = files
    .filter(f => /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  if (!images.length) { await showAlert('No supported images found.'); return; }

  if (images.length > 200) {
    const ok = await showConfirm('Large Import', `Importing ${images.length} images may take a while. Continue?`);
    if (!ok) return;
  }

  const ts = Date.now();
  showLoading(`Saving 0 / ${images.length}…`);
  const pages = [];

  try {
    for (let i = 0; i < images.length; i++) {
      const f   = images[i];
      const ext = f.name.split('.').pop().toLowerCase();
      const key = `img-${ts}-${String(i).padStart(5,'0')}.${ext}`;
      await saveFile(key, f);
      pages.push(key);
      if (i % 20 === 0) updateLoading(`Saving ${i + 1} / ${images.length}…`);
    }

    const thumb = await thumbFromImage(images[0]);
    const name  = images[0].name.replace(/[-_.\s]*\d+\.\w+$/, '') || 'Image Series';

    await saveBook({ id: ts, name, type: 'image-series', totalPages: pages.length, thumbnail: thumb, pages });
    await loadLibrary();
  } catch (err) {
    await showAlert('Import failed: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function thumbFromPDF(pdfDoc) {
  const page     = await pdfDoc.getPage(1);
  const vp       = page.getViewport({ scale: 200 / page.getViewport({ scale: 1 }).width });
  const canvas   = document.createElement('canvas');
  canvas.width   = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return canvas.toDataURL('image/jpeg', 0.8);
}

function thumbFromImage(file) {
  return new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const scale  = Math.min(200 / img.width, 300 / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width  = img.width  * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      res(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(''); };
    img.src = url;
  });
}

// ─── Reader ───────────────────────────────────────────────────────────────────
async function openBook(book) {
  currentBook = book;
  applyMode(mode);

  $('header-title').textContent = book.name;
  $('back-btn').style.display   = 'block';
  $('settings-btn').style.display = 'block';
  $('add-btn').style.display    = 'none';
  $('library-view').style.display = 'none';
  $('reader-view').style.display  = 'block';

  showLoading('Opening…');
  try {
    book.type === 'pdf' ? await renderPDF(book) : await renderImages(book);
  } finally {
    hideLoading();
  }

  updateModeButtons();
  setupPageJumper();

  const saved = localStorage.getItem(`prog-${book.id}`);
  if (saved) setTimeout(() => jumpToPage(JSON.parse(saved).p), 120);
}

function closeReader() {
  blobURLs.forEach(u => URL.revokeObjectURL(u));
  blobURLs = [];
  $('viewer-container').innerHTML = '';
  $('reader-view').style.display  = 'none';
  $('library-view').style.display = 'block';
  $('header-title').textContent   = 'My Library';
  $('back-btn').style.display     = 'none';
  $('settings-btn').style.display = 'none';
  $('add-btn').style.display      = 'block';
  $('page-jumper').style.display  = 'none';
  $('settings-modal').style.display = 'none';
  currentBook = null;
}

// ── PDF rendering ─────────────────────────────────────────────────────────────
async function renderPDF(book) {
  const lib   = await getPdfjs();
  const blob  = await getFile(book.mainFile);
  const buf   = await blob.arrayBuffer();
  const doc   = await lib.getDocument({ data: buf }).promise;
  const container = $('viewer-container');
  container.innerHTML = '';

  for (let i = 1; i <= doc.numPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'placeholder';
    const badge = document.createElement('div');
    badge.className = 'page-num-indicator';
    badge.textContent = `${i} / ${doc.numPages}`;
    wrap.appendChild(badge);
    container.appendChild(wrap);
  }

  // Lazy-render pages with IntersectionObserver
  const renders = new Set();
  const obs = new IntersectionObserver(entries => {
    entries.forEach(async entry => {
      if (!entry.isIntersecting) return;
      const wrap = entry.target;
      const idx  = parseInt(wrap.dataset.page);
      if (renders.has(idx)) return;
      renders.add(idx);
      obs.unobserve(wrap);

      const page     = await doc.getPage(idx);
      const vp       = page.getViewport({ scale: window.devicePixelRatio * (window.innerWidth / page.getViewport({ scale: 1 }).width) });
      const canvas   = document.createElement('canvas');
      canvas.width   = vp.width; canvas.height = vp.height;
      canvas.style.width  = '100%'; canvas.style.height = 'auto';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      wrap.innerHTML = '';
      wrap.appendChild(canvas);
      const b2 = document.createElement('div');
      b2.className = 'page-num-indicator'; b2.textContent = `${idx} / ${doc.numPages}`;
      wrap.appendChild(b2);
      saveProgress(idx - 1);
    });
  }, { rootMargin: '200px' });

  Array.from(container.children).forEach((wrap, i) => {
    wrap.dataset.page = i + 1;
    obs.observe(wrap);
  });
}

// ── Image rendering ───────────────────────────────────────────────────────────
async function renderImages(book) {
  const container = $('viewer-container');
  container.innerHTML = '';

  for (let i = 0; i < book.pages.length; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'placeholder';
    wrap.dataset.idx = i;
    const badge = document.createElement('div');
    badge.className = 'page-num-indicator';
    badge.textContent = `${i + 1} / ${book.pages.length}`;
    wrap.appendChild(badge);
    container.appendChild(wrap);
  }

  const loaded = new Set();
  const obs = new IntersectionObserver(entries => {
    entries.forEach(async entry => {
      if (!entry.isIntersecting) return;
      const wrap = entry.target;
      const idx  = parseInt(wrap.dataset.idx);
      if (loaded.has(idx)) return;
      loaded.add(idx);
      obs.unobserve(wrap);

      const blob = await getFile(book.pages[idx]);
      const url  = URL.createObjectURL(blob);
      blobURLs.push(url);

      const img  = document.createElement('img');
      img.src    = url;
      img.alt    = '';
      wrap.innerHTML = '';
      wrap.appendChild(img);
      const badge2 = document.createElement('div');
      badge2.className = 'page-num-indicator';
      badge2.textContent = `${idx + 1} / ${book.pages.length}`;
      wrap.appendChild(badge2);
      saveProgress(idx);
    });
  }, { rootMargin: '300px' });

  Array.from(container.children).forEach(wrap => obs.observe(wrap));
}

// ─── Progress tracking ────────────────────────────────────────────────────────
function saveProgress(pageIndex) {
  if (currentBook) localStorage.setItem(`prog-${currentBook.id}`, JSON.stringify({ p: pageIndex }));
}

// ─── Page jumper ─────────────────────────────────────────────────────────────
function setupPageJumper() {
  if (!currentBook) return;
  const total = currentBook.totalPages;
  const jumper = $('page-jumper');
  const slider = $('page-slider');
  slider.max   = total;
  slider.value = 1;
  $('jumper-label').textContent = `Page 1 / ${total}`;
  jumper.style.display = 'flex';

  slider.oninput = () => {
    const p = parseInt(slider.value) - 1;
    $('jumper-label').textContent = `Page ${p + 1} / ${total}`;
    jumpToPage(p);
  };
}

function jumpToPage(idx) {
  const container  = $('viewer-container');
  const placeholders = container.children;
  if (!placeholders[idx]) return;
  placeholders[idx].scrollIntoView({ behavior: 'instant', block: 'start' });
  const slider = $('page-slider');
  slider.value = idx + 1;
  $('jumper-label').textContent = `Page ${idx + 1} / ${currentBook.totalPages}`;
}

// ─── Reading modes ────────────────────────────────────────────────────────────
function changeMode(newMode) {
  mode = newMode;
  localStorage.setItem('readingMode', mode);
  applyMode(mode);
  updateModeButtons();
  $('settings-modal').style.display = 'none';
  if (currentBook) {
    const saved = localStorage.getItem(`prog-${currentBook.id}`);
    if (saved) setTimeout(() => jumpToPage(JSON.parse(saved).p), 60);
  }
}

function applyMode(m) {
  const rv = $('reader-view');
  rv.className = '';
  if (m === 'vertical') {
    rv.classList.add('vertical');
  } else {
    rv.classList.add('horizontal');
    if (m === 'rtl') rv.classList.add('rtl');
  }
}

function updateModeButtons() {
  ['vertical','rtl','ltr'].forEach(m => {
    $(`mode-btn-${m}`).classList.toggle('active', m === mode);
  });
}

// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ─── Init ─────────────────────────────────────────────────────────────────────
updateModeButtons();
loadLibrary();
