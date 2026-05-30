/* ── history logging and activity queries ───────────────────── */

const DBHistory = (() => {

  function log(itemId, field, oldVal, newVal) {
    const user = _getCurrentUser();
    DBCore.r('INSERT INTO history (id, item_id, field_changed, old_value, new_value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [_uid(), itemId, field, oldVal || '', newVal || '', new Date().toISOString(), user]);
  }

  function getForItem(itemId) {
    return DBCore.q('SELECT * FROM history WHERE item_id = ? ORDER BY changed_at DESC', [itemId])
      .map(h => ({ id: h.id, fieldChanged: h.field_changed, oldValue: h.old_value, newValue: h.new_value, changedAt: h.changed_at, changedBy: h.changed_by || '' }));
  }

  function getAll(limit) {
    const sql = `SELECT h.*, i.name as item_name FROM history h LEFT JOIN items i ON h.item_id = i.id ORDER BY h.changed_at DESC` + (limit ? ` LIMIT ${limit}` : '');
    return DBCore.q(sql).map(h => ({
      id: h.id, itemId: h.item_id, itemName: h.item_name || '(deleted)',
      fieldChanged: h.field_changed, oldValue: h.old_value, newValue: h.new_value, changedAt: h.changed_at, changedBy: h.changed_by || ''
    }));
  }

  return { log, getForItem, getAll };
})();
