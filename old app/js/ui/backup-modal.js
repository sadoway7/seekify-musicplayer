/* ── backup modal — list, create, restore, download, delete + auto-backup scheduler */

const UIBackup = (() => {

  const AUTO_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
  let autoTimer = null;

  /* ── auto-backup scheduler ──────────────────────────────────── */

  function initAutoBackup() {
    _scheduleNext();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') _scheduleNext();
    });
  }

  function _scheduleNext() {
    if (autoTimer) clearTimeout(autoTimer);
    const last = DB.getMeta('lastBackupDate');
    let delay;
    if (!last) {
      // Never backed up — if there's data, backup soon; otherwise wait
      delay = DB.getItemCount() > 0 ? 5000 : AUTO_INTERVAL_MS;
    } else {
      const elapsed = Date.now() - new Date(last).getTime();
      delay = Math.max(0, AUTO_INTERVAL_MS - elapsed);
    }
    autoTimer = setTimeout(_doAutoBackup, delay);
  }

  async function _doAutoBackup() {
    autoTimer = null;
    try {
      await DB.saveNow();
      const resp = await fetch('/backup', { method: 'POST' });
      if (resp.ok) {
        DB.setMeta('lastBackupDate', new Date().toISOString());
        console.log('[auto-backup] Backup created');
      }
    } catch (e) {
      console.error('[auto-backup] Failed:', e);
    }
    _scheduleNext();
  }

  /* ── modal UI ───────────────────────────────────────────────── */

  async function show() {
    App._closeSettings();
    const overlay = document.getElementById('backup-overlay');
    const content = document.getElementById('backup-content');
    overlay.classList.add('active');
    content.innerHTML = `
      <div class="modal-header-bar">
        <span class="modal-title-sm">Backups</span>
        <button class="btn btn-sm btn-ghost" onclick="UIBackup.close()">&times;</button>
      </div>
      <div class="backup-status" id="backup-status-text">Loading...</div>
      <div class="backup-toolbar">
        <button class="btn btn-primary" onclick="UIBackup.createBackup()">Create Backup Now</button>
        <button class="btn" onclick="UIBackup.uploadBackup()">Upload Backup</button>
        <input type="file" id="backup-upload-input" accept=".db" style="display:none" onchange="UIBackup._handleUpload(this)" />
      </div>
      <div class="backup-list" id="backup-list">Loading backups...</div>
    `;
    await _refreshList();
  }

  function close() {
    document.getElementById('backup-overlay').classList.remove('active');
  }

  async function _refreshList() {
    // Update status line
    const statusEl = document.getElementById('backup-status-text');
    const lastStr = DB.getMeta('lastBackupDate');
    if (statusEl) {
      if (!lastStr) {
        statusEl.textContent = 'No automatic backup yet · Auto-backup every 2 days';
        statusEl.className = 'backup-status backup-status-warn';
      } else {
        const ago = _timeAgo(new Date(lastStr));
        const overdue = Date.now() - new Date(lastStr).getTime() > AUTO_INTERVAL_MS;
        statusEl.textContent = `Last auto-backup: ${ago} · Auto-backup every 2 days`;
        statusEl.className = overdue ? 'backup-status backup-status-warn' : 'backup-status';
      }
    }

    // Fetch backup list
    const listEl = document.getElementById('backup-list');
    if (!listEl) return;
    try {
      const resp = await fetch('/backup');
      if (!resp.ok) throw new Error('Fetch failed');
      const backups = await resp.json();
      if (!backups || !backups.length) {
        listEl.innerHTML = '<div class="backup-empty">No backups yet. Click "Create Backup Now" to make your first backup.</div>';
        return;
      }
      listEl.innerHTML = backups.map((b, i) => `
        <div class="backup-item" id="backup-item-${i}">
          <div class="backup-item-info">
            <div class="backup-item-name">${_esc(b.filename)}</div>
            <div class="backup-item-meta">${_formatDate(b.modified)} · ${_formatSize(b.size)}</div>
          </div>
          <div class="backup-item-actions">
            <button class="btn btn-sm" onclick="UIBackup.downloadBackup('${_escAttr(b.filename)}')" title="Download">Download</button>
            <button class="btn btn-sm" onclick="UIBackup._showRestore(${i}, '${_escAttr(b.filename)}')" title="Restore">Restore</button>
            <button class="btn btn-sm btn-ghost" onclick="UIBackup.deleteBackup('${_escAttr(b.filename)}')" title="Delete">&times;</button>
          </div>
          <div class="backup-restore-confirm" id="backup-restore-${i}" style="display:none;"></div>
        </div>
      `).join('');
    } catch (e) {
      listEl.innerHTML = '<div class="backup-empty backup-empty-error">Failed to load backups. Is the server running?</div>';
    }
  }

  async function createBackup() {
    try {
      await DB.saveNow();
      const resp = await fetch('/backup', { method: 'POST' });
      if (resp.ok) {
        DB.setMeta('lastBackupDate', new Date().toISOString());
        Toast.success('Backup created');
        await _refreshList();
        _scheduleNext(); // Reset auto-backup timer
      } else {
        let reason = `Backup failed (${resp.status})`;
        try { const data = await resp.json(); if (data.error) reason = data.error; } catch(_) {}
        Toast.error(reason);
      }
    } catch (e) {
      Toast.error('Backup failed — is the server running?');
    }
  }

  async function downloadBackup(filename) {
    try {
      const resp = await fetch('/backup?file=' + encodeURIComponent(filename));
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      Toast.error('Download failed');
    }
  }

  async function deleteBackup(filename) {
    if (!confirm('Delete this backup permanently?')) return;
    try {
      const resp = await fetch('/backup?file=' + encodeURIComponent(filename), { method: 'DELETE' });
      if (resp.ok) {
        Toast.success('Backup deleted');
        await _refreshList();
      } else {
        Toast.error('Delete failed');
      }
    } catch (e) {
      Toast.error('Delete failed — server error');
    }
  }

  function uploadBackup() {
    document.getElementById('backup-upload-input').click();
  }

  async function _handleUpload(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.name.endsWith('.db')) {
      Toast.error('Please select a .db file');
      input.value = '';
      return;
    }
    try {
      const resp = await fetch('/backup/upload', {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/x-sqlite3', 'X-Filename': file.name }
      });
      if (resp.ok) {
        Toast.success('Backup uploaded');
        await _refreshList();
      } else {
        let reason = `Upload failed (${resp.status})`;
        try { const data = await resp.json(); if (data.error) reason = data.error; } catch(_) {}
        Toast.error(reason);
      }
    } catch (e) {
      Toast.error('Upload failed — is the server running?');
    }
    input.value = '';
  }

  function _showRestore(idx, filename) {
    // Collapse any other open restore confirms
    document.querySelectorAll('.backup-restore-confirm').forEach((el, i) => {
      if (i !== idx) el.style.display = 'none';
    });
    const el = document.getElementById('backup-restore-' + idx);
    if (!el) return;
    const itemCount = DB.getItemCount();
    el.innerHTML = `
      <div class="backup-restore-warning">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>This will replace all ${itemCount} current item${itemCount !== 1 ? 's' : ''} with the data from this backup. A safety backup will be created first.</span>
      </div>
      <div class="backup-restore-secret">
        <label>Type <strong>RESTORE</strong> to confirm</label>
        <input type="text" id="restore-secret-${idx}" class="reset-secret-input" autocomplete="off" spellcheck="false" placeholder="RESTORE" oninput="UIBackup._checkRestoreSecret(${idx})" />
      </div>
      <div class="backup-restore-btns">
        <button class="btn btn-sm" onclick="UIBackup._cancelRestore(${idx})">Cancel</button>
        <button class="btn btn-sm btn-danger" id="restore-confirm-btn-${idx}" disabled onclick="UIBackup._doRestore('${_escAttr(filename)}', ${idx})">Restore Backup</button>
      </div>
    `;
    el.style.display = '';
    setTimeout(() => { const inp = document.getElementById('restore-secret-' + idx); if (inp) inp.focus(); }, 50);
  }

  function _checkRestoreSecret(idx) {
    const input = document.getElementById('restore-secret-' + idx);
    const btn = document.getElementById('restore-confirm-btn-' + idx);
    if (!input || !btn) return;
    btn.disabled = input.value.trim() !== 'RESTORE';
  }

  function _cancelRestore(idx) {
    const el = document.getElementById('backup-restore-' + idx);
    if (el) el.style.display = 'none';
  }

  async function _doRestore(filename, idx) {
    const btn = document.getElementById('restore-confirm-btn-' + idx);
    if (btn) { btn.disabled = true; btn.textContent = 'Restoring...'; }
    try {
      const resp = await fetch('/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      if (resp.ok) {
        Toast.success('Backup restored — reloading...');
        setTimeout(() => location.reload(), 1000);
      } else {
        Toast.error('Restore failed');
        _cancelRestore(idx);
      }
    } catch (e) {
      Toast.error('Restore failed — server error');
      _cancelRestore(idx);
    }
  }

  /* ── helpers ────────────────────────────────────────────────── */

  function _formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function _timeAgo(date) {
    const min = Math.floor((Date.now() - date.getTime()) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const days = Math.floor(hr / 24);
    return days + 'd ago';
  }

  return { show, close, createBackup, downloadBackup, deleteBackup,
           uploadBackup, _handleUpload,
           initAutoBackup, _showRestore, _checkRestoreSecret, _cancelRestore, _doRestore };
})();
