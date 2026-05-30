/* ── table rendering, sorting, selection, pagination ──────────── */

const UITable = (() => {
  let sortField = 'name';
  let sortAsc = true;

  function renderTable(items, tbodyId, emptyId, options = {}) {
    const tbody = document.getElementById(tbodyId);
    const emptyState = document.getElementById(emptyId);
    if (!items.length) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'flex';
      _renderPagination(0, 0, 0, 0, options);
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    // sort
    const numericFields = new Set(['quantity']);
    const sorted = [...items].sort((a, b) => {
      if (numericFields.has(sortField)) {
        const va = a[sortField] ?? 0;
        const vb = b[sortField] ?? 0;
        return sortAsc ? va - vb : vb - va;
      }
      let va = (a[sortField] || '').toString().toLowerCase();
      let vb = (b[sortField] || '').toString().toLowerCase();
      return va < vb ? (sortAsc ? -1 : 1) : va > vb ? (sortAsc ? 1 : -1) : 0;
    });

    // pagination
    const perPage = options.perPage || 50;
    const page = options.page || 1;
    const totalPages = perPage === 0 ? 1 : Math.max(1, Math.ceil(sorted.length / perPage));
    const safePage = Math.min(page, totalPages);
    const start = perPage === 0 ? 0 : (safePage - 1) * perPage;
    const visible = perPage === 0 ? sorted : sorted.slice(start, start + perPage);

    tbody.innerHTML = visible.map(item => {
      return `<tr class="inv-row ${options.selectedIds?.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
        ${renderTds(item, options)}
      </tr>`;
    }).join('');

    updateSortArrows();
    _renderPagination(sorted.length, safePage, totalPages, perPage, options);
  }

  /* ── pagination bar ─────────────────────────────────────────── */

  function _renderPagination(totalItems, page, totalPages, perPage, options) {
    const topBar = document.getElementById('filter-pagination-top');
    const bottomBar = document.getElementById('pagination-bar');

    const hideIf = (el) => { if (el) { el.innerHTML = ''; el.style.display = 'none'; } };
    const showHtml = (el, html) => { if (el) { el.innerHTML = html; el.style.display = ''; } };

    // Hide pagination if only 1 page, but always show item count
    if (totalItems === 0 || totalPages <= 1 || perPage === 0) {
      if (totalItems > 0) {
        const info = `<span class="pagination-info">${totalItems} item${totalItems !== 1 ? 's' : ''}</span>`;
        showHtml(topBar, info);
      } else {
        hideIf(topBar);
      }
      hideIf(bottomBar);
      return;
    }

    const start = (page - 1) * perPage + 1;
    const end = Math.min(page * perPage, totalItems);

    // Build page buttons
    let pagesHtml = '';
    const maxVisible = 5;
    let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

    // Previous
    pagesHtml += `<button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="App.goToPage(${page - 1})">${_svgChevronLeft()}</button>`;

    // First page + ellipsis
    if (startPage > 1) {
      pagesHtml += `<button class="pagination-btn" onclick="App.goToPage(1)">1</button>`;
      if (startPage > 2) pagesHtml += `<span class="pagination-ellipsis">\u2026</span>`;
    }

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
      pagesHtml += `<button class="pagination-btn ${i === page ? 'pagination-btn-active' : ''}" onclick="App.goToPage(${i})">${i}</button>`;
    }

    // Last page + ellipsis
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pagesHtml += `<span class="pagination-ellipsis">\u2026</span>`;
      pagesHtml += `<button class="pagination-btn" onclick="App.goToPage(${totalPages})">${totalPages}</button>`;
    }

    // Next
    pagesHtml += `<button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="App.goToPage(${page + 1})">${_svgChevronRight()}</button>`;

    const topHtml = `<span class="pagination-info">${start}\u2013${end} of ${totalItems}</span><div class="pagination-pages">${pagesHtml}</div>`;
    const bottomHtml = `<span class="pagination-info">Showing ${start}\u2013${end} of ${totalItems}</span><div class="pagination-pages">${pagesHtml}</div>`;

    showHtml(topBar, topHtml);
    hideIf(bottomBar);
  }

  function _svgChevronLeft() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  }
  function _svgChevronRight() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  }

  function sortBy(field) {
    if (sortField === field) sortAsc = !sortAsc;
    else { sortField = field; sortAsc = true; }
  }

  function updateSortArrows() {
    document.querySelectorAll('.sort-arrow').forEach(el => {
      el.textContent = (el.dataset.col === sortField) ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';
    });
  }

  function getSort() { return { field: sortField, asc: sortAsc }; }

  function initColumnResize(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const handles = table.querySelectorAll('.resize-handle');

    handles.forEach((handle) => {
      const th = handle.parentElement;
      const nextTh = th.nextElementSibling;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Prevent sort click from firing on the th
        const blockSort = (ev) => { ev.stopPropagation(); };
        document.addEventListener('click', blockSort, true);
        setTimeout(() => document.removeEventListener('click', blockSort, true), 300);

        handle.classList.add('active');
        const startX = e.pageX;
        const startColW = th.offsetWidth;
        const startNextW = nextTh ? nextTh.offsetWidth : 0;

        const onMove = (ev) => {
          ev.preventDefault();
          const delta = ev.pageX - startX;
          const newColW = Math.max(40, startColW + delta);
          th.style.width = newColW + 'px';
          th.style.minWidth = newColW + 'px';
          // Shrink the neighbor to compensate
          if (nextTh && startNextW - delta >= 40) {
            const newNextW = startNextW - delta;
            nextTh.style.width = newNextW + 'px';
            nextTh.style.minWidth = newNextW + 'px';
          }
        };

        const onUp = () => {
          handle.classList.remove('active');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  /* ── dynamic column rendering ──────────────────────────────── */

  function renderThead(tableId, showCheckboxes) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const thead = table.querySelector('thead');
    if (!thead) return;

    const cols = ColumnPicker.getVisibleColumns();
    let html = '<tr>';
    if (showCheckboxes) {
      html += '<th class="col-check"><input type="checkbox" id="select-all" onchange="App.toggleSelectAll(this.checked)" /></th>';
    }
    cols.forEach((col, i) => {
      const isFirst = i === 0;
      const isLast = i === cols.length - 1;
      const resizable = !isFirst && !isLast ? ' resizable-th' : '';
      const sortable = col.sortable !== false ? ' sortable' : '';
      const cls = col.key === 'quantity' ? ' col-qty' : '';
      const sortAttr = col.sortable !== false ? ` onclick="App.sortBy('${col.key}')"` : '';
      const resizeHandle = !isFirst && !isLast ? '<div class="resize-handle"></div>' : '';
      html += `<th class="${cls}${resizable}${sortable}"${sortAttr}>${col.label} <span class="sort-arrow" data-col="${col.key}"></span>${resizeHandle}</th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
  }

  // Cell renderer map — each key returns <td> HTML for one column
  const _cellRenderers = {
    name: (item) => `<td class="col-name" onclick="Modal.open('${item.id}')">
      <div class="item-name">${_esc(item.name)}</div>
      ${item.description ? `<div class="item-desc-preview">${_esc(item.description.substring(0, 60))}${item.description.length > 60 ? '...' : ''}</div>` : ''}
    </td>`,
    model: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.model)}</td>`,
    serialNumber: (item) => `<td class="col-serial" onclick="Modal.open('${item.id}')">
      ${item.serialNumber ? `<span class="serial-badge">${_esc(item.serialNumber)}</span>` : '<span class="text-muted">\u2014</span>'}
    </td>`,
    category: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.category)}</td>`,
    quantity: (item) => `<td class="col-qty" onclick="Modal.open('${item.id}')">
      ${item.quantity === 0 ? '<span class="qty-badge qty-zero">0</span>' : (item.quantity != null && item.quantity !== 1) ? `<span class="qty-badge">${item.quantity}</span>` : '<span class="text-muted">1</span>'}
    </td>`,
    ownerAccount: (item) => `<td onclick="Modal.open('${item.id}')">
      ${item.ownerAccount ? `<span class="owner-badge">${_esc(item.ownerAccount)}</span>` : '<span class="text-muted">\u2014</span>'}
    </td>`,
    assignedTo: (item) => `<td onclick="Modal.open('${item.id}')">${item.assignedTo ? _esc(item.assignedTo) : '<span class="text-muted">\u2014</span>'}</td>`,
    location: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.location) || '<span class="text-muted">\u2014</span>'}</td>`,
    status: (item) => {
      const sc = DB.getStatusColor(item.status);
      return `<td onclick="Modal.open('${item.id}')">
        ${item.deleted ? '<span class="status-dot" style="background:#dc2626"></span><span class="status-badge" style="color:#dc2626">Deleted</span>' : `<span class="status-dot" style="background:${sc}"></span><span class="status-badge" style="color:${sc}">${_esc(item.status)}</span>`}
      </td>`;
    },
    brand: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.brand) || '<span class="text-muted">\u2014</span>'}</td>`,
    sku: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.sku) || '<span class="text-muted">\u2014</span>'}</td>`,
    partNumber: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.partNumber) || '<span class="text-muted">\u2014</span>'}</td>`,
    imei: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.imei) || '<span class="text-muted">\u2014</span>'}</td>`,
    itemNumber: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.itemNumber) || '<span class="text-muted">\u2014</span>'}</td>`,
    description: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.description ? item.description.substring(0, 100) : '') || '<span class="text-muted">\u2014</span>'}</td>`,
    barcodeId: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.barcodeId) || '<span class="text-muted">\u2014</span>'}</td>`,
    itemValue: (item) => `<td onclick="Modal.open('${item.id}')">${item.itemValue ? '$' + Number(item.itemValue).toFixed(2) : '<span class="text-muted">\u2014</span>'}</td>`,
    salePrice: (item) => `<td onclick="Modal.open('${item.id}')">${item.salePrice ? '$' + Number(item.salePrice).toFixed(2) : '<span class="text-muted">\u2014</span>'}</td>`,
    conditionType: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.conditionType) || '<span class="text-muted">\u2014</span>'}</td>`,
    conditionGrade: (item) => `<td onclick="Modal.open('${item.id}')">${_esc(item.conditionGrade) || '<span class="text-muted">\u2014</span>'}</td>`,
    datePurchased: (item) => `<td onclick="Modal.open('${item.id}')">${item.datePurchased ? _fmtDateShort(item.datePurchased) : '<span class="text-muted">\u2014</span>'}</td>`,
    dateSold: (item) => `<td onclick="Modal.open('${item.id}')">${item.dateSold ? _fmtDateShort(item.dateSold) : '<span class="text-muted">\u2014</span>'}</td>`,
    tags: (item) => {
      if (!item.tags) return `<td onclick="Modal.open('${item.id}')"><span class="text-muted">\u2014</span></td>`;
      const tags = item.tags.split(',').map(t => t.trim()).filter(Boolean);
      const allTags = DB.getTags ? DB.getTags() : [];
      return `<td class="col-tags" onclick="Modal.open('${item.id}')"><div class="table-tags">${tags.map(t => {
        const tag = allTags.find(at => at.name === t);
        const color = tag?.color || '#64748b';
        return `<span class="table-tag-pill" style="--tag-color:${color};border-color:${color}40;color:${color}">${_esc(t)}</span>`;
      }).join('')}</div></td>`;
    },
  };

  function renderTds(item, options) {
    const cols = ColumnPicker.getVisibleColumns();
    let html = options.showCheckboxes ? `<td class="col-check"><input type="checkbox" ${options.selectedIds?.has(item.id) ? 'checked' : ''} onchange="App.toggleSelect('${item.id}',this.checked)" /></td>` : '';
    cols.forEach(col => {
      const renderer = _cellRenderers[col.key];
      html += renderer ? renderer(item) : '<td></td>';
    });
    if (options.showViewOnly) {
      html += `<td class="col-actions"><button class="row-btn" onclick="event.stopPropagation();Modal.open('${item.id}')">View</button></td>`;
    }
    return html;
  }

  return { renderTable, renderThead, sortBy, getSort, initColumnResize, renderTds };
})();
