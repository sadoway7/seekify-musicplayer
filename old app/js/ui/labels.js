const UILabels = (() => {

  /* ── print dialog ──────────────────────────────────────────── */

  function showPrintDialog() {
    const selectedIds = App.getSelectedIds();
    const totalCount = DB.getItemCount();

    const overlay = document.getElementById('import-overlay');
    const content = document.getElementById('import-content');

    content.innerHTML = `
      <div class="modal-header-bar">
        <span class="modal-title-sm">Export Labels</span>
        <button class="btn btn-sm btn-ghost" onclick="UILabels.closeDialog()">&times;</button>
      </div>
      <div class="label-options">
        <button class="label-option-card" onclick="UILabels.exportAll()">
          <div class="label-option-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="label-option-title">All Items</div>
          <div class="label-option-desc">${totalCount} items</div>
        </button>
        ${selectedIds.length > 0 ? `
        <button class="label-option-card" onclick="UILabels.exportSelected()">
          <div class="label-option-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          </div>
          <div class="label-option-title">Selected Items</div>
          <div class="label-option-desc">${selectedIds.length} items</div>
        </button>
        ` : ''}
        <button class="label-option-card" onclick="UILabels.exportByRange()">
          <div class="label-option-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </div>
          <div class="label-option-title">By Filter</div>
          <div class="label-option-desc">Export labels for currently filtered view</div>
        </button>
      </div>
    `;
    overlay.classList.add('active');
  }

  function closeDialog() {
    document.getElementById('import-overlay').classList.remove('active');
  }

  /* ── export methods ─────────────────────────────────────────── */

  function exportAll() {
    closeDialog();
    const items = DB.getAll();
    _exportCSV(items);
  }

  function exportSelected() {
    closeDialog();
    const ids = App.getSelectedIds();
    const allItems = DB.getAll();
    const items = allItems.filter(i => ids.includes(i.id));
    _exportCSV(items);
  }

  function exportSingle(itemId) {
    const item = DB.getById(itemId);
    if (!item) return;
    _exportCSV([item]);
  }

  function exportByRange() {
    closeDialog();
    const searchInput = document.getElementById('search-input');
    const filters = {
      status: document.querySelector('.filter-select[data-filter="status"]')?.value || 'All',
      location: document.querySelector('.filter-select[data-filter="location"]')?.value || 'All',
      category: document.querySelector('.filter-select[data-filter="category"]')?.value || 'All',
      owner: document.querySelector('.filter-select[data-filter="owner"]')?.value || 'All',
      search: searchInput?.value || ''
    };
    const items = DB.getFiltered(filters);
    _exportCSV(items);
  }

  function _exportCSV(items) {
    if (!items || !items.length) {
      alert('No items to export labels for.');
      return;
    }
    let csv = ['Name','Model','Serial Number','Status','Location','Account']
      .map(_csvEscape).join(',') + '\n';
    items.forEach(item => {
      csv += [
        _csvEscape(item.name),
        _csvEscape(item.model || ''),
        _csvEscape(item.serialNumber || ''),
        _csvEscape(item.status || ''),
        _csvEscape(item.location || ''),
        _csvEscape(item.ownerAccount || ''),
      ].join(',') + '\n';
    });
    _downloadCSV(csv, 'labels.csv');
  }

  return { showPrintDialog, exportAll, exportSelected, exportSingle, exportByRange, closeDialog };
})();
