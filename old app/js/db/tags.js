/* ── tags CRUD ──────────────────────────────────────────────────── */

const DBTags = (() => {

  function getAll() {
    return DBCore.q('SELECT * FROM tags ORDER BY sort_order, name').map(_map);
  }

  function getByName(name) {
    const rows = DBCore.q('SELECT * FROM tags WHERE name = ?', [name]);
    return rows.length ? _map(rows[0]) : null;
  }

  function add(name, color) {
    if (!name?.trim()) return null;
    const id = _uid();
    const c = color || '#64748b';
    DBCore.r('INSERT OR IGNORE INTO tags (id, name, color, sort_order) VALUES (?, ?, ?, ?)',
      [id, name.trim(), c, 999]);
    DBCore.touch(); DBCore.scheduleSave();
    return getByName(name.trim());
  }

  function remove(id) {
    DBCore.r('DELETE FROM tags WHERE id = ?', [id]);
    DBCore.touch(); DBCore.scheduleSave();
  }

  function _map(r) {
    return { id: r.id, name: r.name || '', color: r.color || '', sortOrder: r.sort_order || 0 };
  }

  return { getAll, getByName, add, remove };
})();
