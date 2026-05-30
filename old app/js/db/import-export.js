/* ── CSV import, export, template ───────────────────────────── */

const DBImportExport = (() => {

  function exportCSV(items) {
    if (!items || !items.length) items = DBItems.getAll();
    let csv = ['Name','Description','Model','Serial Number','Status','Location','Owner','Assigned To','Category','Quantity','Brand','SKU','Part Number','IMEI','Cost','MSRP','Item Value','Sale Price','Valuation Year','Market Low','Market High','Barcode ID','Notes','Created','Updated']
      .map(_csvEscape).join(',') + '\n';
    items.forEach(item => {
      const base = [_csvEscape(item.name), _csvEscape(item.description), _csvEscape(item.model),
        _csvEscape(item.serialNumber), _csvEscape(item.status), _csvEscape(item.location),
        _csvEscape(item.ownerAccount), _csvEscape(item.assignedTo || ''),
        _csvEscape(item.category), _csvEscape(item.quantity || 1),
        _csvEscape(item.brand || ''), _csvEscape(item.sku || ''),
        _csvEscape(item.partNumber || ''), _csvEscape(item.imei || ''),
        _csvEscape(item.priceLow || ''), _csvEscape(item.priceHigh || ''),
        _csvEscape(item.itemValue), _csvEscape(item.salePrice),
      ].join(',');

      // Get valuations for this item
      const valuations = item.id ? DBValuations.getForItem(item.id) : [];
      const tail = ',' + [_csvEscape(item.barcodeId), _csvEscape(item.notes), _csvEscape(item.createdAt), _csvEscape(item.updatedAt)].join(',');

      if (valuations.length) {
        // One row per valuation year
        valuations.forEach(v => {
          csv += base + ',' + [_csvEscape(String(v.year)), _csvEscape(v.valueLow || ''), _csvEscape(v.valueHigh || '')].join(',') + tail + '\n';
        });
      } else {
        // No valuations — single row with empty year columns
        csv += base + ',,,' + tail + '\n';
      }
    });
    return csv;
  }

  function importItems(items, skipDuplicates) {
    let added = 0, skipped = 0, updated = 0, errors = 0;
    items.forEach(item => {
      // Extract valuations before processing item
      const valuations = item._valuations;
      delete item._valuations;

      if (item.serialNumber && item.serialNumber.trim()) {
        const existing = DBItems.findBySerial(item.serialNumber.trim());
        if (existing.length > 0) {
          if (skipDuplicates) { skipped++; return; }
          const ex = existing[0];
          DBCore.r(`UPDATE items SET name=?, description=?, model=?, status=?, location=?, owner_account=?, category=?, notes=?, quantity=?, updated_at=? WHERE id=?`,
            [item.name || ex.name, item.description || ex.description, item.model || ex.model,
             item.status || ex.status, item.location || ex.location, item.ownerAccount || ex.ownerAccount,
             item.category || ex.category, item.notes || ex.notes, item.quantity || ex.quantity || 1, new Date().toISOString(), ex.id]);
          DBHistory.log(ex.id, 'Import Update', '', 'Updated via CSV import');
          // Save valuations for updated item
          if (valuations?.length) _saveValuations(ex.id, valuations);
          updated++; return;
        }
      }
      const result = DBItems.addItem(item);
      if (result && result.error) { errors++; skipped++; } else {
        added++;
        // Save valuations for new item
        if (valuations?.length) _saveValuations(item.id, valuations);
      }
    });
    DBCore.touch(); DBCore.scheduleSave();
    return { added, skipped, updated, errors };
  }

  function _saveValuations(itemId, valuations) {
    valuations.forEach(v => {
      const existing = DBValuations.getForYear(itemId, v.year);
      if (existing) {
        // Merge: only overwrite if new value is non-empty
        const low = v.low || existing.valueLow;
        const high = v.high || existing.valueHigh;
        DBValuations.update(itemId, v.year, low, high);
      } else {
        DBValuations.add(itemId, v.year, v.low || '', v.high || '');
      }
    });
  }

  function getTemplateCSV() {
    return `Name,Description,Model,Serial Number,Status,Location,Owner,Assigned To,Category,Quantity,Brand,SKU,Part Number,IMEI,Cost,MSRP,Item Value,Sale Price,Valuation Year,Market Low,Market High,Barcode ID,Notes,Created,Updated
Example Laptop,15" developer laptop,MBP16-M3,ABC123XYZ,Available,Main Office,,John Smith,Laptops,1,Apple,,MBP16-M3-001,,1200.00,1800.00,,2024,800.00,1000.00,,Deployed at main rack,,
Example Laptop,15" developer laptop,MBP16-M3,ABC123XYZ,Available,Main Office,,John Smith,Laptops,1,Apple,,MBP16-M3-001,,1200.00,1800.00,,2025,700.00,900.00,,,,
Example Router,Core network switch,ISR4321,,In Field,Client Site,Acme Corp,,Networking,2,Cisco,ISR4321-SKU,,450.00,600.00,,,,,,,,Deployed at main rack,,
Example Monitor,27" 4K display,U2723QE,DEF456,In Use,Main Office,,Jane Doe,Monitors,3,Dell,,U2723QE-PN,300.00,450.00,,,,,,,,Assigned to desk 12,,`;
  }

  function exportActivityCSV() {
    const activity = DBHistory.getAll();
    let csv = ['Date','Item','Field Changed','Old Value','New Value'].map(_csvEscape).join(',') + '\n';
    activity.forEach(h => {
      csv += [_csvEscape(h.changedAt), _csvEscape(h.itemName), _csvEscape(h.fieldChanged),
        _csvEscape(h.oldValue), _csvEscape(h.newValue)].join(',') + '\n';
    });
    return csv;
  }

  return { exportCSV, importItems, getTemplateCSV, exportActivityCSV };
})();
