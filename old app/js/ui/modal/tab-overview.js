/* ── tab: overview — day-to-day fields ───────────────────────── */

const TabOverview = (() => {

  const tab = {
    id: 'overview',
    label: 'Overview',
    order: 1,
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',

    render(item, mode, isDeleted) {
      const dis = isDeleted ? 'disabled' : '';
      const isDup = mode === 'duplicate';

      return `
        <div class="modal-form">
          <div class="form-row">
            <div class="form-group"><label>Model</label><input id="modal-model" value="${_escAttr(item.model || '')}" placeholder="Model / part #" ${dis} /></div>
            <div class="form-group"><label>Serial Number</label><input id="modal-serial" value="${_escAttr(isDup ? '' : (item.serialNumber || ''))}" placeholder="Serial number" oninput="Modal._checkSerialDuplicate()" ${dis} /></div>
          </div>
          <div id="serial-warning" class="serial-warning" style="display:none;"></div>

          <div class="form-group">
            <label>Description</label>
            <textarea id="modal-desc" placeholder="Description" rows="2" ${dis}>${_esc(item.description || '')}</textarea>
          </div>

          <div class="form-section-label">Ownership & Assignment</div>
          <div class="form-row">
            <div class="form-group"><label>Owner</label>
              <select id="modal-owner" onchange="TabOverview._onOwnerChange()" ${dis}>
                <option value="">-- Us (self-owned) --</option>
                ${Modal._listOptions(DB.getAccounts().map(a => a.name), item.ownerAccount || '')}
                <option value="__new__">+ New account...</option>
              </select>
            </div>
            <div class="form-group"><label>Assigned To</label>
              <select id="modal-assigned-to" ${dis}>
                <option value="">-- Not assigned --</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group"><label>Location</label>
              <select id="modal-location" ${dis}>
                <option value="">-- None --</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Notes</label>
            <textarea id="modal-notes" placeholder="Additional notes..." rows="2" ${dis}>${_esc(item.notes || '')}</textarea>
          </div>
        </div>
      `;
    },

    gather() {
      return {
        description: _val('modal-desc'),
        model: _val('modal-model'),
        serialNumber: _val('modal-serial'),
        notes: _val('modal-notes'),
        ownerAccount: _sel('modal-owner'),
        assignedTo: _sel('modal-assigned-to'),
        location: _sel('modal-location'),
        status: _sel('modal-status'),
        category: CategoryCombo.val('modal-category'),
      };
    },

    isDirty(snapshot, mode) {
      if (mode === 'new') {
        return _val('modal-desc') || _val('modal-model') || _val('modal-serial') || _val('modal-notes');
      }
      return _val('modal-desc') !== (snapshot.description || '') ||
             _val('modal-model') !== (snapshot.model || '') ||
             _val('modal-serial') !== (snapshot.serialNumber || '') ||
             _val('modal-notes') !== (snapshot.notes || '') ||
             _sel('modal-owner') !== (snapshot.ownerAccount || '') ||
             _sel('modal-assigned-to') !== (snapshot.assignedTo || '') ||
             _sel('modal-location') !== (snapshot.location || '');
    },

    init(item, mode, isDeleted) {
      if (isDeleted) return;
      _populateAssignedTo(item.ownerAccount || '', item.assignedTo || '');
      _setupLocationDropdown(item.ownerAccount || '', item.location || '');
      _setupNewOption('modal-owner', 'account');
      Modal._checkSerialDuplicate();
    },
  };

  /* ── assigned-to dropdown ──────────────────────────────────── */

  function _populateAssignedTo(accountName, currentValue) {
    const sel = document.getElementById('modal-assigned-to');
    if (!sel) return;

    let contacts = [];
    if (accountName) {
      contacts = DB.getContactNamesForAccount(accountName);
    }
    // If current value is set but not in the list, include it anyway
    if (currentValue && !contacts.includes(currentValue)) {
      contacts.unshift(currentValue);
    }

    let html = '<option value="">-- Not assigned --</option>';
    contacts.forEach(name => {
      html += `<option value="${_escAttr(name)}" ${name === currentValue ? 'selected' : ''}>${_esc(name)}</option>`;
    });
    sel.innerHTML = html;
  }

  function _onOwnerChange() {
    const ownerVal = _sel('modal-owner');
    if (ownerVal === '__new__') return;
    _populateAssignedTo(ownerVal, '');
    _refreshLocations(ownerVal, null);
  }

  /* ── location dropdown (account-aware) ─────────────────────── */

  function _setupLocationDropdown(currentAccount, currentLocation) {
    const ownerSel = document.getElementById('modal-owner');
    const locSel = document.getElementById('modal-location');
    if (!ownerSel || !locSel) return;

    _refreshLocations(currentAccount, currentLocation);

    ownerSel.addEventListener('change', () => {
      const val = ownerSel.value;
      if (val === '__new__') return;
      _refreshLocations(val, null);
    });

    locSel.onchange = function() {
      if (this.value === '__new__') {
        const name = prompt('New location name:');
        if (name?.trim()) {
          DB.addLocation(name.trim());
          _refreshLocations(ownerSel.value, name.trim());
        } else { this.selectedIndex = 0; }
      } else if (this.value === '__new_account__') {
        const account = ownerSel.value;
        const name = prompt(`New location for "${account}":`);
        if (name?.trim()) {
          DB.addLocation(name.trim(), account);
          _refreshLocations(account, name.trim());
          Toast.success(`Location "${name.trim()}" added for ${account}`);
        } else { this.selectedIndex = 0; }
      }
    };
  }

  function _refreshLocations(selectedAccount, preserveValue) {
    const locSel = document.getElementById('modal-location');
    if (!locSel) return;

    const locs = DB.getLocations(selectedAccount || undefined);
    const accountLocs = selectedAccount ? DB.getLocationsForAccount(selectedAccount) : [];

    let html = '<option value="">-- None --</option>';
    locs.forEach(l => {
      if (!accountLocs.includes(l)) html += `<option value="${_escAttr(l)}">${_esc(l)}</option>`;
    });
    html += '<option value="__new__">+ New location...</option>';
    if (selectedAccount) {
      if (accountLocs.length) {
        html += '<option disabled>── ' + _esc(selectedAccount) + ' Locations ──</option>';
      }
      accountLocs.forEach(l => { html += `<option value="${_escAttr(l)}">${_esc(l)}</option>`; });
      html += `<option value="__new_account__">+ New "${_esc(selectedAccount)}" location...</option>`;
    }

    locSel.innerHTML = html;
    if (preserveValue && locs.concat(accountLocs).includes(preserveValue)) {
      locSel.value = preserveValue;
    }
  }

  /* ── new option handler ────────────────────────────────────── */

  function _setupNewOption(selectId, type) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const origOnchange = sel.onchange;
    sel.onchange = function() {
      if (this.value !== '__new__') { if (origOnchange) origOnchange.call(this); return; }
      if (type === 'account') {
        const name = prompt('New account name:');
        if (name?.trim()) {
          const contact = prompt('Contact (optional):') || '';
          DB.addAccount(name.trim(), contact);
          this.innerHTML = '<option value="">-- Us (self-owned) --</option>' +
            Modal._listOptions(DB.getAccounts().map(a => a.name), name.trim()) +
            '<option value="__new__">+ New account...</option>';
          this.value = name.trim();
          _populateAssignedTo(name.trim(), '');
          _refreshLocations(name.trim(), null);
        } else { this.selectedIndex = 0; }
      }
    };
  }

  Modal.registerTab(tab);

  return { tab, _onOwnerChange };
})();
