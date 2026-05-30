/* ── tab: details — what is this item? ────────────────────────── */

const TabDetails = (() => {

  const COPY_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;

  const tab = {
    id: 'details',
    label: 'Details',
    order: 1,
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',

    render(item, mode, isDeleted) {
      const dis = isDeleted ? 'disabled' : '';
      const extraClass = isDeleted ? 'cat-combo-disabled' : '';
      const isDup = mode === 'duplicate';
      const lockable = mode === 'edit' && !isDeleted;

      return `
        <div class="modal-form">
          <div class="form-row form-row-3">
            <div class="form-group"><label>Brand</label>
              ${_lockedCombo('modal-brand', item.brand || '', lockable, extraClass)}
            </div>
            <div class="form-group"><label>Model</label>
              ${_field('modal-model', item.model || '', 'Model / part #', lockable, dis)}
            </div>
            <div class="form-group"><label>Part Number</label>
              ${_field('modal-part-number', item.partNumber || '', 'Manufacturer part #', lockable, dis)}
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>SKU</label>
              ${_field('modal-sku', item.sku || '', 'Stock keeping unit', lockable, dis)}
            </div>
            <div class="form-group"><label>Item Number</label>
              ${_field('modal-item-number', item.itemNumber || '', 'Internal item #', lockable, dis)}
            </div>
          </div>
          <div class="form-group" style="max-width:65%;">
            <label>IMEI</label>
            ${_field('modal-imei', item.imei || '', 'Mobile device IMEI', lockable, dis)}
          </div>
          <div class="form-group" style="max-width:65%;">
            <label>Serial Number</label>
            ${_field('modal-serial', isDup ? '' : (item.serialNumber || ''), 'Serial number', lockable, dis)}
          </div>
          <div id="serial-warning" class="serial-warning" style="display:none;"></div>
          <hr class="form-divider" />
          <div class="form-group">
            <label>Notes</label>
            <textarea id="modal-notes" placeholder="Additional notes..." rows="2" ${dis}>${_esc(item.notes || '')}</textarea>
          </div>
        </div>
      `;
    },

    gather() {
      const n = v => v === '–' ? '' : v; // normalize locked dashes to empty
      return {
        brand: ListCombo.val('modal-brand'),
        model: n(_val('modal-model')),
        serialNumber: n(_val('modal-serial')),
        partNumber: n(_val('modal-part-number')),
        sku: n(_val('modal-sku')),
        imei: n(_val('modal-imei')),
        itemNumber: n(_val('modal-item-number')),
        notes: _val('modal-notes'),
      };
    },

    isDirty(snapshot, mode) {
      if (!document.getElementById('modal-model')) return false;
      if (mode === 'new') {
        return ListCombo.val('modal-brand') || _val('modal-model') || _val('modal-serial') || _val('modal-notes');
      }
      return _realVal('modal-brand', ListCombo.val('modal-brand'), snapshot.brand) ||
             _realVal('modal-model', _val('modal-model'), snapshot.model) ||
             _realVal('modal-serial', _val('modal-serial'), snapshot.serialNumber) ||
             _realVal('modal-part-number', _val('modal-part-number'), snapshot.partNumber) ||
             _realVal('modal-sku', _val('modal-sku'), snapshot.sku) ||
             _realVal('modal-imei', _val('modal-imei'), snapshot.imei) ||
             _realVal('modal-item-number', _val('modal-item-number'), snapshot.itemNumber) ||
             _val('modal-notes') !== (snapshot.notes || '');
    },

    init(item, mode, isDeleted) {
      const lockable = mode === 'edit' && !isDeleted;
      if (!lockable) {
        ListCombo.init('modal-brand', _fetchBrands, null, {
          allowNew: !isDeleted,
          newLabel: '+ Add new brand...',
          onNew: _addBrand,
        });
      }
      Modal._checkSerialDuplicate();
    },
  };

  /* ── dirty check helper: treats locked "–" as empty ─────────── */

  function _realVal(id, currentVal, snapshotVal) {
    // If field is locked and showing "–", treat as empty = match snapshot's empty
    const v = currentVal === '–' ? '' : currentVal;
    return v !== (snapshotVal || '');
  }

  /* ── field renderer (locked or normal, with copy button) ──── */

  function _field(id, value, placeholder, lockable, dis) {
    const val = _escAttr(value);
    const hasValue = value && value.trim();

    if (!lockable) {
      return `<div class="field-with-copy">
        <input id="${id}" value="${val}" placeholder="${_escAttr(placeholder)}" ${dis} />
        ${hasValue ? _copyBtn(id) : ''}
      </div>`;
    }

    const displayVal = hasValue ? val : '–';
    return `<div class="locked-input" data-locked-for="${id}" onclick="TabDetails._unlockField('${id}', '${_escAttr(placeholder)}')">
      <input id="${id}" value="${displayVal}" class="${hasValue ? '' : 'locked-dash'}" readonly />
      ${hasValue ? _copyBtn(id) : ''}
    </div>`;
  }

  function _copyBtn(id) {
    return `<button type="button" class="field-copy-btn" onclick="event.stopPropagation(); navigator.clipboard.writeText(document.getElementById('${id}')?.value?.replace(/^–$/,'') || ''); Toast.success('Copied')" title="Copy">${COPY_ICON}</button>`;
  }

  /* ── locked combo HTML (for brand) ─────────────────────────── */

  function _lockedCombo(id, value, lockable, extraClass) {
    const hasValue = value && value.trim();
    if (!lockable) {
      return `<div class="field-with-copy">
        ${ListCombo.html(id, value, extraClass)}
        ${hasValue ? _copyBtn(id) : ''}
      </div>`;
    }
    const display = hasValue ? _esc(value) : '–';
    return `<div class="locked-input locked-combo" data-locked-for="${id}" onclick="TabDetails._unlockCombo('${id}')">
      <span class="locked-combo-text ${hasValue ? '' : 'locked-dash'}">${display}</span>
      ${hasValue ? _copyBtn(id) : ''}
    </div>
    <div class="locked-combo-real" style="display:none;">
      ${ListCombo.html(id, value, extraClass)}
    </div>`;
  }

  /* ── unlock a locked field ─────────────────────────────────── */

  function _unlockField(id, placeholder) {
    const wrap = document.querySelector(`[data-locked-for="${id}"]`);
    if (!wrap || wrap.classList.contains('unlocked')) return;
    _showConfirm('This identifier is usually set once.', (yes) => {
      if (!yes) return;
      wrap.classList.add('unlocked');
      const input = wrap.querySelector('input');
      if (input) {
        if (input.value === '–') input.value = '';
        input.placeholder = placeholder;
        input.classList.remove('locked-dash');
        input.readOnly = false;
        input.focus();
        input.select();
      }
      const copyBtn = wrap.querySelector('.field-copy-btn');
      if (copyBtn) copyBtn.style.display = 'none';
    });
  }

  function _unlockCombo(id) {
    const locked = document.querySelector(`.locked-combo[data-locked-for="${id}"]`);
    if (!locked) return;
    _showConfirm('This identifier is usually set once.', (yes) => {
      if (!yes) return;
      const real = locked.nextElementSibling;
      if (!real || !real.classList.contains('locked-combo-real')) return;
      locked.style.display = 'none';
      real.style.display = '';
      ListCombo.init(id, _fetchBrands, null, {
        allowNew: true,
        newLabel: '+ Add new brand...',
        onNew: _addBrand,
      });
      const input = document.getElementById(id);
      if (input) { input.focus(); input.select(); }
    });
  }

  /* ── brand helpers ─────────────────────────────────────────── */

  function _fetchBrands() {
    const rows = DBCore.q("SELECT DISTINCT brand FROM items WHERE brand != '' AND brand IS NOT NULL ORDER BY brand");
    const used = rows.map(r => r.brand);
    const seeds = ['Apple','Cisco','Dell','HP','Lenovo','LG','Microsoft','Samsung','Ubiquiti','Logitech','APC','Fluke'];
    return [...new Set([...seeds, ...used])].sort();
  }

  function _addBrand() {
    const name = prompt('New brand name:');
    if (name?.trim()) ListCombo.setVal('modal-brand', name.trim());
  }

  Modal.registerTab(tab);

  return { tab, _unlockField, _unlockCombo };
})();
