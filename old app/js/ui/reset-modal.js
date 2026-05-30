/* ── reset modal — secret word + selective data group reset ──── */

const UIReset = (() => {

  const SECRET_WORD = 'PANCAKE123';
  let armed = false;

  function show() {
    armed = false;
    App._closeSettings();
    const overlay = document.getElementById('reset-overlay');
    const content = document.getElementById('reset-content');

    content.innerHTML = `
      <div class="modal-header-bar">
        <span class="modal-title-sm">Reset Data</span>
        <button class="btn btn-sm btn-ghost" onclick="UIReset.close()">&times;</button>
      </div>

      <div class="reset-warning">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>This will permanently delete data. Items and history are always cleared. Choose which seed data to restore.</span>
      </div>

      <div class="reset-presets">
        <button class="btn btn-sm" onclick="UIReset._preset('empty')">Empty</button>
        <button class="btn btn-sm btn-primary" onclick="UIReset._preset('everything')">Everything</button>
      </div>

      <div class="reset-groups">
        <label class="reset-group-item">
          <input type="checkbox" id="reset-chk-statuses" checked />
          <div class="reset-group-info">
            <span class="reset-group-name">Statuses</span>
            <span class="reset-group-desc">8 default statuses (Available, In Use, In Field, etc.)</span>
          </div>
        </label>
        <label class="reset-group-item">
          <input type="checkbox" id="reset-chk-categories" checked />
          <div class="reset-group-info">
            <span class="reset-group-name">Categories</span>
            <span class="reset-group-desc">~50 categories with subcategories (Computers, Networking, etc.)</span>
          </div>
        </label>
        <label class="reset-group-item">
          <input type="checkbox" id="reset-chk-locations" checked />
          <div class="reset-group-info">
            <span class="reset-group-name">Locations</span>
            <span class="reset-group-desc">5 locations (Main Office, Warehouse, Server Room, etc.)</span>
          </div>
        </label>
        <label class="reset-group-item">
          <input type="checkbox" id="reset-chk-accounts" checked />
          <div class="reset-group-info">
            <span class="reset-group-name">Accounts</span>
            <span class="reset-group-desc">3 sample accounts (Acme Corp, TechStart LLC, Delta Services)</span>
          </div>
        </label>
        <label class="reset-group-item">
          <input type="checkbox" id="reset-chk-items" checked />
          <div class="reset-group-info">
            <span class="reset-group-name">Items</span>
            <span class="reset-group-desc">12 sample inventory items (MacBook, Dell Monitor, Cisco Router, etc.)</span>
          </div>
        </label>
      </div>

      <div class="reset-secret-section">
        <label class="reset-secret-label">Type the secret word to confirm</label>
        <input type="text" id="reset-secret-input" class="reset-secret-input" autocomplete="off" spellcheck="false" placeholder="Secret word..." oninput="UIReset._checkSecret()" />
      </div>

      <div class="reset-actions">
        <button class="btn" onclick="UIReset.close()">Cancel</button>
        <button class="btn btn-danger" id="reset-confirm-btn" disabled onclick="UIReset._confirm()">Reset Data</button>
      </div>
    `;

    overlay.classList.add('active');
    setTimeout(() => { const input = document.getElementById('reset-secret-input'); if (input) input.focus(); }, 50);
  }

  function close() {
    armed = false;
    document.getElementById('reset-overlay').classList.remove('active');
  }

  function _preset(type) {
    armed = false;
    _updateBtnText();
    const groups = ['statuses', 'categories', 'locations', 'accounts', 'items'];
    const checked = type === 'everything';
    groups.forEach(g => {
      const el = document.getElementById('reset-chk-' + g);
      if (el) el.checked = checked;
    });
  }

  function _checkSecret() {
    armed = false;
    const input = document.getElementById('reset-secret-input');
    const btn = document.getElementById('reset-confirm-btn');
    if (!input || !btn) return;
    const match = input.value.trim().toUpperCase() === SECRET_WORD;
    btn.disabled = !match;
    _updateBtnText();
  }

  function _updateBtnText() {
    const btn = document.getElementById('reset-confirm-btn');
    if (!btn) return;
    btn.textContent = armed ? 'Click again to confirm' : 'Reset Data';
  }

  function _confirm() {
    if (!armed) {
      armed = true;
      _updateBtnText();
      // Auto-disarm after 3 seconds if they don't click again
      setTimeout(() => { if (armed) { armed = false; _updateBtnText(); } }, 3000);
      return;
    }

    const options = {
      statuses:   document.getElementById('reset-chk-statuses')?.checked || false,
      categories: document.getElementById('reset-chk-categories')?.checked || false,
      locations:  document.getElementById('reset-chk-locations')?.checked || false,
      accounts:   document.getElementById('reset-chk-accounts')?.checked || false,
      items:      document.getElementById('reset-chk-items')?.checked || false,
    };
    DB.reset(options);
    close();

    // Clear selection and re-render
    App.clearSelection && App.clearSelection();
    App.render();
    Toast.success('Data reset successfully');
  }

  return { show, close, _preset, _checkSecret, _confirm };
})();
