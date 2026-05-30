/* ── filter bar rendering + filter chips ────────────────────── */

const UIFilters = (() => {

  function renderFilters(activeFilters, onChange, perPage, onPerPageChange, containerId) {
    const barId = containerId || (App.currentTab === 'archive' ? 'filter-bar-archive' : 'filter-bar-inventory');
    const el = document.getElementById(barId);
    if (!el) return;

    const isArchive = App.currentTab === 'archive';
    const statuses = DB.getStatuses();
    const locations = DB.getLocations();
    const categories = DB.getCategoriesWithSubs();
    const catOptions = [];
    const catParents = categories.filter(c => !c.parent);
    const catChildMap = {};
    categories.filter(c => c.parent).forEach(c => { (catChildMap[c.parent] = catChildMap[c.parent] || []).push(c); });
    catParents.forEach(p => {
      const subs = catChildMap[p.name] || [];
      if (subs.length) {
        catOptions.push({ value: p.name, label: '── ' + p.name + ' ──', disabled: true });
        subs.forEach(s => catOptions.push({ value: s.name, label: '  ' + s.name }));
      } else {
        catOptions.push({ value: p.name, label: p.name });
      }
    });
    const owners = DB.getOwners();
    const ppOptions = [25, 50, 100, 0];

    /* Build the filter controls once, then spread them into <td> cells.
       We use a single <td colspan="99"> with a flex inner container
       so the pills flow naturally regardless of column count. */

    el.innerHTML = `<div class="filter-row-inner">
      <div class="filter-left">
      <select class="filter-select" data-filter="status">
        <option value="All">All Statuses</option>
        ${statuses.map(s => `<option value="${_escAttr(s.name)}" ${activeFilters.status === s.name ? 'selected' : ''}>${_esc(s.name)}</option>`).join('')}
      </select>
      <select class="filter-select" data-filter="location">
        <option value="All">All Locations</option>
        ${locations.map(l => `<option value="${_escAttr(l)}" ${activeFilters.location === l ? 'selected' : ''}>${_esc(l)}</option>`).join('')}
      </select>
      ${!isArchive ? `<div class="filter-combo" id="filter-combo-category">
        <input class="filter-combo-input" type="text" placeholder="Category" autocomplete="off" value="${activeFilters.category !== 'All' ? _escAttr(activeFilters.category) : ''}" />
        <svg class="filter-combo-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1l4 4 4-4"/></svg>
        <div class="filter-combo-list" style="display:none;">
          ${catOptions.map(c => `<div class="filter-combo-option${c.disabled ? ' filter-combo-heading' : ''}${activeFilters.category === c.value ? ' filter-combo-active' : ''}" data-value="${_escAttr(c.value)}">${_esc(c.label.trim())}</div>`).join('')}
        </div>
      </div>` : ''}
      ${owners.length > 0 ? `<select class="filter-select" data-filter="owner">
        <option value="All">All Accounts</option>
        ${owners.map(o => `<option value="${_escAttr(o)}" ${activeFilters.owner === o ? 'selected' : ''}>${_esc(o)}</option>`).join('')}
      </select>` : ''}
      ${onPerPageChange ? `<select class="filter-select filter-perpage" data-action="per-page">
        ${ppOptions.map(n => `<option value="${n}" ${perPage === n ? 'selected' : ''}>${n === 0 ? 'All' : n + '/pg'}</option>`).join('')}
      </select>` : ''}
      ${!Object.values(activeFilters).every(v => v === 'All' || v === '') ? `<button class="filter-btn filter-btn-clear" data-action="clear-filters">Clear</button>` : ''}
      <button class="filter-btn filter-btn-columns" onclick="ColumnPicker.show()" title="Customize columns">&#9776; Columns</button>
      </div>
      <div class="filter-pagination" id="filter-pagination-top"></div>
    </div>`;

    el.querySelectorAll('.filter-select').forEach(sel => {
      sel.onchange = () => onChange(sel.dataset.filter, sel.value);
    });
    // Highlight active filters with blue outline
    el.querySelectorAll('.filter-select[data-filter]').forEach(sel => {
      const key = sel.dataset.filter;
      if (activeFilters[key] && activeFilters[key] !== 'All' && activeFilters[key] !== '') {
        sel.classList.add('filter-active');
      }
    });
    const comboInput = el.querySelector('.filter-combo-input');
    if (comboInput && activeFilters.category && activeFilters.category !== 'All') {
      comboInput.classList.add('filter-active');
    }
    const clearBtn = el.querySelector('[data-action="clear-filters"]');
    if (clearBtn) clearBtn.onclick = () => onChange('clear');
    const ppSelect = el.querySelector('[data-action="per-page"]');
    if (ppSelect && onPerPageChange) ppSelect.onchange = () => onPerPageChange(parseInt(ppSelect.value));

    // Wire up searchable category combo
    _initCombo('filter-combo-category', 'category', onChange);

    // Render filter chips above the table
    _renderChips(activeFilters, onChange);
  }

  /* ── filter chips (removable pills) ───────────────────────── */

  function _renderChips(activeFilters, onChange) {
    const container = document.getElementById('filter-tags');
    if (!container) return;
    container.innerHTML = '';

    const labels = { status: 'Status', location: 'Location', category: 'Category', owner: 'Account' };
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (key === 'search' || value === 'All' || value === '') return;
      // Chips removed — active filters shown via blue outline on the select
    });

    // Search chip removed — search feedback shown via blue border on the search input
  }

  /* ── searchable combo dropdown ─────────────────────────────── */

  function _initCombo(containerId, filterKey, onChange) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    const input = wrap.querySelector('.filter-combo-input');
    const list = wrap.querySelector('.filter-combo-list');
    const options = () => wrap.querySelectorAll('.filter-combo-option');
    let isOpen = false;

    function open() {
      if (isOpen) return;
      isOpen = true;
      list.style.display = 'block';
      input.value = '';
      input.placeholder = 'Type to search\u2026';
      _filterList('');
    }
    function close() {
      isOpen = false;
      list.style.display = 'none';
      input.placeholder = 'Category';
      // Restore the active filter value if one is set
      const current = App.activeFilters?.category;
      if (current && current !== 'All') input.value = current;
      else input.value = '';
    }
    function select(value) {
      input.value = value;
      close();
      onChange(filterKey, value || 'All');
    }
    function _filterList(query) {
      const q = query.toLowerCase().trim();
      const empty = list.querySelector('.filter-combo-empty');
      if (empty) empty.remove();

      if (!q) {
        // No query — show everything
        options().forEach(opt => opt.style.display = '');
        return;
      }

      // Build a map: heading text → show its children
      const allOpts = options();
      const matchedHeadings = new Set();
      // First pass: find headings that match the query
      allOpts.forEach(opt => {
        if (opt.classList.contains('filter-combo-heading') && opt.textContent.toLowerCase().includes(q)) {
          matchedHeadings.add(opt);
        }
      });

      let currentHeading = null;
      let hasVisible = false;
      allOpts.forEach(opt => {
        if (opt.classList.contains('filter-combo-heading')) {
          currentHeading = opt;
          const headingMatch = matchedHeadings.has(opt);
          opt.style.display = headingMatch ? '' : 'none';
          if (headingMatch) hasVisible = true;
          return;
        }
        // Child option — show if it matches directly OR its parent heading matches
        const textMatch = opt.textContent.toLowerCase().includes(q);
        const parentMatch = currentHeading && matchedHeadings.has(currentHeading);
        const show = textMatch || parentMatch;
        opt.style.display = show ? '' : 'none';
        if (show) {
          hasVisible = true;
          // Show parent heading if child matches
          if (currentHeading && textMatch && !parentMatch) {
            currentHeading.style.display = '';
          }
        }
      });

      if (!hasVisible) {
        const msg = document.createElement('div');
        msg.className = 'filter-combo-empty';
        msg.textContent = 'No matches';
        list.appendChild(msg);
      }
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', () => { open(); _filterList(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); input.blur(); }
      if (e.key === 'Enter') {
        const first = list.querySelector('.filter-combo-option:not(.filter-combo-heading):not([style*="display: none"])');
        if (first) select(first.dataset.value);
        else if (!input.value.trim()) select('All');
      }
    });

    list.addEventListener('click', (e) => {
      const opt = e.target.closest('.filter-combo-option');
      if (opt && !opt.classList.contains('filter-combo-heading')) select(opt.dataset.value);
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) close();
    });
  }

  return { renderFilters };
})();
