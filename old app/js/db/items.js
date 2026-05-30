/* ── item CRUD, search, serial enforcement, filtered queries ── */

const DBItems = (() => {

  const ARCHIVE_STATUSES = ['Sold', 'Retired', 'Disposed'];

  function _mapItem(row) {
    return {
      id: row.id, name: row.name, description: row.description || '',
      model: row.model || '', serialNumber: row.serial_number || '',
      status: row.status || 'Available', location: row.location || '',
      ownerAccount: row.owner_account || '', category: row.category || 'General',
      barcodeId: row.barcode_id || '', notes: row.notes || '',
      createdAt: row.created_at || '', updatedAt: row.updated_at || '',
      deleted: row.deleted || 0,
      itemValue: row.item_value || '', salePrice: row.sale_price || '',
      quantity: row.quantity != null ? row.quantity : 1,
      // New fields
      assignedTo: row.assigned_to || '',
      brand: row.brand || '', sku: row.sku || '',
      partNumber: row.part_number || '', imei: row.imei || '',
      itemNumber: row.item_number || '',
      priceHigh: row.price_high || '', priceLow: row.price_low || '',
      conditionType: row.condition_type || '', conditionGrade: row.condition_grade || '',
      boxed: row.boxed || 0, conditionNotes: row.condition_notes || '',
      tags: row.tags || '',
      datePurchased: row.date_purchased || '', dateSold: row.date_sold || '',
    };
  }

  function _enrichItem(row) {
    const item = _mapItem(row);
    item.history = DBHistory.getForItem(row.id);
    return item;
  }

  function _enrichItems(rows) {
    if (!rows.length) return [];
    const allHistory = DBCore.q('SELECT * FROM history ORDER BY changed_at DESC');
    const hm = {};
    allHistory.forEach(h => { (hm[h.item_id] = hm[h.item_id] || []).push(h); });
    return rows.map(r => {
      const item = _mapItem(r);
      item.history = (hm[r.id] || []).map(h => ({
        id: h.id, fieldChanged: h.field_changed, oldValue: h.old_value, newValue: h.new_value, changedAt: h.changed_at, changedBy: h.changed_by || ''
      }));
      return item;
    });
  }

  const SEARCH_FIELDS = 'LOWER(name) LIKE ? OR LOWER(serial_number) LIKE ? OR LOWER(model) LIKE ? OR LOWER(description) LIKE ? OR LOWER(barcode_id) LIKE ? OR LOWER(category) LIKE ? OR LOWER(location) LIKE ? OR LOWER(owner_account) LIKE ? OR LOWER(status) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(assigned_to) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(part_number) LIKE ? OR LOWER(imei) LIKE ? OR LOWER(item_number) LIKE ? OR LOWER(condition_type) LIKE ? OR LOWER(condition_grade) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(item_value) LIKE ? OR LOWER(sale_price) LIKE ? OR LOWER(price_high) LIKE ? OR LOWER(price_low) LIKE ? OR LOWER(condition_notes) LIKE ?';
  const SEARCH_PARAM_COUNT = 24;

  function _applySearchFilter(sql, params, searchTerm) {
    // Split search into individual terms (space-separated) and AND them
    const terms = searchTerm.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
    terms.forEach(term => {
      const q = '%' + term + '%';
      sql += ' AND (' + SEARCH_FIELDS + ')';
      params.push(...Array(SEARCH_PARAM_COUNT).fill(q));
    });
    return sql;
  }

  function _filteredQuery(baseSql, baseParams, filters) {
    // Always exclude soft-deleted items from list views
    baseSql += ' AND (deleted = 0 OR deleted IS NULL)';
    const params = [...baseParams];
    if (filters) {
      if (filters.status && filters.status !== 'All') { baseSql += ' AND status = ?'; params.push(filters.status); }
      if (filters.location && filters.location !== 'All') { baseSql += ' AND location = ?'; params.push(filters.location); }
      if (filters.category && filters.category !== 'All') { baseSql += ' AND category = ?'; params.push(filters.category); }
      if (filters.owner && filters.owner !== 'All') { baseSql += ' AND owner_account = ?'; params.push(filters.owner); }
      if (filters.search && filters.search.trim()) {
        baseSql = _applySearchFilter(baseSql, params, filters.search);
      }
    }
    baseSql += ' ORDER BY name';
    return _enrichItems(DBCore.q(baseSql, params));
  }

  function _rawFilteredQuery(baseSql, baseParams, filters) {
    // Same as _filteredQuery but does NOT exclude deleted items
    const params = [...baseParams];
    if (filters) {
      if (filters.status && filters.status !== 'All') { baseSql += ' AND status = ?'; params.push(filters.status); }
      if (filters.location && filters.location !== 'All') { baseSql += ' AND location = ?'; params.push(filters.location); }
      if (filters.category && filters.category !== 'All') { baseSql += ' AND category = ?'; params.push(filters.category); }
      if (filters.owner && filters.owner !== 'All') { baseSql += ' AND owner_account = ?'; params.push(filters.owner); }
      if (filters.search && filters.search.trim()) {
        baseSql = _applySearchFilter(baseSql, params, filters.search);
      }
    }
    baseSql += ' ORDER BY name';
    return _enrichItems(DBCore.q(baseSql, params));
  }

  /* ── public queries ────────────────────────────────────────── */

  function getAll() { return _enrichItems(DBCore.q('SELECT * FROM items WHERE (deleted = 0 OR deleted IS NULL) ORDER BY name')); }
  function getById(id) { const r = DBCore.q('SELECT * FROM items WHERE id = ?', [id]); return r.length ? _enrichItem(r[0]) : null; }
  function getCount() { return DBCore.q('SELECT COUNT(*) AS cnt FROM items WHERE (deleted = 0 OR deleted IS NULL)')[0]?.cnt || 0; }

  function getActive(filters) {
    return _filteredQuery('SELECT * FROM items WHERE status NOT IN (' + ARCHIVE_STATUSES.map(() => '?').join(',') + ')', [...ARCHIVE_STATUSES], filters);
  }

  function getArchived(filters) {
    const statusPlaceholders = ARCHIVE_STATUSES.map(() => '?').join(',');
    const baseSql = `SELECT * FROM items WHERE (status IN (${statusPlaceholders}) OR deleted = 1)`;
    return _rawFilteredQuery(baseSql, [...ARCHIVE_STATUSES], filters);
  }

  function getFiltered(filters) { return _filteredQuery('SELECT * FROM items WHERE 1=1', [], filters); }

  function findBySerial(serial) {
    if (!serial || !serial.trim()) return [];
    return DBCore.q('SELECT * FROM items WHERE (deleted = 0 OR deleted IS NULL) AND LOWER(serial_number) = LOWER(?)', [serial.trim()]).map(r => _mapItem(r));
  }

  function isArchiveStatus(status) { return ARCHIVE_STATUSES.includes(status); }
  function isDeleted(id) { const r = DBCore.q('SELECT deleted FROM items WHERE id = ?', [id]); return r.length ? (r[0].deleted || 0) === 1 : false; }

  /* ── CRUD ──────────────────────────────────────────────────── */

  function addItem(item) {
    if (item.serialNumber && item.serialNumber.trim()) {
      const existing = findBySerial(item.serialNumber.trim());
      if (existing.length > 0) return { error: 'Duplicate serial number', existingItem: existing[0] };
    }
    const id = item.id || _uid();
    const barcode = item.barcodeId || _barcodeId();
    const now = new Date().toISOString();
    DBCore.r(`INSERT INTO items (id,name,description,model,serial_number,status,location,owner_account,category,barcode_id,notes,created_at,updated_at,item_order,deleted,quantity,item_value,sale_price,assigned_to,brand,sku,part_number,imei,item_number,price_high,price_low,condition_type,condition_grade,boxed,condition_notes,date_purchased,date_sold)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, item.name, item.description || '', item.model || '', item.serialNumber || '',
       item.status || 'Available', item.location || '', item.ownerAccount || '',
       item.category || 'General', barcode, item.notes || '', now, now,
       item.quantity || 1,
       item.itemValue || '', item.salePrice || '',
       item.assignedTo || '', item.brand || '', item.sku || '',
       item.partNumber || '', item.imei || '', item.itemNumber || '',
       item.priceHigh || '', item.priceLow || '',
       item.conditionType || '', item.conditionGrade || '',
       item.boxed || 0, item.conditionNotes || '',
       item.datePurchased || '', item.dateSold || '']);
    DBHistory.log(id, 'Created', '', item.name);
    DBCore.touch(); DBCore.scheduleSave();
    return getById(id);
  }

  function updateItem(id, updates) {
    const old = getById(id);
    if (!old) return null;
    if (updates.serialNumber && updates.serialNumber.trim() && updates.serialNumber.trim() !== (old.serialNumber || '').trim()) {
      const conflict = findBySerial(updates.serialNumber.trim()).find(e => e.id !== id);
      if (conflict) return { error: 'Duplicate serial number', existingItem: conflict };
    }
    const colMap = { name:'name',description:'description',model:'model',serialNumber:'serial_number',
      status:'status',location:'location',ownerAccount:'owner_account',category:'category',
      barcodeId:'barcode_id',notes:'notes',itemValue:'item_value',salePrice:'sale_price',
      quantity:'quantity',assignedTo:'assigned_to',brand:'brand',sku:'sku',
      partNumber:'part_number',imei:'imei',itemNumber:'item_number',
      priceHigh:'price_high',priceLow:'price_low',
      conditionType:'condition_type',conditionGrade:'condition_grade',
      boxed:'boxed',conditionNotes:'condition_notes',tags:'tags',
      datePurchased:'date_purchased',dateSold:'date_sold' };
    const labels = { name:'Name',description:'Description',model:'Model',serialNumber:'Serial Number',
      status:'Status',location:'Location',ownerAccount:'Owner',category:'Category',
      barcodeId:'Barcode ID',notes:'Notes',itemValue:'Item Value',salePrice:'Sale Price',
      quantity:'Quantity',assignedTo:'Assigned To',brand:'Brand',sku:'SKU',
      partNumber:'Part Number',imei:'IMEI',itemNumber:'Item Number',
      priceHigh:'Price High',priceLow:'Price Low',
      conditionType:'Condition',conditionGrade:'Condition Grade',
      boxed:'Boxed',conditionNotes:'Condition Notes',tags:'Tags',
      datePurchased:'Date Purchased',dateSold:'Date Sold' };
    const fields = [], vals = [];
    Object.keys(colMap).forEach(k => {
      if (updates[k] !== undefined) {
        const nv = String(updates[k]), ov = String(old[k] || '');
        // Quantity is logged by the caller with reason context — skip auto-log
        if (nv !== ov && k !== 'quantity') DBHistory.log(id, labels[k], ov, nv);
        fields.push(colMap[k] + ' = ?'); vals.push(updates[k]);
      }
    });
    if (fields.length) { fields.push('updated_at = ?'); vals.push(new Date().toISOString()); vals.push(id); DBCore.r('UPDATE items SET ' + fields.join(', ') + ' WHERE id = ?', vals); }
    DBCore.touch(); DBCore.scheduleSave();
    return getById(id);
  }

  /* ── soft delete ───────────────────────────────────────────── */

  function deleteItem(id) {
    const item = _mapItem(DBCore.q('SELECT * FROM items WHERE id = ?', [id])[0]);
    if (!item) return;
    DBHistory.log(id, 'Deleted', item.name, '');
    DBCore.r('UPDATE items SET deleted = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    DBCore.touch(); DBCore.scheduleSave();
  }

  function deleteItems(ids) {
    ids.forEach(id => deleteItem(id));
  }

  /* ── stats (exclude deleted) ───────────────────────────────── */

  function getStats() {
    const where = 'WHERE (deleted = 0 OR deleted IS NULL)';
    const total = DBCore.q(`SELECT COUNT(*) AS cnt FROM items ${where}`)[0]?.cnt || 0;
    const byStatus = {}; DBCore.q(`SELECT status, COUNT(*) as cnt FROM items ${where} GROUP BY status`).forEach(r => byStatus[r.status || 'Unknown'] = r.cnt);
    const byLocation = {}; DBCore.q(`SELECT location, COUNT(*) as cnt FROM items ${where} GROUP BY location`).forEach(r => byLocation[r.location || 'Unknown'] = r.cnt);
    const byCategory = {}; DBCore.q(`SELECT category, COUNT(*) as cnt FROM items ${where} GROUP BY category`).forEach(r => byCategory[r.category || 'Unknown'] = r.cnt);
    const byAccount = {}; DBCore.q(`SELECT owner_account, COUNT(*) as cnt FROM items ${where} GROUP BY owner_account`).forEach(r => byAccount[r.owner_account || ''] = r.cnt);
    const withOwner = DBCore.q(`SELECT COUNT(*) as cnt FROM items ${where} AND owner_account != ''`);
    const totalValue = DBCore.q(`SELECT SUM(CAST(item_value AS REAL)) as total FROM items ${where} AND item_value != ''`)[0]?.total || 0;
    const valueByCategory = {}; DBCore.q(`SELECT category, SUM(CAST(item_value AS REAL)) as total FROM items ${where} AND item_value != '' AND item_value IS NOT NULL GROUP BY category`).forEach(r => valueByCategory[r.category || 'Uncategorized'] = r.total || 0);
    const valueByLocation = {}; DBCore.q(`SELECT location, SUM(CAST(item_value AS REAL)) as total FROM items ${where} AND item_value != '' AND item_value IS NOT NULL GROUP BY location`).forEach(r => valueByLocation[r.location || 'Unlocated'] = r.total || 0);

    // Conservative value (price_low × qty)
    const conservativeValue = DBCore.q(`SELECT SUM(CAST(price_low AS REAL) * quantity) as total FROM items ${where} AND price_low != '' AND price_low IS NOT NULL`)[0]?.total || 0;
    const optimisticValue = DBCore.q(`SELECT SUM(CAST(price_high AS REAL) * quantity) as total FROM items ${where} AND price_high != '' AND price_high IS NOT NULL`)[0]?.total || 0;

    return {
      total, byStatus, byLocation, byCategory, byAccount,
      active: DBCore.q(`SELECT COUNT(*) as cnt FROM items ${where} AND status NOT IN (${ARCHIVE_STATUSES.map(() => '?').join(',')})`, [...ARCHIVE_STATUSES])[0]?.cnt || 0,
      archived: DBCore.q(`SELECT COUNT(*) as cnt FROM items ${where} AND status IN (${ARCHIVE_STATUSES.map(() => '?').join(',')})`, [...ARCHIVE_STATUSES])[0]?.cnt || 0,
      withOwner: withOwner.length ? withOwner[0].cnt : 0,
      withoutOwner: DBCore.q(`SELECT COUNT(*) as cnt FROM items ${where} AND (owner_account = '' OR owner_account IS NULL)`)[0]?.cnt || 0,
      withoutSerial: DBCore.q(`SELECT COUNT(*) as cnt FROM items ${where} AND (serial_number = '' OR serial_number IS NULL)`)[0]?.cnt || 0,
      totalValue, valueByCategory, valueByLocation,
      conservativeValue, optimisticValue,
    };
  }

  return { getAll, getById, getCount, getActive, getArchived, getFiltered, findBySerial, isArchiveStatus, isDeleted,
    addItem, updateItem, deleteItem, deleteItems, getStats };
})();
