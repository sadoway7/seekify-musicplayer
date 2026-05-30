/* ── valuations (year-based market value estimates) ────────────── */

const DBValuations = (() => {

  function getForItem(itemId) {
    return DBCore.q(
      'SELECT * FROM valuations WHERE item_id = ? ORDER BY year DESC',
      [itemId]
    ).map(_map);
  }

  function getForYear(itemId, year) {
    const rows = DBCore.q(
      'SELECT * FROM valuations WHERE item_id = ? AND year = ?',
      [itemId, year]
    );
    return rows.length ? _map(rows[0]) : null;
  }

  /** Ensure a row exists for the current year; return it */
  function ensureCurrentYear(itemId) {
    const year = new Date().getFullYear();
    let row = getForYear(itemId, year);
    if (!row) {
      // Carry forward last year's values if they exist
      const last = getForItem(itemId)[0];
      const id = _uid();
      DBCore.r(
        'INSERT INTO valuations (id, item_id, year, value_low, value_high, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, itemId, year, last ? last.valueLow : '', last ? last.valueHigh : '', new Date().toISOString()]
      );
      DBCore.touch(); DBCore.scheduleSave();
      row = getForYear(itemId, year);
    }
    return row;
  }

  function add(itemId, year, valueLow, valueHigh) {
    const id = _uid();
    DBCore.r(
      'INSERT INTO valuations (id, item_id, year, value_low, value_high, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, itemId, year, valueLow || '', valueHigh || '', new Date().toISOString()]
    );
    DBCore.touch(); DBCore.scheduleSave();
  }

  function update(itemId, year, valueLow, valueHigh) {
    DBCore.r(
      'UPDATE valuations SET value_low = ?, value_high = ?, updated_at = ? WHERE item_id = ? AND year = ?',
      [valueLow || '', valueHigh || '', new Date().toISOString(), itemId, year]
    );
    DBCore.touch(); DBCore.scheduleSave();
  }

  function deleteForItem(itemId) {
    DBCore.r('DELETE FROM valuations WHERE item_id = ?', [itemId]);
    DBCore.touch(); DBCore.scheduleSave();
  }

  function _map(r) {
    return {
      id: r.id, itemId: r.item_id, year: r.year,
      valueLow: r.value_low || '', valueHigh: r.value_high || '',
      updatedAt: r.updated_at || '',
    };
  }

  return { getForItem, getForYear, ensureCurrentYear, add, update, deleteForItem };
})();
