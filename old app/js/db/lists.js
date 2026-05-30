/* ── categories, locations, statuses, accounts CRUD ─────────── */

const DBLists = (() => {

  /* ── categories ────────────────────────────────────────────── */

  function getCategories() {
    const ordered = DBCore.q('SELECT name FROM categories ORDER BY sort_order').map(r => r.name);
    DBCore.q('SELECT DISTINCT category FROM items').map(r => r.category).forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
    return ordered;
  }
  function getCategoriesWithSubs() {
    const rows = DBCore.q('SELECT name, parent_category FROM categories ORDER BY sort_order');
    const seen = new Set();
    const result = [];
    rows.forEach(r => {
      if (!seen.has(r.name)) { seen.add(r.name); result.push({ name: r.name, parent: r.parent_category || '' }); }
    });
    // Include any categories from items not in the categories table
    DBCore.q('SELECT DISTINCT category FROM items').map(r => r.category).forEach(c => {
      if (c && !seen.has(c)) { seen.add(c); result.push({ name: c, parent: '' }); }
    });
    return result;
  }
  function getSubCategories(parent) {
    return DBCore.q('SELECT name FROM categories WHERE parent_category = ? ORDER BY sort_order', [parent]).map(r => r.name);
  }
  function addCategory(name, parent) {
    if (!name.trim()) return;
    const mx = DBCore.q('SELECT MAX(sort_order) AS m FROM categories');
    DBCore.r('INSERT OR IGNORE INTO categories (id, name, sort_order, parent_category) VALUES (?, ?, ?, ?)', [_uid(), name.trim(), (mx.length && mx[0].m !== null) ? mx[0].m + 1 : 0, parent || '']);
    DBCore.touch(); DBCore.scheduleSave();
  }
  function updateCategory(oldName, newName) {
    if (!newName?.trim() || oldName === newName.trim()) return;
    DBCore.r('UPDATE categories SET name=? WHERE name=?', [newName.trim(), oldName]);
    DBCore.r('UPDATE categories SET parent_category=? WHERE parent_category=?', [newName.trim(), oldName]);
    DBCore.r('UPDATE items SET category=? WHERE category=?', [newName.trim(), oldName]);
    DBCore.touch(); DBCore.scheduleSave();
  }
  function deleteCategory(name) { DBCore.r('DELETE FROM categories WHERE name = ?', [name]); DBCore.touch(); DBCore.scheduleSave(); }

  /* ── locations ─────────────────────────────────────────────── */

  function getLocations(accountName) {
    if (accountName) {
      const rows = DBCore.q("SELECT name FROM locations WHERE account_name = '' OR account_name IS NULL OR account_name = ? ORDER BY sort_order", [accountName]);
      const seen = new Set();
      const result = [];
      rows.forEach(r => { if (!seen.has(r.name)) { seen.add(r.name); result.push(r.name); } });
      return result;
    }
    const ordered = DBCore.q('SELECT name FROM locations ORDER BY sort_order').map(r => r.name);
    DBCore.q('SELECT DISTINCT location FROM items').map(r => r.location).filter(l => l).forEach(l => { if (!ordered.includes(l)) ordered.push(l); });
    return ordered;
  }

  function getLocationsWithAccount() {
    const rows = DBCore.q('SELECT name, account_name FROM locations ORDER BY sort_order');
    const seen = new Set();
    const result = [];
    rows.forEach(r => {
      if (!seen.has(r.name)) { seen.add(r.name); result.push({ name: r.name, accountName: r.account_name || '' }); }
    });
    return result;
  }

  function getLocationsForAccount(accountName) {
    if (!accountName) return [];
    return DBCore.q('SELECT name FROM locations WHERE account_name = ? ORDER BY sort_order', [accountName]).map(r => r.name);
  }
  function addLocation(name, accountName) {
    if (!name.trim()) return;
    const mx = DBCore.q('SELECT MAX(sort_order) AS m FROM locations');
    DBCore.r('INSERT OR IGNORE INTO locations (id, name, sort_order, account_name) VALUES (?, ?, ?, ?)', [_uid(), name.trim(), (mx.length && mx[0].m !== null) ? mx[0].m + 1 : 0, accountName || '']);
    DBCore.touch(); DBCore.scheduleSave();
  }
  function deleteLocation(name) { DBCore.r('DELETE FROM locations WHERE name = ?', [name]); DBCore.touch(); DBCore.scheduleSave(); }
  function updateLocation(oldName, newName) {
    if (!newName?.trim() || oldName === newName.trim()) return;
    DBCore.r('UPDATE locations SET name=? WHERE name=?', [newName.trim(), oldName]);
    DBCore.r('UPDATE items SET location=? WHERE location=?', [newName.trim(), oldName]);
    DBCore.touch(); DBCore.scheduleSave();
  }

  /* ── statuses ──────────────────────────────────────────────── */

  function getStatuses() {
    const ordered = DBCore.q('SELECT name, color FROM statuses ORDER BY sort_order');
    const result = ordered.map(r => ({ name: r.name, color: r.color || '#64748b' }));
    DBCore.q('SELECT DISTINCT status FROM items').map(r => r.status).forEach(s => {
      if (s && !result.find(r => r.name === s)) result.push({ name: s, color: '#64748b' });
    });
    return result;
  }
  function getStatusColor(statusName) {
    const rows = DBCore.q('SELECT color FROM statuses WHERE name = ?', [statusName]);
    return rows.length ? rows[0].color : '#64748b';
  }
  function addStatus(name, color) {
    if (!name.trim()) return;
    const mx = DBCore.q('SELECT MAX(sort_order) AS m FROM statuses');
    DBCore.r('INSERT OR IGNORE INTO statuses (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [_uid(), name.trim(), color || '#64748b', (mx.length && mx[0].m !== null) ? mx[0].m + 1 : 0]);
    DBCore.touch(); DBCore.scheduleSave();
  }
  function deleteStatus(name) { DBCore.r('DELETE FROM statuses WHERE name = ?', [name]); DBCore.touch(); DBCore.scheduleSave(); }

  function renameStatus(oldName, newName) {
    DBCore.r('UPDATE statuses SET name = ? WHERE name = ?', [newName, oldName]);
    DBCore.r('UPDATE items SET status = ? WHERE status = ?', [newName, oldName]);
    DBCore.touch(); DBCore.scheduleSave();
  }

  /* ── accounts ──────────────────────────────────────────────── */

  function getOwners() {
    const ordered = DBCore.q('SELECT name FROM accounts ORDER BY sort_order').map(r => r.name);
    DBCore.q('SELECT DISTINCT owner_account FROM items WHERE owner_account != ""').map(r => r.owner_account).forEach(o => { if (o && !ordered.includes(o)) ordered.push(o); });
    return ordered;
  }
  function getAccounts() {
    return DBCore.q('SELECT id, name, contact FROM accounts ORDER BY sort_order').map(r => ({ id: r.id, name: r.name, contact: r.contact || '' }));
  }
  function addAccount(name, contact) {
    if (!name.trim()) return;
    const mx = DBCore.q('SELECT MAX(sort_order) AS m FROM accounts');
    DBCore.r('INSERT OR IGNORE INTO accounts (id, name, contact, sort_order) VALUES (?, ?, ?, ?)', [_uid(), name.trim(), (contact || '').trim(), (mx.length && mx[0].m !== null) ? mx[0].m + 1 : 0]);
    DBCore.touch(); DBCore.scheduleSave();
  }
  function updateAccount(oldName, newName, contact) {
    if (!newName.trim() || oldName === newName.trim()) return;
    DBCore.r('UPDATE accounts SET name=?, contact=? WHERE name=?', [newName.trim(), (contact || '').trim(), oldName]);
    DBCore.r('UPDATE items SET owner_account=? WHERE owner_account=?', [newName.trim(), oldName]);
    DBCore.touch(); DBCore.scheduleSave();
  }
  function deleteAccount(name) { DBCore.r('DELETE FROM accounts WHERE name = ?', [name]); DBCore.touch(); DBCore.scheduleSave(); }

  return {
    getCategories, getCategoriesWithSubs, getSubCategories, addCategory, updateCategory, deleteCategory,
    getLocations, getLocationsWithAccount, getLocationsForAccount, addLocation, updateLocation, deleteLocation,
    getStatuses, getStatusColor, addStatus, deleteStatus, renameStatus,
    getOwners, getAccounts, addAccount, updateAccount, deleteAccount
  };
})();
