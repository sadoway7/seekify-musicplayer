/* ── shared helpers used across all modules ─────────────────── */

function _uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _barcodeId() {
  return 'INV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function _esc(s) {
  if (s === null || s === undefined) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function _escAttr(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _csvEscape(val) {
  const s = (val || '').toString();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _csvLineToArray(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function _parseCSV(csv) {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return [];

  const headers = _csvLineToArray(lines[0]).map(h => h.trim().toLowerCase());
  const fieldMap = {
    'name': 'name', 'item': 'name', 'item name': 'name', 'product': 'name',
    'description': 'description', 'desc': 'description',
    'model': 'model', 'model number': 'model', 'model #': 'model',
    'serial': 'serialNumber', 'serial number': 'serialNumber', 'serial_number': 'serialNumber', 'serial #': 'serialNumber', 's/n': 'serialNumber',
    'status': 'status', 'state': 'status',
    'location': 'location',
    'owner': 'ownerAccount', 'owner account': 'ownerAccount', 'owner_account': 'ownerAccount', 'account': 'ownerAccount', 'client': 'ownerAccount',
    'assigned to': 'assignedTo', 'assigned_to': 'assignedTo', 'assigned': 'assignedTo', 'person': 'assignedTo',
    'category': 'category', 'cat': 'category', 'type': 'category',
    'quantity': 'quantity', 'qty': 'quantity', 'count': 'quantity',
    'brand': 'brand', 'manufacturer': 'brand', 'make': 'brand',
    'sku': 'sku', 'sku #': 'sku',
    'part number': 'partNumber', 'part_number': 'partNumber', 'part #': 'partNumber', 'part no': 'partNumber',
    'imei': 'imei', 'item number': 'itemNumber', 'item_number': 'itemNumber',
    'price low': 'priceLow', 'price_low': 'priceLow', 'price (low)': 'priceLow',
    'price high': 'priceHigh', 'price_high': 'priceHigh', 'price (high)': 'priceHigh',
    'item value': 'itemValue', 'value': 'itemValue',
    'sale price': 'salePrice', 'sale_price': 'salePrice',
    'notes': 'notes', 'note': 'notes', 'comments': 'notes'
  };

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = _csvLineToArray(lines[i]);
    if (!vals.length || !vals[0].trim()) continue;
    const item = {};
    headers.forEach((h, idx) => {
      const field = fieldMap[h];
      if (field && vals[idx]) item[field] = vals[idx].trim();
    });
    if (item.name) items.push(item);
  }
  return items;
}

function _fmtTimestamp(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function _fmtDateShort(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function _downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _val(id) { return document.getElementById(id)?.value?.trim() || ''; }
function _sel(id) { return document.getElementById(id)?.value || ''; }

/* ── toast notifications ────────────────────────────────────── */

const Toast = (() => {
  let container;

  function init() {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  function show(message, type = 'info', duration = 3000) {
    if (!container) init();
    const icons = { success: '\u2713', error: '\u2717', warning: '\u26A0', info: '\u2139' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML =
      `<span class="toast-icon">${icons[type] || icons.info}</span>` +
      `<span class="toast-message">${message}</span>` +
      `<button class="toast-close" onclick="this.parentElement.remove()">\u00D7</button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  return {
    init,
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error', 5000),
    warning: (msg) => show(msg, 'warning', 4000),
    info:    (msg) => show(msg, 'info'),
  };
})();

function _buildCategorySelect(cats) {
  const parents = cats.filter(c => !c.parent);
  const childMap = {};
  cats.filter(c => c.parent).forEach(c => { (childMap[c.parent] = childMap[c.parent] || []).push(c); });
  let html = '';
  parents.forEach(p => {
    const subs = childMap[p.name] || [];
    html += `<option value="${_escAttr(p.name)}">${_esc(p.name)}</option>`;
    subs.forEach(s => {
      html += `<option value="${_escAttr(s.name)}">&nbsp;&nbsp;${_esc(s.name)}</option>`;
    });
  });
  return html;
}

/* ── generic list combobox widget (flat lists) ──────────────────── */

const ListCombo = (() => {

  function html(id, value, extraClass) {
    return `<div class="cat-combo${extraClass ? ' ' + extraClass : ''}" data-listcombo="${id}">
      <input type="text" id="${id}" class="cat-combo-input" value="${_escAttr(value || '')}"
        placeholder="Type or select..." autocomplete="off" />
      <svg class="cat-combo-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 4.5l3 3 3-3"/></svg>
      <div class="cat-combo-dropdown"></div>
    </div>`;
  }

  function init(id, fetchFn, onSelect, opts) {
    const wrap = document.querySelector(`[data-listcombo="${id}"]`);
    if (!wrap) return;
    const input = wrap.querySelector('.cat-combo-input');
    const dropdown = wrap.querySelector('.cat-combo-dropdown');
    let open = false;
    const allowNew = opts?.allowNew;
    const newLabel = opts?.newLabel || '+ New...';
    const onNew = opts?.onNew;

    function render(filter) {
      const items = fetchFn();
      const q = (filter || '').toLowerCase();
      const filtered = q ? items.filter(i => i.toLowerCase().includes(q)) : items;

      let html = '';
      if (!filtered.length && !allowNew) {
        dropdown.innerHTML = `<div class="cat-combo-empty">No matches</div>`;
        return;
      }
      filtered.forEach(item => {
        html += `<div class="cat-combo-option" data-value="${_escAttr(item)}">${_esc(item)}</div>`;
      });
      if (allowNew) {
        html += `<div class="cat-combo-option cat-combo-new" data-value="__new__">${newLabel}</div>`;
      }
      dropdown.innerHTML = html;
    }

    function show() {
      if (open) return;
      open = true;
      render('');
      dropdown.classList.add('open');
    }

    function hide() {
      open = false;
      dropdown.classList.remove('open');
    }

    input.addEventListener('focus', show);
    input.addEventListener('input', () => { if (!open) show(); render(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hide(); input.blur(); }
      if (e.key === 'Enter') {
        const val = input.value.trim();
        if (val) { if (onSelect) onSelect(val); hide(); }
      }
    });

    dropdown.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.cat-combo-option');
      if (!opt) return;
      const val = opt.dataset.value;
      if (val === '__new__') {
        hide();
        if (onNew) onNew();
        return;
      }
      input.value = val;
      if (onSelect) onSelect(val);
      hide();
    });

    document.addEventListener('mousedown', (e) => {
      if (!wrap.contains(e.target)) hide();
    });
  }

  function val(id) { return document.getElementById(id)?.value?.trim() || ''; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

  return { html, init, val, setVal };
})();

/* ── category combobox widget ────────────────────────────────── */

const CategoryCombo = (() => {

  // Build HTML for a category combobox
  // id: base id for the input
  // value: current selected value
  // extraClass: optional additional class on the wrapper
  function html(id, value, extraClass) {
    return `<div class="cat-combo${extraClass ? ' ' + extraClass : ''}" data-combo="${id}">
      <input type="text" id="${id}" class="cat-combo-input" value="${_escAttr(value || '')}"
        placeholder="Type or select category..." autocomplete="off" />
      <svg class="cat-combo-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 4.5l3 3 3-3"/></svg>
      <div class="cat-combo-dropdown"></div>
    </div>`;
  }

  // Initialize behavior after the HTML is inserted into the DOM
  function init(id, onSelect) {
    const wrap = document.querySelector(`[data-combo="${id}"]`);
    if (!wrap) return;
    const input = wrap.querySelector('.cat-combo-input');
    const dropdown = wrap.querySelector('.cat-combo-dropdown');
    let open = false;

    function buildList(filter) {
      const cats = DB.getCategoriesWithSubs();
      const parents = cats.filter(c => !c.parent);
      const childMap = {};
      cats.filter(c => c.parent).forEach(c => { (childMap[c.parent] = childMap[c.parent] || []).push(c); });

      const q = (filter || '').toLowerCase();
      let items = [];

      parents.forEach(p => {
        const subs = childMap[p.name] || [];
        const pMatch = p.name.toLowerCase().includes(q);
        const matchingSubs = subs.filter(s => pMatch || s.name.toLowerCase().includes(q));

        if (!q) {
          // No filter — parents as headers, subs as selectable
          if (matchingSubs.length) {
            items.push({ name: p.name, isParent: true });
          }
          matchingSubs.forEach(s => items.push({ name: s.name, isParent: false, isSub: true }));
        } else if (pMatch || matchingSubs.length) {
          // Filtered — parent as header if it has matching subs, subs selectable
          if (matchingSubs.length) {
            items.push({ name: p.name, isParent: true });
          }
          matchingSubs.forEach(s => items.push({ name: s.name, isParent: false, isSub: true }));
        }
      });

      return items;
    }

    function render(filter) {
      const items = buildList(filter);
      if (!items.length) {
        dropdown.innerHTML = `<div class="cat-combo-empty">No matches</div>`;
        return;
      }

      let html = '';
      items.forEach(item => {
        if (item.isParent) {
          html += `<div class="cat-combo-group">${_esc(item.name)}</div>`;
        } else if (item.isSub) {
          html += `<div class="cat-combo-option cat-combo-sub" data-value="${_escAttr(item.name)}">${_esc(item.name)}</div>`;
        } else {
          html += `<div class="cat-combo-option" data-value="${_escAttr(item.name)}">${_esc(item.name)}</div>`;
        }
      });
      dropdown.innerHTML = html;
    }

    function show() {
      if (open) return;
      open = true;
      render('');
      dropdown.classList.add('open');
    }

    function hide() {
      open = false;
      dropdown.classList.remove('open');
    }

    input.addEventListener('focus', show);
    input.addEventListener('input', () => { if (!open) show(); render(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hide(); input.blur(); }
      if (e.key === 'Enter') {
        const val = input.value.trim();
        if (val) { if (onSelect) onSelect(val); hide(); }
      }
    });

    dropdown.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.cat-combo-option');
      if (!opt) return;
      const val = opt.dataset.value;
      input.value = val;
      if (onSelect) onSelect(val);
      hide();
    });

    document.addEventListener('mousedown', (e) => {
      if (!wrap.contains(e.target)) hide();
    });
  }

  // Get/set value
  function val(id) { return document.getElementById(id)?.value?.trim() || ''; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

  return { html, init, val, setVal };
})();

function _getCurrentUser() {
  return localStorage.getItem('lynq_user') || '';
}

function _setCurrentUser(name) {
  if (name && name.trim()) localStorage.setItem('lynq_user', name.trim());
}

function _requireUser() {
  let name = _getCurrentUser();
  if (name && name.trim()) return name.trim();
  // Show prompt modal after login overlay is gone — required, no cancel
  setTimeout(() => {
    _showPrompt('Enter your name', '', '', true, (result) => {
      if (result && result.trim()) {
        _setCurrentUser(result);
        const el = document.getElementById('user-name-btn');
        if (el) el.textContent = result.trim();
      }
    });
  }, 300);
  return '';
}

/* ── reusable UI prompt (replaces browser prompt()) ────────── */

function _showPrompt(title, message, defaultValue, required, extraActions, callback) {
  // Normalize arguments: support (title, msg, default, required, callback) and (title, msg, default, required, extraActions, callback)
  if (typeof required === 'function') { callback = required; required = false; extraActions = null; }
  else if (typeof extraActions === 'function') { callback = extraActions; extraActions = null; }
  if (typeof required === 'string' || typeof required === 'boolean') { /* already correct type */ }
  else { required = false; }
  if (!Array.isArray(extraActions)) extraActions = null;
  if (typeof callback !== 'function') callback = null;

  const overlay = document.getElementById('prompt-overlay');
  const content = document.getElementById('prompt-content');
  if (!overlay || !content) return;

  // extraActions: array of { label, class, onClick }
  const extraBtns = (extraActions || []).map((a, i) =>
    `<button class="prompt-extra-btn" id="prompt-extra-${i}">${_esc(a.label)}</button>`
  ).join('');

  content.innerHTML = `
    <h3>${_esc(title)}</h3>
    ${message ? `<p>${_esc(message)}</p>` : ''}
    <input type="text" id="prompt-input" value="${_escAttr(defaultValue || '')}" />
    <div class="prompt-modal-btns">
      ${!required ? '<button class="btn" id="prompt-cancel">Cancel</button>' : ''}
      <button class="btn btn-primary" id="prompt-ok">${required ? 'Continue' : 'OK'}</button>
    </div>
    ${extraBtns ? `<div class="prompt-extra">${extraBtns}</div>` : ''}
  `;

  const input = document.getElementById('prompt-input');
  const submit = () => {
    if (required && !input.value.trim()) {
      input.style.borderColor = '#dc2626';
      input.focus();
      return;
    }
    overlay.classList.remove('active');
    if (callback) callback(input.value);
  };
  const cancel = () => {
    overlay.classList.remove('active');
    if (callback) callback(null);
  };

  const cancelBtn = document.getElementById('prompt-cancel');
  if (cancelBtn) cancelBtn.onclick = cancel;
  document.getElementById('prompt-ok').onclick = submit;
  (extraActions || []).forEach((a, i) => {
    const btn = document.getElementById(`prompt-extra-${i}`);
    if (btn) btn.onclick = () => { overlay.classList.remove('active'); a.onClick(); };
  });
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape' && !required) cancel(); };
  const shouldCapitalize = title.toLowerCase().includes('name');
  input.oninput = () => {
    input.style.borderColor = '';
    if (shouldCapitalize) {
      const pos = input.selectionStart;
      const val = input.value;
      if (val.length === 1) {
        input.value = val.toUpperCase();
      } else if (val.length > 1 && pos === 1) {
        input.value = val.charAt(0).toUpperCase() + val.slice(1);
      }
    }
  };

  overlay.classList.add('active');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

/* ── confirmation popup (no input, just Yes / Cancel) ──────── */

function _showConfirm(message, callback, yesLabel, noLabel) {
  const overlay = document.getElementById('prompt-overlay');
  const content = document.getElementById('prompt-content');
  if (!overlay || !content) { callback(false); return; }

  content.innerHTML = `
    <h3>Are you sure?</h3>
    <p>${message}</p>
    <div class="prompt-modal-btns">
      <button class="btn" id="confirm-cancel">${_esc(noLabel || 'Cancel')}</button>
      <button class="btn btn-primary" id="confirm-ok">${_esc(yesLabel || 'Yes')}</button>
    </div>
  `;

  const close = (result) => { overlay.classList.remove('active'); callback(result); };
  document.getElementById('confirm-cancel').onclick = () => close(false);
  document.getElementById('confirm-ok').onclick = () => close(true);

  overlay.onkeydown = (e) => { if (e.key === 'Escape') close(false); };
  overlay.classList.add('active');
  setTimeout(() => document.getElementById('confirm-cancel')?.focus(), 50);
}
