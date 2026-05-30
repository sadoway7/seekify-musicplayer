/* ── tab: condition — new/used, grade, boxed ─────────────────── */

const TabCondition = (() => {

  const tab = {
    id: 'condition',
    label: 'Condition',
    order: 4,
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',

    render(item, mode, isDeleted) {
      const dis = isDeleted ? 'disabled' : '';
      const ct = item.conditionType || '';
      const cg = item.conditionGrade || '';
      const boxed = item.boxed || 0;

      return `
        <div class="modal-form">
          <div class="form-row">
            <div class="form-group"><label>Condition Type</label>
              <select id="modal-condition-type" ${dis}>
                <option value="">-- Select --</option>
                <option value="New" ${ct === 'New' ? 'selected' : ''}>New</option>
                <option value="Used" ${ct === 'Used' ? 'selected' : ''}>Used</option>
                <option value="Refurbished" ${ct === 'Refurbished' ? 'selected' : ''}>Refurbished</option>
              </select>
            </div>
            <div class="form-group"><label>Grade</label>
              <select id="modal-condition-grade" ${dis}>
                <option value="">-- Select --</option>
                <option value="A" ${cg === 'A' ? 'selected' : ''}>A — Excellent</option>
                <option value="B" ${cg === 'B' ? 'selected' : ''}>B — Good</option>
                <option value="C" ${cg === 'C' ? 'selected' : ''}>C — Fair</option>
                <option value="D" ${cg === 'D' ? 'selected' : ''}>D — Poor</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Boxed</label>
              <select id="modal-boxed" ${dis}>
                <option value="0" ${!boxed ? 'selected' : ''}>No</option>
                <option value="1" ${boxed ? 'selected' : ''}>Yes — Has original packaging</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Condition Notes</label>
            <textarea id="modal-condition-notes" placeholder="Describe any wear, damage, or defects..." rows="3" ${dis}>${_esc(item.conditionNotes || '')}</textarea>
          </div>
        </div>
      `;
    },

    gather() {
      return {
        conditionType: _sel('modal-condition-type'),
        conditionGrade: _sel('modal-condition-grade'),
        boxed: parseInt(_sel('modal-boxed')) || 0,
        conditionNotes: _val('modal-condition-notes'),
      };
    },

    isDirty(snapshot, mode) {
      if (!document.getElementById('modal-condition-type')) return false;
      if (mode === 'new') {
        return _sel('modal-condition-type') || _sel('modal-condition-grade') || _val('modal-condition-notes');
      }
      return _sel('modal-condition-type') !== (snapshot.conditionType || '') ||
             _sel('modal-condition-grade') !== (snapshot.conditionGrade || '') ||
             parseInt(_sel('modal-boxed')) !== (snapshot.boxed || 0) ||
             _val('modal-condition-notes') !== (snapshot.conditionNotes || '');
    },

    init(item, mode, isDeleted) {
      // No special initialization needed
    },
  };

  Modal.registerTab(tab);
  return { tab };
})();
