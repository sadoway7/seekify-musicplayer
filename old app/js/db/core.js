/* ── sql.js bootstrap, open/save, low-level query helpers ───── */

const DBCore = (() => {
  let db = null;
  let saveTimer = null;
  let dirty = false;          // true if unsaved writes exist
  let saveInProgress = false;  // guard against concurrent saves
  let beaconSent = false;      // prevent double sendBeacon on visibilitychange + beforeunload

  const WASM_URL = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.wasm';

  async function _loadSqlJs() {
    if (!window.initSqlJs) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load sql.js. Check your internet connection.'));
        document.head.appendChild(s);
      });
    }
    return await initSqlJs({ locateFile: () => WASM_URL });
  }

  function q(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function r(sql, params) {
    db.run(sql, params || []);
    dirty = true;
    _scheduleSave();
  }

  function touch() {
    r("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastUpdated', ?)", [new Date().toISOString()]);
  }

  async function open() {
    const SQL = await _loadSqlJs();
    const resp = await fetch('/data');
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > 0) {
      db = new SQL.Database(new Uint8Array(buffer));
    } else {
      db = new SQL.Database();
    }
    try { q('SELECT COUNT(*) AS cnt FROM sqlite_master'); }
    catch (e) { db = new SQL.Database(); }
    DBSchema.ensureTables();
    // Seed data only via Reset Data button, not auto on empty DB
    // No initial save — disk already has this data, or seedData() marked dirty
    if (dirty) _scheduleSave();
  }

  function _scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(_doSave, 500);  // 500ms debounce
  }

  async function _doSave() {
    if (!db || saveInProgress) return;
    saveInProgress = true;
    saveTimer = null;
    const data = db.export();
    try {
      _showSaveStatus('saving');
      const resp = await fetch('/data', { method: 'POST', body: data, headers: { 'Content-Type': 'application/x-sqlite3' } });
      if (resp.ok) { dirty = false; _showSaveStatus('saved'); }
      else { console.error('Save failed:', resp.status); _showSaveStatus('error'); }
    } catch (e) { console.error('Save failed:', e); _showSaveStatus('error'); }
    finally { saveInProgress = false; }
  }

  async function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await _doSave();
  }

  function scheduleSave() { _scheduleSave(); }

  function isDirty() { return dirty; }

  /* ── crash-proofing: save on page hide / unload ──────────── */

  function _crashSave() {
    if (!db || beaconSent) return;
    try {
      const data = db.export();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/data', false); // synchronous
      xhr.setRequestHeader('Content-Type', 'application/x-sqlite3');
      xhr.send(data);
      dirty = false;
      beaconSent = true;
    } catch (e) {
      // Fallback to sendBeacon if sync XHR fails
      try {
        const data = db.export();
        navigator.sendBeacon('/data', new Blob([data], { type: 'application/x-sqlite3' }));
        dirty = false;
        beaconSent = true;
      } catch (e2) { console.error('Crash save failed:', e2); }
    }
  }

  // modern browsers — fires on tab close, navigate away, minimize
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) _crashSave();
  });

  // fallback for browsers that don't fire visibilitychange on close
  window.addEventListener('beforeunload', () => {
    if (dirty) _crashSave();
  });

  function _showSaveStatus(status) {
    const el = document.getElementById('save-status');
    if (!el) return;
    if (status === 'saving') { el.textContent = 'Saving\u2026'; el.className = 'save-status saving'; }
    else if (status === 'saved') {
      el.textContent = 'Saved'; el.className = 'save-status saved';
      setTimeout(() => { if (el.textContent === 'Saved') { el.textContent = ''; el.className = 'save-status'; } }, 2000);
    }
    else if (status === 'error') { el.textContent = 'Save failed'; el.className = 'save-status error'; }
  }

  function isReady() { return !!db; }

  function getLastUpdated() {
    const rows = q("SELECT value FROM meta WHERE key = 'lastUpdated'");
    return rows.length ? rows[0].value : null;
  }

  function getMeta(key) {
    const rows = q("SELECT value FROM meta WHERE key = ?", [key]);
    return rows.length ? rows[0].value : null;
  }

  function setMeta(key, value) {
    r("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value]);
  }

  function exportDB() {
    return db ? db.export() : null;
  }

  return { q, r, touch, open, saveNow, scheduleSave, isReady, getLastUpdated, isDirty,
           getMeta, setMeta, exportDB };
})();
