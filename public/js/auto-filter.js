/*
 * EduCare automatic filtering
 * ---------------------------
 * Every existing list route already filters correctly on the server. This layer
 * keeps that logic untouched: it serialises the visible filter controls, fetches
 * the same URL, and swaps only the marked results region. No records, routes,
 * permissions, or export logic are changed.
 */
(function () {
  'use strict';

  var DEBOUNCE_MS = 300;
  var pending = {};
  var formCounter = 0;
  var activeRequest = null;

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function pathOf(form) {
    var url = new URL(form.action || window.location.href, window.location.origin);
    return url.pathname;
  }

  function queryFor(form) {
    var params = new URLSearchParams();

    all('input, select, textarea', form).forEach(function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'file') return;

      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) params.append(el.name, el.value);
        return;
      }

      if (el.value !== '' && el.value != null) params.append(el.name, el.value);
    });

    var query = params.toString();
    return query ? '?' + query : '';
  }

  function validateDates(form) {
    var from = one('[name="from"]', form);
    var to = one('[name="to"]', form);
    if (!from || !to) return true;

    var box = one('.auto-filter-validation', form);
    var invalid = !!(from.value && to.value && from.value > to.value);

    if (invalid) {
      if (!box) {
        box = document.createElement('div');
        box.className = 'auto-filter-validation';
        box.setAttribute('role', 'alert');
        form.appendChild(box);
      }
      box.textContent = 'The From date cannot be later than the To date.';
      box.hidden = false;
      from.setAttribute('aria-invalid', 'true');
      to.setAttribute('aria-invalid', 'true');
      return false;
    }

    if (box) box.hidden = true;
    from.removeAttribute('aria-invalid');
    to.removeAttribute('aria-invalid');
    return true;
  }

  function resetForm(form) {
    all('input, select, textarea', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = false;
      } else if (el.tagName === 'SELECT') {
        if (el.options.length) el.selectedIndex = 0;
      } else {
        el.value = '';
      }
    });
  }

  function showLoading(container) {
    if (!container) return;
    container.classList.add('auto-filter-loading');
    container.setAttribute('aria-busy', 'true');

    var overlay = one('.auto-filter-overlay', container);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'auto-filter-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = '<span class="auto-filter-spinner"></span><span>Loading…</span>';
      container.appendChild(overlay);
    }
  }

  function hideLoading(container) {
    if (!container) return;
    container.classList.remove('auto-filter-loading');
    container.removeAttribute('aria-busy');
    var overlay = one('.auto-filter-overlay', container);
    if (overlay) overlay.remove();
  }

  function reinitialize(container) {
    var scope = container || document;

    if (window.educareEnhanceTables) window.educareEnhanceTables(scope);

    var equipmentData = one('#equipment-map-json', scope);
    if (equipmentData && window.educareSetEquipmentMap) {
      try { window.educareSetEquipmentMap(JSON.parse(equipmentData.textContent)); } catch (err) { /* ignore malformed payload */ }
    }

    var emailData = one('#outgoing-data-json', scope);
    if (emailData && window.educareSetOutgoingData) {
      try { window.educareSetOutgoingData(JSON.parse(emailData.textContent)); } catch (err) { /* ignore malformed payload */ }
    }

    if (window.educareInitEmailPagination) window.educareInitEmailPagination();
    if (window.educareInitReportPagination) window.educareInitReportPagination();
  }

  function scrollActivePills(scope) {
    all('.admin-ui-pills', scope || document).forEach(function (nav) {
      var active = nav.querySelector('a.active, a[aria-current="true"]');
      if (!active) return;
      if (nav.scrollWidth <= nav.clientWidth + 1) return;
      var navRect = nav.getBoundingClientRect();
      var activeRect = active.getBoundingClientRect();
      var isVisible = activeRect.left >= navRect.left && activeRect.right <= navRect.right;
      if (isVisible) return;
      var target = nav.scrollLeft + (activeRect.left - navRect.left) - (nav.clientWidth / 2) + (activeRect.width / 2);
      nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    });
  }

  function syncControlState(freshDoc, url) {
    var currentLinks = all('[data-auto-filter-link]');
    var freshLinks = all('[data-auto-filter-link]', freshDoc);

    currentLinks.forEach(function (link, index) {
      var fresh = freshLinks[index];
      if (!fresh) return;
      if (link.className !== fresh.className) link.className = fresh.className;
      if (fresh.hasAttribute('aria-current')) link.setAttribute('aria-current', fresh.getAttribute('aria-current'));
      else link.removeAttribute('aria-current');
      if (link.innerHTML !== fresh.innerHTML) link.innerHTML = fresh.innerHTML;
    });

    all('[data-filter-sync]').forEach(function (el) {
      var key = el.getAttribute('data-filter-sync');
      var fresh = one('[data-filter-sync="' + key + '"]', freshDoc);
      if (!fresh) return;
      if (el.innerHTML !== fresh.innerHTML) el.innerHTML = fresh.innerHTML;
      if (el.className !== fresh.className) el.className = fresh.className;
      if (fresh.hasAttribute('aria-current')) el.setAttribute('aria-current', fresh.getAttribute('aria-current'));
      else el.removeAttribute('aria-current');
    });

    var params = new URL(url, window.location.origin).searchParams;
    all('[data-filter-key]').forEach(function (control) {
      var key = control.getAttribute('data-filter-key');
      all('[data-auto-filter]').forEach(function (form) {
        var field = one('[name="' + key + '"]', form);
        if (field && field.value !== (params.get(key) || '')) field.value = params.get(key) || '';
      });
    });
  }

  function apply(url, resultsSelector) {
    var container = one(resultsSelector);
    if (!container) return;

    if (activeRequest) activeRequest.abort();
    activeRequest = new AbortController();
    var request = activeRequest;
    showLoading(container);

    fetch(url, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      signal: request.signal
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Filter request failed');
        return response.text();
      })
      .then(function (html) {
        var freshDoc = new DOMParser().parseFromString(html, 'text/html');
        var fresh = one(resultsSelector, freshDoc);
        if (!fresh) throw new Error('Results region is missing');

        container.replaceWith(fresh);
        activeRequest = null;

        syncControlState(freshDoc, url);
        reinitialize(fresh);
        scrollActivePills();
        history.replaceState(history.state, '', url);
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') return;
        activeRequest = null;
        hideLoading(container);
        // If anything unexpected happens, fall back to a normal navigation so
        // the user always sees correct results instead of a stale/blank table.
        window.location.assign(url);
      });
  }

  function applyForm(form) {
    if (!validateDates(form)) return;
    apply(pathOf(form) + queryFor(form), form.getAttribute('data-auto-results'));
  }

  function applyLink(link) {
    var resultsSelector = link.getAttribute('data-auto-results');
    var form = all('[data-auto-filter]').filter(function (candidate) {
      return candidate.getAttribute('data-auto-results') === resultsSelector;
    })[0];

    // When a pill/summary control shares a results region with a filter form,
    // keep every other active filter (search text, dates, selects, etc.).
    if (form && validateDates(form)) {
      var query = queryFor(form).replace(/^\?/, '');
      var params = new URLSearchParams(query);
      var key = link.getAttribute('data-filter-key');
      if (key) {
        var value = link.getAttribute('data-filter-value') || '';
        if (value) params.set(key, value);
        else params.delete(key);
      }
      var merged = params.toString();
      apply(pathOf(form) + (merged ? '?' + merged : ''), resultsSelector);
      return;
    }

    apply(link.href, resultsSelector);
  }

  // Pages with their own shortcut controls (e.g. report date presets) can
  // trigger the same automatic refresh without causing a full page load.
  window.educareApplyFilters = applyForm;

  function bindForm(form) {
    form.__autoFilterKey = 'af' + (++formCounter);

    // Defensive cleanup: the manual buttons are removed from markup as well.
    all('[type="submit"]', form).forEach(function (button) { button.remove(); });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      applyForm(form);
    });

    all('input, select, textarea', form).forEach(function (el) {
      var immediate = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'date';
      var delay = immediate ? 0 : DEBOUNCE_MS;

      el.addEventListener(immediate ? 'change' : 'input', function () {
        if (form.dataset.autoFilterSuspended === '1') return;
        clearTimeout(pending[form.__autoFilterKey]);
        pending[form.__autoFilterKey] = setTimeout(function () {
          if (form.dataset.autoFilterSuspended === '1') return;
          applyForm(form);
        }, delay);
      });
    });

    all('[data-filter-clear]', form).forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        clearTimeout(pending[form.__autoFilterKey]);
        resetForm(form);
        apply(pathOf(form), form.getAttribute('data-auto-results'));
      });
    });

    all('[data-filter-apply]', form).forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        clearTimeout(pending[form.__autoFilterKey]);
        applyForm(form);
      });
    });
  }

  function bindLinks() {
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('[data-auto-filter-link]') : null;
      if (!link) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      applyLink(link);
    });
  }

  var linksBound = false;
  function init() {
    all('[data-auto-filter]').forEach(bindForm);
    if (!linksBound) { bindLinks(); linksBound = true; }
    scrollActivePills();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
