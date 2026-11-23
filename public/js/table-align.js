// Unified table column alignment.
// Every column in every table is centered. The shared col-center class is
// applied consistently so tables.css and alignment.css stay in sync.
// Presentation only — no markup, data or behavior is changed.
(function () {
  'use strict';

  function alignmentFor(text) {
    // Intentional: all table text, values, icons and actions are centered.
    return 'col-center';
  }

  // Find the cell that occupies a logical column, accounting for colSpan.
  function cellAt(row, index) {
    var col = 0;
    for (var i = 0; i < row.children.length; i++) {
      var cell = row.children[i];
      if (col === index) return cell;
      col += cell.colSpan || 1;
    }
    return null;
  }

  function alignTable(table) {
    // The Categories table uses per-column alignment from its markup/CSS.
    if (table.classList.contains('categories-table')) return;
    if (table.getAttribute('data-align-done') === '1') return;
    var heads = table.querySelectorAll('thead tr:first-child th');
    if (!heads.length) return;
    table.setAttribute('data-align-done', '1');

    var rows = table.querySelectorAll('tbody tr');
    Array.prototype.forEach.call(heads, function (th, index) {
      var alignment = alignmentFor(th.textContent);
      th.classList.remove('col-left', 'col-center');
      th.classList.add(alignment);

      Array.prototype.forEach.call(rows, function (row) {
        var cell = cellAt(row, index);
        if (!cell || cell.classList.contains('empty')) return;
        cell.classList.remove('col-left', 'col-center');
        cell.classList.add(alignment);
      });
    });
  }

  function init() {
    document.querySelectorAll('.app table').forEach(alignTable);

    // Future-proof: any table inserted later inherits the same alignment rules.
    if (window.MutationObserver && document.body) {
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(function () {
          pending = false;
          document.querySelectorAll('.app table:not([data-align-done])').forEach(alignTable);
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
