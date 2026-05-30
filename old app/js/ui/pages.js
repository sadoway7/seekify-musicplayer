/* ── archive, activity, reports page renderers ──────────────── */

const UIPages = (() => {

  function renderArchivePage(items) {
    UITable.renderTable(items, 'archive-tbody', 'archive-empty', { showDate: true, showViewOnly: true });
  }

  function renderActivityPage() {
    let activity = DB.getAllActivity(500);
    const tbody = document.getElementById('activity-tbody');
    const empty = document.getElementById('activity-empty');
    if (empty) empty.style.display = 'none';

    // Populate filter dropdowns from data
    _populateActivityFilters(activity);

    // Read active filters
    const fieldFilter = document.querySelector('[data-activity-filter="field"]')?.value || 'All';
    const userFilter = document.querySelector('[data-activity-filter="user"]')?.value || 'All';
    const searchText = (document.querySelector('.activity-search')?.value || '').toLowerCase().trim();
    const dateFrom = document.querySelector('[data-activity-filter="dateFrom"]')?.value || '';
    const dateTo = document.querySelector('[data-activity-filter="dateTo"]')?.value || '';

    // Apply filters
    if (fieldFilter !== 'All') activity = activity.filter(h => h.fieldChanged === fieldFilter);
    if (userFilter !== 'All') activity = activity.filter(h => h.changedBy === userFilter);
    if (dateFrom) activity = activity.filter(h => h.changedAt >= dateFrom);
    if (dateTo) activity = activity.filter(h => h.changedAt <= dateTo + 'T23:59:59');
    if (searchText) activity = activity.filter(h =>
      (h.itemName || '').toLowerCase().includes(searchText) ||
      (h.fieldChanged || '').toLowerCase().includes(searchText) ||
      (h.oldValue || '').toLowerCase().includes(searchText) ||
      (h.newValue || '').toLowerCase().includes(searchText) ||
      (h.changedBy || '').toLowerCase().includes(searchText)
    );

    if (!activity.length) { tbody.innerHTML = ''; if (empty) empty.style.display = 'flex'; return; }

    tbody.innerHTML = activity.map(h => `<tr class="inv-row" onclick="Modal.open('${h.itemId}')">
      <td class="activity-time">${_fmtTimestamp(h.changedAt)}</td>
      <td class="activity-item">${_esc(h.itemName)}</td>
      <td class="activity-field">${_esc(h.fieldChanged)}</td>
      <td class="activity-old">${_esc(h.oldValue) || '<span class="text-muted">\u2014</span>'}</td>
      <td class="activity-new">${_esc(h.newValue) || '<span class="text-muted">\u2014</span>'}</td>
      <td class="activity-user">${_esc(h.changedBy)}</td>
    </tr>`).join('');
  }

  function _populateActivityFilters(activity) {
    const fields = [...new Set(activity.map(h => h.fieldChanged).filter(Boolean))].sort();
    const users = [...new Set(activity.map(h => h.changedBy).filter(Boolean))].sort();

    const fieldSel = document.querySelector('[data-activity-filter="field"]');
    const userSel = document.querySelector('[data-activity-filter="user"]');

    if (fieldSel) {
      // Remove all except first option ("All Fields")
      while (fieldSel.options.length > 1) fieldSel.remove(1);
      fields.forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; fieldSel.appendChild(o); });
    }
    if (userSel) {
      while (userSel.options.length > 1) userSel.remove(1);
      users.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; userSel.appendChild(o); });
    }
  }

  function renderReportsPage() {
    const stats = DB.getStats();
    const el = document.getElementById('reports-content');
    if (!el) return;

    const statusRows = Object.entries(stats.byStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => {
        const color = DB.getStatusColor(status);
        const isArchive = DB.isArchiveStatus(status);
        const group = isArchive ? 'archived' : 'active';
        return { status, count, color, group };
      });

    const activeStatuses = statusRows.filter(r => r.group === 'active');
    const archivedStatuses = statusRows.filter(r => r.group === 'archived');

    const hasValue = stats.totalValue > 0;
    const fmtVal = (v) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    el.innerHTML = `
      <div class="reports-grid">
        <div class="report-card">
          <div class="report-card-label">Active</div>
          <div class="report-card-value">${stats.active}</div>
        </div>
        <div class="report-card">
          <div class="report-card-label">Archived</div>
          <div class="report-card-value">${stats.archived}</div>
        </div>
        <div class="report-card">
          <div class="report-card-label">Total</div>
          <div class="report-card-value">${stats.total}</div>
        </div>
        ${stats.withOwner > 0 ? `<div class="report-card">
          <div class="report-card-label">Assigned to Accounts</div>
          <div class="report-card-value">${stats.withOwner}</div>
        </div>` : ''}
        <div class="report-card report-card-highlight">
          <div class="report-card-label">Total Value</div>
          <div class="report-card-value">${fmtVal(stats.totalValue)}</div>
        </div>
      </div>

      <div class="report-sections-grid">
        <div class="report-section-card">
          <div class="report-section-title">By Status</div>
          <table class="report-table">
            <thead><tr><th>Status</th><th class="report-th-count">Items</th></tr></thead>
            <tbody>
              ${activeStatuses.map(r => `<tr>
                <td><span class="status-badge" style="color:${r.color}">${_esc(r.status)}</span></td>
                <td class="report-count">${r.count}</td>
              </tr>`).join('')}
              ${archivedStatuses.length ? `<tr><td colspan="2" class="report-group-label">Archived</td></tr>` : ''}
              ${archivedStatuses.map(r => `<tr>
                <td><span class="status-badge" style="color:${r.color}">${_esc(r.status)}</span></td>
                <td class="report-count">${r.count}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="report-section-card">
          <div class="report-section-title">By Location</div>
          <table class="report-table">
            <thead><tr><th>Location</th><th class="report-th-count">Items</th></tr></thead>
            <tbody>
              ${Object.entries(stats.byLocation)
                .filter(([loc]) => loc && loc !== 'Unknown')
                .sort((a, b) => b[1] - a[1])
                .map(([loc, count]) => `<tr>
                <td>${_esc(loc)}</td>
                <td class="report-count">${count}</td>
              </tr>`).join('')}
              ${stats.withoutSerial > 0 ? `<tr>
                <td>Without serial number</td>
                <td class="report-count">${stats.withoutSerial}</td>
              </tr>` : ''}
            </tbody>
          </table>
        </div>

        <div class="report-section-card">
          <div class="report-section-title">By Account</div>
          <table class="report-table">
            <thead><tr><th>Account</th><th class="report-th-count">Items</th></tr></thead>
            <tbody>
              ${Object.entries(stats.byAccount)
                .filter(([acct]) => acct && acct !== '')
                .sort((a, b) => b[1] - a[1])
                .map(([acct, count]) => `<tr>
                <td>${_esc(acct)}</td>
                <td class="report-count">${count}</td>
              </tr>`).join('')}
              ${stats.withoutOwner > 0 ? `<tr>
                <td>Unassigned</td>
                <td class="report-count">${stats.withoutOwner}</td>
              </tr>` : ''}
              ${!Object.keys(stats.byAccount).length ? '<tr><td colspan="2" class="text-muted">No accounts configured</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <div class="report-section-card">
          <div class="report-section-title">Value by Category</div>
          <table class="report-table">
            <thead><tr><th>Category</th><th class="report-th-count">Value</th></tr></thead>
            <tbody>
              ${Object.entries(stats.valueByCategory).length ? Object.entries(stats.valueByCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, val]) => `<tr>
                <td>${_esc(cat)}</td>
                <td class="report-count">${fmtVal(val)}</td>
              </tr>`).join('') : '<tr><td colspan="2" class="text-muted">No value data yet</td></tr>'}
              <tr class="report-total-row">
                <td>Total</td>
                <td class="report-count">${fmtVal(stats.totalValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="report-section-card">
          <div class="report-section-title">Value by Location</div>
          <table class="report-table">
            <thead><tr><th>Location</th><th class="report-th-count">Value</th></tr></thead>
            <tbody>
              ${Object.entries(stats.valueByLocation).length ? Object.entries(stats.valueByLocation)
                .sort((a, b) => b[1] - a[1])
                .map(([loc, val]) => `<tr>
                <td>${_esc(loc)}</td>
                <td class="report-count">${fmtVal(val)}</td>
              </tr>`).join('') : '<tr><td colspan="2" class="text-muted">No value data yet</td></tr>'}
              <tr class="report-total-row">
                <td>Total</td>
                <td class="report-count">${fmtVal(stats.totalValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  let _accountView = null; // null = list, string = account name to show
  let _accountDetailTab = 'people'; // 'people' | 'places' | 'items'

  function renderAccountsPage() {
    if (_accountView) return _renderAccountDetail(_accountView);

    const accounts = DB.getAccounts();
    const stats = DB.getStats();
    const el = document.getElementById('accounts-content');
    if (!el) return;

    if (!accounts.length) {
      el.innerHTML = `<div class="empty-state" style="display:flex;">
        <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
        <div class="empty-title">No accounts yet</div>
        <div class="empty-desc">Add accounts using the button above.</div>
      </div>`;
      return;
    }

    let html = '<div class="cat-groups"><div class="cat-group">';
    accounts.forEach(acct => {
      const count = stats.byAccount[acct.name] || 0;
      const contacts = DB.getContactsByAccount(acct.name);
      const menu = _itemMenu(acct.name, [
        `<button class="list-menu-item" onclick="event.stopPropagation();UIPages._renameAccount('${_escAttr(acct.name)}')">Edit</button>`,
        `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._deleteAccount('${_escAttr(acct.name)}')">Delete</button>`,
      ]);
      html += `<div class="cat-parent" onclick="UIPages.openAccount('${_escAttr(acct.name)}')">
        <div class="cat-parent-info">
          <span class="cat-parent-name">${_esc(acct.name)}</span>
          ${acct.contact ? `<span class="cat-parent-subs" style="background:transparent;color:var(--text-secondary);">${_esc(acct.contact)}</span>` : ''}
          ${contacts.length ? `<span class="cat-parent-subs" style="background:transparent;color:var(--primary);">${contacts.length} contact${contacts.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="cat-parent-right">
          <span class="cat-parent-count">${count > 0 ? count + ' item' + (count !== 1 ? 's' : '') : 'No items'}</span>
          ${menu}
          <span class="account-list-arrow">&#8250;</span>
        </div>
      </div>`;
    });
    html += '</div></div>';
    el.innerHTML = html;
  }

  function openAccount(name) {
    _accountView = name;
    _accountDetailTab = 'people';
    renderAccountsPage();
  }

  function closeAccount() {
    _accountView = null;
    _accountDetailTab = 'people';
    renderAccountsPage();
  }

  function _switchAccountDetailTab(tab) {
    _accountDetailTab = tab;
    _renderAccountDetail(_accountView);
  }

  function _renderAccountDetail(acctName) {
    const el = document.getElementById('accounts-content');
    if (!el) return;

    const acct = DB.getAccounts().find(a => a.name === acctName);
    const contacts = DB.getContactsByAccount(acctName);
    const locations = DB.getLocationsForAccount(acctName);
    const items = DB.getActive({ owner: acctName });
    // Also find items assigned to people at this account
    const assignedItems = DB.getActive({}).filter(i => {
      if (i.ownerAccount === acctName) return false; // already in owned items
      const contact = contacts.find(c => c.name === i.assignedTo);
      return !!contact;
    });

    const tab = _accountDetailTab || 'people';

    let tabContent = '';
    if (tab === 'people') {
      tabContent = _renderAccountPeople(acctName, contacts);
    } else if (tab === 'places') {
      tabContent = _renderAccountPlaces(acctName, locations);
    } else if (tab === 'items') {
      tabContent = _renderAccountItems(acctName, items);
    } else if (tab === 'assigned') {
      tabContent = _renderAccountAssigned(acctName, assignedItems, contacts);
    }

    el.innerHTML = `
      <div class="account-detail-header">
        <button class="btn btn-sm btn-ghost" onclick="UIPages.closeAccount()">&larr; Accounts</button>
        <span class="account-detail-name">${_esc(acctName)}</span>
        ${acct?.contact ? `<span class="account-detail-contact">${_esc(acct.contact)}</span>` : ''}
      </div>
      <div class="account-detail-tabs">
        <button class="account-detail-tab${tab === 'people' ? ' active' : ''}" onclick="UIPages._switchAccountDetailTab('people')">People (${contacts.length})</button>
        <button class="account-detail-tab${tab === 'places' ? ' active' : ''}" onclick="UIPages._switchAccountDetailTab('places')">Places (${locations.length})</button>
        <button class="account-detail-tab${tab === 'items' ? ' active' : ''}" onclick="UIPages._switchAccountDetailTab('items')">Owned Items (${items.length})</button>
        ${assignedItems.length ? `<button class="account-detail-tab${tab === 'assigned' ? ' active' : ''}" onclick="UIPages._switchAccountDetailTab('assigned')">Assigned Here (${assignedItems.length})</button>` : ''}
      </div>
      ${tabContent}
    `;
  }

  /* ── account people tab ────────────────────────────────────── */

  function _renderAccountPeople(acctName, contacts) {
    const stats = DB.getStats();
    let html = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
      <button class="btn btn-sm btn-primary" onclick="UIPages._addContactPrompt('${_escAttr(acctName)}')">+ Add Person</button>
    </div>`;

    if (!contacts.length) {
      html += `<div class="empty-state" style="display:flex;padding:32px;">
        <div class="empty-title">No contacts yet</div>
        <div class="empty-desc">Add people who work at ${_esc(acctName)}.</div>
      </div>`;
      return html;
    }

    html += '<div class="cat-groups"><div class="cat-group">';
    contacts.forEach(c => {
      // Count items assigned to this person
      const assignedCount = DB.getActive({}).filter(i => i.assignedTo === c.name).length;
      const menu = _itemMenu(c.name, [
        `<button class="list-menu-item" onclick="event.stopPropagation();UIPages._editContact('${_escAttr(c.id)}')">Edit</button>`,
        `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._deleteContact('${_escAttr(c.id)}','${_escAttr(c.name)}')">Delete</button>`,
      ]);
      html += `<div class="cat-parent">
        <div class="cat-parent-info">
          <span class="cat-parent-name">${_esc(c.name)}</span>
          ${c.role ? `<span class="cat-parent-subs" style="background:var(--primary-light);color:var(--primary);">${_esc(c.role)}</span>` : ''}
          ${c.email ? `<span class="cat-parent-subs" style="background:transparent;color:var(--text-secondary);">${_esc(c.email)}</span>` : ''}
          ${c.phone && !c.email ? `<span class="cat-parent-subs" style="background:transparent;color:var(--text-secondary);">${_esc(c.phone)}</span>` : ''}
        </div>
        <div class="cat-parent-right">
          <span class="cat-parent-count">${assignedCount > 0 ? assignedCount + ' item' + (assignedCount !== 1 ? 's' : '') : ''}</span>
          ${menu}
        </div>
      </div>`;
    });
    html += '</div></div>';
    return html;
  }

  /* ── account places tab ────────────────────────────────────── */

  function _renderAccountPlaces(acctName, locations) {
    const stats = DB.getStats();
    let html = '';
    if (!locations.length) {
      html += `<div class="empty-state" style="display:flex;padding:32px;">
        <div class="empty-title">No locations yet</div>
        <div class="empty-desc">Add locations for ${_esc(acctName)}.</div>
      </div>`;
      return html;
    }
    html += '<div class="cat-groups"><div class="cat-group">';
    locations.forEach(loc => {
      const count = stats.byLocation[loc] || 0;
      const menu = _itemMenu(loc, [
        `<button class="list-menu-item" onclick="event.stopPropagation();UIPages._renameLocation('${_escAttr(loc)}')">Rename</button>`,
        `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._deleteLocation('${_escAttr(loc)}')">Delete</button>`,
      ]);
      html += `<div class="cat-parent" onclick="UIPages.openLocation('${_escAttr(loc)}')">
        <div class="cat-parent-info">
          <span class="cat-parent-name">${_esc(loc)}</span>
        </div>
        <div class="cat-parent-right">
          <span class="cat-parent-count">${count > 0 ? count + ' item' + (count !== 1 ? 's' : '') : '—'}</span>
          ${menu}
          <span class="account-list-arrow">&#8250;</span>
        </div>
      </div>`;
    });
    html += '</div></div>';
    return html;
  }

  /* ── account owned items tab ───────────────────────────────── */

  function _renderAccountItems(acctName, items) {
    if (!items.length) {
      return `<div class="empty-state" style="display:flex;padding:32px;">
        <div class="empty-title">No items owned by ${_esc(acctName)}</div>
        <div class="empty-desc">Items where the owner is set to this account will appear here.</div>
      </div>`;
    }

    return `<div class="table-wrap"><table class="inv-table">
      <thead><tr><th>Name</th><th>Model</th><th>Serial #</th><th>Category</th><th>Qty</th><th>Assigned To</th><th>Status</th></tr></thead>
      <tbody>${_renderItemRows(items)}</tbody>
    </table></div>`;
  }

  /* ── account assigned items tab ────────────────────────────── */

  function _renderAccountAssigned(acctName, assignedItems, contacts) {
    if (!assignedItems.length) {
      return `<div class="empty-state" style="display:flex;padding:32px;">
        <div class="empty-title">No items assigned to people here</div>
        <div class="empty-desc">Items assigned to contacts at ${_esc(acctName)} will appear here.</div>
      </div>`;
    }

    return `<div class="table-wrap"><table class="inv-table">
      <thead><tr><th>Name</th><th>Model</th><th>Serial #</th><th>Category</th><th>Qty</th><th>Assigned To</th><th>Owner</th><th>Status</th></tr></thead>
      <tbody>${assignedItems.map(item => {
        const sc = DB.getStatusColor(item.status);
        return `<tr class="inv-row" onclick="Modal.open('${item.id}')">
          <td class="col-name"><div class="item-name">${_esc(item.name)}</div></td>
          <td>${_esc(item.model)}</td>
          <td class="col-serial">${item.serialNumber ? `<span class="serial-badge">${_esc(item.serialNumber)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td>${_esc(item.category)}</td>
          <td class="col-qty">${item.quantity !== 1 ? `<span class="qty-badge">${item.quantity}</span>` : '<span class="text-muted">1</span>'}</td>
          <td>${item.assignedTo ? `<span class="owner-badge">${_esc(item.assignedTo)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td>${item.ownerAccount ? `<span class="owner-badge">${_esc(item.ownerAccount)}</span>` : '<span class="text-muted">Us</span>'}</td>
          <td><span class="status-dot" style="background:${sc}"></span><span class="status-badge" style="color:${sc}">${_esc(item.status)}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  /* ── shared item row renderer ──────────────────────────────── */

  function _renderItemRows(items) {
    return items.map(item => {
      const sc = DB.getStatusColor(item.status);
      return `<tr class="inv-row" onclick="Modal.open('${item.id}')">
        <td class="col-name">
          <div class="item-name">${_esc(item.name)}</div>
          ${item.description ? `<div class="item-desc-preview">${_esc(item.description.substring(0, 60))}</div>` : ''}
        </td>
        <td>${_esc(item.model)}</td>
        <td class="col-serial">${item.serialNumber ? `<span class="serial-badge">${_esc(item.serialNumber)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
        <td>${_esc(item.category)}</td>
        <td class="col-qty">${item.quantity === 0 ? '<span class="qty-badge qty-zero">0</span>' : (item.quantity != null && item.quantity !== 1) ? `<span class="qty-badge">${item.quantity}</span>` : '<span class="text-muted">1</span>'}</td>
        <td>${item.assignedTo ? `<span class="owner-badge">${_esc(item.assignedTo)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
        <td><span class="status-dot" style="background:${sc}"></span><span class="status-badge" style="color:${sc}">${_esc(item.status)}</span></td>
      </tr>`;
    }).join('');
  }

  /* ── contact CRUD prompts ──────────────────────────────────── */

  function _showContactForm(title, defaults, callback) {
    const overlay = document.getElementById('prompt-overlay');
    const content = document.getElementById('prompt-content');
    if (!overlay || !content) return;

    content.innerHTML = `
      <h3>${_esc(title)}</h3>
      <div class="contact-form">
        <div class="contact-form-row">
          <label>Name</label>
          <input type="text" id="contact-name" value="${_escAttr(defaults.name || '')}" placeholder="Contact name" />
        </div>
        <div class="contact-form-row">
          <label>Role</label>
          <input type="text" id="contact-role" value="${_escAttr(defaults.role || '')}" placeholder="Role / title" />
        </div>
        <div class="contact-form-row">
          <label>Email</label>
          <input type="email" id="contact-email" value="${_escAttr(defaults.email || '')}" placeholder="Email address" />
        </div>
        <div class="contact-form-row">
          <label>Phone</label>
          <input type="tel" id="contact-phone" value="${_escAttr(defaults.phone || '')}" placeholder="Phone number" />
        </div>
      </div>
      <div class="prompt-modal-btns">
        <button class="btn" id="contact-cancel">Cancel</button>
        <button class="btn btn-primary" id="contact-ok">Save</button>
      </div>
    `;

    const nameInput = document.getElementById('contact-name');
    const submit = () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.style.borderColor = '#dc2626'; nameInput.focus(); return; }
      overlay.classList.remove('active');
      callback({
        name,
        role: document.getElementById('contact-role').value.trim(),
        email: document.getElementById('contact-email').value.trim(),
        phone: document.getElementById('contact-phone').value.trim(),
      });
    };
    const cancel = () => { overlay.classList.remove('active'); };

    document.getElementById('contact-cancel').onclick = cancel;
    document.getElementById('contact-ok').onclick = submit;
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') cancel(); };

    overlay.classList.add('active');
    setTimeout(() => nameInput.focus(), 50);
  }

  function _addContactPrompt(acctName) {
    _showContactForm('Add Person', { name: '', role: '', email: '', phone: '' }, (data) => {
      DB.addContact({ ...data, account_name: acctName });
      Toast.success(`"${data.name}" added`);
      renderAccountsPage();
    });
  }

  function _editContact(contactId) {
    const c = DB.getContactById(contactId);
    if (!c) return;
    _showContactForm('Edit Person', { name: c.name, role: c.role || '', email: c.email || '', phone: c.phone || '' }, (data) => {
      DB.updateContact(contactId, data);
      Toast.success('Contact updated');
      renderAccountsPage();
    });
  }

  function _deleteContact(contactId, contactName) {
    _showConfirm(`Items assigned to "${contactName}" will be unassigned.`, (yes) => {
      if (!yes) return;
      DB.deleteContact(contactId);
      Toast.success(`"${contactName}" deleted`);
      renderAccountsPage();
      App.render();
    }, 'Delete');
  }

  let _locationView = null;

  function renderLocationsPage() {
    if (_locationView) return _renderLocationDetail(_locationView);

    const locations = DB.getLocationsWithAccount();
    const stats = DB.getStats();
    const el = document.getElementById('locations-content');
    if (!el) return;

    if (!locations.length) {
      el.innerHTML = `<div class="empty-state" style="display:flex;">
        <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
        <div class="empty-title">No locations yet</div>
        <div class="empty-desc">Add locations using the button above.</div>
      </div>`;
      return;
    }

    // Group: global locations first, then account-scoped
    const global = locations.filter(l => !l.accountName);
    const scoped = locations.filter(l => l.accountName);
    const byAccount = {};
    scoped.forEach(l => { (byAccount[l.accountName] = byAccount[l.accountName] || []).push(l); });

    let html = '<div class="cat-groups">';

    // Global locations
    if (global.length) {
      html += '<div class="cat-group">';
      global.forEach(loc => {
        const count = stats.byLocation[loc.name] || 0;
        const menu = _itemMenu(loc.name, [
          `<button class="list-menu-item" onclick="event.stopPropagation();UIPages._renameLocation('${_escAttr(loc.name)}')">Rename</button>`,
          `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._deleteLocation('${_escAttr(loc.name)}')">Delete</button>`,
        ]);
        html += `<div class="cat-parent" onclick="UIPages.openLocation('${_escAttr(loc.name)}')">
          <div class="cat-parent-info">
            <span class="cat-parent-name">${_esc(loc.name)}</span>
          </div>
          <div class="cat-parent-right">
            <span class="cat-parent-count">${count > 0 ? count + ' item' + (count !== 1 ? 's' : '') : 'No items'}</span>
            ${menu}
            <span class="account-list-arrow">&#8250;</span>
          </div>
        </div>`;
      });
      html += '</div>';
    }

    // Account-scoped locations
    Object.entries(byAccount).forEach(([acct, locs]) => {
      html += `<div class="cat-group">
        <div class="cat-group-header">${_esc(acct)} Locations</div>`;
      locs.forEach(loc => {
        const count = stats.byLocation[loc.name] || 0;
        const menu = _itemMenu(loc.name, [
          `<button class="list-menu-item" onclick="event.stopPropagation();UIPages._renameLocation('${_escAttr(loc.name)}')">Rename</button>`,
          `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._deleteLocation('${_escAttr(loc.name)}')">Delete</button>`,
        ]);
        html += `<div class="cat-sub" onclick="UIPages.openLocation('${_escAttr(loc.name)}')">
          <div class="cat-sub-info">
            <span class="cat-sub-name">${_esc(loc.name)}</span>
          </div>
          <div class="cat-sub-right">
            <span class="cat-sub-count">${count > 0 ? count + ' item' + (count !== 1 ? 's' : '') : '\u2014'}</span>
            ${menu}
            <span class="account-list-arrow">&#8250;</span>
          </div>
        </div>`;
      });
      html += '</div>';
    });

    html += '</div>';
    el.innerHTML = html;
  }

  function _addLocationPrompt() {
    const name = prompt('Location name:');
    if (!name?.trim()) return;
    DB.addLocation(name.trim());
    Toast.success(`Location "${name.trim()}" added`);
    renderLocationsPage();
    App.render();
  }

  function _renameLocation(oldName) {
    const newName = prompt('Rename location:', oldName);
    if (!newName?.trim() || newName.trim() === oldName) return;
    DB.updateLocation(oldName, newName.trim());
    Toast.success(`Renamed to "${newName.trim()}"`);
    renderLocationsPage();
    App.render();
  }

  function _deleteLocation(name) {
    _confirmDelete('location', name, 'location');
  }

  function _deleteCategory(name) {
    _confirmDelete('category', name, 'category');
  }

  function _deleteAccount(name) {
    _confirmDelete('account', name, 'owner_account');
  }

  function _confirmDeleteStatus(name) {
    _confirmDelete('status', name, 'status', function() {
      // Re-open the statuses modal after delete
      document.getElementById('delete-confirm-overlay').classList.remove('active');
      Toast.success(`"${name}" deleted`);
      App.render();
      UIManage.show('statuses');
    });
  }

  function _renameAccount(oldName) {
    const acct = DB.getAccounts().find(a => a.name === oldName);
    const newName = prompt('Account name:', oldName);
    if (!newName?.trim() || newName.trim() === oldName) return;
    const contact = prompt('Contact info:', acct?.contact || '');
    DB.updateAccount(oldName, newName.trim(), contact || '');
    Toast.success(`Renamed to "${newName.trim()}"`);
    renderAccountsPage();
    App.render();
  }

  function _addAccountPrompt() {
    const name = prompt('Account name:');
    if (!name?.trim()) return;
    const contact = prompt('Contact (optional):') || '';
    DB.addAccount(name.trim(), contact);
    Toast.success(`Account "${name.trim()}" added`);
    renderAccountsPage();
    App.render();
  }

  function openLocation(name) {
    _locationView = name;
    renderLocationsPage();
  }

  function closeLocation() {
    _locationView = null;
    renderLocationsPage();
  }

  function _renderLocationDetail(locName) {
    const el = document.getElementById('locations-content');
    if (!el) return;

    const items = DB.getActive({ location: locName });

    el.innerHTML = `
      <div class="account-detail-header">
        <button class="btn btn-sm btn-ghost" onclick="UIPages.closeLocation()">&larr; Locations</button>
        <span class="account-detail-name">${_esc(locName)}</span>
      </div>
      <div class="table-wrap">
        <table class="inv-table">
          <thead>
            <tr>
              <th>Name</th><th>Model</th><th>Serial #</th><th>Category</th><th>Qty</th><th>Account</th><th>Status</th>
            </tr>
          </thead>
          <tbody id="location-detail-tbody"></tbody>
        </table>
        ${!items.length ? `<div class="empty-state" style="display:flex;">
          <div class="empty-title">No items at this location</div>
          <div class="empty-desc">Assign items to this location from the inventory page.</div>
        </div>` : ''}
      </div>`;

    const tbody = document.getElementById('location-detail-tbody');
    if (tbody && items.length) {
      tbody.innerHTML = items.map(item => {
        const sc = DB.getStatusColor(item.status);
        return `<tr class="inv-row" onclick="Modal.open('${item.id}')">
          <td class="col-name">
            <div class="item-name">${_esc(item.name)}</div>
            ${item.description ? `<div class="item-desc-preview">${_esc(item.description.substring(0, 60))}</div>` : ''}
          </td>
          <td>${_esc(item.model)}</td>
          <td class="col-serial">${item.serialNumber ? `<span class="serial-badge">${_esc(item.serialNumber)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td>${_esc(item.category)}</td>
          <td class="col-qty">${item.quantity === 0 ? '<span class="qty-badge qty-zero">0</span>' : (item.quantity != null && item.quantity !== 1) ? `<span class="qty-badge">${item.quantity}</span>` : '<span class="text-muted">1</span>'}</td>
          <td>${item.ownerAccount ? `<span class="owner-badge">${_esc(item.ownerAccount)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td><span class="status-dot" style="background:${sc}"></span><span class="status-badge" style="color:${sc}">${_esc(item.status)}</span></td>
        </tr>`;
      }).join('');
    }
  }

  let _categoryView = null; // null = list, string = category name to show
  let _categorySelected = null; // selected parent name for sub panel

  function renderCategoriesPage() {
    if (_categoryView) return _renderCategoryDetail(_categoryView);

    const cats = DB.getCategoriesWithSubs();
    const stats = DB.getStats();
    const el = document.getElementById('categories-content');
    if (!el) return;

    const parents = cats.filter(c => !c.parent);
    const childMap = {};
    cats.filter(c => c.parent).forEach(c => {
      (childMap[c.parent] = childMap[c.parent] || []).push(c);
    });

    if (!parents.length) {
      el.innerHTML = `<div class="empty-state" style="display:flex;">
        <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></div>
        <div class="empty-title">No categories yet</div>
        <div class="empty-desc">Add categories to organize your inventory.</div>
      </div>`;
      return;
    }

    // Build column 1: parent list
    let col1 = '<div class="cat-col">';
    parents.forEach(cat => {
      let total = stats.byCategory[cat.name] || 0;
      const subs = childMap[cat.name] || [];
      subs.forEach(s => { total += (stats.byCategory[s.name] || 0); });

      const selected = _categorySelected === cat.name;
      const action = subs.length
        ? `UIPages._selectCatParent('${_escAttr(cat.name)}')`
        : `UIPages.openCategory('${_escAttr(cat.name)}')`;

      col1 += `<div class="cat-row${selected ? ' cat-row-selected' : ''}" onclick="${action}">
        <div class="cat-row-info">
          <span class="cat-row-name">${_esc(cat.name)}</span>
          ${subs.length ? `<span class="cat-row-badge">${subs.length}</span>` : ''}
        </div>
        <div class="cat-row-right">
          <span class="cat-row-count">${total > 0 ? total + ' item' + (total !== 1 ? 's' : '') : '\u2014'}</span>
          ${_itemMenu(cat.name)}
          ${subs.length ? '<span class="account-list-arrow cat-row-arrow">&#8250;</span>' : ''}
        </div>
      </div>`;
    });
    col1 += '</div>';

    // Build column 2: subcategories for selected parent
    let col2 = '';
    if (_categorySelected) {
      const subs = childMap[_categorySelected] || [];
      col2 += `<div class="cat-col-subs"><div class="cat-subs-inner">`;
      subs.forEach(sub => {
        const subCount = stats.byCategory[sub.name] || 0;
        col2 += `<div class="cat-row cat-row-sub" onclick="UIPages.openCategory('${_escAttr(sub.name)}')">
          <div class="cat-row-info">
            <span class="cat-row-name">${_esc(sub.name)}</span>
          </div>
          <div class="cat-row-right">
            <span class="cat-row-count">${subCount > 0 ? subCount : '\u2014'}</span>
            ${_itemMenu(sub.name)}
            <span class="account-list-arrow">&#8250;</span>
          </div>
        </div>`;
      });
      col2 += `<button class="cat-row cat-row-add" onclick="UIPages._addSubCategory('${_escAttr(_categorySelected)}')">+ Add subcategory</button>`;
      col2 += '</div></div>';
    }

    el.innerHTML = `<div class="cat-two-col">${col1}${col2}</div>`;

    // Align sub column to the selected parent row
    if (_categorySelected) {
      const rows = el.querySelectorAll('.cat-col:first-child .cat-row');
      const subsInner = el.querySelector('.cat-subs-inner');
      const parentCol = el.querySelector('.cat-col');
      if (!subsInner || !parentCol) return;

      let offset = 0;
      for (const row of rows) {
        if (row.classList.contains('cat-row-selected')) break;
        offset += row.offsetHeight;
      }

      // Don't let subs extend past the parent column height
      const parentH = parentCol.offsetHeight;
      const subsH = subsInner.offsetHeight;
      if (offset + subsH > parentH) {
        offset = Math.max(0, parentH - subsH);
      }

      subsInner.style.transform = `translateY(${offset}px)`;
    }
  }

  function _selectCatParent(name) {
    _categorySelected = _categorySelected === name ? null : name;
    renderCategoriesPage();
  }

  function _addSubCategory(parentName) {
    const name = prompt('Subcategory name:');
    if (!name?.trim()) return;
    DB.addCategory(name.trim(), parentName);
    Toast.success(`"${name.trim()}" added under ${parentName}`);
    renderCategoriesPage();
    App.render();
  }

  function _renameCategory(oldName) {
    const newName = prompt('Rename category:', oldName);
    if (!newName?.trim() || newName.trim() === oldName) return;
    DB.updateCategory(oldName, newName.trim());
    Toast.success(`Renamed to "${newName.trim()}"`);
    renderCategoriesPage();
    App.render();
  }

  // Smart delete: if items use this value, ask what to do with them
  // type: 'category' | 'location' | 'account' | 'status'
  // name: the value being deleted
  // field: the DB column name (category, location, owner_account, status)
  // callback: function() to call after successful delete
  function _confirmDelete(type, name, field, callback) {
    const allowedFields = ['category', 'location', 'owner_account', 'status'];
    if (!allowedFields.includes(field)) return;
    const affected = DBCore.q(`SELECT COUNT(*) as cnt FROM items WHERE ${field} = ? AND deleted = 0`, [name])[0].cnt;

    if (affected === 0) {
      // No items affected, just delete
      _execDelete(type, name, field, 'none', callback);
      return;
    }

    // Build list of existing values (excluding the one being deleted)
    let existing = [];
    if (type === 'category') existing = DB.getCategoriesWithSubs().map(c => c.name).filter(n => n !== name);
    else if (type === 'location') existing = DB.getLocationsWithAccount().map(l => l.name).filter(n => n !== name);
    else if (type === 'status') existing = DB.getStatuses().map(s => s.name).filter(n => n !== name);
    else if (type === 'account') existing = DB.getAccounts().map(a => a.name).filter(n => n !== name);

    const overlay = document.getElementById('delete-confirm-overlay');
    const content = document.getElementById('delete-confirm-content');
    const typeLabel = { category: 'category', location: 'location', account: 'account', status: 'status' }[type];

    const existingOptions = existing.map(v => `<option value="${_escAttr(v)}">${_esc(v)}</option>`).join('');

    content.innerHTML = `<div class="modal-header-bar">
        <span class="modal-title-sm">Delete ${_esc(typeLabel)}</span>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('delete-confirm-overlay').classList.remove('active')">&times;</button>
      </div>
      <div class="delete-confirm-body">
        <p class="delete-confirm-msg"><strong>${_esc(name)}</strong> is used by <strong>${affected} item${affected !== 1 ? 's' : ''}</strong>. What should happen to those items?</p>
        <div class="delete-confirm-options">
          <label class="delete-confirm-option">
            <input type="radio" name="delete-action" value="blank" checked />
            <span>Remove the ${_esc(typeLabel)} — leave it blank on those items</span>
          </label>
          <label class="delete-confirm-option">
            <input type="radio" name="delete-action" value="existing" />
            <span>Reassign to an existing ${_esc(typeLabel)}:</span>
            <select id="delete-reassign-existing" class="delete-confirm-select">${existingOptions}</select>
          </label>
          <label class="delete-confirm-option">
            <input type="radio" name="delete-action" value="new" />
            <span>Replace with a new value:</span>
            <input id="delete-reassign-new" class="delete-confirm-input" placeholder="New ${_esc(typeLabel)} name..." />
          </label>
        </div>
        <div class="delete-confirm-actions">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('delete-confirm-overlay').classList.remove('active')">Cancel</button>
          <button class="btn btn-danger btn-sm" onclick="UIPages._execDeleteConfirm('${_escAttr(type)}','${_escAttr(name)}','${field}')">Delete & Apply</button>
        </div>
      </div>`;
    overlay.classList.add('active');
  }

  function _execDeleteConfirm(type, name, field) {
    const action = document.querySelector('input[name="delete-action"]:checked')?.value || 'blank';
    _execDelete(type, name, field, action, function() {
      document.getElementById('delete-confirm-overlay').classList.remove('active');
      Toast.success(`"${name}" deleted`);
      // Re-render the current page
      renderCategoriesPage();
      renderLocationsPage();
      renderAccountsPage();
      App.render();
    });
  }

  function _execDelete(type, name, field, action, callback) {
    const allowedFields = ['category', 'location', 'owner_account', 'status'];
    if (!allowedFields.includes(field)) return;
    let replaceWith = '';

    if (action === 'existing') {
      replaceWith = document.getElementById('delete-reassign-existing')?.value || '';
    } else if (action === 'new') {
      replaceWith = document.getElementById('delete-reassign-new')?.value?.trim() || '';
      // Create the new value if it doesn't exist
      if (replaceWith) {
        if (type === 'category') DB.addCategory(replaceWith);
        else if (type === 'location') DB.addLocation(replaceWith);
        else if (type === 'status') DB.addStatus(replaceWith);
        else if (type === 'account') DB.addAccount(replaceWith);
      }
    }

    // Reassign items
    DBCore.r(`UPDATE items SET ${field} = ? WHERE ${field} = ?`, [replaceWith, name]);

    // Delete the value itself
    if (type === 'category') DB.deleteCategory(name);
    else if (type === 'location') DB.deleteLocation(name);
    else if (type === 'status') DB.deleteStatus(name);
    else if (type === 'account') DB.deleteAccount(name);

    if (callback) callback();
  }

  function openCategory(name) {
    _categoryView = name;
    renderCategoriesPage();
  }

  // Shared dropdown menu for list items (rename, delete)
  function _itemMenu(name, actions) {
    const items = actions || [
      `<button class="list-menu-item" onclick="event.stopPropagation();UIPages._renameCategory('${_escAttr(name)}')">Rename</button>`,
      `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._deleteCategory('${_escAttr(name)}')">Delete</button>`,
    ];
    return `<div class="list-menu-wrap">
      <button class="list-menu-trigger" onclick="event.stopPropagation();UIPages._toggleMenu(this)">&#8943;</button>
      <div class="list-menu-dropdown">${items.join('')}</div>
    </div>`;
  }

  function _toggleMenu(btn) {
    document.querySelectorAll('.list-menu-wrap.open').forEach(w => { if (w !== btn.parentElement) w.classList.remove('open'); });
    btn.parentElement.classList.toggle('open');
  }

  function _addCategoryPrompt() {
    const cats = DB.getCategoriesWithSubs().filter(c => !c.parent);
    const name = prompt('Category name:');
    if (!name?.trim()) return;
    const parent = prompt('Parent category (leave blank for top-level):\n\n' + cats.map(c => c.name).join(', '));
    DB.addCategory(name.trim(), parent?.trim() || '');
    Toast.success(`Category "${name.trim()}" added`);
    _categoryView = null;
    renderCategoriesPage();
    App.render();
  }

  function closeCategory() {
    _categoryView = null;
    renderCategoriesPage();
  }

  function _renderCategoryDetail(catName) {
    const el = document.getElementById('categories-content');
    if (!el) return;

    const items = DB.getActive({ category: catName });
    const cats = DB.getCategoriesWithSubs();
    const cat = cats.find(c => c.name === catName);
    const parentName = cat?.parent || '';
    const isParent = cats.some(c => c.parent === catName);
    const subs = isParent ? cats.filter(c => c.parent === catName) : [];

    el.innerHTML = `
      <div class="account-detail-header">
        <button class="btn btn-sm btn-ghost" onclick="UIPages.closeCategory()">&larr; Categories</button>
        <span class="account-detail-name">${_esc(catName)}</span>
        ${parentName ? `<span class="manage-list-contact" style="color:var(--purple);">${_esc(parentName)}</span>` : ''}
      </div>
      ${subs.length ? `<ul class="category-subs-bar">${subs.map(s => {
        const cnt = DB.getStats().byCategory[s.name] || 0;
        return `<li class="category-subs-pill" onclick="UIPages.openCategory('${_escAttr(s.name)}')">${_esc(s.name)} <span class="category-subs-count">${cnt}</span></li>`;
      }).join('')}</ul>` : ''}
      <div class="table-wrap">
        <table class="inv-table">
          <thead>
            <tr>
              <th>Name</th><th>Model</th><th>Serial #</th><th>Qty</th><th>Location</th><th>Account</th><th>Status</th>
            </tr>
          </thead>
          <tbody id="category-detail-tbody"></tbody>
        </table>
        ${!items.length ? `<div class="empty-state" style="display:flex;">
          <div class="empty-title">No items in ${_esc(catName)}</div>
          <div class="empty-desc">Assign items to this category from the inventory page.</div>
        </div>` : ''}
      </div>`;

    const tbody = document.getElementById('category-detail-tbody');
    if (tbody && items.length) {
      tbody.innerHTML = items.map(item => {
        const sc = DB.getStatusColor(item.status);
        return `<tr class="inv-row" onclick="Modal.open('${item.id}')">
          <td class="col-name">
            <div class="item-name">${_esc(item.name)}</div>
            ${item.description ? `<div class="item-desc-preview">${_esc(item.description.substring(0, 60))}</div>` : ''}
          </td>
          <td>${_esc(item.model)}</td>
          <td class="col-serial">${item.serialNumber ? `<span class="serial-badge">${_esc(item.serialNumber)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td class="col-qty">${item.quantity === 0 ? '<span class="qty-badge qty-zero">0</span>' : (item.quantity != null && item.quantity !== 1) ? `<span class="qty-badge">${item.quantity}</span>` : '<span class="text-muted">1</span>'}</td>
          <td>${_esc(item.location) || '<span class="text-muted">\u2014</span>'}</td>
          <td>${item.ownerAccount ? `<span class="owner-badge">${_esc(item.ownerAccount)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td><span class="status-dot" style="background:${sc}"></span><span class="status-badge" style="color:${sc}">${_esc(item.status)}</span></td>
        </tr>`;
      }).join('');
    }
  }

  // Reset all drill-in views (called on tab switch so sidebar click goes to list)
  function resetViews() {
    _accountView = null;
    _accountDetailTab = 'people';
    _locationView = null;
    _categoryView = null;
    _statusView = null;
    _tagView = null;
    _categorySelected = null;
  }

  /* ── statuses page ─────────────────────────────────────────── */

  let _statusView = null;

  function renderStatusesPage() {
    if (_statusView) return _renderStatusDetail(_statusView);
    const el = document.getElementById('statuses-content');
    if (!el) return;
    const statuses = DB.getStatuses();
    const stats = DB.getStats();

    el.innerHTML = `<div class="cat-two-col"><div class="cat-col">
      ${statuses.map(s => {
        const cnt = stats.byStatus[s.name] || 0;
        return `<div class="cat-row" onclick="UIPages.openStatus('${_escAttr(s.name)}')">
          <div class="cat-row-info">
            <span class="status-dot" style="background:${s.color}"></span>
            <span class="cat-row-name">${_esc(s.name)}</span>
          </div>
          <div class="cat-row-right">
            <span class="cat-row-count">${cnt > 0 ? cnt : '\u2014'}</span>
            ${_itemMenu(s.name, [
              `<button class="list-menu-item" onclick="event.stopPropagation();UIPages._renameStatus('${_escAttr(s.name)}')">Rename</button>`,
              `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._confirmDeleteStatus('${_escAttr(s.name)}')">Delete</button>`,
            ])}
            <span class="account-list-arrow cat-row-arrow">&#8250;</span>
          </div>
        </div>`;
      }).join('')}
    </div></div>`;
  }

  function openStatus(name) { _statusView = name; renderStatusesPage(); }
  function closeStatus() { _statusView = null; renderStatusesPage(); }

  function _renderStatusDetail(statusName) {
    const el = document.getElementById('statuses-content');
    if (!el) return;
    const status = DB.getStatuses().find(s => s.name === statusName);
    const color = status?.color || '#64748b';
    const items = DB.getActive({ status: statusName });

    el.innerHTML = `
      <div class="account-detail-header">
        <button class="btn btn-sm btn-ghost" onclick="UIPages.closeStatus()">&larr; Statuses</button>
        <span class="status-dot" style="background:${color}"></span>
        <span class="account-detail-name">${_esc(statusName)}</span>
        <button class="btn btn-sm btn-ghost" style="margin-left:auto;" onclick="App.filterAndGo('status','${_escAttr(statusName)}')">View in Inventory</button>
      </div>
      <div class="table-wrap">
        <table class="inv-table">
          <thead><tr><th>Name</th><th>Model</th><th>Serial #</th><th>Qty</th><th>Category</th><th>Location</th></tr></thead>
          <tbody id="status-detail-tbody"></tbody>
        </table>
        ${!items.length ? `<div class="empty-state" style="display:flex;"><div class="empty-title">No items with status "${_esc(statusName)}"</div></div>` : ''}
      </div>`;

    const tbody = document.getElementById('status-detail-tbody');
    if (tbody && items.length) {
      tbody.innerHTML = items.map(item => `
        <tr class="inv-row" onclick="Modal.open('${item.id}')">
          <td class="col-name"><div class="item-name">${_esc(item.name)}</div></td>
          <td>${_esc(item.model) || '<span class="text-muted">\u2014</span>'}</td>
          <td class="col-serial">${item.serialNumber ? `<span class="serial-badge">${_esc(item.serialNumber)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td class="col-qty">${(item.quantity != null && item.quantity !== 1) ? `<span class="qty-badge">${item.quantity}</span>` : '<span class="text-muted">1</span>'}</td>
          <td>${_esc(item.category) || '<span class="text-muted">\u2014</span>'}</td>
          <td>${_esc(item.location) || '<span class="text-muted">\u2014</span>'}</td>
        </tr>`).join('');
    }
  }

  function _addStatusPrompt() {
    _showPrompt('New Status', 'Status name', '', true, (name) => {
      if (!name?.trim()) return;
      DB.addStatus(name.trim(), '#64748b');
      Toast.success(`Status "${name.trim()}" added`);
      renderStatusesPage();
      App.render();
    });
  }

  function _renameStatus(oldName) {
    _showPrompt('Rename Status', `Rename "${oldName}" to:`, oldName, true, (newName) => {
      if (!newName?.trim() || newName.trim() === oldName) return;
      DB.renameStatus(oldName, newName.trim());
      Toast.success(`Renamed to "${newName.trim()}"`);
      if (_statusView === oldName) _statusView = newName.trim();
      renderStatusesPage();
      App.render();
    });
  }

  /* ── tags page ─────────────────────────────────────────────── */

  let _tagView = null;

  function renderTagsPage() {
    if (_tagView) return _renderTagDetail(_tagView);
    const el = document.getElementById('tags-content');
    if (!el) return;
    let tags = [];
    try { tags = DBTags.getAll(); } catch(e) { console.error('DBTags error:', e); }
    let items = [];
    try { items = DB.getActive(); } catch(e) { console.error('getActive error:', e); }
    const tagCounts = {};
    tags.forEach(t => { tagCounts[t.name] = 0; });
    items.forEach(item => {
      (item.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });

    el.innerHTML = `<div class="cat-two-col"><div class="cat-col">
      ${tags.length ? tags.map(t => {
        const cnt = tagCounts[t.name] || 0;
        return `<div class="cat-row" onclick="UIPages.openTag('${_escAttr(t.name)}')">
          <div class="cat-row-info">
            <span class="status-dot" style="background:${t.color || '#64748b'}"></span>
            <span class="cat-row-name">${_esc(t.name)}</span>
          </div>
          <div class="cat-row-right">
            <span class="cat-row-count">${cnt > 0 ? cnt : '\u2014'}</span>
            ${_itemMenu(t.name, [
              `<button class="list-menu-item list-menu-item-danger" onclick="event.stopPropagation();UIPages._confirmDeleteTag('${_escAttr(t.name)}')">Delete</button>`,
            ])}
            <span class="account-list-arrow cat-row-arrow">&#8250;</span>
          </div>
        </div>`;
      }).join('') : '<div class="empty-state"><div class="empty-title">No tags yet</div><div class="empty-sub">Click + to add your first tag</div></div>'}
    </div></div>`;
  }

  function openTag(name) { _tagView = name; renderTagsPage(); }
  function closeTag() { _tagView = null; renderTagsPage(); }

  function _renderTagDetail(tagName) {
    const el = document.getElementById('tags-content');
    if (!el) return;
    const tag = DBTags.getByName(tagName);
    const color = tag?.color || '#64748b';
    const allItems = DB.getActive();
    const items = allItems.filter(item => {
      const tags = (item.tags || '').split(',').map(t => t.trim());
      return tags.includes(tagName);
    });

    el.innerHTML = `
      <div class="account-detail-header">
        <button class="btn btn-sm btn-ghost" onclick="UIPages.closeTag()">&larr; Tags</button>
        <span class="status-dot" style="background:${color}"></span>
        <span class="account-detail-name">${_esc(tagName)}</span>
        <button class="btn btn-sm btn-ghost" style="margin-left:auto;" onclick="App.filterAndGo('search','${_escAttr(tagName)}')">View in Inventory</button>
      </div>
      <div class="table-wrap">
        <table class="inv-table">
          <thead><tr><th>Name</th><th>Model</th><th>Serial #</th><th>Qty</th><th>Category</th><th>Status</th></tr></thead>
          <tbody id="tag-detail-tbody"></tbody>
        </table>
        ${!items.length ? `<div class="empty-state" style="display:flex;"><div class="empty-title">No items tagged "${_esc(tagName)}"</div></div>` : ''}
      </div>`;

    const tbody = document.getElementById('tag-detail-tbody');
    if (tbody && items.length) {
      tbody.innerHTML = items.map(item => {
        const sc = DB.getStatusColor(item.status);
        return `<tr class="inv-row" onclick="Modal.open('${item.id}')">
          <td class="col-name"><div class="item-name">${_esc(item.name)}</div></td>
          <td>${_esc(item.model) || '<span class="text-muted">\u2014</span>'}</td>
          <td class="col-serial">${item.serialNumber ? `<span class="serial-badge">${_esc(item.serialNumber)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
          <td class="col-qty">${(item.quantity != null && item.quantity !== 1) ? `<span class="qty-badge">${item.quantity}</span>` : '<span class="text-muted">1</span>'}</td>
          <td>${_esc(item.category) || '<span class="text-muted">\u2014</span>'}</td>
          <td><span class="status-dot" style="background:${sc}"></span><span class="status-badge" style="color:${sc}">${_esc(item.status)}</span></td>
        </tr>`;
      }).join('');
    }
  }

  function _addTagPrompt() {
    _showPrompt('New Tag', 'Tag name', '', false, (name) => {
      if (!name?.trim()) return;
      DBTags.add(name.trim());
      Toast.success(`Tag "${name.trim()}" added`);
      renderTagsPage();
    });
  }

  function _confirmDeleteTag(name) {
    _showConfirm(`Delete tag "${name}"? It will be removed from all items.`, (yes) => {
      if (!yes) return;
      const items = DB.getActive();
      items.forEach(item => {
        const tags = (item.tags || '').split(',').map(t => t.trim()).filter(t => t && t !== name);
        DB.updateItem(item.id, { tags: tags.join(',') });
      });
      DBTags.remove(DBTags.getByName(name)?.id);
      Toast.success(`Tag "${name}" deleted`);
      renderTagsPage();
      App.render();
    }, 'Delete');
  }

    return { renderArchivePage, renderActivityPage, renderReportsPage, renderAccountsPage, openAccount, closeAccount, renderLocationsPage, openLocation, closeLocation, renderCategoriesPage, openCategory, closeCategory, renderStatusesPage, renderTagsPage, resetViews, _addCategoryPrompt, _addSubCategory, _renameCategory, _deleteCategory, _toggleMenu, _selectCatParent, _renameLocation, _deleteLocation, _addLocationPrompt, _renameAccount, _deleteAccount, _addAccountPrompt, _execDeleteConfirm, _confirmDeleteStatus, _renameStatus, _addStatusPrompt, _addTagPrompt, _confirmDeleteTag, _switchAccountDetailTab, _addContactPrompt, _editContact, _deleteContact };
  })();

  // Close list menus on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.list-menu-wrap')) {
      document.querySelectorAll('.list-menu-wrap.open').forEach(w => w.classList.remove('open'));
    }
  });
