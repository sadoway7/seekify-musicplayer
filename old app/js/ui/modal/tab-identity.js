/* ── tab: identity — brand, SKU, part number, IMEI, barcode ── */

const TabIdentity = (() => {

  const tab = {
    id: 'identity',
    label: 'Identity',
    order: 2,
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',

    render(item, mode, isDeleted) {
      const dis = isDeleted ? 'disabled' : '';
      const extraClass = isDeleted ? 'cat-combo-disabled' : '';
      return `
        <div class="modal-form">
          <div class="form-row">
            <div class="form-group"><label>Brand</label>
              ${ListCombo.html('modal-brand', item.brand || '', extraClass)}
            </div>
            <div class="form-group"><label>SKU</label><input id="modal-sku" value="${_escAttr(item.sku || '')}" placeholder="Stock keeping unit" ${dis} /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Part Number</label><input id="modal-part-number" value="${_escAttr(item.partNumber || '')}" placeholder="Manufacturer part #" ${dis} /></div>
            <div class="form-group"><label>IMEI</label><input id="modal-imei" value="${_escAttr(item.imei || '')}" placeholder="Mobile device IMEI" ${dis} /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Item Number</label><input id="modal-item-number" value="${_escAttr(item.itemNumber || '')}" placeholder="Internal item #" ${dis} /></div>
            <div class="form-group"><label>Barcode ID</label><input id="modal-barcode-id" value="${_escAttr(item.barcodeId || '')}" placeholder="Auto-generated" ${dis} /></div>
          </div>
        </div>
      `;
    },

    gather() {
      return {
        brand: ListCombo.val('modal-brand'),
        sku: _val('modal-sku'),
        partNumber: _val('modal-part-number'),
        imei: _val('modal-imei'),
        itemNumber: _val('modal-item-number'),
        barcodeId: _val('modal-barcode-id'),
      };
    },

    isDirty(snapshot, mode) {
      if (mode === 'new') {
        return ListCombo.val('modal-brand') || _val('modal-sku') || _val('modal-part-number') || _val('modal-imei');
      }
      return ListCombo.val('modal-brand') !== (snapshot.brand || '') ||
             _val('modal-sku') !== (snapshot.sku || '') ||
             _val('modal-part-number') !== (snapshot.partNumber || '') ||
             _val('modal-imei') !== (snapshot.imei || '') ||
             _val('modal-item-number') !== (snapshot.itemNumber || '') ||
             _val('modal-barcode-id') !== (snapshot.barcodeId || '');
    },

    init(item, mode, isDisabled) {
      // Fetch distinct brand values from all items, plus seed brands
      ListCombo.init('modal-brand', _fetchBrands, null, {
        allowNew: !isDisabled,
        newLabel: '+ Add new brand...',
        onNew: _addBrand,
      });
    },
  };

  function _fetchBrands() {
    // Get all distinct brands currently in use
    const rows = DBCore.q("SELECT DISTINCT brand FROM items WHERE brand != '' AND brand IS NOT NULL ORDER BY brand");
    const used = rows.map(r => r.brand);
    // Seed brands that should always be available
    const seeds = ['Apple','Cisco','Dell','HP','Lenovo','LG','Microsoft','Samsung','Ubiquiti','Logitech','APC','Fluke'];
    const all = [...new Set([...seeds, ...used])].sort();
    return all;
  }

  function _addBrand() {
    const name = prompt('New brand name:');
    if (name?.trim()) {
      ListCombo.setVal('modal-brand', name.trim());
    }
  }

  Modal.registerTab(tab);
  return { tab };
})();
