/* ── bulk edit modal — edit multiple items at once ────────────── */

const UIBulkEdit = (() => {

  const ALL_FIELDS = [
    { key: 'status',         label: 'Status',         type: 'select' },
    { key: 'category',       label: 'Category',       type: 'select' },
    { key: 'location',       label: 'Location',       type: 'select' },
    { key: 'ownerAccount',   label: 'Account',        type: 'select' },
    { key: 'assignedTo',     label: 'Assigned To',    type: 'select' },
    { key: 'brand',          label: 'Brand',          type: 'select' },
    { key: 'model',          label: 'Model',          type: 'text' },
    { key: 'serialNumber',   label: 'Serial #',       type: 'text', noBatch: true },
    { key: 'sku',            label: 'SKU',            type: 'text' },
    { key: 'partNumber',     label: 'Part Number',    type: 'text' },
    { key: 'imei',           label: 'IMEI',           type: 'text', noBatch: true },
    { key: 'itemNumber',     label: 'Item Number',    type: 'text' },
    { key: 'barcodeId',      label: 'Barcode',        type: 'text', readOnly: true },
    { key: 'quantity',       label: 'Qty',            type: 'number' },
    { key: 'description',    label: 'Description',    type: 'text' },
    { key: 'itemValue',      label: 'Value',          type: 'text' },
    { key: 'salePrice',      label: 'Sale Price',     type: 'text' },
    { key: 'conditionType',  label: 'Condition',      type: 'select' },
    { key: 'conditionGrade', label: 'Grade',          type: 'select' },
    { key: 'datePurchased',  label: 'Date Purchased', type: 'date' },
    { key: 'dateSold',       label: 'Date Sold',      type: 'date' },
    { key: 'tags',           label: 'Tags',           type: 'tags' },
  ];

  const DEFAULT_VISIBLE = ['serialNumber','ownerAccount','assignedTo','tags','quantity'];

  // ── draft state for column picker (session-only) ──
  let _draft = null;
  let _original = null;

  let _sessionConfig = null;

  function getDefaultConfig() {
    // Visible columns ordered as defined in DEFAULT_VISIBLE, hidden ones after
    return ALL_FIELDS.map((f, i) => ({
      key: f.key,
      visible: DEFAULT_VISIBLE.includes(f.key),
      order: DEFAULT_VISIBLE.includes(f.key) ? DEFAULT_VISIBLE.indexOf(f.key) : DEFAULT_VISIBLE.length + i,
    }));
  }

  function getVisibleFields() {
    const config = _sessionConfig || getDefaultConfig();
    return config.filter(c => c.visible).sort((a, b) => a.order - b.order).map(c => c.key);
  }

  function _configsMatch(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const norm = c => c.map(x => `${x.key}:${x.visible}:${x.order}`).join('|');
    return norm(a) === norm(b);
  }

  function _updatePickerApplyBtn() {
    const btn = document.getElementById('bulk-cp-apply');
    if (!btn) return;
    const changed = !_configsMatch(_draft, _original);
    btn.disabled = !changed;
    btn.classList.toggle('btn-primary', changed);
    btn.classList.toggle('btn-disabled', !changed);
  }

  // ── column picker panel ──

  function _showColumnPicker() {
    const overlay = document.getElementById('bulk-cp-overlay');
    if (!overlay) return;
    const currentConfig = _sessionConfig || getDefaultConfig();
    _original = JSON.parse(JSON.stringify(currentConfig));
    _draft = JSON.parse(JSON.stringify(currentConfig));
    _renderPicker();
    overlay.classList.add('active');
  }

  function _hideColumnPicker() {
    const overlay = document.getElementById('bulk-cp-overlay');
    if (overlay) overlay.classList.remove('active');
    _draft = null;
  }

  function _renderPicker() {
    const content = document.getElementById('bulk-cp-content');
    if (!content) return;
    const items = _draft
      .map(c => ({ ...c, ...ALL_FIELDS.find(f => f.key === c.key) }))
      .filter(c => c.label)
      .sort((a, b) => a.order - b.order);

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;font-size:14px;font-weight:600;">Edit Columns</h3>
        <button class="column-picker-close" onclick="UIBulkEdit._hideColumnPicker()">&times;</button>
      </div>
      <p style="font-size:12px;color:#94a3b8;margin:4px 0 10px;">Click to toggle. Drag to reorder.</p>
      <div class="column-picker-list" id="bulk-cp-list">
        ${items.map(item => `
          <div class="column-picker-item${item.visible ? ' column-picker-selected' : ''}" draggable="true" data-key="${item.key}" onclick="UIBulkEdit._cpToggle('${item.key}', this)">
            <span class="column-picker-grip">&#8942;&#8942;</span>
            <span class="column-picker-dot"></span>
            <span class="column-picker-label">${item.label}</span>
          </div>
        `).join('')}
      </div>
      <div class="column-picker-footer">
        <div class="column-picker-actions">
          <button class="btn" onclick="UIBulkEdit._hideColumnPicker()">Cancel</button>
          <button class="btn btn-disabled" id="bulk-cp-apply" disabled onclick="UIBulkEdit._cpApply()">Apply</button>
        </div>
        <div class="column-picker-presets">
          <button class="column-picker-link" onclick="UIBulkEdit._cpReset()">System Default</button>
        </div>
      </div>
    `;

    _setupPickerDrag();
    _updatePickerApplyBtn();
  }

  function _setupPickerDrag() {
    const list = document.getElementById('bulk-cp-list');
    if (!list) return;
    let dragEl = null;
    list.querySelectorAll('.column-picker-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        dragEl = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        dragEl = null;
        _syncPickerOrder();
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!dragEl || dragEl === item) return;
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) list.insertBefore(dragEl, item);
        else list.insertBefore(dragEl, item.nextSibling);
      });
    });
  }

  function _syncPickerOrder() {
    const list = document.getElementById('bulk-cp-list');
    if (!list) return;
    list.querySelectorAll('.column-picker-item').forEach((el, i) => {
      const entry = _draft.find(c => c.key === el.dataset.key);
      if (entry) entry.order = i;
    });
    _updatePickerApplyBtn();
  }

  function _cpToggle(key, el) {
    const entry = _draft.find(c => c.key === key);
    if (!entry) return;
    entry.visible = !entry.visible;
    el.classList.toggle('column-picker-selected', entry.visible);
    _updatePickerApplyBtn();
  }

  function _cpApply() {
    if (_draft) _sessionConfig = JSON.parse(JSON.stringify(_draft));
    document.getElementById('bulk-cp-overlay').classList.remove('active');
    _draft = null;
    _reRender();
  }

  // Re-render table only (keeps _sessionConfig intact)
  function _reRender() {
    const overlay = document.getElementById('bulk-edit-overlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    open(true);
  }

  function _cpReset() {
    _draft = getDefaultConfig();
    _renderPicker();
  }

  // ── main modal ──

  function open(skipReset) {
    const ids = App.getSelectedIds();
    if (!ids.length) return;

    // Start with system defaults only on first open
    if (!skipReset) _sessionConfig = null;

    const items = ids.map(id => DB.getById(id)).filter(Boolean);
    const statuses = DB.getStatuses().map(s => s.name);
    const categories = DB.getCategoriesWithSubs();
    const catHtml = _buildCategorySelect(categories);
    const locations = DB.getLocations();
    const accounts = DB.getAccounts().map(a => a.name);
    const allTags = DB.getTags ? DB.getTags() : [];
    const contacts = DB.getContacts().map(c => c.name);
    const brands = DBCore.q("SELECT DISTINCT brand FROM items WHERE brand != '' AND brand IS NOT NULL ORDER BY brand").map(r => r.brand);
    const visible = getVisibleFields();

    const overlay = document.getElementById('bulk-edit-overlay');
    const content = document.getElementById('bulk-edit-content');

    const conditionOpts = ['New','Excellent','Good','Fair','Poor','For Parts'];
    const gradeOpts = ['A','B','C','D','F'];

    // Build a batch cell for a given field
    function batchCell(f) {
      const id = 'bulk-batch-' + _fieldToId(f.key);
      if (f.type === 'tags') return `<div class="form-group"><label>Add Tag</label><select id="${id}"><option value="">— skip —</option>${allTags.map(t => `<option value="${_escAttr(t.name)}">${_esc(t.name)}</option>`).join('')}</select></div>`;
      if (f.key === 'status') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${statuses.map(s => `<option value="${_escAttr(s)}">${_esc(s)}</option>`).join('')}</select></div>`;
      if (f.key === 'category') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${catHtml}</select></div>`;
      if (f.key === 'location') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${locations.map(l => `<option value="${_escAttr(l)}">${_esc(l)}</option>`).join('')}</select></div>`;
      if (f.key === 'ownerAccount') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${accounts.map(a => `<option value="${_escAttr(a)}">${_esc(a)}</option>`).join('')}</select></div>`;
      if (f.key === 'assignedTo') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${contacts.map(c => `<option value="${_escAttr(c)}">${_esc(c)}</option>`).join('')}</select></div>`;
      if (f.key === 'brand') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${brands.map(b => `<option value="${_escAttr(b)}">${_esc(b)}</option>`).join('')}</select></div>`;
      if (f.key === 'conditionType') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${conditionOpts.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>`;
      if (f.key === 'conditionGrade') return `<div class="form-group"><label>${f.label}</label><select id="${id}"><option value="">— skip —</option>${gradeOpts.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>`;
      if (f.type === 'date') return `<div class="form-group"><label>${f.label}</label><input type="date" id="${id}" /></div>`;
      if (f.type === 'number') return `<div class="form-group"><label>${f.label}</label><input type="number" id="${id}" min="1" /></div>`;
      return `<div class="form-group"><label>${f.label}</label><input type="text" id="${id}" placeholder="— skip —" /></div>`;
    }

    const batchCells = ALL_FIELDS.filter(f => visible.includes(f.key) && !f.noBatch && !f.readOnly).map(f => batchCell(f)).join('');

    // Per-item cell for each visible field
    function itemCell(field, item) {
      const val = item[field.key] || '';
      if (field.readOnly) return `<td class="bulk-readonly">${_esc(val) || '<span style="color:#94a3b8">—</span>'}</td>`;
      if (field.type === 'tags') return `<td><div class="bulk-tags-cell"><span class="bulk-tags-display">${(item.tags || '').split(',').map(t => t.trim()).filter(Boolean).map(t => {
        const tag = allTags.find(at => at.name === t);
        const color = tag?.color || '#64748b';
        return `<span class="table-tag-pill bulk-tag-remove" style="border-color:${color}40;color:${color}" data-id="${item.id}" data-tag="${_escAttr(t)}" onclick="UIBulkEdit._removeTag(this)">${_esc(t)}<span class="bulk-tag-x">&times;</span></span>`;
      }).join(' ')}</span><select class="bulk-field bulk-tag-add" data-id="${item.id}"><option value="">+ Tag</option>${allTags.map(t => `<option value="${_escAttr(t.name)}">${_esc(t.name)}</option>`).join('')}</select></div></td>`;

      if (field.key === 'status') return `<td><select class="bulk-field" data-field="status" data-id="${item.id}"><option value="">— skip —</option>${statuses.map(s => `<option value="${_escAttr(s)}" ${s === val ? 'selected' : ''}>${_esc(s)}</option>`).join('')}</select></td>`;
      if (field.key === 'category') return `<td><select class="bulk-field" data-field="category" data-id="${item.id}"><option value="">— skip —</option>${categories.map(c => `<option value="${_escAttr(c.name)}" ${c.name === val ? 'selected' : ''}>${_esc(c.name)}</option>`).join('')}</select></td>`;
      if (field.key === 'location') return `<td><select class="bulk-field" data-field="location" data-id="${item.id}"><option value="">— skip —</option>${locations.map(l => `<option value="${_escAttr(l)}" ${l === val ? 'selected' : ''}>${_esc(l)}</option>`).join('')}</select></td>`;
      if (field.key === 'ownerAccount') return `<td><select class="bulk-field" data-field="ownerAccount" data-id="${item.id}"><option value="">— skip —</option>${accounts.map(a => `<option value="${_escAttr(a)}" ${a === val ? 'selected' : ''}>${_esc(a)}</option>`).join('')}</select></td>`;
      if (field.key === 'assignedTo') return `<td><select class="bulk-field" data-field="assignedTo" data-id="${item.id}"><option value="">— skip —</option>${contacts.map(c => `<option value="${_escAttr(c)}" ${c === val ? 'selected' : ''}>${_esc(c)}</option>`).join('')}</select></td>`;
      if (field.key === 'brand') return `<td><select class="bulk-field" data-field="brand" data-id="${item.id}"><option value="">— skip —</option>${brands.map(b => `<option value="${_escAttr(b)}" ${b === val ? 'selected' : ''}>${_esc(b)}</option>`).join('')}</select></td>`;
      if (field.key === 'conditionType') return `<td><select class="bulk-field" data-field="conditionType" data-id="${item.id}"><option value="">— skip —</option>${conditionOpts.map(c => `<option value="${c}" ${c === val ? 'selected' : ''}>${c}</option>`).join('')}</select></td>`;
      if (field.key === 'conditionGrade') return `<td><select class="bulk-field" data-field="conditionGrade" data-id="${item.id}"><option value="">— skip —</option>${gradeOpts.map(c => `<option value="${c}" ${c === val ? 'selected' : ''}>${c}</option>`).join('')}</select></td>`;
      if (field.type === 'date') return `<td><input type="date" class="bulk-field" data-field="${field.key}" data-id="${item.id}" value="${_escAttr(val)}" /></td>`;
      if (field.type === 'number') return `<td><input type="number" class="bulk-field" data-field="${field.key}" data-id="${item.id}" value="${val || ''}" min="1" /></td>`;
      return `<td><input type="text" class="bulk-field" data-field="${field.key}" data-id="${item.id}" value="${_escAttr(val)}" placeholder="— skip —" /></td>`;
    }

    const visibleFields = ALL_FIELDS.filter(f => visible.includes(f.key));

    content.innerHTML = `
      <div class="modal-header-bar">
        <span class="modal-title-sm">Bulk Edit (${items.length} items)</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="bulk-column-btn" onclick="UIBulkEdit._showColumnPicker()">&#9776; Columns</button>
          <button class="btn btn-sm btn-ghost" onclick="UIBulkEdit.close()">&times;</button>
        </div>
      </div>

      <div class="bulk-edit-table-wrap">
        <table class="bulk-edit-table">
          <thead>
            <tr>
              <th>Name</th>
              ${visibleFields.map(f => `<th>${f.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `<tr data-item-id="${item.id}">
              <td class="bulk-edit-name" title="${_escAttr([
                  item.name,
                  item.brand ? 'Brand: ' + item.brand : '',
                  item.model ? 'Model: ' + item.model : '',
                  item.serialNumber ? 'Serial: ' + item.serialNumber : '',
                  item.imei ? 'IMEI: ' + item.imei : '',
                  item.sku ? 'SKU: ' + item.sku : '',
                ].filter(Boolean).join('\n'))}">${_esc(item.name)}</td>
              ${visibleFields.map(f => itemCell(f, item)).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="bulk-edit-batch">
        <div class="bulk-edit-batch-label">Update draft values:</div>
        <div class="bulk-edit-batch-row">
          ${batchCells}
          <button class="btn btn-sm" onclick="UIBulkEdit._applyBatch()">Update Draft</button>
        </div>
      </div>

      <div class="modal-footer-bar">
        <div class="modal-footer-left"></div>
        <div class="modal-footer-right">
          <button class="btn btn-ghost" onclick="UIBulkEdit.close()">Cancel</button>
          <button class="btn btn-primary" onclick="UIBulkEdit._save()">Save Changes</button>
        </div>
      </div>
    `;

    overlay.classList.add('active');
  }

  function close() {
    document.getElementById('bulk-edit-overlay').classList.remove('active');
    document.getElementById('bulk-cp-overlay').classList.remove('active');
  }

  function _applyBatch() {
    const visible = getVisibleFields();
    ALL_FIELDS.filter(f => visible.includes(f.key)).forEach(f => {
      const id = 'bulk-batch-' + _fieldToId(f.key);
      const el = document.getElementById(id);
      if (!el || !el.value) return;
      const val = el.value;
      if (f.type === 'tags') {
        document.querySelectorAll('.bulk-tags-display').forEach(span => {
          if (!span.textContent.includes(val)) {
            const allTags = DB.getTags ? DB.getTags() : [];
            const tag = allTags.find(t => t.name === val);
            const color = tag?.color || '#64748b';
            span.innerHTML += ` <span class="table-tag-pill" style="border-color:${color}40;color:${color}">${_esc(val)}</span>`;
          }
        });
      } else {
        document.querySelectorAll(`.bulk-field[data-field="${f.key}"]`).forEach(fe => { fe.value = val; });
      }
    });
  }

  function _fieldToId(key) {
    if (key === 'ownerAccount') return 'account';
    if (key === 'assignedTo') return 'assigned';
    if (key === 'conditionType') return 'condition';
    if (key === 'conditionGrade') return 'condition-grade';
    if (key === 'serialNumber') return 'serial-number';
    if (key === 'partNumber') return 'part-number';
    if (key === 'itemNumber') return 'item-number';
    if (key === 'barcodeId') return 'barcode-id';
    if (key === 'itemValue') return 'item-value';
    if (key === 'salePrice') return 'sale-price';
    if (key === 'datePurchased') return 'date-purchased';
    if (key === 'dateSold') return 'date-sold';
    return key;
  }

  function _removeTag(el) {
    const id = el.dataset.id;
    const tagName = el.dataset.tag;
    el.remove();
    // Track removal via hidden input
    const row = document.querySelector(`tr[data-item-id="${id}"]`);
    if (!row) return;
    let hidden = row.querySelector('.bulk-tags-removed');
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.className = 'bulk-tags-removed';
      hidden.dataset.id = id;
      row.appendChild(hidden);
    }
    const removed = hidden.value ? hidden.value.split(',') : [];
    if (!removed.includes(tagName)) removed.push(tagName);
    hidden.value = removed.join(',');
  }

  function _save() {
    const rows = document.querySelectorAll('.bulk-edit-table tbody tr');
    const batchTagEl = document.getElementById('bulk-batch-tag');
    const batchTag = batchTagEl ? batchTagEl.value : '';
    let changed = 0;

    rows.forEach(row => {
      const id = row.dataset.itemId;
      const updates = {};
      row.querySelectorAll('.bulk-field:not(.bulk-tag-add)').forEach(sel => {
        if (sel.value) updates[sel.dataset.field] = sel.value;
      });

      // Collect current visible tags (DOM state, not DB state)
      const visiblePills = row.querySelectorAll('.bulk-tag-remove');
      const currentTags = Array.from(visiblePills).map(p => p.dataset.tag);

      // Collect removed tags
      const removedInput = row.querySelector('.bulk-tags-removed');
      const removedTags = removedInput ? removedInput.value.split(',').filter(Boolean) : [];

      // Added via per-item dropdown
      const tagSelect = row.querySelector('.bulk-tag-add');
      const addedTag = tagSelect ? tagSelect.value : '';

      // If any tag changes happened, build the final tag list
      if (removedTags.length || addedTag) {
        let tags = currentTags.slice(); // already excludes removed ones (removed from DOM)
        if (addedTag && !tags.includes(addedTag)) tags.push(addedTag);
        updates.tags = tags.join(',');
      }

      // Batch tag addition
      if (batchTag) {
        const item = DB.getById(id);
        if (item) {
          const existing = (item.tags || '').split(',').map(t => t.trim()).filter(Boolean);
          if (!existing.includes(batchTag)) {
            existing.push(batchTag);
            updates.tags = existing.join(',');
          }
        }
      }

      if (Object.keys(updates).length) {
        DB.updateItem(id, updates);
        changed++;
      }
    });

    close();
    App.clearSelection();
    App.render();
  }

  function _buildCategorySelect(categories) {
    const parents = categories.filter(c => !c.parent);
    const childMap = {};
    categories.filter(c => c.parent).forEach(c => { (childMap[c.parent] = childMap[c.parent] || []).push(c); });
    let html = '';
    parents.forEach(p => {
      const subs = childMap[p.name] || [];
      if (subs.length) {
        html += `<optgroup label="${_esc(p.name)}">`;
        subs.forEach(s => html += `<option value="${_escAttr(s.name)}">${_esc(s.name)}</option>`);
        html += '</optgroup>';
      } else {
        html += `<option value="${_escAttr(p.name)}">${_esc(p.name)}</option>`;
      }
    });
    return html;
  }

  return {
    open, close, _applyBatch, _save, _removeTag,
    _showColumnPicker, _hideColumnPicker, _renderPicker,
    _cpToggle, _cpApply, _cpReset
  };
})();
