/* ── contacts (people) CRUD ───────────────────────────────────── */

const DBContacts = (() => {

  function getAll() {
    return DBCore.q('SELECT * FROM contacts ORDER BY account_name, sort_order, name')
      .map(r => _map(r));
  }

  function getByAccount(accountName) {
    if (!accountName) return [];
    return DBCore.q('SELECT * FROM contacts WHERE account_name = ? ORDER BY sort_order, name', [accountName])
      .map(r => _map(r));
  }

  function getByName(name) {
    if (!name || !name.trim()) return [];
    return DBCore.q('SELECT * FROM contacts WHERE name = ?', [name.trim()])
      .map(r => _map(r));
  }

  function getById(id) {
    const rows = DBCore.q('SELECT * FROM contacts WHERE id = ?', [id]);
    return rows.length ? _map(rows[0]) : null;
  }

  function add(contact) {
    if (!contact.name?.trim()) return null;
    const id = contact.id || _uid();
    DBCore.r('INSERT INTO contacts (id, name, email, phone, account_name, role, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, contact.name.trim(), contact.email || '', contact.phone || '',
       contact.account_name || '', contact.role || '', contact.notes || '',
       contact.sort_order || 0]);
    DBCore.touch(); DBCore.scheduleSave();
    return getById(id);
  }

  function update(id, updates) {
    const old = getById(id);
    if (!old) return null;
    const fields = [], vals = [];
    const colMap = { name:'name', email:'email', phone:'phone', accountName:'account_name', role:'role', notes:'notes' };
    Object.keys(colMap).forEach(k => {
      if (updates[k] !== undefined) { fields.push(colMap[k] + ' = ?'); vals.push(updates[k]); }
    });
    if (fields.length) {
      vals.push(id);
      DBCore.r('UPDATE contacts SET ' + fields.join(', ') + ' WHERE id = ?', vals);
      DBCore.touch(); DBCore.scheduleSave();
    }
    return getById(id);
  }

  function deleteContact(id) {
    const contact = getById(id);
    if (!contact) return;
    DBCore.r('DELETE FROM contacts WHERE id = ?', [id]);
    // Clear assigned_to on items that reference this person
    if (contact.name) {
      DBCore.r('UPDATE items SET assigned_to = ? WHERE assigned_to = ?', ['', contact.name]);
    }
    DBCore.touch(); DBCore.scheduleSave();
  }

  function getAllNames() {
    return DBCore.q('SELECT name, account_name FROM contacts ORDER BY name').map(r => ({ name: r.name, account: r.account_name || '' }));
  }

  function getNamesForAccount(accountName) {
    if (!accountName) return [];
    return DBCore.q('SELECT name FROM contacts WHERE account_name = ? ORDER BY name', [accountName]).map(r => r.name);
  }

  /* Find contacts matching a search, returns formatted strings like "John Smith at Safeway" */
  function searchContacts(query) {
    if (!query || !query.trim()) return getAllNames();
    const q = '%' + query.trim().toLowerCase() + '%';
    return DBCore.q('SELECT name, account_name FROM contacts WHERE LOWER(name) LIKE ? OR LOWER(account_name) LIKE ? ORDER BY name', [q, q])
      .map(r => ({ name: r.name, account: r.account_name || '' }));
  }

  function _map(r) {
    return {
      id: r.id, name: r.name || '', email: r.email || '',
      phone: r.phone || '', accountName: r.account_name || '',
      role: r.role || '', notes: r.notes || '', sortOrder: r.sort_order || 0,
    };
  }

  return { getAll, getByAccount, getByName, getById, add, update, deleteContact, getAllNames, getNamesForAccount, searchContacts };
})();
