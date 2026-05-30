/* ── import dialog — upload → column mapping → review ────────── */

const UIImport = (() => {
  let pendingItems = [];
  let csvHeaders = [];
  let csvRows = [];

  const LYNQ_FIELDS = [
    { key: '', label: '-- Skip this column --' },
    { key: 'name', label: 'Item Name *' },
    { key: 'description', label: 'Description' },
    { key: 'model', label: 'Model / Part #' },
    { key: 'serialNumber', label: 'Serial Number' },
    { key: 'status', label: 'Status' },
    { key: 'location', label: 'Location' },
    { key: 'ownerAccount', label: 'Account / Owner' },
    { key: 'category', label: 'Category' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'itemValue', label: 'Item Value' },
    { key: 'salePrice', label: 'Sale Price' },
    { key: 'priceLow', label: 'Cost (Purchase Price)' },
    { key: 'priceHigh', label: 'MSRP' },
    { key: 'brand', label: 'Brand' },
    { key: 'sku', label: 'SKU' },
    { key: 'partNumber', label: 'Part Number' },
    { key: 'imei', label: 'IMEI' },
    { key: 'assignedTo', label: 'Assigned To' },
    { key: 'notes', label: 'Notes' },
    { key: 'valuationYear', label: 'Valuation Year' },
    { key: 'marketLow', label: 'Market Value (Low)' },
    { key: 'marketHigh', label: 'Market Value (High)' },
  ];

  // Auto-match common CSV header names to Stocklog fields
  const AUTO_MAP = {
    'name': 'name', 'item': 'name', 'item name': 'name', 'product': 'name', 'product name': 'name', 'title': 'name',
    'description': 'description', 'desc': 'description',
    'model': 'model', 'model number': 'model', 'model #': 'model', 'part': 'model', 'part #': 'model', 'part number': 'partNumber',
    'serial': 'serialNumber', 'serial number': 'serialNumber', 'serial_number': 'serialNumber', 'serial #': 'serialNumber', 's/n': 'serialNumber', 'serial no': 'serialNumber',
    'status': 'status', 'state': 'status',
    'location': 'location', 'site': 'location', 'warehouse': 'location', 'room': 'location', 'bin': 'location', 'shelf': 'location',
    'owner': 'ownerAccount', 'owner account': 'ownerAccount', 'owner_account': 'ownerAccount', 'account': 'ownerAccount', 'client': 'ownerAccount', 'company': 'ownerAccount',
    'assigned to': 'assignedTo', 'assigned': 'assignedTo', 'assigned_to': 'assignedTo',
    'category': 'category', 'cat': 'category', 'type': 'category', 'class': 'category', 'group': 'category',
    'quantity': 'quantity', 'qty': 'quantity', 'count': 'quantity', 'amount': 'quantity',
    'value': 'itemValue', 'item value': 'itemValue', 'cost': 'priceLow', 'unit cost': 'priceLow', 'purchase price': 'priceLow', 'price low': 'priceLow',
    'msrp': 'priceHigh', 'retail price': 'priceHigh', 'price high': 'priceHigh',
    'sale price': 'salePrice', 'sale': 'salePrice', 'selling price': 'salePrice',
    'brand': 'brand', 'manufacturer': 'brand', 'make': 'brand',
    'sku': 'sku', 'item number': 'sku',
    'part number': 'partNumber', 'part_no': 'partNumber',
    'imei': 'imei',
    'notes': 'notes', 'note': 'notes', 'comments': 'notes', 'comment': 'notes', 'remarks': 'notes',
    'valuation year': 'valuationYear', 'valuation_year': 'valuationYear', 'val year': 'valuationYear', 'year': 'valuationYear',
    'market low': 'marketLow', 'market_low': 'marketLow', 'market value low': 'marketLow', 'value low': 'marketLow',
    'market high': 'marketHigh', 'market_high': 'marketHigh', 'market value high': 'marketHigh', 'value high': 'marketHigh',
  };

  /* ── stage 1: upload ───────────────────────────────────────── */

  function show() {
    pendingItems = [];
    csvHeaders = [];
    csvRows = [];
    const overlay = document.getElementById('import-overlay');
    const content = document.getElementById('import-content');
    content.innerHTML = `
      <div class="modal-header-bar">
        <span class="modal-title-sm">Import Inventory from CSV</span>
        <button class="btn btn-sm btn-ghost" onclick="UIImport.close()">&times;</button>
      </div>
      <div class="import-info">
        <p>Upload a CSV file. The first row should be column headers. You'll map each column to the right field on the next screen.</p>
      </div>
      <div style="margin-bottom:12px"><button class="btn btn-sm" onclick="UIImport.downloadTemplate()">Download Import Template</button></div>
      <div class="import-options">
        <label class="import-option"><input type="radio" name="import-mode" value="update" checked /><span>Update existing items with matching serial numbers</span></label>
        <label class="import-option"><input type="radio" name="import-mode" value="skip" /><span>Skip items with duplicate serial numbers</span></label>
      </div>
      <div class="import-drop" id="import-drop">
        <input type="file" id="import-file" accept=".csv" style="display:none" onchange="UIImport.handleFile(this)" />
        <div class="import-drop-text">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div>Click to browse or drag a CSV file here</div>
        </div>
      </div>`;
    overlay.classList.add('active');

    const dropZone = document.getElementById('import-drop');
    dropZone.onclick = () => document.getElementById('import-file').click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); if (e.dataTransfer.files.length) { document.getElementById('import-file').files = e.dataTransfer.files; UIImport.handleFile(document.getElementById('import-file')); } };
  }

  function close() {
    document.getElementById('import-overlay')?.classList.remove('active');
    pendingItems = []; csvHeaders = []; csvRows = [];
  }

  function downloadTemplate() { _downloadCSV(DB.getTemplateCSV(), 'inventory-import-template.csv'); }

  function handleFile(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length < 2) { Toast.error('CSV must have a header row and at least one data row'); return; }

      csvHeaders = _csvLineToArray(lines[0]);
      csvRows = lines.slice(1).map(l => _csvLineToArray(l)).filter(row => row.some(cell => cell.trim()));

      if (!csvRows.length) { Toast.error('No data rows found in CSV'); return; }

      _renderColumnMapping();
    };
    reader.readAsText(file);
  }

  /* ── stage 2: column mapping ──────────────────────────────── */

  /** Auto-detect field + year from a column header */
  function _autoDetect(header) {
    const h = header.trim().toLowerCase();
    // Direct match first
    if (AUTO_MAP[h]) return { field: AUTO_MAP[h], year: null };
    // Try year-suffixed patterns: "2023 low", "market 2024 high", "market_low_2023", "value high 2023"
    const yearMatch = h.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      const stripped = h.replace(/\b(19\d{2}|20\d{2})\b/g, '').replace(/[_\-\s]+/g, ' ').trim();
      // Check if the stripped version maps to market low/high
      const knownPatterns = ['market low', 'market high', 'value low', 'value high',
                             'market value low', 'market value high', 'market_low', 'market_high',
                             'marketlow', 'markethigh', 'valuelow', 'valuehigh',
                             'low', 'high'];
      for (const pattern of knownPatterns) {
        if (stripped === pattern || stripped.includes(pattern)) {
          if (pattern.includes('low')) return { field: 'marketLow', year };
          if (pattern.includes('high')) return { field: 'marketHigh', year };
        }
      }
    }
    return { field: '', year: null };
  }

  function _renderColumnMapping() {
    const content = document.getElementById('import-content');
    const autoDetected = csvHeaders.map(h => _autoDetect(h));
    const previewRows = csvRows.slice(0, 3);

    content.innerHTML = `
      <div class="modal-header-bar">
        <span class="modal-title-sm">Map Columns</span>
        <button class="btn btn-sm btn-ghost" onclick="UIImport.close()">&times;</button>
      </div>
      <p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:16px;">
        Found <strong>${csvHeaders.length}</strong> columns and <strong>${csvRows.length}</strong> rows.
        Match each CSV column to the correct Stocklog field. Unmapped columns will be skipped.
        <br/><span style="font-size:0.75rem;color:var(--muted);">For Market Value columns, set the year to create historical valuations.</span>
      </p>
      <table class="import-review-table" style="margin-bottom:16px;">
        <thead>
          <tr>
            <th style="width:26%;">CSV Column Header</th>
            <th style="width:24%;">Maps To</th>
            <th style="width:16%;">Year</th>
            <th>Preview (first 3 rows)</th>
          </tr>
        </thead>
        <tbody>
          ${csvHeaders.map((header, i) => {
            const auto = autoDetected[i];
            const options = LYNQ_FIELDS.map(f =>
              `<option value="${f.key}" ${f.key === auto.field ? 'selected' : ''}>${f.label}</option>`
            ).join('');
            const preview = previewRows.map(r => _esc(r[i] || '')).join('<br/>');
            const isMapped = auto.field;
            const isMarketField = auto.field === 'marketLow' || auto.field === 'marketHigh';
            const yearVal = auto.year || '';
            return `<tr class="${isMapped ? '' : 'import-map-unmapped'}" data-map-row="${i}">
              <td>
                ${_esc(header)}
                ${isMapped ? ' <span style="font-size:0.625rem;color:var(--green);font-weight:600;">&#10003; auto</span>' : ' <span style="font-size:0.625rem;color:var(--red);font-weight:600;">&#10007; not mapped</span>'}
              </td>
              <td><select class="import-map-select${isMapped ? '' : ' import-map-select-unmapped'}" data-map-col="${i}" onchange="UIImport._onFieldChange(this, ${i})">${options}</select></td>
              <td><input type="number" class="import-map-year" data-map-year="${i}" value="${yearVal}" placeholder="—" min="1990" max="2099" style="width:60px;text-align:center;font-size:0.8125rem;border:1px solid ${isMarketField ? 'var(--border)' : 'transparent'};background:${isMarketField ? 'var(--bg)' : 'transparent'};border-radius:var(--radius);padding:2px 4px;${isMarketField ? '' : 'pointer-events:none;color:var(--muted);'}" /></td>
              <td style="font-size:0.6875rem;color:var(--text-secondary);font-family:'SF Mono',Monaco,monospace;line-height:1.6;">${preview || '<span style="color:var(--muted);">\u2014</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="display:flex;gap:8px;justify-content:space-between;">
        <button class="btn" onclick="UIImport.show()">&larr; Back</button>
        <button class="btn btn-primary" onclick="UIImport.applyMapping()">Apply Mapping &amp; Continue</button>
      </div>`;
  }

  /* ── apply mapping and build items ─────────────────────────── */

  function applyMapping() {
    // Read the mapping from dropdowns + year inputs
    const mapping = {}; // col → field
    const colYears = {}; // col → year (for marketLow/marketHigh columns)
    document.querySelectorAll('[data-map-col]').forEach(sel => {
      const col = parseInt(sel.dataset.mapCol);
      if (sel.value) mapping[col] = sel.value;
    });
    document.querySelectorAll('[data-map-year]').forEach(inp => {
      const col = parseInt(inp.dataset.mapYear);
      const year = parseInt(inp.value);
      if (year > 1990) colYears[col] = year;
    });

    // Check that name is mapped
    const nameCol = Object.entries(mapping).find(([col, field]) => field === 'name');
    if (!nameCol) {
      Toast.error('You must map at least one column to "Item Name"');
      return;
    }

    // Detect format: long (valuationYear column) vs wide (year on market columns)
    const hasValYear = Object.values(mapping).includes('valuationYear');
    const marketColsWithYears = Object.entries(mapping)
      .filter(([col, field]) => (field === 'marketLow' || field === 'marketHigh') && colYears[col])
      .map(([col, field]) => ({ col: parseInt(col), field, year: colYears[col] }));
    const isWide = marketColsWithYears.length > 0;

    // Build raw rows from CSV using the mapping
    const rawRows = csvRows.map(row => {
      const item = {};
      Object.entries(mapping).forEach(([col, field]) => {
        const val = (row[parseInt(col)] || '').trim();
        if (val) item[field] = val;
      });
      // Wide format: collect market values with their assigned years
      if (isWide) {
        item._wideValuations = {};
        marketColsWithYears.forEach(({ col, field, year }) => {
          const val = (row[col] || '').trim();
          if (val) {
            if (!item._wideValuations[year]) item._wideValuations[year] = {};
            item._wideValuations[year][field === 'marketLow' ? 'low' : 'high'] = val;
          }
        });
      }
      return item;
    }).filter(item => item.name);

    if (hasValYear && !isWide) {
      // ── Long format: group rows by item, collect valuation sub-rows ──
      const groups = {};
      const groupOrder = [];
      rawRows.forEach(row => {
        const key = (row.name + '||' + (row.serialNumber || '')).toLowerCase();
        if (!groups[key]) {
          groups[key] = { base: null, valuations: [] };
          groupOrder.push(key);
        }
        const year = row.valuationYear ? parseInt(row.valuationYear) : 0;
        if (year && (row.marketLow || row.marketHigh)) {
          groups[key].valuations.push({ year, low: row.marketLow || '', high: row.marketHigh || '' });
          delete row.valuationYear;
          delete row.marketLow;
          delete row.marketHigh;
        }
        if (!groups[key].base || !groups[key].base.name) {
          groups[key].base = row;
        } else {
          for (const [k, v] of Object.entries(row)) {
            if (v && !groups[key].base[k]) groups[key].base[k] = v;
          }
        }
      });
      pendingItems = groupOrder.map(key => {
        const g = groups[key];
        const item = g.base;
        if (g.valuations.length) item._valuations = g.valuations;
        return item;
      });
    } else if (isWide) {
      // ── Wide format: one row = one item, market columns have years ──
      pendingItems = rawRows.map(row => {
        const wide = row._wideValuations;
        delete row._wideValuations;
        // Remove marketLow/marketHigh from base if they came from year-specific columns
        // (they're in _wideValuations instead)
        // If marketLow/marketHigh were also mapped without a year, they stay as current year
        if (wide && Object.keys(wide).length) {
          row._valuations = Object.entries(wide).map(([year, vals]) => ({
            year: parseInt(year),
            low: vals.low || '',
            high: vals.high || '',
          }));
        }
        return row;
      });
    } else {
      // ── No valuations — flat import ──
      pendingItems = rawRows;
    }

    // Set defaults and detect duplicates
    pendingItems.forEach(item => {
      item.status = item.status || 'Available';
      item.category = item.category || '';

      if (item.serialNumber && item.serialNumber.trim()) {
        const existing = DBItems.findBySerial(item.serialNumber.trim());
        if (existing.length > 0) {
          item._dupStatus = 'duplicate';
          item._originalItem = existing[0];
        }
      }
    });

    if (!pendingItems.length) {
      Toast.error('No valid items found after mapping. Check that the name column is correct.');
      return;
    }

    _renderReview();
  }

  /* ── stage 3: review & import ──────────────────────────────── */

  function _renderReview() {
    const content = document.getElementById('import-content');
    const statuses = DB.getStatuses().map(s => s.name);
    const locations = DB.getLocations();
    const categories = DB.getCategoriesWithSubs();
    const categoryOptions = [];
    const parents = categories.filter(c => !c.parent);
    const childMap = {};
    categories.filter(c => c.parent).forEach(c => { (childMap[c.parent] = childMap[c.parent] || []).push(c); });
    parents.forEach(p => {
      const subs = childMap[p.name] || [];
      if (subs.length) {
        categoryOptions.push({ value: p.name, label: p.name, group: true });
        subs.forEach(s => categoryOptions.push({ value: s.name, label: s.name }));
      } else {
        categoryOptions.push({ value: p.name, label: p.name });
      }
    });
    const accounts = DB.getAccounts().map(a => a.name);

    // Count validation issues
    let warnings = 0;
    let dupWarnings = 0;
    pendingItems.forEach(item => {
      if (!_validIn(item.status, statuses)) warnings++;
      if (item._dupStatus === 'duplicate') dupWarnings++;
    });
    warnings += dupWarnings;

    content.innerHTML = `
      <div class="modal-header-bar">
        <span class="modal-title-sm">Review Import</span>
        <button class="btn btn-sm btn-ghost" onclick="UIImport.close()">&times;</button>
      </div>
      <div class="import-review-header">
        <strong>${pendingItems.length} items ready to import</strong>
        ${dupWarnings > 0 ? `<span style="color:var(--amber);font-size:0.75rem;font-weight:600;">${dupWarnings} duplicate serial${dupWarnings !== 1 ? 's' : ''} need resolution</span>` : warnings > 0 ? `<span style="color:var(--red);font-size:0.75rem;font-weight:600;">${warnings} field${warnings !== 1 ? 's' : ''} need attention</span>` : '<span class="import-review-hint">All fields match. Click any cell to edit.</span>'}
      </div>
      <div class="import-review-table-wrap">
        <table class="import-review-table import-resizable" id="review-table">
          <thead>
            <tr>
              <th class="review-th-remove" style="width:28px;"></th>
              <th class="resizable-th" style="width:180px;">Name<div class="resize-handle"></div></th>
              <th class="resizable-th" style="width:130px;">Model<div class="resize-handle"></div></th>
              <th class="resizable-th" style="width:130px;">Serial #<div class="resize-handle"></div></th>
              <th class="resizable-th" style="width:130px;">Status<div class="resize-handle"></div></th>
              <th class="resizable-th" style="width:140px;">Location<div class="resize-handle"></div></th>
              <th class="resizable-th" style="width:140px;">Category<div class="resize-handle"></div></th>
              <th class="resizable-th" style="width:140px;">Account<div class="resize-handle"></div></th>
              <th style="width:56px;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${pendingItems.map((item, i) => {
              const isDup = item._dupStatus === 'duplicate';
              const resolved = item._dupStatus === 'keep-new' || item._dupStatus === 'keep-original' || item._dupStatus === 'make-dup';
              let html = `<tr data-idx="${i}" class="${isDup ? 'import-row-dup' : ''}">`;
              html += `<td class="review-td-remove"><button class="review-remove-btn" onclick="UIImport.removeItem(${i})" title="Remove">&times;</button></td>`;
              html += `<td><input class="review-cell" value="${_escAttr(item.name)}" onchange="UIImport.editCell(${i},'name',this.value)" /></td>`;
              html += `<td><input class="review-cell" value="${_escAttr(item.model || '')}" onchange="UIImport.editCell(${i},'model',this.value)" /></td>`;
              html += `<td><input class="review-cell" value="${_escAttr(item.serialNumber || '')}" onchange="UIImport.editCell(${i},'serialNumber',this.value)" /></td>`;
              html += `<td>${_reviewSelect(i, 'status', item.status, statuses, 'Available', true)}</td>`;
              html += `<td>${ListCombo.html('import-loc-' + i, item.location, 'import-review-combo')}</td>`;
              html += `<td>${CategoryCombo.html('import-cat-' + i, item.category, 'import-review-combo')}</td>`;
              html += `<td>${ListCombo.html('import-acct-' + i, item.ownerAccount, 'import-review-combo')}</td>`;
              html += `<td><input class="review-cell" style="width:40px;text-align:center;" value="${_escAttr(item.quantity || '1')}" onchange="UIImport.editCell(${i},'quantity',this.value)" /></td>`;
              html += `</tr>`;

              // Duplicate resolution banner
              if (isDup && !resolved) {
                const orig = item._originalItem;
                html += `<tr class="import-dup-banner"><td colspan="9">
                  <div class="import-dup-inner">
                    <div class="import-dup-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      Duplicate serial #${_esc(item.serialNumber)} — already used by:
                    </div>
                    <div class="import-dup-orig">
                      <span class="import-dup-tag">Original</span>
                      <strong>${_esc(orig.name)}</strong>
                      ${orig.model ? ` · ${_esc(orig.model)}` : ''}
                      · ${_esc(orig.status)}
                      ${orig.location ? ` · ${_esc(orig.location)}` : ''}
                      ${orig.ownerAccount ? ` · ${_esc(orig.ownerAccount)}` : ''}
                    </div>
                    <div class="import-dup-actions">
                      <button class="btn btn-sm" onclick="UIImport.resolveDuplicate(${i},'keep-original')">Keep Original</button>
                      <button class="btn btn-sm btn-primary" onclick="UIImport.resolveDuplicate(${i},'keep-new')">Keep New</button>
                      <button class="btn btn-sm" onclick="UIImport.resolveDuplicate(${i},'make-dup')">Make Duplicate</button>
                    </div>
                  </div>
                </td></tr>`;
              } else if (resolved) {
                const label = item._dupStatus === 'keep-new' ? 'Keep New' : item._dupStatus === 'make-dup' ? 'Duplicate (serial cleared)' : 'Keep Original';
                html += `<tr class="import-dup-resolved"><td colspan="9">
                  <div class="import-dup-resolved-inner">
                    <span class="import-dup-resolved-label">${label}</span>
                    ${item._dupStatus !== 'keep-original' ? `<button class="btn btn-sm btn-ghost" onclick="UIImport.resolveDuplicate(${i},'duplicate')">Change</button>` : ''}
                  </div>
                </td></tr>`;
              }

              return html;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="import-review-footer">
        <button class="btn" onclick="UIImport._renderColumnMapping()">&larr; Back to Mapping</button>
        <button class="btn btn-primary" onclick="UIImport.confirmImport()" ${warnings > 0 ? 'disabled' : ''}>Confirm Import (${pendingItems.length} items)</button>
        ${warnings > 0 ? '<span style="font-size:0.75rem;color:var(--red);">Fix red fields before importing</span>' : ''}
      </div>`;

    _initColumnResize();

    // Initialize comboboxes for each row
    pendingItems.forEach((item, i) => {
      ListCombo.init('import-loc-' + i, () => DB.getLocations(), (val) => { editCell(i, 'location', val); }, {
        allowNew: true, newLabel: '+ New location...', onNew: () => {
          const name = prompt('New location name:');
          if (name?.trim()) { DB.addLocation(name.trim()); editCell(i, 'location', name.trim()); }
        }
      });
      CategoryCombo.init('import-cat-' + i, (val) => { editCell(i, 'category', val); });
      ListCombo.init('import-acct-' + i, () => DB.getAccounts().map(a => a.name), (val) => { editCell(i, 'ownerAccount', val); }, {
        allowNew: true, newLabel: '+ New account...', onNew: () => {
          const name = prompt('New account name:');
          if (name?.trim()) { const contact = prompt('Contact (optional):') || ''; DB.addAccount(name.trim(), contact); editCell(i, 'ownerAccount', name.trim()); }
        }
      });
    });
  }

  function _initColumnResize() {
    const table = document.getElementById('review-table');
    if (!table) return;
    const handles = table.querySelectorAll('.resize-handle');

    handles.forEach((handle) => {
      const th = handle.parentElement;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handle.classList.add('active');
        const startX = e.pageX;
        const startW = th.offsetWidth;
        const startTableW = table.offsetWidth;
        const onMove = (ev) => {
          const delta = ev.pageX - startX;
          const newW = Math.max(60, startW + delta);
          th.style.width = newW + 'px';
          th.style.minWidth = newW + 'px';
          table.style.width = (startTableW + delta) + 'px';
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

  // Build a <select> for a review row. Flags red if value doesn't match existing.
  // Options can be strings or objects: { value, label, group? }
  function _reviewSelect(idx, field, value, options, defaultVal, allowNew) {
    const flatList = options.map(o => typeof o === 'string' ? o : o.value || o.label);
    const valid = !value || _validIn(value, flatList);
    const cls = valid ? 'import-review-select' : 'import-review-select import-review-invalid';
    const current = value || defaultVal || '';
    let html = `<select class="${cls}" onchange="UIImport.editCell(${idx},'${field}',this.value)">`;
    if (!valid && value) {
      html += `<option value="${_escAttr(value)}" selected>${_esc(value)} ⚠ not in system</option>`;
    }
    if (!current || current === '') {
      html += `<option value="">-- None --</option>`;
    }
    options.forEach(opt => {
      if (typeof opt === 'string') {
        const sel = opt === current ? 'selected' : '';
        html += `<option value="${_escAttr(opt)}" ${sel}>${_esc(opt)}</option>`;
      } else if (opt.group) {
        html += `<optgroup label="${_escAttr(opt.label)}"></optgroup>`;
      } else {
        const sel = opt.value === current ? 'selected' : '';
        html += `<option value="${_escAttr(opt.value)}" ${sel}>${_esc(opt.label)}</option>`;
      }
    });
    if (allowNew) {
      const labels = { location: '+ New location...', ownerAccount: '+ New account...', category: '+ New category...', status: '+ New status...' };
      html += `<option value="__new__">${labels[field] || '+ New...'}</option>`;
    }
    html += '</select>';
    return html;
  }

  function _validIn(value, list) {
    if (!value) return true;
    return list.some(item => item.toLowerCase() === value.toLowerCase());
  }

  /** Toggle year input visibility when field dropdown changes */
  function _onFieldChange(selectEl, colIdx) {
    const row = selectEl.closest('tr');
    const yearInput = row?.querySelector('.import-map-year');
    if (!yearInput) return;
    const isMarket = selectEl.value === 'marketLow' || selectEl.value === 'marketHigh';
    yearInput.style.border = isMarket ? '1px solid var(--border)' : 'transparent';
    yearInput.style.background = isMarket ? 'var(--bg)' : 'transparent';
    yearInput.style.pointerEvents = isMarket ? '' : 'none';
    yearInput.style.color = isMarket ? '' : 'var(--muted)';
    if (!isMarket) yearInput.value = '';
  }

  // Expose for back button
  function _renderColumnMappingPublic() { _renderColumnMapping(); }

  function editCell(idx, field, value) {
    if (!pendingItems[idx]) return;
    // Handle "+ New..." options
    if (value === '__new__') {
      if (field === 'location') {
        const name = prompt('New location name:');
        if (name?.trim()) {
          DB.addLocation(name.trim());
          pendingItems[idx][field] = name.trim();
        } else { _renderReview(); return; }
      } else if (field === 'ownerAccount') {
        const name = prompt('New account name:');
        if (name?.trim()) {
          const contact = prompt('Contact (optional):') || '';
          DB.addAccount(name.trim(), contact);
          pendingItems[idx][field] = name.trim();
        } else { _renderReview(); return; }
      } else if (field === 'category') {
        const name = prompt('New category name:');
        if (name?.trim()) {
          const parent = prompt('Parent category (leave blank for top-level):') || '';
          DB.addCategory(name.trim(), parent.trim());
          pendingItems[idx][field] = name.trim();
        } else { _renderReview(); return; }
      } else if (field === 'status') {
        const name = prompt('New status name:');
        if (name?.trim()) {
          DB.addStatus(name.trim());
          pendingItems[idx][field] = name.trim();
        } else { _renderReview(); return; }
      }
    } else {
      pendingItems[idx][field] = value;
    }
    // Re-render to update validation state, preserving scroll position
    const wrap = document.querySelector('.import-review-table-wrap');
    const scrollTop = wrap ? wrap.scrollTop : 0;
    _renderReview();
    if (wrap) requestAnimationFrame(() => { wrap.scrollTop = scrollTop; });
  }

  function removeItem(idx) {
    pendingItems.splice(idx, 1);
    if (pendingItems.length === 0) {
      _renderColumnMapping();
    } else {
      _renderReview();
    }
  }

  function resolveDuplicate(idx, action) {
    const item = pendingItems[idx];
    if (!item) return;
    if (action === 'keep-new') {
      item._dupStatus = 'keep-new';
    } else if (action === 'keep-original') {
      item._dupStatus = 'keep-original';
    } else if (action === 'make-dup') {
      item._dupStatus = 'make-dup';
    } else if (action === 'duplicate') {
      // Reset to unresolved
      item._dupStatus = 'duplicate';
    }
    const wrap = document.querySelector('.import-review-table-wrap');
    const scrollTop = wrap ? wrap.scrollTop : 0;
    _renderReview();
    if (wrap) requestAnimationFrame(() => { wrap.scrollTop = scrollTop; });
  }

  function confirmImport() {
    const invalid = pendingItems.filter(i => !i.name || !i.name.trim());
    if (invalid.length) { Toast.error(`${invalid.length} item(s) are missing a name. Fix or remove them.`); return; }

    // Check for unresolved duplicates
    const unresolved = pendingItems.filter(i => i._dupStatus === 'duplicate');
    if (unresolved.length) { Toast.error(`${unresolved.length} duplicate serial(s) need resolution`); return; }

    // Separate items by resolution
    const toImport = [];
    let kept = 0, duped = 0;
    pendingItems.forEach(item => {
      if (item._dupStatus === 'keep-original') {
        kept++;
        return; // skip — don't import
      }
      if (item._dupStatus === 'make-dup') {
        // Clear serial so it adds as new item
        const clean = { ...item };
        delete clean.serialNumber;
        delete clean._dupStatus;
        delete clean._originalItem;
        toImport.push(clean);
        duped++;
        return;
      }
      // keep-new or no duplicate — import as-is
      const clean = { ...item };
      delete clean._dupStatus;
      delete clean._originalItem;
      toImport.push(clean);
    });

    const result = DB.importItems(toImport, false);

    const content = document.getElementById('import-content');
    content.innerHTML = `<div class="modal-header-bar">
        <span class="modal-title-sm">Import Complete</span>
        <button class="btn btn-sm btn-ghost" onclick="UIImport.close()">&times;</button>
      </div>
      <div class="import-result-box"><div class="import-success"><strong>Import Complete!</strong>
        <div class="import-stats">
          <span class="import-stat added">Added: ${result.added}</span>
          <span class="import-stat updated">Updated: ${result.updated}</span>
          <span class="import-stat skipped">Kept original: ${kept}</span>
          <span class="import-stat updated">Duplicates: ${duped}</span>
          <span class="import-stat skipped">Skipped: ${result.skipped}</span>
        </div></div></div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="UIImport.show()">Import More</button>
        <button class="btn btn-primary" onclick="UIImport.close()">Done</button>
      </div>`;
    Toast.success(`Imported ${result.added} items`);
    pendingItems = [];
    App.render();
  }

  return { show, close, downloadTemplate, handleFile, applyMapping, editCell, removeItem, resolveDuplicate, confirmImport, _renderColumnMapping: _renderColumnMappingPublic, _onFieldChange };
})();
