/* ── tab: history — change log ───────────────────────────────── */

const TabHistory = (() => {

  const tab = {
    id: 'history',
    label: 'History',
    order: 5,
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',

    render(item, mode, isDeleted) {
      if (!item.history || !item.history.length) {
        return `<div class="modal-form">
          <div class="history-empty">No change history for this item.</div>
        </div>`;
      }

      return `
        <div class="modal-form">
          <div class="history-count-bar">
            <span class="modal-notes-count">${item.history.length} change${item.history.length !== 1 ? 's' : ''}</span>
          </div>
          <ul class="history-list">
            ${item.history.map(h => {
              const isReason = h.fieldChanged === 'Quantity' && h.oldValue && h.oldValue.includes('→');
              return `<li class="history-item${isReason ? ' history-item-reason' : ''}">
                <div class="history-meta">
                  <span class="history-field">${_esc(h.fieldChanged)}</span>
                  <span class="history-right">${h.changedBy ? `<span class="history-user">${_esc(h.changedBy)}</span>` : ''}<span class="history-time">${_fmtTimestamp(h.changedAt)}</span></span>
                </div>
                ${isReason
                  ? `<div class="history-change"><span class="history-qty-change">${_esc(h.oldValue)}</span><span class="history-reason-sep">—</span><span class="history-reason-text">${_esc(h.newValue) || '—'}</span></div>`
                  : `<div class="history-change"><span class="history-old">${_esc(h.oldValue) || '—'}</span><span class="history-arrow">→</span><span class="history-new">${_esc(h.newValue) || '—'}</span></div>`
                }
              </li>`;
            }).join('')}
          </ul>
        </div>
      `;
    },

    gather() {
      // History tab is read-only, nothing to gather
      return {};
    },

    gather() {
      return {}; // Read-only tab, no editable data
    },

    isDirty(snapshot, mode) {
      return false; // Read-only tab
    },

    init(item, mode, isDeleted) {
      // No special initialization needed
    },
  };

  Modal.registerTab(tab);
  return { tab };
})();
