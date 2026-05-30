/* ── item modal — add / edit / view ──────────────────────────── */

const Modal = (() => {
  let currentItemId = null;
  let isNewItem = false;
  let isDuplicate = false;
  let snapshot = null;
  let originalQuantity = 1;
  let pendingQty = 1;
  let qtyAdjustments = []; // collected adjustments to log on save

  /* ── open / close ──────────────────────────────────────────── */

  function open(itemId) {
    currentItemId = itemId;
    isNewItem = false;
    _render();
    document.getElementById('modal-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function openNew() {
    currentItemId = null;
    isNewItem = true;
    snapshot = null;
    _renderNew();
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('.panel-body').classList.add('panel-new');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    _dismiss();
  }

  function _tryClose() {
    if (_isDirty()) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }
    _dismiss();
  }

  function openDuplicate(itemId) {
    const source = DB.getById(itemId);
    if (!source) return;
    currentItemId = null;
    isNewItem = true;
    isDuplicate = true;
    snapshot = null;
    _renderDuplicate(source);
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('.panel-body').classList.add('panel-duplicate');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function _dismiss() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('active');
    const panel = overlay.querySelector('.panel-body');
    if (panel) { panel.classList.remove('panel-new', 'panel-duplicate'); }
    document.body.style.overflow = '';
    currentItemId = null;
    isNewItem = false;
    isDuplicate = false;
    snapshot = null;
    originalQuantity = 1;
    pendingQty = 1;
    qtyAdjustments = [];
  }

  /* ── dirty check ───────────────────────────────────────────── */

  function _isDirty() {
    if (isNewItem) {
      return _val('modal-name') || _val('modal-desc') || _val('modal-model') ||
             _val('modal-serial') || _val('modal-notes');
    }
    if (!snapshot) return false;
    return _val('modal-name') !== snapshot.name ||
           _val('modal-desc') !== (snapshot.description || '') ||
           _val('modal-model') !== (snapshot.model || '') ||
           _val('modal-serial') !== (snapshot.serialNumber || '') ||
           _sel('modal-status') !== snapshot.status ||
           _sel('modal-location') !== (snapshot.location || '') ||
           CategoryCombo.val('modal-category') !== (snapshot.category || '') ||
           _sel('modal-owner') !== (snapshot.ownerAccount || '') ||
           _val('modal-notes') !== (snapshot.notes || '') ||
           _val('modal-value') !== (snapshot.itemValue || '') ||
           _val('modal-sale-price') !== (snapshot.salePrice || '') ||
           pendingQty !== (snapshot.quantity || 1);
  }

  /* ── gather form data ──────────────────────────────────────── */

  function _gatherUpdates() {
    const nameEl = document.getElementById('modal-name');
    if (!nameEl || !nameEl.value.trim()) return null;
    return {
      name: nameEl.value.trim(),
      description: _val('modal-desc'),
      model: _val('modal-model'),
      serialNumber: _val('modal-serial'),
      status: _sel('modal-status'),
      location: _sel('modal-location'),
      category: CategoryCombo.val('modal-category'),
      ownerAccount: _sel('modal-owner'),
      notes: _val('modal-notes'),
      itemValue: _val('modal-value'),
      salePrice: _val('modal-sale-price'),
      quantity: pendingQty,
    };
  }

  /* ── save (explicit) ───────────────────────────────────────── */

  function _save() {
    if (!currentItemId || isNewItem) return;
    const updates = _gatherUpdates();
    if (!updates) { alert('Please enter an item name.'); return; }

    const result = DB.updateItem(currentItemId, updates);
    if (result && result.error) {
      Toast.error(`Error: ${result.error}`);
      return;
    }

    // Log quantity adjustments as a single entry with reason
    if (qtyAdjustments.length > 0) {
      const lastAdj = qtyAdjustments[qtyAdjustments.length - 1];
      const summary = qtyAdjustments.map(a => a.summary).join(', ');
      DBHistory.log(currentItemId, 'Quantity', String(originalQuantity), String(pendingQty));
      // Log each reason as a follow-up entry
      qtyAdjustments.forEach(adj => {
        DBHistory.log(currentItemId, 'Quantity', adj.summary, adj.reason);
      });
    }

    Toast.success('Item saved');
    App.render();
    _dismiss();
  }

  /* ── quantity adjust panel ─────────────────────────────────── */

  function _openQtyAdjust() {
    const panel = document.getElementById('qty-adjust-panel');
    if (!panel) return;
    panel.style.display = '';
    const amountEl = document.getElementById('qty-adj-amount');
    if (amountEl) { amountEl.value = ''; amountEl.focus(); }
    const reasonEl = document.getElementById('qty-adj-reason');
    if (reasonEl) reasonEl.value = '';
    const directionEl = document.getElementById('qty-adj-direction');
    if (directionEl) directionEl.value = 'add';
  }

  function _cancelQtyAdjust() {
    const panel = document.getElementById('qty-adjust-panel');
    if (panel) panel.style.display = 'none';
  }

  function _applyQtyAdjust() {
    const direction = document.getElementById('qty-adj-direction')?.value || 'add';
    const amount = parseInt(document.getElementById('qty-adj-amount')?.value) || 0;
    const reason = document.getElementById('qty-adj-reason')?.value?.trim() || '';

    if (amount <= 0) { alert('Enter a valid amount.'); return; }
    if (!reason) { alert('Please provide a reason for this adjustment.'); document.getElementById('qty-adj-reason')?.focus(); return; }

    const oldQty = pendingQty;
    const newQty = direction === 'add' ? pendingQty + amount : pendingQty - amount;
    if (newQty < 0) { alert('Cannot remove more than the current quantity.'); return; }

    pendingQty = newQty;
    const display = document.getElementById('modal-qty-value');
    if (display) display.textContent = pendingQty;

    const changeWord = direction === 'add' ? 'Added' : 'Removed';
    qtyAdjustments.push({
      summary: `${oldQty} → ${newQty} (${changeWord} ${amount})`,
      reason: reason,
    });

    const panel = document.getElementById('qty-adjust-panel');
    if (panel) panel.style.display = 'none';
  }

  /* ── edit existing item ────────────────────────────────────── */

  function _render() {
    const item = DB.getById(currentItemId);
    if (!item) return;
    const content = document.getElementById('modal-content');
    const isDeleted = DB.isDeleted(currentItemId);

    snapshot = {
      name: item.name, description: item.description, model: item.model,
      serialNumber: item.serialNumber, status: item.status,
      location: item.location, category: item.category,
      ownerAccount: item.ownerAccount, notes: item.notes,
      itemValue: item.itemValue, salePrice: item.salePrice,
      quantity: item.quantity,
    };
    originalQuantity = item.quantity || 1;
    pendingQty = originalQuantity;
    qtyAdjustments = [];

    const sc = DB.getStatusColor(item.status);

    content.innerHTML = `
      <div class="modal-header-bar">
        <div class="modal-header-left">
          <div class="modal-header-qty">
            <span class="modal-header-qty-label">Qty</span>
            <span id="modal-qty-value" class="modal-header-qty-num">${pendingQty}</span>
            ${!isDeleted ? `<button type="button" class="btn btn-sm" onclick="Modal._openQtyAdjust()">Adjust</button>` : ''}
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="Modal._tryClose()">&times;</button>
      </div>
      <div class="panel-content">

      <div class="modal-top-row">
        <div class="modal-top-left">
          <div class="modal-name-row">
            <input id="modal-name" class="modal-name-input" value="${_escAttr(item.name)}" placeholder="Item name" ${isDeleted ? 'disabled' : ''} />
          </div>
          <div class="modal-subtitle">
            ${item.model ? `<span class="modal-serial-tag">${_esc(item.model)}<button class="tag-copy-btn" onclick="navigator.clipboard.writeText('${_escAttr(item.model)}');Toast.success('Copied')" title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></span>` : ''}
            ${item.serialNumber ? `<span class="modal-serial-tag">${_esc(item.serialNumber)}<button class="tag-copy-btn" onclick="navigator.clipboard.writeText('${_escAttr(item.serialNumber)}');Toast.success('Copied')" title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></span>` : ''}
            ${isDeleted ? '<span class="modal-deleted-tag">Deleted</span>' : ''}
          </div>
        </div>
        <div class="modal-top-right">
          <div class="modal-top-field">
            <label>Category</label>
            ${CategoryCombo.html('modal-category', item.category, isDeleted ? 'cat-combo-disabled' : '')}
          </div>
          <div class="modal-top-field">
            <label>Status</label>
            <div class="modal-status-wrap" style="--status-color:${sc}">
              <select id="modal-status" class="modal-status-select" ${isDeleted ? 'disabled' : ''}>${_statusOptions(item.status)}</select>
            </div>
          </div>
          </div>
        </div>
      </div>

      <div class="modal-form" id="modal-edit-form">
        <div id="qty-adjust-panel" class="qty-adjust-panel" style="display:none;">
          <div class="qty-adjust-row">
            <select id="qty-adj-direction" class="qty-adj-dir">
              <option value="add">Add</option>
              <option value="remove">Remove</option>
            </select>
            <input id="qty-adj-amount" type="number" min="1" value="" placeholder="1" class="qty-adj-amount" />
            <input id="qty-adj-reason" type="text" placeholder="Reason (required)" class="qty-adj-reason" />
          </div>
          <div class="qty-adjust-actions">
            <button type="button" class="btn btn-sm" onclick="Modal._cancelQtyAdjust()">Cancel</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="Modal._applyQtyAdjust()">Apply</button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Model</label><input id="modal-model" value="${_escAttr(item.model)}" placeholder="Model / part #" ${isDeleted ? 'disabled' : ''} /></div>
          <div class="form-group"><label>Serial Number</label><input id="modal-serial" value="${_escAttr(item.serialNumber)}" placeholder="Serial number" oninput="Modal._checkSerialDuplicate()" ${isDeleted ? 'disabled' : ''} /></div>
        </div>
        <div id="serial-warning" class="serial-warning" style="display:none;"></div>

        <div class="form-group">
          <label>Description</label>
          <textarea id="modal-desc" placeholder="Description" rows="2" ${isDeleted ? 'disabled' : ''}>${_esc(item.description)}</textarea>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Item Value</label><input id="modal-value" value="${_escAttr(item.itemValue)}" placeholder="e.g. 1500.00" ${isDeleted ? 'disabled' : ''} /></div>
          <div class="form-group"><label>Sale Price</label><input id="modal-sale-price" value="${_escAttr(item.salePrice)}" placeholder="e.g. 1200.00" ${isDeleted ? 'disabled' : ''} /></div>
        </div>

        <div class="form-group">
          <label>Notes</label>
          <textarea id="modal-notes" placeholder="Additional notes..." rows="2" ${isDeleted ? 'disabled' : ''}>${_esc(item.notes)}</textarea>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Location</label>
            <select id="modal-location" ${isDeleted ? 'disabled' : ''}>
              <option value="">-- None --</option>
              ${_listOptions(DB.getLocations(), item.location)}
            </select>
          </div>
          <div class="form-group"><label>Account</label>
            <select id="modal-owner" ${isDeleted ? 'disabled' : ''}>
              <option value="">-- None --</option>
              ${_listOptions(DB.getAccounts().map(a => a.name), item.ownerAccount)}
              <option value="__new__">+ New account...</option>
            </select>
          </div>
        </div>
      </div>

      <div class="modal-footer-bar">
        <div class="modal-footer-left">
          <button class="btn" onclick="Modal._confirmDelete()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            Delete
          </button>
          <button class="btn" onclick="Modal.openDuplicate('${item.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Duplicate
          </button>
        </div>
        <div class="modal-footer-right">
          <button class="btn" onclick="UILabels.exportSingle('${item.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Export Label
          </button>
          <button class="btn" onclick="Modal._tryClose()">Cancel</button>
          <button class="btn btn-primary" onclick="Modal._save()">Save</button>
        </div>
      </div>

      </div><!-- end panel-content -->

      ${_renderHistory(item)}
    `;

    setTimeout(() => {
      if (!isDeleted) {
        CategoryCombo.init('modal-category');
        _setupNewOption('modal-owner', 'account');
        _setupLocationDropdown(item.ownerAccount, item.location);
        _setupStatusColor();
      }
      _checkSerialDuplicate();
    }, 50);
  }

  /* ── new item ──────────────────────────────────────────────── */

  function _renderNew() {
    const content = document.getElementById('modal-content');
    pendingQty = 1;

    content.innerHTML = `
      <div class="modal-header-bar">
        <div class="modal-header-left">
          <div class="modal-header-qty">
            <span class="modal-header-qty-label">Qty</span>
            <span id="modal-qty-value" class="modal-header-qty-num">${pendingQty}</span>
            <button type="button" class="btn btn-sm" onclick="Modal._openQtyAdjust()">Adjust</button>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="Modal._tryClose()">&times;</button>
      </div>
      <div class="panel-content">

      <div class="modal-top-row">
        <div class="modal-top-left">
          <div class="modal-name-row">
            <input id="modal-name" class="modal-name-input" placeholder="Item name" />
          </div>
        </div>
        <div class="modal-top-right">
          <div class="modal-top-field">
            <label>Category</label>
            ${CategoryCombo.html('modal-category', '')}
          </div>
          <div class="modal-top-field">
            <label>Status</label>
            <div class="modal-status-wrap" style="--status-color:#16a34a">
              <select id="modal-status" class="modal-status-select">${_statusOptions('Available')}</select>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-form">
        <div id="qty-adjust-panel" class="qty-adjust-panel" style="display:none;">
          <div class="qty-adjust-row">
            <select id="qty-adj-direction" class="qty-adj-dir">
              <option value="add">Add</option>
              <option value="remove">Remove</option>
            </select>
            <input id="qty-adj-amount" type="number" min="1" value="" placeholder="1" class="qty-adj-amount" />
            <input id="qty-adj-reason" type="text" placeholder="Reason (required)" class="qty-adj-reason" />
          </div>
          <div class="qty-adjust-actions">
            <button type="button" class="btn btn-sm" onclick="Modal._cancelQtyAdjust()">Cancel</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="Modal._applyQtyAdjust()">Apply</button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Model</label><input id="modal-model" placeholder="Model / part #" /></div>
          <div class="form-group"><label>Serial Number</label><input id="modal-serial" placeholder="Serial number" oninput="Modal._checkSerialDuplicate()" /></div>
        </div>
        <div id="serial-warning" class="serial-warning" style="display:none;"></div>

        <div class="form-group">
          <label>Description</label>
          <textarea id="modal-desc" placeholder="Description" rows="2"></textarea>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Item Value</label><input id="modal-value" placeholder="e.g. 1500.00" /></div>
          <div class="form-group"><label>Sale Price</label><input id="modal-sale-price" placeholder="e.g. 1200.00" /></div>
        </div>

        <div class="form-group">
          <label>Notes</label>
          <textarea id="modal-notes" placeholder="Additional notes..." rows="2"></textarea>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Location</label>
            <select id="modal-location">
              <option value="">-- None --</option>
              ${_listOptions(DB.getLocations(), '')}
            </select>
          </div>
          <div class="form-group"><label>Account</label>
            <select id="modal-owner">
              <option value="">-- None --</option>
              ${_listOptions(DB.getAccounts().map(a => a.name), '')}
              <option value="__new__">+ New account...</option>
            </select>
          </div>
        </div>

      </div>
      <div class="modal-footer-bar">
        <div class="modal-footer-left"></div>
        <div class="modal-footer-right">
          <button class="btn" onclick="Modal._tryClose()">Cancel</button>
          <button class="btn btn-primary" onclick="Modal._create()">Add Item</button>
        </div>
      </div>

      </div><!-- end panel-content -->
    `;

    setTimeout(() => {
      _setupLocationDropdown('', '');
      CategoryCombo.init('modal-category');
      _setupNewOption('modal-owner', 'account');
    }, 50);
  }

  /* ── duplicate item ────────────────────────────────────────── */

  function _renderDuplicate(source) {
    const content = document.getElementById('modal-content');
    pendingQty = 1;

    const sc = DB.getStatusColor(source.status);

    content.innerHTML = `
      <div class="modal-header-bar">
        <div class="modal-header-left">
          <div class="modal-header-qty">
            <span class="modal-header-qty-label">Qty</span>
            <span id="modal-qty-value" class="modal-header-qty-num">${pendingQty}</span>
            <button type="button" class="btn btn-sm" onclick="Modal._openQtyAdjust()">Adjust</button>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="Modal._tryClose()">&times;</button>
      </div>
      <div class="panel-content">

      <div class="duplicate-banner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        Duplicated from <strong>${_esc(source.name)}</strong> — update fields as needed, then save.
      </div>

      <div class="modal-top-row">
        <div class="modal-top-left">
          <div class="modal-name-row">
            <input id="modal-name" class="modal-name-input" value="${_escAttr(source.name)}" placeholder="Item name" />
          </div>
        </div>
        <div class="modal-top-right">
          <div class="modal-top-field">
            <label>Category</label>
            ${CategoryCombo.html('modal-category', source.category)}
          </div>
          <div class="modal-top-field">
            <label>Status</label>
            <div class="modal-status-wrap" style="--status-color:${sc}">
              <select id="modal-status" class="modal-status-select">${_statusOptions(source.status)}</select>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-form">
        <div id="qty-adjust-panel" class="qty-adjust-panel" style="display:none;">
          <div class="qty-adjust-row">
            <select id="qty-adj-direction" class="qty-adj-dir">
              <option value="add">Add</option>
              <option value="remove">Remove</option>
            </select>
            <input id="qty-adj-amount" type="number" min="1" value="" placeholder="1" class="qty-adj-amount" />
            <input id="qty-adj-reason" type="text" placeholder="Reason (required)" class="qty-adj-reason" />
          </div>
          <div class="qty-adjust-actions">
            <button type="button" class="btn btn-sm" onclick="Modal._cancelQtyAdjust()">Cancel</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="Modal._applyQtyAdjust()">Apply</button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Model</label><input id="modal-model" value="${_escAttr(source.model)}" placeholder="Model / part #" /></div>
          <div class="form-group"><label>Serial Number</label><input id="modal-serial" value="" placeholder="Enter new serial number" oninput="Modal._checkSerialDuplicate()" /></div>
        </div>
        <div id="serial-warning" class="serial-warning" style="display:none;"></div>

        <div class="form-group">
          <label>Description</label>
          <textarea id="modal-desc" placeholder="Description" rows="2">${_esc(source.description)}</textarea>
        </div>

        <div class="form-group">
          <label>Notes</label>
          <textarea id="modal-notes" placeholder="Additional notes..." rows="2">${_esc(source.notes)}</textarea>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Item Value</label><input id="modal-value" value="${_escAttr(source.itemValue || '')}" placeholder="e.g. 1500.00" /></div>
          <div class="form-group"><label>Sale Price</label><input id="modal-sale-price" value="${_escAttr(source.salePrice || '')}" placeholder="e.g. 1200.00" /></div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Location</label>
            <select id="modal-location">
              <option value="">-- None --</option>
              ${_listOptions(DB.getLocations(), source.location)}
            </select>
          </div>
          <div class="form-group"><label>Account</label>
            <select id="modal-owner">
              <option value="">-- None --</option>
              ${_listOptions(DB.getAccounts().map(a => a.name), source.ownerAccount)}
              <option value="__new__">+ New account...</option>
            </select>
          </div>
        </div>

      <div class="modal-footer-bar">
        <div class="modal-footer-left"></div>
        <div class="modal-footer-right">
          <button class="btn" onclick="Modal._tryClose()">Cancel</button>
          <button class="btn btn-primary" onclick="Modal._create()">Save Duplicate</button>
        </div>
      </div>

      </div><!-- end panel-content -->
    `;

    setTimeout(() => {
      _setupLocationDropdown(source.ownerAccount, source.location);
      CategoryCombo.init('modal-category');
      _setupNewOption('modal-owner', 'account');
      _setupStatusColor();
    }, 50);
  }

  /* ── status color sync ─────────────────────────────────────── */

  function _setupStatusColor() {
    const sel = document.getElementById('modal-status');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const wrap = sel.closest('.modal-status-wrap');
      if (!wrap) return;
      const color = DB.getStatusColor(sel.value);
      wrap.style.setProperty('--status-color', color || '');
    });
  }

  /* ── form helpers ──────────────────────────────────────────── */

  function _statusOptions(selected) {
    return DB.getStatuses().map(s => `<option value="${_escAttr(s.name)}" ${s.name === selected ? 'selected' : ''}>${_esc(s.name)}</option>`).join('');
  }

  function _listOptions(list, selected) {
    return list.map(item => {
      const val = typeof item === 'string' ? item : item.name;
      return `<option value="${_escAttr(val)}" ${val === selected ? 'selected' : ''}>${_esc(val)}</option>`;
    }).join('');
  }

  /* ── duplicate detection ───────────────────────────────────── */

  function _checkSerialDuplicate() {
    const serial = document.getElementById('modal-serial')?.value?.trim();
    const warning = document.getElementById('serial-warning');
    if (!warning) return;
    if (!serial) { warning.style.display = 'none'; return; }

    const existing = DB.findBySerial(serial).filter(i => i.id !== currentItemId);
    if (existing.length > 0) {
      warning.style.display = 'block';
      warning.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Serial already used by <strong>${_esc(existing[0].name)}</strong> (${_esc(existing[0].status)})</span>
      `;
    } else {
      warning.style.display = 'none';
    }
  }

  /* ── history ───────────────────────────────────────────────── */

  function _renderHistory(item) {
    if (!item.history || !item.history.length) return '';
    return `<div class="modal-section">
      <div class="modal-section-header collapsible-header" onclick="Modal._toggleSection(this)">
        <span class="collapsible-label"><span class="collapsible-chevron">&#9660;</span> Change History</span>
        <span class="modal-notes-count">${item.history.length}</span>
      </div>
      <div class="collapsible-body"><ul class="history-list">
        ${item.history.map(h => {
          const isReason = h.fieldChanged === 'Quantity' && h.oldValue && h.oldValue.includes('→');
          return `<li class="history-item${isReason ? ' history-item-reason' : ''}">
            <div class="history-meta">
              <span class="history-field">${_esc(h.fieldChanged)}</span>
              <span class="history-right">${h.changedBy ? `<span class="history-user">${_esc(h.changedBy)}</span>` : ''}<span class="history-time">${_fmtTimestamp(h.changedAt)}</span></span>
            </div>
            ${isReason
              ? `<div class="history-change"><span class="history-qty-change">${_esc(h.oldValue)}</span><span class="history-reason-sep">\u2014</span><span class="history-reason-text">${_esc(h.newValue) || '\u2014'}</span></div>`
              : `<div class="history-change"><span class="history-old">${_esc(h.oldValue) || '\u2014'}</span><span class="history-arrow">\u2192</span><span class="history-new">${_esc(h.newValue) || '\u2014'}</span></div>`
            }
          </li>`;
        }).join('')}
      </ul></div></div>`;
  }

  /* ── create ────────────────────────────────────────────────── */

  function _create() {
    const name = _val('modal-name');
    if (!name) { alert('Please enter an item name.'); return; }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name, description: _val('modal-desc'), model: _val('modal-model'),
      serialNumber: _val('modal-serial'), status: _sel('modal-status'),
      location: _sel('modal-location'), category: CategoryCombo.val('modal-category'),
      ownerAccount: _sel('modal-owner'), notes: _val('modal-notes'),
      quantity: pendingQty,
    };

    const result = DB.addItem(item);
    if (result && result.error) {
      Toast.error(`Cannot add: ${result.error} -- "${result.existingItem.name}" already uses serial ${item.serialNumber}`);
      return;
    }
    Toast.success(isDuplicate ? 'Duplicate created' : 'Item added');
    _dismiss();
    App.render();
  }

  /* ── delete (soft) ─────────────────────────────────────────── */

  function _confirmDelete() {
    if (!currentItemId) return;
    const item = DB.getById(currentItemId);
    if (!item) return;
    const isDeleted = DB.isDeleted(currentItemId);
    if (isDeleted) {
      alert(`"${item.name}" is already deleted.`);
      return;
    }
    if (confirm(`Delete "${item.name}"? It will be hidden from lists but kept in the activity log.`)) {
      DB.deleteItem(currentItemId);
      Toast.success(`"${item.name}" deleted`);
      _dismiss();
      App.render();
    }
  }

  /* ── location dropdown (account-aware) ─────────────────────── */

  function _setupLocationDropdown(currentAccount, currentLocation) {
    const ownerSel = document.getElementById('modal-owner');
    const locSel = document.getElementById('modal-location');
    if (!ownerSel || !locSel) return;

    // Populate location options based on selected account
    function refreshLocations(selectedAccount, preserveValue) {
      const locs = DB.getLocations(selectedAccount || undefined);
      const accountLocs = selectedAccount ? DB.getLocationsForAccount(selectedAccount) : [];

      let html = '<option value="">-- None --</option>';
      // Global locations
      locs.forEach(l => {
        if (!accountLocs.includes(l)) html += `<option value="${_escAttr(l)}">${_esc(l)}</option>`;
      });
      html += '<option value="__new__">+ New location...</option>';
      // Account-specific locations (grouped)
      if (selectedAccount) {
        html += '<option disabled>── ' + _esc(selectedAccount) + ' Locations ──</option>';
        accountLocs.forEach(l => { html += `<option value="${_escAttr(l)}">${_esc(l)}</option>`; });
        html += `<option value="__new_account__">+ New "${_esc(selectedAccount)}" location...</option>`;
      }

      locSel.innerHTML = html;
      if (preserveValue && locs.concat(accountLocs).includes(preserveValue)) {
        locSel.value = preserveValue;
      }
    }

    // Initial population
    const acct = ownerSel.value || currentAccount || '';
    refreshLocations(acct, currentLocation);

    // When account changes, refresh locations
    ownerSel.addEventListener('change', () => {
      const val = ownerSel.value;
      if (val === '__new__') return; // handled by _setupNewOption
      refreshLocations(val, null);
    });

    // Handle "+ New location..." and "+ New account location..."
    locSel.onchange = function() {
      if (this.value === '__new__') {
        const name = prompt('New location name:');
        if (name?.trim()) {
          DB.addLocation(name.trim());
          refreshLocations(ownerSel.value, name.trim());
        } else { this.selectedIndex = 0; }
      } else if (this.value === '__new_account__') {
        const account = ownerSel.value;
        const name = prompt(`New location for "${account}":`);
        if (name?.trim()) {
          DB.addLocation(name.trim(), account);
          refreshLocations(account, name.trim());
          Toast.success(`Location "${name.trim()}" added for ${account}`);
        } else { this.selectedIndex = 0; }
      }
    };
  }

  /* ── toggle / new option ───────────────────────────────────── */

  function _toggleSection(header) {
    const body = header.nextElementSibling;
    const chevron = header.querySelector('.collapsible-chevron');
    if (!body) return;
    body.classList.toggle('collapsed');
    chevron.innerHTML = body.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
  }

  function _setupNewOption(selectId, type) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.onchange = function() {
      if (this.value !== '__new__') return;
      if (type === 'account') {
        const name = prompt('New account name:');
        if (name?.trim()) {
          const contact = prompt('Contact (optional):') || '';
          DB.addAccount(name.trim(), contact);
          this.innerHTML = '<option value="">-- None --</option>' +
            _listOptions(DB.getAccounts().map(a => a.name), name.trim()) +
            '<option value="__new__">+ New account...</option>';
          this.value = name.trim();
          // Refresh location dropdown so account-specific option appears
          const locSel = document.getElementById('modal-location');
          if (locSel) {
            const locs = DB.getLocations(name.trim());
            const accountLocs = DB.getLocationsForAccount(name.trim());
            let html = '<option value="">-- None --</option>';
            locs.forEach(l => { if (!accountLocs.includes(l)) html += `<option value="${_escAttr(l)}">${_esc(l)}</option>`; });
            html += '<option value="__new__">+ New location...</option>';
            html += '<option disabled>── ' + _esc(name.trim()) + ' Locations ──</option>';
            accountLocs.forEach(l => { html += `<option value="${_escAttr(l)}">${_esc(l)}</option>`; });
            html += `<option value="__new_account__">+ New "${_esc(name.trim())}" location...</option>`;
            locSel.innerHTML = html;
          }
        } else { this.selectedIndex = 0; }
        return;
      }
      const name = prompt(`New ${type} name:`);
      if (name?.trim()) {
        if (type === 'location') DB.addLocation(name.trim());
        else if (type === 'category') DB.addCategory(name.trim());
        const list = type === 'location' ? DB.getLocations() : DB.getCategories();
        const prefix = type === 'location' ? '<option value="">-- None --</option>' : '';
        this.innerHTML = prefix + _listOptions(list, name.trim()) + `<option value="__new__">+ New ${type}...</option>`;
        this.value = name.trim();
      } else { this.selectedIndex = 0; }
    };
  }

  /* ── init ──────────────────────────────────────────────────── */

  function init() {
    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') _tryClose(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _tryClose(); });
  }

  return { init, open, openNew, openDuplicate, close, _tryClose, _save, _create, _openQtyAdjust, _cancelQtyAdjust, _applyQtyAdjust, _confirmDelete, _toggleSection, _checkSerialDuplicate };
})();
