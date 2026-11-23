// Connected repair workflow UI: live material totals and automatic refresh.
(function () {
  'use strict';

  function money(cents) {
    return '₱' + (Number(cents) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function initMaterials() {
    var form = document.getElementById('materials-form');
    if (!form) return;
    var container = document.getElementById('material-items');
    var addBtn = document.getElementById('add-material-item');
    var total = document.getElementById('materials-live-total');
    var index = 0;

    function rowHtml(n) {
      return '<div class="material-item" data-material-row="' + n + '">' +
        '<div class="form-grid">' +
        '<div class="field full"><label>Material / equipment name *</label><input type="text" data-mat="materialName" maxlength="200" required></div>' +
        '<div class="field"><label>Unit price (₱) *</label><input type="number" data-mat="unitPrice" min="0" step="0.01" value="0" required></div>' +
        '<div class="field"><label>Quantity *</label><input type="number" data-mat="quantity" min="0.001" step="0.001" value="1" required></div>' +
        '<div class="field"><label>Unit *</label><input type="text" data-mat="unit" maxlength="40" value="pc" required></div>' +
        '<div class="field full"><label>Purpose / description *</label><input type="text" data-mat="purpose" maxlength="1000" required></div>' +
        '<div class="field full"><label>Picture proof (per item) *</label><input type="file" name="materialPhotos" accept="image/jpeg,image/png,image/gif,image/webp" required></div>' +
        '</div></div>';
    }

    function addRow() {
      container.insertAdjacentHTML('beforeend', rowHtml(index++));
      update();
    }

    function update() {
      var sum = 0;
      container.querySelectorAll('[data-material-row]').forEach(function (row) {
        var price = Math.round(Number(row.querySelector('[data-mat="unitPrice"]').value || 0) * 100);
        var qty = Math.round(Number(row.querySelector('[data-mat="quantity"]').value || 0) * 1000);
        sum += Math.round(price * qty / 1000);
      });
      total.textContent = money(sum);
    }

    addBtn.addEventListener('click', addRow);
    container.addEventListener('input', update);
    form.addEventListener('submit', function () {
      var items = [];
      container.querySelectorAll('[data-material-row]').forEach(function (row) {
        var item = {};
        row.querySelectorAll('[data-mat]').forEach(function (input) {
          item[input.getAttribute('data-mat')] = input.value;
        });
        items.push(item);
      });
      var hidden = form.querySelector('input[name="materials"]');
      if (!hidden) {
        hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'materials';
        form.appendChild(hidden);
      }
      hidden.value = JSON.stringify(items);
      var button = form.querySelector('button[type="submit"]');
      if (button) { button.classList.add('is-loading'); button.disabled = true; }
    });

    addRow();
  }

  function hasUnsavedInput() {
    var dirty = false;
    document.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea, select').forEach(function (el) {
      if (!dirty && typeof el.defaultValue === 'string' && el.value !== el.defaultValue) dirty = true;
    });
    return dirty;
  }

  function initRefresh() {
    var watched = document.querySelector('[data-revision-region]') || document.querySelector('.request-detail-page');
    if (!watched) return;
    var revision = null;
    var path = location.pathname;
    setInterval(function () {
      if (document.hidden || hasUnsavedInput()) return;
      fetch('/requests/api/state', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          if (revision === null) { revision = data.revision; return; }
          if (data.revision !== revision && location.pathname === path) location.reload();
        })
        .catch(function () { /* offline: keep the current page */ });
    }, 15000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMaterials();
    initRefresh();
  });
})();
