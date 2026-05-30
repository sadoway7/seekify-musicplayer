/* ── printable forms — intake, count, transfer ───────────────── */

const UIForms = (() => {

  /* ── picker modal ─────────────────────────────────────────── */

  function show() {
    const overlay = document.getElementById('forms-overlay');
    const content = document.getElementById('forms-content');
    if (!overlay || !content) return;

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="font-size:1rem;font-weight:600;">Print Forms</h3>
        <button class="btn btn-sm btn-ghost" onclick="UIForms.close()">&times;</button>
      </div>
      <div class="form-picker-grid">
        <div class="form-picker-card" onclick="UIForms.showIntakeOptions()">
          <div class="form-picker-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>
          </div>
          <div class="form-picker-title">Intake Sheet</div>
          <div class="form-picker-desc">Blank rows for writing down items as you find them — 10 items per page, room to write</div>
        </div>
        <div class="form-picker-card" onclick="UIForms.showCountOptions()">
          <div class="form-picker-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          </div>
          <div class="form-picker-title">Count Sheet</div>
          <div class="form-picker-desc">Pre-filled per location — check what's there vs what should be there</div>
        </div>
        <div class="form-picker-card" onclick="UIForms.printTransfer()">
          <div class="form-picker-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          </div>
          <div class="form-picker-title">Transfer Slip</div>
          <div class="form-picker-desc">Move items between locations with sign-off</div>
        </div>
      </div>
    `;
    overlay.classList.add('active');
  }

  function close() {
    document.getElementById('forms-overlay')?.classList.remove('active');
  }

  /* ── intake sheet options ─────────────────────────────────── */

  function showIntakeOptions() {
    const content = document.getElementById('forms-content');
    if (!content) return;

    const today = new Date().toISOString().split('T')[0];
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="font-size:1rem;font-weight:600;">Intake Sheet</h3>
        <button class="btn btn-sm btn-ghost" onclick="UIForms.show()">&larr; Back</button>
      </div>
      <p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:16px;">
        10 items per page with room to write. Hand to staff for cataloging items in the field.
      </p>
      <div class="form-options">
        <div class="form-options-row">
          <div><label>Pages</label>
            <select id="form-intake-pages">
              <option value="1">1 page (6 items)</option>
              <option value="2">2 pages (12 items)</option>
              <option value="3" selected>3 pages (18 items)</option>
              <option value="5">5 pages (30 items)</option>
              <option value="8">8 pages (48 items)</option>
            </select>
          </div>
          <div><label>Date</label>
            <select id="form-intake-date">
              <option value="${today}">${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</option>
              <option value="">Undated</option>
            </select>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="UIForms.show()">Cancel</button>
        <button class="btn btn-primary" onclick="UIForms.printIntake()">Print Intake Sheet</button>
      </div>
    `;
  }

  /* ── count sheet options ──────────────────────────────────── */

  function showCountOptions() {
    const content = document.getElementById('forms-content');
    if (!content) return;

    const locations = DB.getLocations();
    const accounts = DB.getAccounts();
    const categories = DB.getCategories();
    const today = new Date().toISOString().split('T')[0];

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="font-size:1rem;font-weight:600;">Count Sheet</h3>
        <button class="btn btn-sm btn-ghost" onclick="UIForms.show()">&larr; Back</button>
      </div>
      <p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:16px;">
        Pre-filled with items grouped by your choice. Write in actual quantities found during inventory check.
      </p>
      <div class="form-options" style="max-width:320px;">
        <div class="form-options-row" style="flex-direction:column;gap:12px;">
          <div style="width:100%;"><label>Count By</label>
            <select id="form-count-groupby" onchange="UIForms._updateCountFilter()" style="width:100%;">
              <option value="location">Location</option>
              <option value="account">Account</option>
              <option value="category">Category</option>
              <option value="all">All Items</option>
            </select>
          </div>
          <div id="form-count-filter-wrap" style="width:100%;"><label>Location</label>
            <select id="form-count-filter" style="width:100%;">
              <option value="__all__">All Locations (one page per location)</option>
              ${locations.map(l => `<option value="${_escAttr(l)}">${_esc(l)}</option>`).join('')}
            </select>
          </div>
          <div style="width:100%;"><label>Date Starting</label>
            <select id="form-count-date" style="width:100%;">
              <option value="${today}">${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</option>
              <option value="">Undated</option>
            </select>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="UIForms.show()">Cancel</button>
        <button class="btn btn-primary" onclick="UIForms.printCount()">Print Count Sheet</button>
      </div>
    `;
  }

  function _updateCountFilter() {
    const groupBy = document.getElementById('form-count-groupby')?.value;
    const wrap = document.getElementById('form-count-filter-wrap');
    const select = document.getElementById('form-count-filter');
    if (!wrap || !select) return;

    if (groupBy === 'all') {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';

    let options = [];
    let label = '';
    if (groupBy === 'location') {
      options = DB.getLocations();
      label = 'Location';
    } else if (groupBy === 'account') {
      options = DB.getAccounts().map(a => a.name);
      label = 'Account';
    } else if (groupBy === 'category') {
      options = DB.getCategories();
      label = 'Category';
    }

    select.innerHTML = `<option value="__all__">All ${label}s</option>` +
      options.map(o => `<option value="${_escAttr(o)}">${_esc(o)}</option>`).join('');
    wrap.querySelector('label').textContent = label;
  }

  /* ═══════════════════════════════════════════════════════════════
     INTAKE SHEET — generous handwriting layout
     ═══════════════════════════════════════════════════════════════ */

  function printIntake() {
    const pages = parseInt(document.getElementById('form-intake-pages')?.value) || 3;
    const date = document.getElementById('form-intake-date')?.value || '';
    const area = document.getElementById('forms-print-area');
    if (!area) return;
    close();

    const itemsPerPage = 6;
    let html = '';
    for (let p = 0; p < pages; p++) {
      html += `<div class="form-page">
        <div class="form-header">
          <div class="form-header-left">
            <div class="form-brand">Stocklog</div>
            <div class="form-title">Item Intake Sheet</div>
            <div class="form-subtitle">Record each item found. Enter into Stocklog when done.</div>
          </div>
          <div style="text-align:right;font-size:0.6875rem;color:#666;">
            Page ${p + 1} of ${pages}<br/>
            ${date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
          </div>
        </div>
        <div class="form-meta">
          <div class="form-meta-field"><span class="form-meta-label">Location / Area:</span><span class="form-meta-line"></span></div>
          <div class="form-meta-field"><span class="form-meta-label">Date:</span><span class="form-meta-line">${date}</span></div>
          <div class="form-meta-field"><span class="form-meta-label">Counted By:</span><span class="form-meta-line"></span></div>
          <div class="form-meta-field"><span class="form-meta-label">Checked By:</span><span class="form-meta-line"></span></div>
        </div>
        ${_intakeBlocks(itemsPerPage, p * itemsPerPage)}
        <div class="form-footer">
          <span>Items this page: ________</span>
          <span>Total all pages: ________</span>
        </div>
      </div>`;
    }

    area.innerHTML = html;
    area.style.display = 'block';
    _printAndCleanup(area, 'Stocklog Intake Sheet');
  }

  function _printAndCleanup(area, formTitle) {
    const origTitle = document.title;
    if (formTitle) document.title = formTitle;
    const cleanup = () => {
      area.style.display = 'none';
      area.innerHTML = '';
      document.title = origTitle;
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => window.print(), 100);
    setTimeout(cleanup, 5000);
  }

  function _intakeBlocks(count, start) {
    let html = '';
    for (let i = 0; i < count; i++) {
      const num = start + i + 1;
      html += `
      <div class="intake-block">
        <div class="intake-block-num">${num}</div>
        <div class="intake-block-body">
          <div class="intake-row">
            <div class="intake-field intake-field-wide">
              <span class="intake-label">Item Name</span>
              <span class="intake-line"></span>
            </div>
          </div>
          <div class="intake-row intake-row-2col">
            <div class="intake-field">
              <span class="intake-label">Serial #</span>
              <span class="intake-line"></span>
            </div>
            <div class="intake-field">
              <span class="intake-label">Model / Part #</span>
              <span class="intake-line"></span>
            </div>
          </div>
          <div class="intake-row intake-row-3col">
            <div class="intake-field">
              <span class="intake-label">Category</span>
              <span class="intake-line"></span>
            </div>
            <div class="intake-field intake-field-narrow">
              <span class="intake-label">Qty</span>
              <span class="intake-line"></span>
            </div>
            <div class="intake-field intake-field-narrow">
              <span class="intake-label">Value</span>
              <span class="intake-line"></span>
            </div>
          </div>
          <div class="intake-row intake-row-2col">
            <div class="intake-field">
              <span class="intake-label">Location</span>
              <span class="intake-line"></span>
            </div>
            <div class="intake-field">
              <span class="intake-label">Account / Owner</span>
              <span class="intake-line"></span>
            </div>
          </div>
          <div class="intake-row">
            <div class="intake-field intake-field-wide">
              <span class="intake-label">Description / Notes</span>
              <span class="intake-line"></span>
            </div>
          </div>
        </div>
      </div>`;
    }
    return html;
  }

  /* ═══════════════════════════════════════════════════════════════
     COUNT SHEET — pre-filled with expected items, room to write
     ═══════════════════════════════════════════════════════════════ */

  function printCount() {
    const groupBy = document.getElementById('form-count-groupby')?.value || 'location';
    const filterVal = document.getElementById('form-count-filter')?.value || '__all__';
    const date = document.getElementById('form-count-date')?.value || '';
    const area = document.getElementById('forms-print-area');
    if (!area) return;
    close();

    const allItems = DB.getActive({});
    const fieldMap = { location: 'location', account: 'account', category: 'category' };
    const fallbackMap = { location: 'Unlocated', account: 'Unassigned', category: 'Uncategorized' };

    let groups;
    if (groupBy === 'all') {
      groups = [{ label: 'All Items', items: allItems }];
    } else {
      const field = fieldMap[groupBy];
      const fallback = fallbackMap[groupBy];
      const uniqueVals = [...new Set(allItems.map(i => i[field] || fallback))].sort();
      const vals = filterVal === '__all__' ? uniqueVals : uniqueVals.filter(v => v === filterVal);
      groups = vals.map(v => ({
        label: v,
        items: allItems.filter(i => (i[field] || fallback) === v)
      })).filter(g => g.items.length);
    }

    let html = '';
    groups.forEach(group => {
      const items = group.items;
      const totalExpected = items.reduce((s, i) => s + (i.quantity || 1), 0);
      const pagesNeeded = Math.ceil(items.length / 18);

      for (let p = 0; p < pagesNeeded; p++) {
        const pageItems = items.slice(p * 18, (p + 1) * 18);
        const pageExpected = pageItems.reduce((s, i) => s + (i.quantity || 1), 0);

        html += `<div class="form-page">
          <div class="form-header">
            <div class="form-header-left">
              <div class="form-brand">Stocklog</div>
              <div class="form-title">Inventory Count Sheet</div>
              <div class="form-subtitle">${_esc(group.label)}${pagesNeeded > 1 ? ` (page ${p + 1} of ${pagesNeeded})` : ''}</div>
            </div>
            <div style="text-align:right;font-size:0.6875rem;color:#666;">
              ${date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}<br/>
              ${pageItems.length} items &middot; ${pageExpected} expected
            </div>
          </div>
          <div class="form-meta">
            <div class="form-meta-field"><span class="form-meta-label">${groupBy === 'all' ? 'Scope' : groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}:</span><span class="form-meta-line">${_esc(group.label)}</span></div>
            <div class="form-meta-field"><span class="form-meta-label">Date:</span><span class="form-meta-line">${date}</span></div>
            <div class="form-meta-field"><span class="form-meta-label">Counted By:</span><span class="form-meta-line"></span></div>
            <div class="form-meta-field"><span class="form-meta-label">Checked By:</span><span class="form-meta-line"></span></div>
          </div>
          <table class="form-grid">
            <thead>
              <tr>
                <th style="width:22px;">#</th>
                <th style="width:28%;">Item Name</th>
                <th style="width:14%;">Model</th>
                <th style="width:14%;">Serial #</th>
                <th style="width:8%;">Exp</th>
                <th style="width:8%;">Act</th>
                <th style="width:26%;">Notes / Discrepancy</th>
              </tr>
            </thead>
            <tbody>
              ${pageItems.map((item, i) => `<tr>
                <td class="row-num">${p * 18 + i + 1}</td>
                <td style="padding:3px 6px;font-size:0.75rem;">${_esc(item.name)}</td>
                <td style="padding:3px 6px;font-size:0.6875rem;">${_esc(item.model) || '\u2014'}</td>
                <td style="padding:3px 6px;font-size:0.6875rem;font-family:'SF Mono',Monaco,monospace;">${_esc(item.serialNumber) || '\u2014'}</td>
                <td style="text-align:center;font-size:0.75rem;font-weight:600;padding:3px;">${item.quantity || 1}</td>
                <td></td>
                <td></td>
              </tr>`).join('')}
            </tbody>
          </table>
          <div class="count-total">
            Expected: <strong>${pageExpected}</strong> &nbsp;&middot;&nbsp; Actual: ________
            &nbsp;&middot;&nbsp; Difference: ________
          </div>
          <div class="form-signature">
            <div class="form-sig-block"><div class="form-sig-line"></div><div class="form-sig-label">Counted By</div></div>
            <div class="form-sig-block"><div class="form-sig-line"></div><div class="form-sig-label">Verified By</div></div>
            <div class="form-sig-block"><div class="form-sig-line"></div><div class="form-sig-label">Date</div></div>
          </div>
        </div>`;
      }
    });

    if (!html) {
      Toast.warning('No items found for selected filter');
      return;
    }

    area.innerHTML = html;
    area.style.display = 'block';
    _printAndCleanup(area, 'Stocklog Count Sheet');
  }

  /* ═══════════════════════════════════════════════════════════════
     TRANSFER SLIP — generous handwriting layout
     ═══════════════════════════════════════════════════════════════ */

  function printTransfer() {
    close();
    const area = document.getElementById('forms-print-area');
    if (!area) return;

    area.innerHTML = `<div class="form-page" style="max-width:7in;margin:0 auto;min-height:auto;">
      <div class="form-header">
        <div class="form-header-left">
          <div class="form-brand">Stocklog</div>
          <div class="form-title">Transfer Slip</div>
          <div class="form-subtitle">Record items moving between locations</div>
        </div>
        <div style="text-align:right;font-size:0.6875rem;color:#666;">
          ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 40px;margin-bottom:20px;font-size:0.8125rem;">
        <div class="form-meta-field"><span class="form-meta-label">From:</span><span class="form-meta-line"></span></div>
        <div class="form-meta-field"><span class="form-meta-label">To:</span><span class="form-meta-line"></span></div>
        <div class="form-meta-field"><span class="form-meta-label">Date:</span><span class="form-meta-line"></span></div>
        <div class="form-meta-field"><span class="form-meta-label">Reason:</span><span class="form-meta-line"></span></div>
      </div>
      <table class="form-grid">
        <thead>
          <tr>
            <th style="width:24px;">#</th>
            <th style="width:30%;">Item Name</th>
            <th style="width:26%;">Serial #</th>
            <th style="width:10%;">Qty</th>
            <th style="width:30%;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${_transferRows(13)}
        </tbody>
      </table>
      <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px 32px;font-size:0.8125rem;">
        <div class="form-meta-field"><span class="form-meta-label">Total items:</span><span class="form-meta-line"></span></div>
        <div class="form-meta-field"><span class="form-meta-label">Total qty:</span><span class="form-meta-line"></span></div>
      </div>
      <div class="form-signature" style="margin-top:24px;">
        <div class="form-sig-block"><div class="form-sig-line"></div><div class="form-sig-label">Released By</div></div>
        <div class="form-sig-block"><div class="form-sig-line"></div><div class="form-sig-label">Received By</div></div>
        <div class="form-sig-block"><div class="form-sig-line"></div><div class="form-sig-label">Date</div></div>
      </div>
    </div>`;

    area.style.display = 'block';
    _printAndCleanup(area, 'Stocklog Transfer Slip');
  }

  function _transferRows(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `<tr>
        <td class="row-num">${i + 1}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      </tr>`;
    }
    return html;
  }

  return { show, close, showIntakeOptions, showCountOptions, _updateCountFilter, printIntake, printCount, printTransfer };
})();
