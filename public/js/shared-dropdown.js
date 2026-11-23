(function () {
  'use strict';
  var CARET = '<svg class="ec-select-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  var CHECK = '<svg class="ec-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  function closeAll(except) {
    document.querySelectorAll('.ec-select-wrap.is-open').forEach(function (wrap) {
      if (except && wrap === except) return;
      wrap.classList.remove('is-open');
      var panel = wrap.querySelector('.ec-select-panel');
      var btn = wrap.querySelector('.ec-select-btn');
      if (panel) {
        panel.hidden = true;
        panel.style.position = '';
        panel.style.left = '';
        panel.style.width = '';
        panel.style.right = '';
        panel.style.top = '';
        panel.style.bottom = '';
        panel.style.maxHeight = '';
        panel.style.zIndex = '';
      }
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function build(select) {
    if (!select || select.dataset.ecEnhanced === '1') return;
    select.dataset.ecEnhanced = '1';
    select.classList.add('ec-select-native');

    var wrap = document.createElement('div');
    wrap.className = 'ec-select-wrap';
    var parent = select.parentNode;
    parent.insertBefore(wrap, select);
    wrap.appendChild(select);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ec-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (select.disabled) btn.disabled = true;
    if (select.id) btn.id = select.id + '__btn';
    btn.innerHTML = '<span class="ec-select-label"></span>' + CARET;
    wrap.appendChild(btn);

    var panel = document.createElement('div');
    panel.className = 'ec-select-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'listbox');
    wrap.appendChild(panel);

    function selectedOption() {
      return select.options[select.selectedIndex] || null;
    }

    function syncLabel() {
      var opt = selectedOption();
      var label = wrap.querySelector('.ec-select-label');
      var text = opt ? opt.textContent.trim() : '';
      var isPlaceholder = !opt || opt.value === '' || opt.disabled;
      if (!text) text = 'Select option';
      label.textContent = text;
      label.classList.toggle('is-placeholder', !!isPlaceholder && !select.value);
    }

    function syncState() {
      btn.disabled = !!select.disabled;
      syncLabel();
    }

    function render() {
      panel.innerHTML = '';
      var groups = [];
      var currentGroup = null;
      Array.prototype.forEach.call(select.children, function (node) {
        if (node.tagName === 'OPTGROUP') {
          var g = { label: node.label, options: Array.prototype.slice.call(node.children) };
          groups.push(g);
        } else if (node.tagName === 'OPTION') {
          if (!currentGroup) { currentGroup = { label: '', options: [] }; groups.push(currentGroup); }
          currentGroup.options.push(node);
        }
      });
      if (!groups.length) {
        panel.innerHTML = '<div class="ec-select-empty">No options available</div>';
        syncState();
        return;
      }
      groups.forEach(function (g) {
        var container = panel;
        if (g.label) {
          container = document.createElement('div');
          container.className = 'ec-select-group';
          var gl = document.createElement('div');
          gl.className = 'ec-select-group-label';
          gl.textContent = g.label;
          container.appendChild(gl);
          panel.appendChild(container);
        }
        var visibleCount = 0;
        g.options.forEach(function (opt) {
          if (opt.hidden) return;
          visibleCount++;
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'ec-select-option';
          item.setAttribute('role', 'option');
          item.dataset.value = opt.value;
          item.disabled = !!opt.disabled;
          item.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
          if (opt.selected) item.classList.add('is-selected');
          item.innerHTML = '<span class="ec-select-option-label"></span>' + CHECK;
          item.querySelector('.ec-select-option-label').textContent = opt.textContent.trim();
          item.addEventListener('click', function () {
            if (opt.disabled) return;
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
            render();
            closeAll();
            btn.focus();
          });
          container.appendChild(item);
        });
        if (g.label && visibleCount === 0) container.remove();
      });
      syncState();
    }

    function positionPanel() {
      var r = btn.getBoundingClientRect();
      var spaceBelow = window.innerHeight - r.bottom - 8;
      var spaceAbove = r.top - 8;
      var openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      panel.style.position = 'fixed';
      panel.style.left = r.left + 'px';
      panel.style.width = r.width + 'px';
      panel.style.right = 'auto';
      panel.style.zIndex = '1400';
      if (openUp) {
        panel.style.top = 'auto';
        panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
        panel.style.maxHeight = Math.max(160, spaceAbove - 10) + 'px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = (r.bottom + 6) + 'px';
        panel.style.maxHeight = Math.max(160, spaceBelow - 10) + 'px';
      }
    }
    function resetPanelPosition() {
      panel.style.position = '';
      panel.style.left = '';
      panel.style.width = '';
      panel.style.right = '';
      panel.style.top = '';
      panel.style.bottom = '';
      panel.style.maxHeight = '';
      panel.style.zIndex = '';
    }

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      var open = wrap.classList.contains('is-open');
      closeAll();
      if (!open) {
        render();
        wrap.classList.add('is-open');
        panel.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        positionPanel();
        var selected = panel.querySelector('.ec-select-option.is-selected') || panel.querySelector('.ec-select-option:not([disabled])');
        if (selected) selected.scrollIntoView({ block: 'nearest' });
      }
    });

    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); btn.click();
      }
      if (e.key === 'Escape') { closeAll(); btn.focus(); }
    });

    panel.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(panel.querySelectorAll('.ec-select-option:not([disabled])'));
      var idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
      if (e.key === 'Escape') { e.preventDefault(); closeAll(); btn.focus(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (document.activeElement) document.activeElement.click(); }
    });

    select.addEventListener('change', function () { render(); });
    new MutationObserver(function () { render(); }).observe(select, { childList: true, subtree: true, attributes: true });

    render();
  }

  function init() {
    document.querySelectorAll('select[data-ec-select="1"]').forEach(build);
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.ec-select-wrap')) closeAll();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
  window.addEventListener('resize', function () { closeAll(); });
  document.addEventListener('scroll', function (e) {
    if (e.target && e.target.closest && e.target.closest('.ec-select-panel')) return;
    closeAll();
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.EduCareSharedDropdown = { init: init, closeAll: closeAll };
})();