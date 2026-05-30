# Resizable Table Columns — Fix for "neighbor columns shift" problem

## The Problem

When you make table columns resizable by dragging, the column you're dragging grows
but its neighbors shrink. The whole table stays the same total width, so columns
compete for space instead of growing independently.

This happens with both `table-layout: auto` AND `table-layout: fixed`.

## Why It Happens

HTML tables want to fill their container width. When one column gets wider,
the browser redistributes the remaining space across other columns to keep the
total the same. This is by design in the CSS table layout algorithm.

## The Fix

**Grow the table width itself** by the same amount you grow the column.

When the user drags a column wider:
1. Calculate the delta (how far they dragged)
2. Set the column's new width: `newWidth = startWidth + delta`
3. Set the table's new width: `tableWidth = startTableWidth + delta`

This way the table grows to accommodate the wider column, and other columns
keep their original widths untouched.

## CSS Requirements

```css
table {
  table-layout: fixed;
}
.table-wrap {
  overflow: auto; /* both x and y, so table can scroll when wider than container */
}
```

- `table-layout: fixed` — makes the browser respect exact pixel widths
- `overflow: auto` on the container — horizontal scroll when table overflows
- Do NOT use `min-width: 100%` on the table — it fights the resize

## JS Implementation

```javascript
function initColumnResize(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const handles = table.querySelectorAll('.resize-handle');

  handles.forEach((handle) => {
    const th = handle.parentElement;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.pageX;
      const startColW = th.offsetWidth;
      const startTableW = table.offsetWidth;

      const onMove = (ev) => {
        const delta = ev.pageX - startX;
        const newColW = Math.max(60, startColW + delta);

        th.style.width = newColW + 'px';
        th.style.minWidth = newColW + 'px';

        // THIS IS THE KEY LINE — grow the table too
        table.style.width = (startTableW + delta) + 'px';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}
```

## HTML Structure

```html
<div class="table-wrap">
  <table class="resizable-table">
    <thead>
      <tr>
        <th class="resizable-th" style="width:140px;">
          Column Name
          <div class="resize-handle"></div>
        </th>
        <!-- more columns... -->
      </tr>
    </thead>
    <tbody>...</tbody>
  </table>
</div>
```

## Resize Handle CSS

```css
.resizable-th {
  position: relative;
  user-select: none;
}

.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}

.resize-handle:hover,
.resize-handle.active {
  background: var(--primary);
  opacity: 0.4;
}
```

## TL;DR

| What people try | Why it fails |
|---|---|
| Just setting `th.style.width` | Other columns compress to fit same total width |
| `table-layout: fixed` alone | Same problem — table width stays constant |
| Using `<colgroup>` + `<col>` | Same problem, just indirection |

| What actually works |
|---|
| Set `th.style.width` AND `table.style.width` together |
| `table-layout: fixed` + `overflow: auto` on container |
| No `min-width: 100%` on the table |

## Date

2026-05-26 — discovered/verified in LynqInventory import review table
