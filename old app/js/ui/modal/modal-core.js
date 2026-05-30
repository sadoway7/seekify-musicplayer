/* ── item modal — tabbed shell: open/close/save, tab switching ── */

const Modal = (() => {
  let currentItemId = null;
  let isNewItem = false;
  let isDuplicate = false;
  let snapshot = null;
  let originalQuantity = 1;
  let pendingQty = 1;
  let qtyAdjustments = [];
  let _activeTab = 'details';

  /* ── tab registry ──────────────────────────────────────────── */
  const _tabs = [];

  function registerTab(tab) {
    _tabs.push(tab);
    // Sort by order if provided, otherwise append
    _tabs.sort((a, b) => (a.order || 99) - (b.order || 99));
  }

  let _tabStash = {}; // tab id → gathered data (frozen when switching away)

  function _switchTab(tabId) {
    // Stash current tab's data before switching
    _stashCurrentTab();
    _activeTab = tabId;
    const container = document.getElementById('modal-tab-content');
    if (!container) return;
    const tab = _tabs.find(t => t.id === tabId);
    if (!tab) return;
    const item = currentItemId ? DB.getById(currentItemId) : null;
    const mode = isNewItem ? (isDuplicate ? 'duplicate' : 'new') : 'edit';
    const isDeleted = currentItemId ? DB.isDeleted(currentItemId) : false;
    container.innerHTML = tab.render(item || {}, mode, isDeleted);
    if (tab.init) tab.init(item || {}, mode, isDeleted);
    // Update tab bar active state
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
      btn.classList.toggle('modal-tab-active', btn.dataset.tab === tabId);
    });
    _updateSaveBtn();
  }

  /** Gather the current active tab's data and stash it */
  function _stashCurrentTab() {
    const tab = _tabs.find(t => t.id === _activeTab);
    if (!tab || !tab.gather) return;
    // Only stash if the tab's DOM exists
    _tabStash[_activeTab] = tab.gather();
  }

  /* ── open / close ──────────────────────────────────────────── */

  function open(itemId) {
    currentItemId = itemId;
    isNewItem = false;
    isDuplicate = false;
    _tabStash = {};
    _activeTab = 'details';
    _render();
    document.getElementById('modal-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    _startSaveBtnPoll();
  }

  function openNew() {
    currentItemId = null;
    isNewItem = true;
    isDuplicate = false;
    snapshot = null;
    _tabStash = {};
    _activeTab = 'details';
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
      _showConfirm('Your changes will be lost if you don\'t save them.', (yes) => { if (yes) _dismiss(); }, 'Discard Changes', 'Keep Editing');
      return;
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
    _tabStash = {};
    _activeTab = 'details';
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
    _tabStash = {};
    originalQuantity = 1;
    pendingQty = 1;
    qtyAdjustments = [];
    _stopSaveBtnPoll();
  }

  /* ── dirty check ───────────────────────────────────────────── */

  function _isDirty() {
    if (isNewItem) {
      // Stash current tab + check stash
      _stashCurrentTab();
      for (const tab of _tabs) {
        const stashed = _tabStash[tab.id];
        if (stashed) {
          // Check if any stashed field has a value
          if (Object.values(stashed).some(v => v && v !== '' && v !== 0)) return true;
        } else if (tab.isDirty && tab.isDirty({}, 'new')) {
          return true;
        }
      }
      return false;
    }
    if (!snapshot) return false;

    // Header fields (always in DOM)
    if (document.getElementById('modal-desc') && _val('modal-desc') !== (snapshot.description || '')) return true;
    if (document.getElementById('modal-status') && _sel('modal-status') !== (snapshot.status || '')) return true;
    if (document.querySelector('.tag-dropdown-list') && _gatherTags() !== (snapshot.tags || '')) return true;
    const catLocked = document.querySelector('.locked-combo[data-locked-for="modal-category"]');
    if (!catLocked && document.getElementById('modal-category') && CategoryCombo.val('modal-category') !== (snapshot.category || '')) return true;

    // Assignment fields (above tabs, always in DOM)
    if (document.getElementById('modal-owner')) {
      if (ListCombo.val('modal-owner') !== (snapshot.ownerAccount || '')) return true;
      if (ListCombo.val('modal-assigned-to') !== (snapshot.assignedTo || '')) return true;
      if (ListCombo.val('modal-location') !== (snapshot.location || '')) return true;
    }

    // Stash current active tab's data so we include it
    _stashCurrentTab();

    // Check all tabs — use stashed data for inactive tabs, live DOM for active
    for (const tab of _tabs) {
      const stashed = _tabStash[tab.id];
      if (tab.id === _activeTab || !stashed) {
        // Active tab or never-visited tab — check via live DOM (isDirty guards against missing DOM)
        if (tab.isDirty && tab.isDirty(snapshot, 'edit')) return true;
      } else {
        // Inactive tab with stashed data — compare stash to snapshot
        if (_objDirty(stashed, snapshot)) return true;
      }
    }

    return pendingQty !== (snapshot.quantity || 1);
  }

  /** Compare a stashed tab's gathered data against the snapshot */
  function _objDirty(stashed, snapshot) {
    for (const [key, val] of Object.entries(stashed)) {
      if (key === '_priorEdits') {
        // Compare prior year edits to snapshot's _priorYears
        const priorYears = snapshot._priorYears || {};
        for (const [year, vals] of Object.entries(val)) {
          const snap = priorYears[year];
          if (!snap) {
            // New year added — dirty if any value present
            if ((vals.low && vals.low !== '') || (vals.high && vals.high !== '')) return true;
          } else {
            if ((vals.low || '') !== (snap.valueLow || '')) return true;
            if ((vals.high || '') !== (snap.valueHigh || '')) return true;
          }
        }
      } else if (typeof val !== 'object') {
        if (val !== (snapshot[key] ?? '')) return true;
      }
    }
    return false;
  }

  /* ── gather all tab data ───────────────────────────────────── */

  function _gatherAllUpdates() {
    const updates = {};

    // Start with stashed data from previously-visited tabs
    for (const [tabId, data] of Object.entries(_tabStash)) {
      Object.assign(updates, data);
    }

    // Overlay with active tab's live DOM (authoritative for current tab)
    const activeTab = _tabs.find(t => t.id === _activeTab);
    if (activeTab?.gather) {
      Object.assign(updates, activeTab.gather());
    }

    // Fill in any tabs that were never visited (never switched to) — use snapshot values
    for (const tab of _tabs) {
      if (tab.gather && !_tabStash[tab.id] && tab.id !== _activeTab) {
        // Never stashed and not active — use snapshot values by gathering empty DOM
        // Actually, we can't gather from non-existent DOM, so just skip
        // These fields stay at their snapshot values from the DB
      }
    }

    // Header fields
    updates.name = _val('modal-name');
    updates.description = _val('modal-desc');
    updates.category = CategoryCombo.val('modal-category');
    updates.status = _sel('modal-status');
    updates.quantity = pendingQty;
    updates.tags = _gatherTags();

    // Assignment fields (above tabs, always in DOM)
    if (document.getElementById('modal-owner')) {
      updates.ownerAccount = ListCombo.val('modal-owner');
      updates.assignedTo = ListCombo.val('modal-assigned-to');
      updates.location = ListCombo.val('modal-location');
    }

    return updates;
  }

  /* ── save (existing item) ──────────────────────────────────── */

  function _save() {
    if (!currentItemId || isNewItem) return;
    const updates = _gatherAllUpdates();
    if (!updates.name || !updates.name.trim()) { alert('Please enter an item name.'); return; }

    const result = DB.updateItem(currentItemId, updates);
    if (result && result.error) {
      Toast.error(`Error: ${result.error}`);
      return;
    }

    // Save year-based market valuations (pass gathered data in case tab isn't active)
    if (TabValuation._saveValuations) TabValuation._saveValuations(currentItemId, updates);

    // Log quantity adjustments
    if (qtyAdjustments.length > 0) {
      DBHistory.log(currentItemId, 'Quantity', String(originalQuantity), String(pendingQty));
      qtyAdjustments.forEach(adj => {
        DBHistory.log(currentItemId, 'Quantity', adj.summary, adj.reason);
      });
    }

    Toast.success('Item saved');
    App.render();
    _dismiss();
  }

  /* ── create (new or duplicate) ─────────────────────────────── */

  function _create() {
    const updates = _gatherAllUpdates();
    if (!updates.name || !updates.name.trim()) { alert('Please enter an item name.'); return; }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      ...updates,
    };

    const result = DB.addItem(item);
    if (result && result.error) {
      Toast.error(`Cannot add: ${result.error} -- "${result.existingItem.name}" already uses serial ${item.serialNumber}`);
      return;
    }

    // Save year-based market valuations for new item (pass gathered data)
    if (TabValuation._saveValuations) TabValuation._saveValuations(item.id, updates);

    Toast.success(isDuplicate ? 'Duplicate created' : 'Item added');
    _dismiss();
    App.render();
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
    _updateSaveBtn();
  }

  /* ── unlock name ───────────────────────────────────────────── */

  function _unlockName() {
    const wrap = document.querySelector('[data-locked-for="modal-name"]');
    if (!wrap || wrap.classList.contains('unlocked')) return;
    _showConfirm('This identifier is usually set once.', (yes) => {
      if (!yes) return;
      wrap.classList.add('unlocked');
      const input = wrap.querySelector('input');
      if (input) { input.focus(); input.select(); }
    });
  }

  function _unlockCategory() {
    const locked = document.querySelector('.locked-combo[data-locked-for="modal-category"]');
    if (!locked) return;
    _showConfirm('This identifier is usually set once.', (yes) => {
      if (!yes) return;
      const real = locked.nextElementSibling;
      if (!real || !real.classList.contains('locked-combo-real')) return;
      locked.style.display = 'none';
      real.style.display = '';
      CategoryCombo.init('modal-category');
      const input = document.getElementById('modal-category');
      if (input) { input.focus(); input.select(); }
    });
  }

  /* ── serial duplicate check ────────────────────────────────── */

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

  /* ── tag dropdown ───────────────────────────────────────────── */

  function _tagsHtml(item, isDeleted) {
    const allTags = DBTags.getAll();
    const active = (item.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const dis = isDeleted ? 'disabled' : '';

    // Selected pills
    const pills = active.map(name => {
      const tag = allTags.find(t => t.name === name);
      const bg = tag?.color || '#64748b';
      return `<span class="modal-tag-pill modal-tag-active" data-tag="${_escAttr(name)}" style="--tag-color:${bg}">${_esc(name)}</span>`;
    }).join('');

    // Dropdown options
    const options = allTags.map(tag => {
      const selected = active.includes(tag.name);
      const bg = tag.color || '#94a3b8';
      return `<div class="tag-dropdown-option${selected ? ' tag-dropdown-selected' : ''}" data-tag="${_escAttr(tag.name)}" onclick="event.stopPropagation();Modal._toggleTag(this)" style="${selected ? `border-color:${bg};color:${bg}` : ''}">
        <span class="tag-dropdown-dot" style="background:${bg}"></span>
        ${_esc(tag.name)}
      </div>`;
    }).join('');

    return `
      <div class="tag-dropdown-wrap" ${dis ? 'data-disabled' : ''}>
        <button type="button" class="tag-dropdown-trigger" onclick="Modal._toggleTagDropdown()" ${dis}>
          Tags
           <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1l4 4 4-4"/></svg>
        </button>
        <div class="tag-dropdown-list" style="display:none;">
          ${options}
          <button type="button" class="tag-dropdown-add" onclick="Modal._addTagInline(event)">+ New tag</button>
        </div>
      </div>
      <div class="modal-top-tags-pills">${pills}</div>
    `;
  }

  function _toggleTagDropdown() {
    const list = document.querySelector('.tag-dropdown-list');
    if (!list) return;
    const isOpen = list.style.display !== 'none';
    list.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
      // Close on outside click
      setTimeout(() => {
        const close = (e) => {
          if (!list.contains(e.target) && !e.target.closest('.tag-dropdown-trigger')) {
            list.style.display = 'none';
            document.removeEventListener('mousedown', close);
          }
        };
        document.addEventListener('mousedown', close);
      }, 10);
    }
  }

  function _tagChanged() {
    const pillsEl = document.querySelector('.modal-top-tags-pills');
    const allTags = DBTags.getAll();
    const selected = document.querySelectorAll('.tag-dropdown-list .tag-dropdown-selected');
    const names = [...selected].map(el => el.dataset.tag);

    pillsEl.innerHTML = names.map(name => {
      const tag = allTags.find(t => t.name === name);
      const bg = tag?.color || '#64748b';
      return `<span class="modal-tag-pill modal-tag-active" data-tag="${_escAttr(name)}" style="--tag-color:${bg}">${_esc(name)}</span>`;
    }).join('');
  }

  function _toggleTag(el) {
    el.classList.toggle('tag-dropdown-selected');
    const tagName = el.dataset.tag;
    const tag = DBTags.getAll().find(t => t.name === tagName);
    const bg = tag?.color || '#94a3b8';
    if (el.classList.contains('tag-dropdown-selected')) {
      el.style.borderColor = bg;
      el.style.color = bg;
    } else {
      el.style.borderColor = '';
      el.style.color = '';
    }
    _tagChanged();
  }

  function _addTagInline(e) {
    e.stopPropagation();
    const name = prompt('New tag name:');
    if (!name?.trim()) return;
    const trimmed = name.trim();
    DBTags.add(trimmed);
    const list = document.querySelector('.tag-dropdown-list');
    const allTags = DBTags.getAll();
    const selected = [...document.querySelectorAll('.tag-dropdown-list .tag-dropdown-selected')].map(el => el.dataset.tag);
    selected.push(trimmed);
    list.innerHTML = allTags.map(tag => {
      const isSelected = selected.includes(tag.name);
      const bg = tag.color || '#94a3b8';
      return `<div class="tag-dropdown-option${isSelected ? ' tag-dropdown-selected' : ''}" data-tag="${_escAttr(tag.name)}" onclick="event.stopPropagation();Modal._toggleTag(this)" style="${isSelected ? `border-color:${bg};color:${bg}` : ''}">
        <span class="tag-dropdown-dot" style="background:${bg}"></span>
        ${_esc(tag.name)}
      </div>`;
    }).join('') + `<button type="button" class="tag-dropdown-add" onclick="Modal._addTagInline(event)">+ New tag</button>`;
    _tagChanged();
  }

  function _gatherTags() {
    const selected = document.querySelectorAll('.tag-dropdown-list .tag-dropdown-selected');
    return [...selected].map(el => el.dataset.tag).join(',');
  }

  function _confirmDelete() {
    if (!currentItemId) return;
    const item = DB.getById(currentItemId);
    if (!item) return;
    const isDel = DB.isDeleted(currentItemId);
    if (isDel) { alert(`"${item.name}" is already deleted.`); return; }
    _showConfirm(`"${item.name}" will be hidden from lists but kept in the activity log.`, (yes) => {
      if (!yes) return;
      DB.deleteItem(currentItemId);
      Toast.success(`"${item.name}" deleted`);
      _dismiss();
      App.render();
    }, 'Delete');
  }

  /* ── shared form helpers ───────────────────────────────────── */

  function _statusOptions(selected) {
    return DB.getStatuses().map(s => `<option value="${_escAttr(s.name)}" ${s.name === selected ? 'selected' : ''}>${_esc(s.name)}</option>`).join('');
  }

  function _listOptions(list, selected) {
    return list.map(item => {
      const val = typeof item === 'string' ? item : item.name;
      return `<option value="${_escAttr(val)}" ${val === selected ? 'selected' : ''}>${_esc(val)}</option>`;
    }).join('');
  }

  /* ── tab bar HTML ──────────────────────────────────────────── */

  function _tabBarHtml() {
    return `<div class="modal-tab-bar">
      ${_tabs.map(t => `<button class="modal-tab-btn${t.id === _activeTab ? ' modal-tab-active' : ''}" data-tab="${t.id}" onclick="Modal._switchTab('${t.id}')">
        ${t.icon ? `<span class="modal-tab-icon">${t.icon}</span>` : ''}${_esc(t.label)}
      </button>`).join('')}
    </div>`;
  }

  /* ── assignment row (owner, assigned to, location) above tabs ─ */

  function _assignmentRowHtml(item, isDeleted) {
    const dis = isDeleted ? 'disabled' : '';
    const extraClass = isDeleted ? 'cat-combo-disabled' : '';
    return `
      <div class="modal-assignment-row">
        <div class="form-row">
          <div class="form-group">
            <label>Owner / Account</label>
            ${ListCombo.html('modal-owner', item.ownerAccount || '', extraClass)}
          </div>
          <div class="form-group">
            <label>Assigned To</label>
            ${ListCombo.html('modal-assigned-to', item.assignedTo || '', extraClass)}
          </div>
          <div class="form-group">
            <label>Location</label>
            ${ListCombo.html('modal-location', item.location || '', extraClass)}
          </div>
        </div>
      </div>`;
  }

  function _initAssignmentCombos(isDeleted) {
    ListCombo.init('modal-owner', _fetchAccounts, null, {
      allowNew: !isDeleted,
      newLabel: '+ Add new account...',
      onNew: _addAccount,
    });
    ListCombo.init('modal-assigned-to', _fetchContacts, null, {
      allowNew: !isDeleted,
      newLabel: '+ Add new contact...',
      onNew: _addContact,
    });
    ListCombo.init('modal-location', _fetchLocations, null, {
      allowNew: !isDeleted,
      newLabel: '+ Add new location...',
      onNew: _addLocation,
    });
  }

  function _fetchAccounts() {
    return DB.getAccounts().map(a => a.name).sort();
  }

  function _addAccount() {
    const name = prompt('New account name:');
    if (!name?.trim()) return;
    const trimmed = name.trim();
    DB.addAccount(trimmed, '');
    ListCombo.setVal('modal-owner', trimmed);
  }

  function _fetchContacts() {
    const account = ListCombo.val('modal-owner');
    if (account) {
      return DB.getContactNamesForAccount(account);
    }
    // No account selected — show all contacts
    const rows = DBCore.q("SELECT DISTINCT name FROM contacts ORDER BY name");
    return rows.map(r => r.name);
  }

  function _addContact() {
    const account = ListCombo.val('modal-owner');
    if (!account) {
      Toast.error('Select an account first');
      return;
    }
    // Use the prompt overlay for a quick name-only add in the modal
    _showPrompt('Add Person', 'Name', '', true, (name) => {
      if (!name?.trim()) return;
      DB.addContact({ name: name.trim(), account_name: account });
      ListCombo.setVal('modal-assigned-to', name.trim());
    });
  }

  function _fetchLocations() {
    const rows = DBCore.q("SELECT DISTINCT location FROM items WHERE location != '' AND location IS NOT NULL ORDER BY location");
    return rows.map(r => r.location);
  }

  function _addLocation() {
    const name = prompt('New location name:');
    if (name?.trim()) ListCombo.setVal('modal-location', name.trim());
  }

  /* ── render helpers ────────────────────────────────────────── */

  function _headerHtml(item, isDeleted) {
    const sc = DB.getStatusColor(item.status || 'Available');
    return `
      <div class="modal-header-bar">
        <div class="modal-header-left">
          <div class="modal-header-qty">
            <span class="modal-header-qty-label">Qty</span>
            <span id="modal-qty-value" class="modal-header-qty-num">${pendingQty}</span>
            ${!isDeleted ? `<button type="button" class="btn btn-sm" onclick="Modal._openQtyAdjust()">Adjust</button>` : ''}
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="Modal._tryClose()">&times;</button>
      </div>`;
  }

  function _topRowHtml(item, isDeleted) {
    const sc = DB.getStatusColor(item.status || 'Available');
    const isEdit = !isNewItem && !isDuplicate;
    const lockable = isEdit && !isDeleted;
    const extraClass = isDeleted ? 'cat-combo-disabled' : '';

    const nameHtml = lockable
      ? `<div class="locked-input" data-locked-for="modal-name" onclick="Modal._unlockName()">
          <input id="modal-name" class="modal-name-input" value="${_escAttr(item.name || '')}" />
        </div>`
      : `<input id="modal-name" class="modal-name-input" value="${_escAttr(item.name || '')}" placeholder="Item name" ${isDeleted ? 'disabled' : ''} />`;

    return `
      <div class="modal-top-row">
        <div class="modal-top-left">
          <div class="modal-name-row">
            ${nameHtml}
          </div>
          <div class="modal-subtitle">
            ${item.model ? `<button class="modal-serial-tag" onclick="navigator.clipboard.writeText('${_escAttr(item.model)}');Toast.success('Copied')" title="Copy">${_esc(item.model)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>` : ''}
            ${item.serialNumber ? `<button class="modal-serial-tag" onclick="navigator.clipboard.writeText('${_escAttr(item.serialNumber)}');Toast.success('Copied')" title="Copy">${_esc(item.serialNumber)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>` : ''}
            ${isDeleted ? '<span class="modal-deleted-tag">Deleted</span>' : ''}
            ${item.assignedTo ? `<span class="modal-serial-tag" style="background:#eff6ff;color:#2563eb;">${_esc(item.assignedTo)}${item.ownerAccount ? ` at ${_esc(item.ownerAccount)}` : ''}</span>` : ''}
          </div>
          <div class="modal-desc-row">
            <textarea id="modal-desc" placeholder="Description" rows="2" ${isDeleted ? 'disabled' : ''}>${_esc(item.description || '')}</textarea>
          </div>
          <div class="modal-assignment-row">
            <div class="form-row">
              <div class="form-group">
                <label>Owner / Account</label>
                ${ListCombo.html('modal-owner', item.ownerAccount || '', extraClass)}
              </div>
              <div class="form-group">
                <label>Assigned To</label>
                ${ListCombo.html('modal-assigned-to', item.assignedTo || '', extraClass)}
              </div>
              <div class="form-group">
                <label>Location</label>
                ${ListCombo.html('modal-location', item.location || '', extraClass)}
              </div>
            </div>
          </div>
        </div>
        <div class="modal-top-right">
          <div class="modal-top-fields-row">
            <div class="modal-top-field">
              <label>Category</label>
              ${lockable
                ? `<div class="locked-input locked-combo" data-locked-for="modal-category" onclick="Modal._unlockCategory()">
                    <span class="locked-combo-text">${item.category ? _esc(item.category) : '<span class="locked-placeholder">Category</span>'}</span>
                  </div>
                  <div class="locked-combo-real" style="display:none;">
                    ${CategoryCombo.html('modal-category', item.category || '', '')}
                  </div>`
                : CategoryCombo.html('modal-category', item.category || '', isDeleted ? 'cat-combo-disabled' : '')}
            </div>
            <div class="modal-top-field">
              <label>Status</label>
              <div class="modal-status-wrap" style="--status-color:${sc}">
                <select id="modal-status" class="modal-status-select" ${isDeleted ? 'disabled' : ''}>${_statusOptions(item.status || 'Available')}</select>
              </div>
            </div>
          </div>
          <div class="modal-top-field-full">
            ${_tagsHtml(item, isDeleted)}
          </div>
        </div>
      </div>`;
  }

  function _qtyAdjustHtml(disabled) {
    return `<div id="qty-adjust-panel" class="qty-adjust-panel" style="display:none;">
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
    </div>`;
  }

  function _footerHtml(mode, item) {
    if (mode === 'new' && !isDuplicate) {
      return `<div class="modal-footer-bar">
        <div class="modal-footer-left"></div>
        <div class="modal-footer-right">
          <button class="btn" onclick="Modal._tryClose()">Cancel</button>
          <button class="btn btn-primary" onclick="Modal._create()">Add Item</button>
        </div>
      </div>`;
    }
    if (mode === 'new' && isDuplicate) {
      return `<div class="modal-footer-bar">
        <div class="modal-footer-left"></div>
        <div class="modal-footer-right">
          <button class="btn" onclick="Modal._tryClose()">Cancel</button>
          <button class="btn btn-primary" onclick="Modal._create()">Save Duplicate</button>
        </div>
      </div>`;
    }
    return `<div class="modal-footer-bar">
      <div class="modal-footer-left">
        <button class="btn" onclick="Modal._confirmDelete()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          Delete
        </button>
        <button class="btn" onclick="Modal.openDuplicate('${item?.id || ''}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Duplicate
        </button>
      </div>
      <div class="modal-footer-right">
        <button class="btn" onclick="UILabels.exportSingle('${item?.id || ''}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Export Label
        </button>
        <button class="btn" onclick="Modal._tryClose()">Cancel</button>
        <button id="modal-save-btn" class="btn btn-primary btn-save-disabled" onclick="Modal._save()" disabled>Save</button>
      </div>
    </div>`;
  }

  /* ── render: edit existing item ────────────────────────────── */

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
      quantity: item.quantity, assignedTo: item.assignedTo,
      brand: item.brand, sku: item.sku, partNumber: item.partNumber,
      imei: item.imei, itemNumber: item.itemNumber,
      priceHigh: item.priceHigh, priceLow: item.priceLow,
      datePurchased: item.datePurchased, dateSold: item.dateSold,
      conditionType: item.conditionType, conditionGrade: item.conditionGrade,
      boxed: item.boxed, conditionNotes: item.conditionNotes,
      tags: item.tags,
    };
    // Stash current year's market valuations for dirty check
    const curVal = DBValuations.getForYear(item.id, new Date().getFullYear());
    snapshot._marketLow = curVal ? curVal.valueLow : '';
    snapshot._marketHigh = curVal ? curVal.valueHigh : '';
    // Stash prior years for dirty check
    const allVals = DBValuations.getForItem(item.id);
    const thisYear = new Date().getFullYear();
    snapshot._priorYears = {};
    allVals.filter(v => v.year !== thisYear).forEach(v => {
      snapshot._priorYears[v.year] = { valueLow: v.valueLow, valueHigh: v.valueHigh };
    });
    originalQuantity = item.quantity || 1;
    pendingQty = originalQuantity;
    qtyAdjustments = [];

    // Find the active tab
    const tab = _tabs.find(t => t.id === _activeTab) || _tabs[0];
    if (!tab) return;

    content.innerHTML = `
      ${_headerHtml(item, isDeleted)}
      <div class="panel-content">
        ${_topRowHtml(item, isDeleted)}
        ${_tabBarHtml()}
        ${_qtyAdjustHtml(isDeleted)}
        <div id="modal-tab-content">${tab.render(item, 'edit', isDeleted)}</div>
        ${_footerHtml('edit', item)}
      </div>
    `;

    setTimeout(() => {
      if (!isDeleted) {
        // Only init category combo if it's not locked
        const lockedCat = document.querySelector('.locked-combo[data-locked-for="modal-category"]');
        if (!lockedCat) CategoryCombo.init('modal-category');
        _setupStatusColor();
      }
      _initAssignmentCombos(isDeleted);
      if (tab.init) tab.init(item, 'edit', isDeleted);
    }, 50);
  }

  /* ── render: new item ──────────────────────────────────────── */

  function _renderNew() {
    const content = document.getElementById('modal-content');
    pendingQty = 1;

    const tab = _tabs.find(t => t.id === _activeTab) || _tabs[0];
    if (!tab) return;

    content.innerHTML = `
      ${_headerHtml({}, false)}
      <div class="panel-content">
        ${_topRowHtml({}, false)}
        ${_tabBarHtml()}
        ${_qtyAdjustHtml(false)}
        <div id="modal-tab-content">${tab.render({}, 'new', false)}</div>
        ${_footerHtml('new', null)}
      </div>
    `;

    setTimeout(() => {
      CategoryCombo.init('modal-category');
      _initAssignmentCombos(false);
      _setupStatusColor();
      if (tab.init) tab.init({}, 'new', false);
    }, 50);
  }

  /* ── render: duplicate item ────────────────────────────────── */

  function _renderDuplicate(source) {
    const content = document.getElementById('modal-content');
    pendingQty = 1;

    const tab = _tabs.find(t => t.id === _activeTab) || _tabs[0];
    if (!tab) return;

    content.innerHTML = `
      ${_headerHtml({}, false)}
      <div class="panel-content">
        <div class="duplicate-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Duplicated from <strong>${_esc(source.name)}</strong> — update fields as needed, then save.
        </div>
        ${_topRowHtml(source, false)}
        ${_tabBarHtml()}
        ${_qtyAdjustHtml(false)}
        <div id="modal-tab-content">${tab.render(source, 'duplicate', false)}</div>
        ${_footerHtml('duplicate', null)}
      </div>
    `;

    setTimeout(() => {
      CategoryCombo.init('modal-category');
      _initAssignmentCombos(false);
      _setupStatusColor();
      if (tab.init) tab.init(source, 'duplicate', false);
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

  /* ── init ──────────────────────────────────────────────────── */

  let _saveBtnPoll = null;

  function _updateSaveBtn() {
    const btn = document.getElementById('modal-save-btn');
    if (!btn) return;
    const dirty = _isDirty();
    btn.disabled = !dirty;
  }

  function _startSaveBtnPoll() {
    _stopSaveBtnPoll();
    _updateSaveBtn();
    _saveBtnPoll = setInterval(_updateSaveBtn, 300);
  }

  function _stopSaveBtnPoll() {
    if (_saveBtnPoll) { clearInterval(_saveBtnPoll); _saveBtnPoll = null; }
  }

  function init() {
    const overlay = document.getElementById('modal-overlay');
    overlay.addEventListener('click', e => { if (e.target.id === 'modal-overlay') _tryClose(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _tryClose(); });
  }

  return {
    init, open, openNew, openDuplicate, close, registerTab, _switchTab,
    _tryClose, _save, _create, _openQtyAdjust, _cancelQtyAdjust, _applyQtyAdjust,
    _confirmDelete, _checkSerialDuplicate, _unlockName, _unlockCategory, _toggleTagDropdown, _toggleTag, _tagChanged, _addTagInline, _statusOptions, _listOptions, _updateSaveBtn
  };
})();
