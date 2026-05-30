/* ── manage statuses / tags modal ─────────────────────────────── */

const UIManage = (() => {
  let currentType = 'statuses';

  function show(type) {
    App._closeSettings();
    currentType = type || 'statuses';
    const overlay = document.getElementById('manage-overlay');
    const content = document.getElementById('manage-content');

    if (currentType === 'tags') {
      _renderTags(content);
    } else {
      _renderStatuses(content);
    }
    overlay.classList.add('active');
    setTimeout(() => { const input = document.getElementById('manage-new-item'); if (input) input.focus(); }, 50);
  }

  function close() { document.getElementById('manage-overlay').classList.remove('active'); }

  /* ── statuses ──────────────────────────────────────────────── */

  function _renderStatuses(content) {
    const statuses = DB.getStatuses();
    const stats = DB.getStats();

    content.innerHTML = `<div class="modal-header-bar">
        <span class="modal-title-sm">Manage Statuses</span>
        <button class="btn btn-sm btn-ghost" onclick="UIManage.close()">&times;</button>
      </div>
      <div class="manage-add-row">
        <input id="manage-new-item" placeholder="New status name..." onkeydown="if(event.key==='Enter')UIManage._add()" />
        <input id="manage-new-color" type="color" value="#64748b" class="manage-color-input" title="Pick color" />
        <button class="btn btn-primary btn-sm" onclick="UIManage._add()">Add</button>
      </div>
      <ul class="manage-list">
        ${statuses.map(s => {
          const cnt = stats.byStatus[s.name] || 0;
          return `<li class="manage-list-item">
            <div class="manage-list-info">
              <span class="status-dot" style="background:${s.color}"></span>
              <span class="manage-list-name">${_esc(s.name)}</span>
              ${cnt > 0 ? `<span class="manage-list-count">${cnt}</span>` : '<span class="manage-list-count manage-list-count-zero">0</span>'}
            </div>
            <div class="manage-list-actions">
              <button class="manage-list-btn btn-del" title="Delete" onclick="UIManage._delete('${_escAttr(s.name)}')">&times;</button>
            </div>
          </li>`;
        }).join('')}
      </ul>`;
  }

  /* ── tags ──────────────────────────────────────────────────── */

  function _renderTags(content) {
    const tags = DBTags.getAll();
    const items = DB.getAllItems();
    const tagCounts = {};
    tags.forEach(t => { tagCounts[t.name] = 0; });
    items.forEach(item => {
      (item.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });

    content.innerHTML = `<div class="modal-header-bar">
        <span class="modal-title-sm">Manage Tags</span>
        <button class="btn btn-sm btn-ghost" onclick="UIManage.close()">&times;</button>
      </div>
      <div class="manage-add-row">
        <input id="manage-new-item" placeholder="New tag name..." onkeydown="if(event.key==='Enter')UIManage._add()" />
        <input id="manage-new-color" type="color" value="#64748b" class="manage-color-input" title="Pick color" />
        <button class="btn btn-primary btn-sm" onclick="UIManage._add()">Add</button>
      </div>
      <ul class="manage-list">
        ${tags.map(t => {
          const cnt = tagCounts[t.name] || 0;
          return `<li class="manage-list-item">
            <div class="manage-list-info">
              <span class="status-dot" style="background:${t.color}"></span>
              <span class="manage-list-name">${_esc(t.name)}</span>
              ${cnt > 0 ? `<span class="manage-list-count">${cnt}</span>` : '<span class="manage-list-count manage-list-count-zero">0</span>'}
            </div>
            <div class="manage-list-actions">
              <button class="manage-list-btn btn-del" title="Delete" onclick="UIManage._delete('${_escAttr(t.name)}')">&times;</button>
            </div>
          </li>`;
        }).join('')}
      </ul>`;
  }

  /* ── shared add / delete ───────────────────────────────────── */

  function _add() {
    const input = document.getElementById('manage-new-item');
    const color = document.getElementById('manage-new-color');
    if (!input?.value.trim()) return;
    const name = input.value.trim();
    const c = color?.value || '#64748b';

    if (currentType === 'tags') {
      DBTags.add(name, c);
    } else {
      DB.addStatus(name, c);
    }
    show(currentType);
    App.render();
  }

  function _delete(name) {
    const overlay = document.getElementById('manage-overlay');
    overlay.classList.remove('active');

    if (currentType === 'tags') {
      _confirmDeleteTag(name);
    } else {
      UIPages._confirmDeleteStatus(name);
    }
  }

  function _confirmDeleteTag(name) {
    _showConfirm(`Delete tag "${name}"? It will be removed from all items.`, (yes) => {
      if (!yes) { show('tags'); return; }
      // Remove tag from all items that have it
      const items = DB.getAllItems();
      items.forEach(item => {
        const tags = (item.tags || '').split(',').map(t => t.trim()).filter(t => t && t !== name);
        DB.updateItem(item.id, { tags: tags.join(',') });
      });
      DBTags.remove(DBTags.getByName(name)?.id);
      Toast.success(`Tag "${name}" deleted`);
      show('tags');
      App.render();
    }, 'Delete');
  }

  return { show, close, _add, _delete };
})();
