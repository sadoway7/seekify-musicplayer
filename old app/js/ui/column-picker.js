/* ── column picker — choose visible columns + reorder ────────── */

const ColumnPicker = (() => {

  const STORAGE_KEY = 'lynq-inventory-columns';
  const USER_DEFAULT_KEY = 'lynq-inventory-columns-default';

  const ALL_COLUMNS = [
    { key: 'name',           label: 'Name',            sortable: true, required: true },
    { key: 'brand',          label: 'Brand',           sortable: true },
    { key: 'model',          label: 'Model',           sortable: true },
    { key: 'serialNumber',   label: 'Serial #',        sortable: true },
    { key: 'category',       label: 'Category',        sortable: true },
    { key: 'quantity',       label: 'Qty',             sortable: true },
    { key: 'ownerAccount',   label: 'Owner',           sortable: true },
    { key: 'assignedTo',     label: 'Assigned To',     sortable: true },
    { key: 'location',       label: 'Location',        sortable: true },
    { key: 'status',         label: 'Status',          sortable: true },
    { key: 'sku',            label: 'SKU',             sortable: true },
    { key: 'partNumber',     label: 'Part Number',     sortable: true },
    { key: 'imei',           label: 'IMEI',            sortable: true },
    { key: 'itemNumber',     label: 'Item Number',     sortable: true },
    { key: 'barcodeId',      label: 'Barcode',         sortable: true },
    { key: 'description',    label: 'Description',     sortable: false },
    { key: 'itemValue',      label: 'Value',           sortable: true },
    { key: 'salePrice',      label: 'Sale Price',      sortable: true },
    { key: 'conditionType',  label: 'Condition',       sortable: true },
    { key: 'conditionGrade', label: 'Grade',           sortable: true },
    { key: 'datePurchased',  label: 'Date Purchased',  sortable: true },
    { key: 'dateSold',       label: 'Date Sold',       sortable: true },
    { key: 'tags',           label: 'Tags',            sortable: false },
  ];

  const DEFAULT_VISIBLE = ['name','brand','model','serialNumber','category','quantity','ownerAccount','assignedTo','location','status','tags'];

  // draft = working copy while modal is open (not persisted)
  let _draft = null;
  let _original = null;

  function _configsMatch(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const norm = c => c.map(x => `${x.key}:${x.visible}:${x.order}`).join('|');
    return norm(a) === norm(b);
  }

  function _updateApplyBtn() {
    const btn = document.getElementById('column-picker-apply');
    if (!btn) return;
    const changed = !_configsMatch(_draft, _original);
    btn.disabled = !changed;
    btn.classList.toggle('btn-primary', changed);
    btn.classList.toggle('btn-disabled', !changed);
  }

  function getConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const config = JSON.parse(raw);
        // Merge in any new columns added to ALL_COLUMNS since last save
        const existingKeys = new Set(config.map(c => c.key));
        ALL_COLUMNS.forEach((col, i) => {
          if (!existingKeys.has(col.key)) {
            config.push({ key: col.key, visible: DEFAULT_VISIBLE.includes(col.key), order: config.length });
          }
        });
        // Remove columns that no longer exist
        const allKeys = new Set(ALL_COLUMNS.map(c => c.key));
        return config.filter(c => allKeys.has(c.key));
      }
    } catch(e) {}
    return getDefaultConfig();
  }

  function getDefaultConfig() {
    return ALL_COLUMNS.map((col, i) => ({
      key: col.key,
      visible: DEFAULT_VISIBLE.includes(col.key),
      order: i,
    }));
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function saveUserDefault() {
    localStorage.setItem(USER_DEFAULT_KEY, JSON.stringify(_draft || getConfig()));
  }

  function loadUserDefault() {
    try {
      const raw = localStorage.getItem(USER_DEFAULT_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return null;
  }

  function hasUserDefault() {
    return !!localStorage.getItem(USER_DEFAULT_KEY);
  }

  function getVisibleColumns() {
    const config = getConfig();
    const visible = config.filter(c => c.visible).sort((a, b) => a.order - b.order);
    return ALL_COLUMNS.filter(ac => visible.some(v => v.key === ac.key))
      .sort((a, b) => {
        const va = visible.find(v => v.key === a.key);
        const vb = visible.find(v => v.key === b.key);
        return (va?.order ?? 99) - (vb?.order ?? 99);
      });
  }

  /* ── modal ─────────────────────────────────────────────────── */

  function show() {
    const overlay = document.getElementById('column-picker-overlay');
    if (!overlay) return;
    overlay.classList.add('active');
    _original = getConfig();
    _draft = JSON.parse(JSON.stringify(_original));
    _render();
  }

  function hide() {
    _draft = null;
    const overlay = document.getElementById('column-picker-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  function _render() {
    const content = document.getElementById('column-picker-content');
    if (!content) return;

    const config = _draft || getConfig();

    const items = config
      .map(c => ({ ...c, ...ALL_COLUMNS.find(ac => ac.key === c.key) }))
      .filter(c => c.label)
      .sort((a, b) => a.order - b.order);

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3>Table Columns</h3>
        <button class="column-picker-close" onclick="ColumnPicker.hide()">&times;</button>
      </div>
      <p style="font-size:12px;color:#94a3b8;margin-bottom:10px;">Click to toggle. Drag to reorder.</p>
      <div class="column-picker-list" id="column-picker-list">
        ${items.map(item => `
          <div class="column-picker-item${item.visible ? ' column-picker-selected' : ''}" draggable="true" data-key="${item.key}" onclick="ColumnPicker._toggle('${item.key}', this)">
            <span class="column-picker-grip">&#8942;&#8942;</span>
            <span class="column-picker-dot"></span>
            <span class="column-picker-label">${item.label}</span>
            ${item.required ? '<span style="font-size:10px;color:#94a3b8;margin-left:auto;">always on</span>' : ''}
          </div>
        `).join('')}
      </div>
      <div class="column-picker-footer">
        <div class="column-picker-actions">
          <button class="btn" onclick="ColumnPicker.hide()">Cancel</button>
          <button class="btn" id="column-picker-apply" disabled onclick="ColumnPicker._apply()">Apply</button>
        </div>
        <div class="column-picker-presets">
          <button class="column-picker-link" onclick="ColumnPicker._saveDefault()">Save My Default</button>
          <span class="column-picker-sep">·</span>
          <button class="column-picker-link" onclick="ColumnPicker._loadDefault()"${hasUserDefault() ? '' : ' disabled'}>My Default</button>
          <span class="column-picker-sep">·</span>
          <button class="column-picker-link" onclick="ColumnPicker._reset()">System Default</button>
        </div>
        <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:2px;">Saved in this browser</div>
      </div>
    `;

    _setupDrag();
    _updateApplyBtn();
  }

  function _setupDrag() {
    const list = document.getElementById('column-picker-list');
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
        _syncOrder();
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!dragEl || dragEl === item) return;
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          list.insertBefore(dragEl, item);
        } else {
          list.insertBefore(dragEl, item.nextSibling);
        }
      });
    });
  }

  function _syncOrder() {
    const list = document.getElementById('column-picker-list');
    if (!list) return;
    const items = list.querySelectorAll('.column-picker-item');
    items.forEach((el, i) => {
      const entry = _draft.find(c => c.key === el.dataset.key);
      if (entry) entry.order = i;
    });
    _updateApplyBtn();
  }

  function _toggle(key, el) {
    const entry = _draft.find(c => c.key === key);
    if (!entry || entry.required) return;
    entry.visible = !entry.visible;
    el.classList.toggle('column-picker-selected', entry.visible);
    _updateApplyBtn();
  }

  function _apply() {
    if (_draft) saveConfig(_draft);
    hide();
    App.render();
  }

  function _reset() {
    _draft = getDefaultConfig();
    _render();
    _updateApplyBtn();
  }

  function _loadDefault() {
    const def = loadUserDefault();
    if (def) { _draft = JSON.parse(JSON.stringify(def)); _render(); _updateApplyBtn(); }
  }

  function _saveDefault() {
    saveUserDefault();
  }

  return { show, hide, _toggle, _apply, _reset, _saveDefault, _loadDefault, getConfig, getVisibleColumns, ALL_COLUMNS };
})();
