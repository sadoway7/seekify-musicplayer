/* ── app entry point — tab routing, orchestration ────────────── */

const App = (() => {
  let currentTab = 'inventory';
  let selectedIds = new Set();
  let activeFilters = { status: 'All', location: 'All', category: 'All', owner: 'All', search: '' };
  let perPage = 25;
  let currentPage = 1;

  /* ── init ──────────────────────────────────────────────────── */

  function init() {
    _requireUser();
    _updateUserName();
    _initSearchEnter();
    Toast.init();
    Modal.init();
    render();
  }

  /* ── tab switching ─────────────────────────────────────────── */

  function switchTab(tab) {
    currentTab = tab;
    currentPage = 1;
    UIPages.resetViews();
    document.querySelectorAll('.sidebar-item[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const page = document.getElementById('page-' + tab);
    if (page) page.style.display = '';
    UITable.sortBy('name');
    render();
  }

  /* ── main render ───────────────────────────────────────────── */

  let _resizeInitDone = false;
  let _lastColHash = '';
  let _lastColTab = '';

  function render() {
    const searchVal = document.getElementById('search-input')?.value || '';
    activeFilters.search = _searchTerms.concat(searchVal.trim() ? [searchVal.trim()] : []).join(' ');

    if (currentTab === 'inventory') {
      _renderStats();
      UIFilters.renderFilters(activeFilters, onFilterChange, perPage, onPerPageChange);
      const colHash = ColumnPicker.getVisibleColumns().map(c => c.key).join(',');
      if (colHash !== _lastColHash || currentTab !== _lastColTab) UITable.renderThead('inv-table', true);
      _lastColHash = colHash; _lastColTab = currentTab;
      const items = DB.getActive(activeFilters);
      UITable.renderTable(items, 'inv-tbody', 'empty-state', { showCheckboxes: true, selectedIds, perPage, page: currentPage });
      UITable.initColumnResize('inv-table');
    } else if (currentTab === 'accounts') {
      UIPages.renderAccountsPage();
    } else if (currentTab === 'categories') {
      UIPages.renderCategoriesPage();
    } else if (currentTab === 'locations') {
      UIPages.renderLocationsPage();
    } else if (currentTab === 'archive') {
      UIFilters.renderFilters(activeFilters, onFilterChange, perPage, onPerPageChange, 'filter-bar-archive-inline');
      const colHash = ColumnPicker.getVisibleColumns().map(c => c.key).join(',');
      if (colHash !== _lastColHash || currentTab !== _lastColTab) UITable.renderThead('archive-table', true);
      _lastColHash = colHash; _lastColTab = currentTab;
      const items = DB.getArchived(activeFilters);
      UITable.renderTable(items, 'archive-tbody', 'archive-empty', { perPage, page: currentPage });
      UITable.initColumnResize('archive-table');
    } else if (currentTab === 'activity') {
      UIPages.renderActivityPage();
    } else if (currentTab === 'reports') {
      UIPages.renderReportsPage();
    } else if (currentTab === 'statuses') {
      UIPages.renderStatusesPage();
    } else if (currentTab === 'tags') {
      UIPages.renderTagsPage();
    }

    _updateBulkBar();
    _updateTimestamp();
  }

  /* ── search / filters ──────────────────────────────────────── */

  let _searchTerms = []; // max 3

  function _getCombinedSearch() {
    return _searchTerms.join(' ');
  }

  function _addSearchTerm(term) {
    term = term.trim();
    if (!term) return;
    if (_searchTerms.length >= 3) return;
    // Avoid duplicates
    if (_searchTerms.some(t => t.toLowerCase() === term.toLowerCase())) return;
    _searchTerms.push(term);
    _renderSearchTags();
    onSearch(_getCombinedSearch());
  }

  function _removeSearchTerm(index) {
    _searchTerms.splice(index, 1);
    _renderSearchTags();
    const clearBtn = document.getElementById('search-clear');
    const input = document.getElementById('search-input');
    if (clearBtn) clearBtn.style.display = (_searchTerms.length || (input && input.value.trim())) ? 'flex' : 'none';
    onSearch(_getCombinedSearch());
  }

  function _clearSearchTerms() {
    _searchTerms = [];
    _renderSearchTags();
  }

  function _renderSearchTags() {
    const container = document.getElementById('search-tags');
    if (!container) return;
    container.innerHTML = _searchTerms.map((t, i) =>
      `<span class="search-tag">${_esc(t)}<button class="search-tag-x" onclick="App._removeSearchTerm(${i})">&times;</button></span>`
    ).join('');
  }

  function onSearch(query) {
    activeFilters.search = query;
    currentPage = 1;
    if (currentTab !== 'inventory' && query) switchTab('inventory');
    else render();
  }

  function _initSearchEnter() {
    const input = document.getElementById('search-input');
    if (!input) return;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (input.value.trim()) {
          App._addSearchTerm(input.value.trim());
          input.value = '';
          input.style.background = '#fff';
          input.previousElementSibling.style.color = '';
          document.getElementById('search-clear').style.display = _searchTerms.length ? 'flex' : 'none';
        } else if (currentTab !== 'inventory') {
          switchTab('inventory');
        }
      }
    });
  }

  function onFilterChange(key, value) {
    if (key === 'clear') activeFilters = { status: 'All', location: 'All', category: 'All', owner: 'All', search: '' };
    else activeFilters[key] = value;
    currentPage = 1;
    render();
  }

  function onPerPageChange(val) { perPage = val; currentPage = 1; render(); }

  function sortBy(field) { UITable.sortBy(field); currentPage = 1; render(); }

  function goToPage(page) { currentPage = page; render(); }

  /* ── selection ─────────────────────────────────────────────── */

  function toggleSelect(id, checked) { if (checked) selectedIds.add(id); else selectedIds.delete(id); render(); }
  function toggleSelectAll(checked) { if (checked) DB.getActive(activeFilters).forEach(i => selectedIds.add(i.id)); else selectedIds.clear(); render(); }
  function clearSelection() { selectedIds.clear(); const cb = document.getElementById('select-all'); if (cb) cb.checked = false; render(); }
  function getSelectedIds() { return [...selectedIds]; }

  function _updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const count = document.getElementById('bulk-count');
    if (!bar) return;
    bar.style.display = selectedIds.size > 0 ? 'flex' : 'none';
    if (count) count.textContent = selectedIds.size + ' selected';
  }

  /* ── export ────────────────────────────────────────────────── */

  function exportCSV() {
    const items = (currentTab === 'archive') ? DB.getArchived(activeFilters) : DB.getActive(activeFilters);
    if (!items.length) { Toast.warning('No items to export'); return; }
    _downloadCSV(DB.exportCSV(items), 'inventory-export.csv');
    Toast.success(`Exported ${items.length} items`);
  }
  function exportSelected() {
    if (!selectedIds.size) { Toast.warning('No items selected'); return; }
    _downloadCSV(DB.exportCSV(DB.getAll().filter(i => selectedIds.has(i.id))), 'inventory-selected.csv');
    Toast.success(`Exported ${selectedIds.size} items`);
  }
  function exportActivity() { _downloadCSV(DB.exportActivityCSV(), 'activity-log.csv'); Toast.success('Activity log exported'); }

  /* ── delete ────────────────────────────────────────────────── */

  function deleteSelected() {
    if (!selectedIds.size || !confirm(`Delete ${selectedIds.size} item(s)?`)) return;
    DB.deleteItems([...selectedIds]);
    Toast.success(`${selectedIds.size} item${selectedIds.size > 1 ? 's' : ''} deleted`);
    selectedIds.clear(); render();
  }

  /* ── import / manage proxies ───────────────────────────────── */

  function showImport() { UIImport.show(); }
  function downloadTemplate() { UIImport.downloadTemplate(); }
  function showManage(type) { UIManage.show(type); }
  function closeManage() { UIManage.close(); }

  function quickAdd(type) {
    if (type === 'account') {
      const name = prompt('Account name:');
      if (name?.trim()) {
        const contact = prompt('Contact (optional):') || '';
        DB.addAccount(name.trim(), contact);
        Toast.success(`Account "${name.trim()}" added`);
        render();
      }
    } else if (type === 'location') {
      const name = prompt('Location name:');
      if (name?.trim()) {
        DB.addLocation(name.trim());
        Toast.success(`Location "${name.trim()}" added`);
        render();
      }
    } else if (type === 'category') {
      const name = prompt('Category name:');
      if (name?.trim()) {
        DB.addCategory(name.trim());
        Toast.success(`Category "${name.trim()}" added`);
        render();
      }
    }
  }

  /* ── settings ──────────────────────────────────────────────── */

  function toggleSettings(e) { e.stopPropagation(); document.getElementById('settings-menu').classList.toggle('open'); }
  function _closeSettings() { const m = document.getElementById('settings-menu'); if (m) m.classList.remove('open'); }
  function showResetModal() {
    UIReset.show();
  }

  /* ── helpers ───────────────────────────────────────────────── */

  function _renderStats() {
    const el = document.getElementById('inventory-stats');
    if (!el) return;
    const stats = DB.getStats();
    el.innerHTML = `
      <span class="stat-item"><span class="stat-num">${stats.active}</span> active</span>
      <span class="stat-sep">|</span>
      <span class="stat-item"><span class="stat-num">${stats.archived}</span> archived</span>
      <span class="stat-sep">|</span>
      <span class="stat-item"><span class="stat-num">${stats.total}</span> total</span>
      ${stats.totalValue > 0 ? `<span class="stat-sep">|</span><span class="stat-item"><span class="stat-num">$${Number(stats.totalValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span> value</span>` : ''}
    `;
    // Update page title with count
    const title = document.querySelector('#page-inventory .page-title');
    if (title) title.textContent = 'Inventory' + (stats.active > 0 ? ` (${stats.active})` : '');
  }

  function _updateTimestamp() {
    const el = document.getElementById('last-updated');
    if (!el) return;
    const ts = DB.getLastUpdated();
    if (!ts) { el.textContent = ''; return; }
    const d = new Date(ts), now = new Date(), diffMin = Math.floor((now - d) / 60000);
    el.textContent = diffMin < 1 ? 'Updated just now' : diffMin < 60 ? `Updated ${diffMin}m ago` :
      Math.floor(diffMin / 60) < 24 ? `Updated ${Math.floor(diffMin / 60)}h ago` :
      'Updated ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function _updateUserName() {
    const el = document.getElementById('user-name-btn');
    if (el) el.textContent = _getCurrentUser();
  }

  function changeUser() {
    const current = _getCurrentUser();
    _showPrompt('Change your name', '', current, false, [
      { label: 'Log Out', onClick: () => App.logout() }
    ], (name) => {
      if (name && name.trim()) {
        _setCurrentUser(name);
        _updateUserName();
      }
    });
  }

  function logout() {
    Login.logout();
  }

  /* ── global events ─────────────────────────────────────────── */

  document.addEventListener('click', e => { if (!e.target.closest('.settings-dropdown-wrap')) _closeSettings(); });

  return {
    init, render, switchTab, onSearch, sortBy, goToPage,
    get currentTab() { return currentTab; },
    get activeFilters() { return activeFilters; },
    toggleSelect, toggleSelectAll, clearSelection, getSelectedIds,
    exportCSV, exportSelected, exportActivity,
    deleteSelected,
    showImport, downloadTemplate,
    showManage, closeManage, quickAdd,
    toggleSettings, showResetModal, _closeSettings,
    changeUser, logout,
    filterAndGo,
    _addSearchTerm, _removeSearchTerm, _clearSearchTerms,
    get _searchTerms() { return _searchTerms; },
  };

  function filterAndGo(filterKey, value) {
    activeFilters[filterKey] = value;
    switchTab('inventory');
  }
})();

// App boot is handled by login.js after authentication
