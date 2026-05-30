/* ── tab: valuation — cost, MSRP, market value, sale price ──── */

const TabValuation = (() => {

  /* DB fields: priceLow=Cost, priceHigh=MSRP, itemValue unused, salePrice=Sale Price
     Valuations table: year-based value_low/value_high for market estimates */

  let _priorEdits = {}; // year → { low, high } — tracks edits to prior year rows

  const tab = {
    id: 'valuation',
    label: 'Valuation',
    order: 3,
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',

    render(item, mode, isDeleted) {
      const dis = isDeleted ? 'disabled' : '';
      const qty = item.quantity || 1;

      // Reset prior edits on render
      _priorEdits = {};

      // Get valuations — ensure current year exists
      let valuations = [];
      let currentVal = null;
      if (item.id && mode !== 'new') {
        currentVal = DBValuations.ensureCurrentYear(item.id);
        valuations = DBValuations.getForItem(item.id);
      }
      if (!currentVal) {
        currentVal = { year: new Date().getFullYear(), valueLow: '', valueHigh: '' };
      }

      const thisYear = new Date().getFullYear();
      const prevYears = valuations.filter(v => v.year !== currentVal.year);

      return `
        <div class="modal-form">
          <div class="form-row">
            <div class="form-group"><label>MSRP</label><input id="modal-price-high" value="${_escAttr(item.priceHigh || '')}" placeholder="Manufacturer retail price" ${dis} /></div>
            <div class="form-group"><label>Cost (Purchase Price)</label><input id="modal-price-low" value="${_escAttr(item.priceLow || '')}" placeholder="What we paid" ${dis} oninput="TabValuation._updateComputed()" /></div>
            <div class="form-group"><label>Sale Price</label><input id="modal-sale-price" value="${_escAttr(item.salePrice || '')}" placeholder="Listed selling price" ${dis} /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Date Purchased</label><input type="date" id="modal-date-purchased" value="${_escAttr(item.datePurchased || '')}" ${dis} /></div>
            <div class="form-group"><label>Date Sold</label><input type="date" id="modal-date-sold" value="${_escAttr(item.dateSold || '')}" ${dis} /></div>
          </div>

          <hr class="form-divider" />

          <div class="valuation-year-header">
            <span>Estimated Market Value</span>
            <span class="valuation-year-badge">${currentVal.year}</span>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Low Estimate</label><input id="modal-market-low" value="${_escAttr(currentVal.valueLow || '')}" placeholder="Conservative" ${dis} oninput="TabValuation._updateComputed()" /></div>
            <div class="form-group"><label>High Estimate</label><input id="modal-market-high" value="${_escAttr(currentVal.valueHigh || '')}" placeholder="Optimistic" ${dis} oninput="TabValuation._updateComputed()" /></div>
          </div>

          <div class="valuation-computed">
            <div class="valuation-computed-title">Totals</div>
            <div class="valuation-grid">
              <div class="valuation-cell">
                <div class="valuation-label">Qty</div>
                <div class="valuation-value" id="val-qty">${qty}</div>
              </div>
              <div class="valuation-cell">
                <div class="valuation-label">Total Cost</div>
                <div class="valuation-value" id="val-total-cost"></div>
              </div>
              <div class="valuation-cell">
                <div class="valuation-label">Market Low</div>
                <div class="valuation-value valuation-low" id="val-market-low"></div>
              </div>
              <div class="valuation-cell">
                <div class="valuation-label">Market High</div>
                <div class="valuation-value valuation-high" id="val-market-high"></div>
              </div>
              <div class="valuation-cell">
                <div class="valuation-label">Gain / Loss</div>
                <div class="valuation-value" id="val-gain-loss"></div>
              </div>
            </div>
          </div>

          <div class="valuation-prev-title">
            <span>Prior Years</span>
            ${!isDeleted ? `<button type="button" class="btn btn-sm btn-ghost" onclick="TabValuation._addPriorYear()" style="font-size:0.6875rem;padding:2px 8px;">+ Add year</button>` : ''}
          </div>
          <div class="valuation-prev-list" id="valuation-prior-list">
            ${prevYears.length ? prevYears.map(v => _priorRow(v, dis)).join('') : '<div class="valuation-prev-empty">No prior year valuations</div>'}
          </div>
        </div>
      `;
    },

    gather() {
      const data = {
        priceLow: _val('modal-price-low'),
        priceHigh: _val('modal-price-high'),
        salePrice: _val('modal-sale-price'),
        datePurchased: _val('modal-date-purchased'),
        dateSold: _val('modal-date-sold'),
        _marketLow: _val('modal-market-low'),
        _marketHigh: _val('modal-market-high'),
        _priorEdits: { ..._priorEdits },
      };
      // Also gather from any visible prior year inputs
      document.querySelectorAll('.valuation-prior-input').forEach(input => {
        const year = input.dataset.year;
        const field = input.dataset.field; // 'low' or 'high'
        if (!_priorEdits[year]) _priorEdits[year] = {};
        _priorEdits[year][field] = input.value.trim();
      });
      data._priorEdits = { ..._priorEdits };
      return data;
    },

    isDirty(snapshot, mode) {
      if (!document.getElementById('modal-price-low')) return false;
      if (mode === 'new') {
        return _val('modal-sale-price') || _val('modal-price-low') || _val('modal-price-high');
      }
      // Check current year fields
      if (_val('modal-price-low') !== (snapshot.priceLow || '')) return true;
      if (_val('modal-price-high') !== (snapshot.priceHigh || '')) return true;
      if (_val('modal-sale-price') !== (snapshot.salePrice || '')) return true;
      if (_val('modal-date-purchased') !== (snapshot.datePurchased || '')) return true;
      if (_val('modal-date-sold') !== (snapshot.dateSold || '')) return true;
      if (_val('modal-market-low') !== (snapshot._marketLow || '')) return true;
      if (_val('modal-market-high') !== (snapshot._marketHigh || '')) return true;

      // Check prior year edits
      const prior = tab.gather()._priorEdits;
      for (const [year, vals] of Object.entries(prior)) {
        const snapYear = snapshot._priorYears?.[year];
        if (!snapYear) {
          // New year added — dirty if any value present
          if ((vals.low && vals.low !== '') || (vals.high && vals.high !== '')) return true;
        } else {
          if ((vals.low || '') !== (snapYear.valueLow || '')) return true;
          if ((vals.high || '') !== (snapYear.valueHigh || '')) return true;
        }
      }
      return false;
    },

    init(item, mode, isDeleted) {
      _updateComputed();
    },
  };

  function _fmt(v) {
    return v > 0 ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  }

  function _priorRow(v, dis) {
    return `
      <div class="valuation-prev-row">
        <span class="valuation-prev-year">${v.year}</span>
        <input class="valuation-prior-input" data-year="${v.year}" data-field="low"
          value="${_escAttr(v.valueLow || '')}" placeholder="Low" ${dis} style="width:90px;font-size:0.8125rem;" />
        <span class="valuation-prev-sep">–</span>
        <input class="valuation-prior-input" data-year="${v.year}" data-field="high"
          value="${_escAttr(v.valueHigh || '')}" placeholder="High" ${dis} style="width:90px;font-size:0.8125rem;" />
        ${!dis ? `<button type="button" class="valuation-prior-remove" onclick="TabValuation._removePriorYear(${v.year})" title="Remove">&times;</button>` : ''}
      </div>`;
  }

  function _addPriorYear() {
    const thisYear = new Date().getFullYear();
    // Find existing years
    const list = document.getElementById('valuation-prior-list');
    if (!list) return;

    const existingYears = [...list.querySelectorAll('.valuation-prev-year')].map(el => parseInt(el.textContent));
    existingYears.push(thisYear); // current year is off-limits too

    // Find next available past year
    let year = thisYear - 1;
    while (existingYears.includes(year) && year > 1990) year--;

    if (existingYears.includes(year)) {
      Toast.error('No available years to add');
      return;
    }

    // Remove "no prior" empty message if present
    const empty = list.querySelector('.valuation-prev-empty');
    if (empty) empty.remove();

    // Insert row
    const rowHtml = `
      <div class="valuation-prev-row">
        <input class="valuation-prior-year-input" type="number" min="1990" max="${thisYear - 1}" value="${year}"
          onchange="TabValuation._changePriorYear(this)" style="width:56px;font-size:0.8125rem;font-weight:600;color:var(--muted);" />
        <input class="valuation-prior-input" data-year="${year}" data-field="low"
          value="" placeholder="Low" style="width:90px;font-size:0.8125rem;" />
        <span class="valuation-prev-sep">–</span>
        <input class="valuation-prior-input" data-year="${year}" data-field="high"
          value="" placeholder="High" style="width:90px;font-size:0.8125rem;" />
        <button type="button" class="valuation-prior-remove" onclick="TabValuation._removePriorYear(${year})" title="Remove">&times;</button>
      </div>`;
    list.insertAdjacentHTML('beforeend', rowHtml);
  }

  function _changePriorYear(input) {
    const row = input.closest('.valuation-prev-row');
    const newYear = parseInt(input.value);
    const thisYear = new Date().getFullYear();
    if (isNaN(newYear) || newYear < 1990 || newYear >= thisYear) {
      Toast.error('Enter a year between 1990 and ' + (thisYear - 1));
      input.value = input.defaultValue;
      return;
    }
    // Update data-year on sibling inputs
    row.querySelectorAll('.valuation-prior-input').forEach(inp => {
      inp.dataset.year = newYear;
    });
    // Update remove button
    const removeBtn = row.querySelector('.valuation-prior-remove');
    if (removeBtn) {
      removeBtn.setAttribute('onclick', `TabValuation._removePriorYear(${newYear})`);
    }
  }

  function _removePriorYear(year) {
    const list = document.getElementById('valuation-prior-list');
    if (!list) return;
    const inputs = list.querySelectorAll(`.valuation-prior-input[data-year="${year}"]`);
    if (inputs.length) {
      const row = inputs[0].closest('.valuation-prev-row');
      if (row) row.remove();
    }
    // Show empty message if no rows left
    if (!list.querySelector('.valuation-prev-row')) {
      list.innerHTML = '<div class="valuation-prev-empty">No prior year valuations</div>';
    }
    // Remove from edits
    delete _priorEdits[year];
  }

  function _updateComputed() {
    const qtyEl = document.getElementById('modal-qty-value');
    const qty = qtyEl ? parseInt(qtyEl.textContent) || 1 : 1;
    const cost = parseFloat(document.getElementById('modal-price-low')?.value) || 0;
    const marketLow = parseFloat(document.getElementById('modal-market-low')?.value) || 0;
    const marketHigh = parseFloat(document.getElementById('modal-market-high')?.value) || 0;

    const totalCost = cost * qty;
    const totalLow = marketLow * qty;
    const totalHigh = marketHigh * qty;
    const gainLoss = ((marketLow + marketHigh) / 2 - cost) * qty;

    const elQty = document.getElementById('val-qty');
    const elCost = document.getElementById('val-total-cost');
    const elLow = document.getElementById('val-market-low');
    const elHigh = document.getElementById('val-market-high');
    const elGain = document.getElementById('val-gain-loss');

    if (elQty) elQty.textContent = qty;
    if (elCost) elCost.textContent = _fmt(totalCost);
    if (elLow) elLow.textContent = _fmt(totalLow);
    if (elHigh) elHigh.textContent = _fmt(totalHigh);
    if (elGain) {
      if (gainLoss > 0) {
        elGain.textContent = '+' + _fmt(gainLoss);
        elGain.className = 'valuation-value valuation-gain';
      } else if (gainLoss < 0) {
        elGain.textContent = '-' + _fmt(gainLoss);
        elGain.className = 'valuation-value valuation-loss';
      } else {
        elGain.textContent = '—';
        elGain.className = 'valuation-value';
      }
    }
  }

  /** Save all valuations — current year + prior years */
  function _saveValuations(itemId, overrides) {
    const year = new Date().getFullYear();
    const low = overrides?._marketLow ?? _val('modal-market-low');
    const high = overrides?._marketHigh ?? _val('modal-market-high');
    DBValuations.ensureCurrentYear(itemId);
    DBValuations.update(itemId, year, low, high);

    // Save prior years
    const priorData = overrides?._priorEdits;
    if (priorData) {
      for (const [yr, vals] of Object.entries(priorData)) {
        const y = parseInt(yr);
        if (isNaN(y)) continue;
        const lo = vals.low || '';
        const hi = vals.high || '';
        // Upsert: ensure row exists, then update
        const existing = DBValuations.getForYear(itemId, y);
        if (!existing) {
          DBValuations.add(itemId, y, lo, hi);
        } else {
          DBValuations.update(itemId, y, lo, hi);
        }
      }
    }

    // Also gather from DOM if tab is active (for direct edits not in stash)
    const priorInputs = document.querySelectorAll('.valuation-prior-input');
    if (priorInputs.length) {
      const domData = {};
      priorInputs.forEach(inp => {
        const yr = inp.dataset.year;
        const field = inp.dataset.field;
        if (!domData[yr]) domData[yr] = {};
        domData[yr][field] = inp.value.trim();
      });
      for (const [yr, vals] of Object.entries(domData)) {
        const y = parseInt(yr);
        if (isNaN(y) || y === year) continue; // skip current year (already saved)
        const lo = vals.low || '';
        const hi = vals.high || '';
        const existing = DBValuations.getForYear(itemId, y);
        if (!existing) {
          DBValuations.add(itemId, y, lo, hi);
        } else {
          DBValuations.update(itemId, y, lo, hi);
        }
      }
    }
  }

  Modal.registerTab(tab);
  return { tab, _updateComputed, _saveValuations, _addPriorYear, _changePriorYear, _removePriorYear };
})();
