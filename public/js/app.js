// Small UI helpers.
document.addEventListener('DOMContentLoaded', function () {
  // Light / dark mode is handled globally by /js/theme-toggle.js so the same
  // switch component works on the auth pages and inside the app shell.

  // Ask before destructive/important actions: <form data-confirm="...">
  function ecInferConfirm(form, msg) {
    var action = (form.getAttribute('action') || '').toLowerCase();
    var text = (msg || '').toLowerCase();
    var opts = {
      title: form.getAttribute('data-confirm-title') || 'Confirm Action',
      message: msg || 'Are you sure you want to continue?',
      confirmLabel: form.getAttribute('data-confirm-ok') || 'Confirm',
      cancelLabel: form.getAttribute('data-confirm-cancel') || 'Cancel',
      tone: form.getAttribute('data-confirm-tone') || 'danger',
      icon: form.getAttribute('data-confirm-icon') || 'warning'
    };
    if (action.indexOf('/approve') !== -1 || text.indexOf('approve') !== -1) {
      opts.title = form.getAttribute('data-confirm-title') || 'Approve Request?';
      if (action.indexOf('/users/') !== -1) opts.title = form.getAttribute('data-confirm-title') || 'Approve Account?';
      opts.confirmLabel = form.getAttribute('data-confirm-ok') || 'Confirm Approval';
      opts.tone = form.getAttribute('data-confirm-tone') || 'success';
      opts.icon = form.getAttribute('data-confirm-icon') || 'check';
    } else if (action.indexOf('/reject') !== -1 || text.indexOf('reject') !== -1) {
      opts.title = form.getAttribute('data-confirm-title') || 'Reject Request?';
      opts.confirmLabel = form.getAttribute('data-confirm-ok') || 'Confirm Rejection';
      opts.tone = 'danger'; opts.icon = 'warning';
    } else if (action.indexOf('/cancel') !== -1 || text.indexOf('cancel report') !== -1 || text.indexOf('cancel request') !== -1) {
      opts.title = form.getAttribute('data-confirm-title') || 'Cancel Request?';
      opts.confirmLabel = form.getAttribute('data-confirm-ok') || 'Confirm Cancellation';
      opts.tone = 'warning'; opts.icon = 'warning';
    } else if (action.indexOf('/delete') !== -1 || text.indexOf('delete') !== -1 || text.indexOf('remove') !== -1 || text.indexOf('clear') !== -1) {
      opts.title = form.getAttribute('data-confirm-title') || (text.indexOf('remove') !== -1 ? 'Remove Item?' : 'Delete Item?');
      if (text.indexOf('clear all') !== -1) opts.title = form.getAttribute('data-confirm-title') || 'Clear Records?';
      opts.confirmLabel = form.getAttribute('data-confirm-ok') || (text.indexOf('remove') !== -1 ? 'Remove' : (text.indexOf('clear') !== -1 ? 'Confirm Clear' : 'Delete'));
      opts.tone = 'danger'; opts.icon = text.indexOf('remove') !== -1 ? 'trash' : 'warning';
    } else if (action.indexOf('/toggle') !== -1 || text.indexOf('deactivate') !== -1 || text.indexOf('activate') !== -1) {
      var deactivating = text.indexOf('deactivate') !== -1;
      opts.title = form.getAttribute('data-confirm-title') || (deactivating ? 'Deactivate Item?' : 'Activate Item?');
      opts.confirmLabel = form.getAttribute('data-confirm-ok') || (deactivating ? 'Confirm Deactivation' : 'Confirm Activation');
      opts.tone = deactivating ? 'warning' : 'success';
      opts.icon = deactivating ? 'warning' : 'check';
    }
    if (form.getAttribute('data-confirm-title')) opts.title = form.getAttribute('data-confirm-title');
    if (form.getAttribute('data-confirm-ok')) opts.confirmLabel = form.getAttribute('data-confirm-ok');
    if (form.getAttribute('data-confirm-cancel')) opts.cancelLabel = form.getAttribute('data-confirm-cancel');
    if (form.getAttribute('data-confirm-tone')) opts.tone = form.getAttribute('data-confirm-tone');
    if (form.getAttribute('data-confirm-icon')) opts.icon = form.getAttribute('data-confirm-icon');
    return opts;
  }

  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (form.dataset.ecConfirmed === '1') {
        delete form.dataset.ecConfirmed;
        return;
      }
      e.preventDefault();
      if (form.dataset.ecConfirming === '1') return;
      var submitter = e.submitter;
      var msg = form.getAttribute('data-confirm') || 'Are you sure you want to continue?';
      var opts = ecInferConfirm(form, msg);
      form.dataset.ecConfirming = '1';
      Promise.resolve(window.ecConfirm ? window.ecConfirm(opts) : false).then(function (ok) {
        delete form.dataset.ecConfirming;
        if (!ok) return;
        form.dataset.ecConfirmed = '1';
        if (submitter && submitter.classList) {
          submitter.classList.add('is-loading');
          submitter.disabled = true;
        }
        try {
          if (submitter && form.requestSubmit) form.requestSubmit(submitter);
          else form.submit();
        } catch (_) {
          form.submit();
        }
      });
    });
  });

  // ---------- Sidebar & Hamburger Menu Controller ----------
  var sidebar = document.getElementById('sidebar');
  var backdrop = document.getElementById('backdrop');
  var hamburgerBtns = document.querySelectorAll('.hamburger-btn, .menu-btn, .sidebar-toggle-btn');

  function isMobile() {
    return window.innerWidth <= 860;
  }

  function setMobileMenu(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (backdrop) backdrop.classList.toggle('show', open);
    document.body.classList.toggle('menu-open', open);
    hamburgerBtns.forEach(function (b) {
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function toggleDesktopSidebar(forceCollapse) {
    var isCurrentlyCollapsed = document.documentElement.classList.contains('sidebar-collapsed') ||
                               document.body.classList.contains('sidebar-collapsed');
    var shouldCollapse = typeof forceCollapse === 'boolean' ? forceCollapse : !isCurrentlyCollapsed;

    if (shouldCollapse) {
      document.documentElement.classList.add('sidebar-collapsed');
      document.body.classList.add('sidebar-collapsed');
      try { localStorage.setItem('educare-sidebar-collapsed', 'true'); } catch (e) {}
    } else {
      document.documentElement.classList.remove('sidebar-collapsed');
      document.body.classList.remove('sidebar-collapsed');
      try { localStorage.setItem('educare-sidebar-collapsed', 'false'); } catch (e) {}
    }

    hamburgerBtns.forEach(function (b) {
      var label = shouldCollapse ? 'Expand Sidebar' : 'Collapse Sidebar';
      b.setAttribute('title', label);
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
    });
  }

  // Restore desktop collapsed state if saved in localStorage
  try {
    var savedState = localStorage.getItem('educare-sidebar-collapsed');
    if (savedState === 'true' && !isMobile()) {
      document.documentElement.classList.add('sidebar-collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
  } catch (e) {}

  // Handle all hamburger and menu toggle button clicks
  hamburgerBtns.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isMobile()) {
        var isOpen = sidebar && sidebar.classList.contains('open');
        setMobileMenu(!isOpen);
      } else {
        toggleDesktopSidebar();
      }
    });
  });

  if (backdrop) {
    backdrop.addEventListener('click', function () {
      setMobileMenu(false);
    });
  }


  if (sidebar) {
    sidebar.querySelectorAll('nav a').forEach(function (a) {
      a.addEventListener('click', function () {
        if (isMobile()) setMobileMenu(false);
      });
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (isMobile()) setMobileMenu(false);
    }
  });

  window.addEventListener('resize', function () {
    if (!isMobile() && sidebar && sidebar.classList.contains('open')) {
      setMobileMenu(false);
    }
  });

  // ---------- Tables become cards on phones ----------
  // Copies each column heading onto its cells so CSS can show it as a label.
  // Exposed so automatically refreshed result tables get the same treatment.
  window.educareEnhanceTables = function (root) {
    var scope = root || document;
    var tables = scope.querySelectorAll('table:not([data-mobile-ready])');
    Array.prototype.forEach.call(tables, function (table) {
      table.setAttribute('data-mobile-ready', '1');
      var heads = table.querySelectorAll('thead th');
      if (!heads.length) return;
      var labels = Array.prototype.map.call(heads, function (th) { return th.textContent.trim(); });
      table.classList.add('stack-table');
      table.querySelectorAll('tbody tr').forEach(function (tr) {
        var col = 0;
        Array.prototype.forEach.call(tr.children, function (td) {
          if (td.classList.contains('empty') || td.colSpan > 1) {
            td.classList.add('full-cell');
          } else {
            td.setAttribute('data-label', labels[col] || '');
            var wrap = document.createElement('div');
            wrap.className = 'cell';
            while (td.firstChild) wrap.appendChild(td.firstChild);
            td.appendChild(wrap);
          }
          col += td.colSpan || 1;
        });
      });
    });
  };
  window.educareEnhanceTables(document);

  // ---------- Collapsible search filters on phones ----------
  document.querySelectorAll('form.card.filters').forEach(function (form) {
    var active = 0;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.name === 'sort' || el.type === 'submit' || el.type === 'hidden') return;
      if (el.type === 'checkbox' ? el.checked : el.value) active++;
    });
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-light filter-toggle';
    var label = function () {
      var closed = form.classList.contains('collapsed');
      toggle.textContent = (closed ? '🔍 Search & filters' : '✕ Hide filters') + (active ? ' (' + active + ' active)' : '');
      toggle.setAttribute('aria-expanded', closed ? 'false' : 'true');
    };
    if (!active) form.classList.add('collapsed');
    label();
    toggle.addEventListener('click', function () {
      form.classList.toggle('collapsed');
      label();
    });
    form.parentNode.insertBefore(toggle, form);
  });

  // User form: show technician fields only for technicians
  var role = document.getElementById('role');
  var techFields = document.getElementById('tech-fields');
  if (role && techFields) {
    var sync = function () {
      techFields.classList.toggle('hidden', role.value !== 'technician');
    };
    role.addEventListener('change', sync);
    sync();
  }

  // Character counters: <span data-count-for="fieldId">
  document.querySelectorAll('[data-count-for]').forEach(function (out) {
    var field = document.getElementById(out.getAttribute('data-count-for'));
    if (!field) return;
    var update = function () { out.textContent = field.value.length; };
    field.addEventListener('input', update);
    update();
  });

  // ---------- Submit Request: 3-step form (Details, Photo, Review) ----------
  var wizard = document.getElementById('report-form');
  if (wizard) setupWizard(wizard);
  var modalWizard = document.getElementById('modal-report-form');
  if (modalWizard) setupWizard(modalWizard);

  // ---------- Submit Request Floating Card Modal Controller ----------
  window.openSubmitRequestModal = function (context) {
    var modal = document.getElementById('submit-request-modal');
    var ctx = context && typeof context === 'object' ? context : {};
    var query = [];
    if (ctx.location) query.push('location=' + encodeURIComponent(ctx.location));
    if (ctx.categoryId) query.push('categoryId=' + encodeURIComponent(ctx.categoryId));
    if (!modal) {
      window.location.href = '/requests/new' + (query.length ? '?' + query.join('&') : '');
      return;
    }
    var form = document.getElementById('modal-report-form');
    if (form) {
      if (typeof form.__setSubmittingState === 'function') form.__setSubmittingState(false);
      if (typeof form.__showStep === 'function') form.__showStep(1);
      var catSelect = form.querySelector('select[id$="equipment-category"]');
      var locSelect = form.querySelector('select[id$="equipment-location"]');
      if (catSelect && ctx.categoryId) catSelect.value = String(ctx.categoryId);
      if (locSelect && ctx.location) locSelect.value = ctx.location;
    }
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    var title = form ? form.querySelector('input[name="title"]') : null;
    if (title) setTimeout(function () { title.focus(); }, 120);
  };

  window.closeSubmitRequestModal = function (e) {
    if (e && e.target && e.target !== document.getElementById('submit-request-modal') && !e.target.classList.contains('submit-modal-close')) {
      return;
    }
    var modal = document.getElementById('submit-request-modal');
    if (modal) {
      document.querySelectorAll('.eq-dropdown.is-open').forEach(function (p) {
        if (typeof p._eqClose === 'function') p._eqClose();
      });
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
    }
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('submit-request-modal');
      if (modal && modal.style.display === 'flex') {
        window.closeSubmitRequestModal();
      }
    }
  });

  // Intercept all links to /requests/new to open floating card modal
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="/requests/new"]');
    if (link && document.getElementById('submit-request-modal')) {
      e.preventDefault();
      var href = link.getAttribute('href') || '';
      var query = href.indexOf('?') >= 0 ? href.slice(href.indexOf('?') + 1) : '';
      var params = new URLSearchParams(query);
      window.openSubmitRequestModal({
        location: params.get('location') || '',
        categoryId: params.get('categoryId') || ''
      });
    }
  });

  // Auto-open modal if requested via URL query param (?openModal=1)
  try {
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openModal') === '1' || urlParams.get('new') === '1') {
      window.openSubmitRequestModal({
        location: urlParams.get('location') || '',
        categoryId: urlParams.get('categoryId') || ''
      });
    }
  } catch (e) {}

  // ---------- New User Account Floating Card Modal Controller ----------
  function syncModalRoleFields(role) {
    var techFields = document.getElementById('modal-tech-fields');
    var studentField = document.getElementById('modal-student-id-field');
    if (techFields) techFields.style.display = (role === 'technician') ? 'block' : 'none';
    if (studentField) studentField.style.display = (role === 'admin' || role === 'technician') ? 'none' : 'block';
  }

  var modalRoleSelect = document.getElementById('modal-user-role');
  if (modalRoleSelect) {
    modalRoleSelect.addEventListener('change', function () {
      syncModalRoleFields(this.value);
    });
    syncModalRoleFields(modalRoleSelect.value);
  }

  window.openNewAccountModal = function (role) {
    var modal = document.getElementById('new-account-modal');
    if (!modal) {
      window.location.href = '/users/new' + (role ? '?role=' + encodeURIComponent(role) : '');
      return;
    }
    if (role && modalRoleSelect) {
      modalRoleSelect.value = role;
      syncModalRoleFields(role);
    }
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    var nameInput = document.getElementById('modal-user-name');
    if (nameInput) setTimeout(function () { nameInput.focus(); }, 120);
  };

  window.closeNewAccountModal = function (e) {
    if (e && e.target && e.target !== document.getElementById('new-account-modal') && !e.target.classList.contains('submit-modal-close') && !e.target.closest('.submit-modal-close') && !e.target.classList.contains('btn-light')) {
      return;
    }
    var modal = document.getElementById('new-account-modal');
    if (modal) {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
    }
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('new-account-modal');
      if (modal && modal.style.display === 'flex') {
        window.closeNewAccountModal();
      }
    }
  });

  // Intercept all links to /users/new to open floating card modal
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="/users/new"]');
    if (link && document.getElementById('new-account-modal')) {
      e.preventDefault();
      var href = link.getAttribute('href') || '';
      var roleMatch = href.match(/role=([a-zA-Z]+)/);
      var role = roleMatch ? roleMatch[1] : null;
      window.openNewAccountModal(role);
    }
  });

  // Auto-open new account modal if requested via URL query param (?openAccountModal=1)
  try {
    var userUrlParams = new URLSearchParams(window.location.search);
    if (userUrlParams.get('openAccountModal') === '1') {
      window.openNewAccountModal(userUrlParams.get('role'));
    }
  } catch (e) {}

  // ---------- Edit Profile Floating Modal Controller ----------
  window.openProfileEditModal = function () {
    var modal = document.getElementById('profile-edit-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');

    // Keep notifications readable while the overlay is open.
    var flashSlot = document.getElementById('profile-modal-flash');
    var pageAlert = document.querySelector('main.content > .alert');
    if (flashSlot && pageAlert && pageAlert.parentNode !== flashSlot) {
      flashSlot.appendChild(pageAlert);
    }
    setTimeout(function () {
      var nameInput = document.getElementById('name');
      if (nameInput) nameInput.focus();
    }, 120);
  };

  window.closeProfileEditModal = function (e) {
    if (e && e.target && e.target !== document.getElementById('profile-edit-modal') &&
        !e.target.closest('[data-modal-close]')) {
      return;
    }
    var modal = document.getElementById('profile-edit-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('profile-edit-modal');
      if (modal && modal.style.display === 'flex') window.closeProfileEditModal();
    }
  });

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open-profile-modal], a[href="/profile/edit"]');
    if (opener && document.getElementById('profile-edit-modal')) {
      e.preventDefault();
      window.openProfileEditModal();
    }
  });

  var saveProfileBtn = document.getElementById('profile-modal-save');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', function () {
      var detailsForm = document.getElementById('profile-details-form');
      if (detailsForm) detailsForm.submit();
    });
  }

  // Auto-open when arriving from the legacy /profile/edit route.
  try {
    if (new URLSearchParams(window.location.search).get('edit') === '1') {
      window.openProfileEditModal();
    }
  } catch (e) {}

  // ---------- Equipment Details Quick View Modal Controller ----------
  var currentSelectedEqId = null;
  var currentSelectedEqData = null;

  window.openEquipmentDetailsModal = function (eqId) {
    var modal = document.getElementById('equipment-details-modal');
    if (!modal) {
      window.location.href = '/equipment/' + eqId;
      return;
    }
    currentSelectedEqId = eqId;
    currentSelectedEqData = null;
    var data = window.EQUIPMENT_MAP ? window.EQUIPMENT_MAP[eqId] : null;
    if (!data) {
      window.location.href = '/equipment/' + eqId;
      return;
    }
    currentSelectedEqData = data;

    var titleEl = document.getElementById('eq-modal-title');
    var codeEl = document.getElementById('eq-modal-code');
    var statusBadgeEl = document.getElementById('eq-modal-status-badge');
    var catLocEl = document.getElementById('eq-modal-category-location');
    var modelEl = document.getElementById('eq-modal-model');
    var serialEl = document.getElementById('eq-modal-serial');
    var catEl = document.getElementById('eq-modal-category');
    var deptEl = document.getElementById('eq-modal-dept');
    var locEl = document.getElementById('eq-modal-location');
    var impEl = document.getElementById('eq-modal-importance');
    var nextPmEl = document.getElementById('eq-modal-next-pm');
    var openReqsEl = document.getElementById('eq-modal-open-reqs');
    var acqEl = document.getElementById('eq-modal-acq-date');
    var notesWrap = document.getElementById('eq-modal-notes-wrap');
    var notesEl = document.getElementById('eq-modal-notes');
    var fullViewBtn = document.getElementById('eq-modal-full-view-btn');

    if (titleEl) titleEl.textContent = data.name || 'Equipment';
    if (codeEl) codeEl.textContent = data.code || '';
    if (statusBadgeEl) {
      statusBadgeEl.textContent = data.status || 'Operational';
      statusBadgeEl.className = 'badge ' + (
        data.status === 'Operational' ? 'badge-green' :
        data.status === 'Needs Repair' ? 'badge-amber' :
        data.status === 'Under Maintenance' ? 'badge-blue' :
        data.status === 'Decommissioned' ? 'badge-gray' : 'badge-red'
      );
    }
    var catName = data.category ? data.category.name : 'General';
    if (catLocEl) catLocEl.textContent = catName + ' · ' + (data.location || 'Campus');
    if (modelEl) modelEl.textContent = data.model || '—';
    if (serialEl) serialEl.textContent = data.serialNumber ? 'SN ' + data.serialNumber : '—';
    if (catEl) catEl.textContent = catName;
    if (deptEl) deptEl.textContent = data.department || '—';
    if (locEl) locEl.textContent = data.location || '—';
    if (impEl) impEl.textContent = 'Level ' + (data.importance || 1) + (data.importance === 3 ? ' (High Priority)' : data.importance === 2 ? ' (Medium Priority)' : ' (Low Priority)');
    
    if (nextPmEl) {
      if (data.schedule && data.schedule.hasHistory && data.schedule.nextDue) {
        nextPmEl.textContent = data.schedule.nextDue + (data.schedule.status && data.schedule.status !== 'Scheduled' ? ' (' + data.schedule.status + ')' : '');
      } else if (data.schedule) {
        nextPmEl.textContent = 'Not yet recorded';
      } else {
        nextPmEl.textContent = 'Not scheduled';
      }
    }
    if (openReqsEl) {
      openReqsEl.textContent = (data.openRequests || 0) + ' active request(s)';
      openReqsEl.style.color = (data.openRequests > 0) ? '#d97706' : '#10b981';
    }
    if (acqEl) acqEl.textContent = data.acquisitionDate ? data.acquisitionDate : '—';

    if (notesWrap && notesEl) {
      if (data.notes && data.notes.trim()) {
        notesEl.textContent = data.notes;
        notesWrap.style.display = 'block';
      } else {
        notesWrap.style.display = 'none';
      }
    }

    var photoWrap = document.getElementById('eq-modal-photo-wrap');
    var photoEl = document.getElementById('eq-modal-photo');
    if (photoWrap && photoEl) {
      if (data.photo) {
        photoEl.src = '/uploads/' + data.photo;
        photoEl.onerror = function () { photoWrap.style.display = 'none'; };
        photoWrap.style.display = 'block';
      } else {
        photoWrap.style.display = 'none';
      }
    }

    if (fullViewBtn) fullViewBtn.href = '/equipment/' + data.id;

    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
  };

  window.closeEquipmentDetailsModal = function (e) {
    if (e && e.target && e.target !== document.getElementById('equipment-details-modal') && !e.target.classList.contains('submit-modal-close') && !e.target.closest('.submit-modal-close') && !e.target.classList.contains('btn-light')) {
      return;
    }
    var modal = document.getElementById('equipment-details-modal');
    if (modal) {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
    }
  };

  window.submitRequestForCurrentEq = function () {
    window.closeEquipmentDetailsModal();
    var context = currentSelectedEqData ? {
      location: currentSelectedEqData.location || '',
      categoryId: currentSelectedEqData.category ? currentSelectedEqData.category.id : ''
    } : {};
    var query = [];
    if (context.location) query.push('location=' + encodeURIComponent(context.location));
    if (context.categoryId) query.push('categoryId=' + encodeURIComponent(context.categoryId));
    if (window.openSubmitRequestModal && (context.location || context.categoryId)) {
      window.openSubmitRequestModal(context);
    } else {
      window.location.href = '/requests/new' + (query.length ? '?' + query.join('&') : '');
    }
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var eqModal = document.getElementById('equipment-details-modal');
      if (eqModal && eqModal.style.display === 'flex') {
        window.closeEquipmentDetailsModal();
      }
    }
  });

  // "Use" buttons in the technician recommendations fill the assign form
  document.querySelectorAll('[data-pick-tech]').forEach(function (b) {
    b.addEventListener('click', function () {
      var sel = document.getElementById('technicianId');
      if (sel) {
        sel.value = b.getAttribute('data-pick-tech');
        sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sel.focus();
      }
    });
  });

  // ---------- Password visibility toggles ----------
  document.querySelectorAll('.btn-toggle-pw').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-target');
      var input = document.getElementById(targetId);
      if (!input) return;
      var isPw = input.type === 'password';
      input.type = isPw ? 'text' : 'password';
      btn.innerHTML = isPw
        ? '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>'
        : '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
      var label = isPw ? 'Hide password' : 'Show password';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('aria-pressed', isPw ? 'true' : 'false');
    });
  });

  // ---------- Password strength meter & live security checklist ----------
  var newPw = document.getElementById('new_password');
  var confirmPw = document.getElementById('confirm_password');
  var meterWrap = document.getElementById('pw-meter-wrap');
  var meterFill = document.getElementById('pw-meter-fill');
  var strengthLabel = document.getElementById('pw-strength-label');

  var ruleLen = document.getElementById('rule-length');
  var ruleLetters = document.getElementById('rule-letters');
  var ruleNum = document.getElementById('rule-number');
  var ruleMatch = document.getElementById('rule-match');

  if (newPw) {
    var checkPw = function () {
      var v1 = newPw.value || '';
      var v2 = confirmPw ? confirmPw.value || '' : '';

      if (meterWrap) meterWrap.style.display = v1.length > 0 ? 'flex' : 'none';

      var hasLen = v1.length >= 8;
      var hasLetters = /[A-Za-z]/.test(v1);
      var hasNum = /[0-9]/.test(v1) || /[^A-Za-z0-9]/.test(v1);
      var hasMatch = v1.length >= 8 && v1 === v2;

      if (ruleLen) ruleLen.classList.toggle('valid', hasLen);
      if (ruleLetters) ruleLetters.classList.toggle('valid', hasLetters);
      if (ruleNum) ruleNum.classList.toggle('valid', hasNum);
      if (ruleMatch) ruleMatch.classList.toggle('valid', hasMatch);

      // Calculate strength score (0 to 5)
      var score = 0;
      if (hasLen) score++;
      if (hasLetters && hasNum) score++;
      if (/[A-Z]/.test(v1) && /[a-z]/.test(v1)) score++;
      if (/[^A-Za-z0-9]/.test(v1)) score++;
      if (v1.length >= 12 && score >= 3) score++;

      if (meterFill && strengthLabel) {
        if (!v1.length) {
          meterFill.style.width = '0%';
          strengthLabel.textContent = 'Enter password';
          strengthLabel.style.color = 'var(--muted)';
        } else if (score <= 1) {
          meterFill.style.width = '25%';
          meterFill.style.backgroundColor = '#ef4444';
          strengthLabel.textContent = 'Weak';
          strengthLabel.style.color = '#ef4444';
        } else if (score === 2) {
          meterFill.style.width = '50%';
          meterFill.style.backgroundColor = '#f97316';
          strengthLabel.textContent = 'Fair';
          strengthLabel.style.color = '#f97316';
        } else if (score === 3) {
          meterFill.style.width = '75%';
          meterFill.style.backgroundColor = '#3b82f6';
          strengthLabel.textContent = 'Good';
          strengthLabel.style.color = '#2563eb';
        } else {
          meterFill.style.width = '100%';
          meterFill.style.backgroundColor = '#10b981';
          strengthLabel.textContent = 'Strong';
          strengthLabel.style.color = '#10b981';
        }
      }
    };

    newPw.addEventListener('input', checkPw);
    if (confirmPw) confirmPw.addEventListener('input', checkPw);
    checkPw();
  }


});

function setupWizard(form) {
  var steps = form.querySelectorAll('.wstep');
  var marks = form.querySelectorAll('[data-step-ind]');
  var btn = function (name) { return form.querySelector('[data-nav="' + name + '"]'); };
  var current = 1;
  var last = steps.length;
  var submitting = false;
  var submitBtn = btn('submit');
  var submitBtnDefaultHtml = submitBtn ? submitBtn.innerHTML : '';
  form.classList.add('wizard-on');

  function setSubmittingState(isSubmitting) {
    submitting = isSubmitting;
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
    if (isSubmitting) {
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true" style="width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;vertical-align:middle;margin-right:6px;animation:wizard-spin .75s linear infinite;"></span>Submitting...';
    } else {
      submitBtn.innerHTML = submitBtnDefaultHtml;
    }
  }

  function show(n) {
    current = n;
    steps.forEach(function (s) { s.classList.toggle('current', Number(s.getAttribute('data-step')) === n); });
    marks.forEach(function (li) {
      var k = Number(li.getAttribute('data-step-ind'));
      li.classList.toggle('current', k === n);
      li.classList.toggle('done', k < n);
    });
    if (btn('cancel')) btn('cancel').hidden = false;
    if (btn('back')) btn('back').hidden = n === 1;
    if (btn('next')) btn('next').hidden = n === last;
    if (btn('submit')) btn('submit').hidden = n !== last;
    if (n === last) fillReview();
    var modalContainer = form.closest('.submit-modal-card');
    if (modalContainer) {
      modalContainer.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      var top = form.getBoundingClientRect().top + window.scrollY - 80;
      if (window.scrollY > top) window.scrollTo({ top: top, behavior: 'smooth' });
    }
  }

  function getEqErrorEl(sel) {
    var wrap = sel ? sel.closest('.eq-field') : null;
    return wrap ? wrap.querySelector('.eq-error') : null;
  }
  function showEqError(sel, message) {
    var wrap = sel ? sel.closest('.eq-field') : null;
    var err = getEqErrorEl(sel);
    var trigger = wrap ? wrap.querySelector('.eq-trigger') : null;
    if (err) { err.textContent = message; err.classList.add('is-visible'); }
    if (trigger) trigger.classList.add('has-error');
  }
  function clearEqError(sel) {
    var wrap = sel ? sel.closest('.eq-field') : null;
    var err = getEqErrorEl(sel);
    var trigger = wrap ? wrap.querySelector('.eq-trigger') : null;
    if (err) { err.textContent = ''; err.classList.remove('is-visible'); }
    if (trigger) trigger.classList.remove('has-error');
  }

  // Checks only the fields of one step and shows the browser's message.
  function stepValid(n) {
    var stepEl = steps[n - 1];
    var fields = stepEl.querySelectorAll('input, select, textarea');
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.classList && f.classList.contains('eq-native-select')) continue;
      if (f.willValidate && !f.checkValidity()) {
        f.reportValidity();
        return false;
      }
    }
    var reqEq = stepEl.querySelectorAll('select.eq-native-select[data-required="true"]');
    for (var j = 0; j < reqEq.length; j++) {
      if (!reqEq[j].value) {
        showEqError(reqEq[j], 'Please select an equipment item before proceeding.');
        var trg = reqEq[j].closest('.eq-field');
        if (trg) {
          var t = trg.querySelector('.eq-trigger');
          if (t) t.focus();
        }
        return false;
      }
      clearEqError(reqEq[j]);
    }
    return true;
  }

  if (btn('next')) btn('next').addEventListener('click', function () { if (stepValid(current)) show(current + 1); });
  if (btn('back')) btn('back').addEventListener('click', function () { if (!submitting) show(current - 1); });
  form.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { if (!submitting) show(Number(b.getAttribute('data-go'))); });
  });
  // Enter in a text field moves to the next step instead of submitting early.
  form.addEventListener('submit', function (e) {
    if (current < last) {
      e.preventDefault();
      if (stepValid(current)) show(current + 1);
      return;
    }

    if (submitting) {
      e.preventDefault();
      return;
    }

    if (!stepValid(current)) {
      e.preventDefault();
      return;
    }

    var modal = form.closest('#submit-request-modal');
    if (modal) {
      e.preventDefault();
      setSubmittingState(true);
      var formData = new FormData(form);
      fetch(form.action || '/requests', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      }).then(function (res) {
        if (res.redirected && /\/requests\/\d+/.test(res.url)) {
          window.location.href = res.url;
          return null;
        }
        if (res.ok && /\/requests\/\d+/.test(res.url)) {
          window.location.href = res.url;
          return null;
        }
        return res.text().then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var err = doc.querySelector('.alert-danger, .alert-error, .errors, .error-list');
          var msg = err ? err.textContent.replace(/\s+/g, ' ').trim() : 'Unable to submit request. Please review the form and try again.';
          setSubmittingState(false);
          if (window.ecAlert) window.ecAlert(msg, { title: 'Unable to Submit Request', tone: 'danger', icon: 'warning' });
        });
      }).catch(function () {
        setSubmittingState(false);
        if (window.ecAlert) window.ecAlert('Unable to submit request. Please check your connection and try again.', { title: 'Connection Error', tone: 'danger', icon: 'warning' });
      });
      return;
    }

    setSubmittingState(true);
  });

  function initEqDropdown(selectEl, formEl) {
    var wrap = selectEl.closest('[data-eq-select]');
    if (!wrap) return function () {};
    var trigger = wrap.querySelector('.eq-trigger');
    var triggerLabel = wrap.querySelector('.eq-trigger-label');
    var panel = wrap.querySelector('.eq-dropdown');
    var searchInput = wrap.querySelector('.eq-search');
    var optionsWrap = wrap.querySelector('.eq-options');
    if (!trigger || !panel || !optionsWrap) return function () {};

    var open = false;
    var panelHome = panel.parentNode;
    var onDocKeydown = function (e) {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
        trigger.focus();
      }
    };

    function visibleOptions() {
      return Array.prototype.filter.call(selectEl.options, function (opt) {
        return opt.value && !opt.hidden;
      });
    }

    function selectedOption() {
      return selectEl.options[selectEl.selectedIndex] && selectEl.options[selectEl.selectedIndex].value
        ? selectEl.options[selectEl.selectedIndex]
        : null;
    }

    function updateTrigger() {
      var opt = selectedOption();
      if (opt) {
        triggerLabel.textContent = opt.textContent.trim();
        triggerLabel.classList.remove('is-placeholder');
      } else {
        triggerLabel.textContent = 'Select equipment…';
        triggerLabel.classList.add('is-placeholder');
      }
    }

    function positionPanel() {
      var rect = trigger.getBoundingClientRect();
      var gap = 6;
      var viewportPad = 12;
      var width = rect.width;
      var left = rect.left;
      var maxLeft = window.innerWidth - width - viewportPad;
      if (left > maxLeft) left = maxLeft;
      if (left < viewportPad) left = viewportPad;
      panel.style.width = width + 'px';
      panel.style.left = left + 'px';
      panel.style.top = (rect.bottom + gap) + 'px';

      var panelRect = panel.getBoundingClientRect();
      var spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad;
      var spaceAbove = rect.top - gap - viewportPad;
      var maxH = Math.max(160, Math.min(280, Math.max(spaceBelow, spaceAbove)));
      optionsWrap.style.maxHeight = maxH + 'px';
      panelRect = panel.getBoundingClientRect();
      var panelH = panelRect.height;
      var top = rect.bottom + gap;
      if (spaceBelow < panelH && spaceAbove > spaceBelow) {
        top = rect.top - panelH - gap;
      }
      if (top < viewportPad) top = viewportPad;
      if (top + panelH > window.innerHeight - viewportPad) {
        top = Math.max(viewportPad, window.innerHeight - panelH - viewportPad);
      }
      panel.style.top = top + 'px';
    }

    function renderOptions() {
      var q = (searchInput.value || '').toLowerCase().trim();
      var opts = visibleOptions();
      var currentVal = selectEl.value;
      optionsWrap.innerHTML = '';
      var count = 0;
      opts.forEach(function (opt) {
        var text = opt.textContent.trim();
        var hay = (text + ' ' + (opt.getAttribute('data-location') || '') + ' ' + (opt.getAttribute('data-category-name') || '')).toLowerCase();
        if (q && hay.indexOf(q) === -1) return;
        count++;
        var div = document.createElement('div');
        div.className = 'eq-option' + (opt.value === currentVal ? ' is-selected' : '');
        div.setAttribute('role', 'option');
        div.setAttribute('data-value', opt.value);
        div.setAttribute('aria-selected', opt.value === currentVal ? 'true' : 'false');
        div.textContent = text;
        div.addEventListener('click', function () {
          selectEl.value = opt.value;
          clearEqError(selectEl);
          updateTrigger();
          renderOptions();
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          closePanel();
          trigger.focus();
        });
        optionsWrap.appendChild(div);
      });
      if (!count) {
        var empty = document.createElement('div');
        empty.className = 'eq-option-empty';
        empty.textContent = q ? 'No matching equipment found.' : 'No equipment available.';
        optionsWrap.appendChild(empty);
      }
    }

    function closePanel() {
      if (!open) return;
      open = false;
      panel.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
      document.removeEventListener('keydown', onDocKeydown, true);
      if (panelHome && panel.parentNode !== panelHome) panelHome.appendChild(panel);
    }

    function openPanel() {
      if (open) return;
      open = true;
      if (panel.parentNode !== document.body) document.body.appendChild(panel);
      panel.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      renderOptions();
      positionPanel();
      window.addEventListener('resize', positionPanel);
      window.addEventListener('scroll', positionPanel, true);
      document.addEventListener('keydown', onDocKeydown, true);
      setTimeout(function () { if (searchInput) { searchInput.value = ''; renderOptions(); positionPanel(); searchInput.focus(); } }, 20);
    }

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (open) closePanel(); else openPanel();
    });

    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!open) openPanel();
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        closePanel();
      }
    });

    searchInput.addEventListener('input', function () {
      renderOptions();
      positionPanel();
    });

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
        trigger.focus();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = optionsWrap.querySelector('.eq-option');
        if (first) first.click();
      }
    });

    document.addEventListener('click', function (e) {
      if (!open) return;
      if (wrap.contains(e.target) || panel.contains(e.target)) return;
      closePanel();
    });

    selectEl.addEventListener('change', function () {
      clearEqError(selectEl);
      updateTrigger();
      if (open) { renderOptions(); positionPanel(); }
    });

    updateTrigger();
    renderOptions();

    var refresh = function () {
      updateTrigger();
      if (open) { renderOptions(); positionPanel(); }
    };
    selectEl._eqRefresh = refresh;
    panel._eqClose = closePanel;
    return refresh;
  }

  // Character counters scoped to this form
  form.querySelectorAll('[data-count-for]').forEach(function (out) {
    var targetId = out.getAttribute('data-count-for');
    var field = form.querySelector('#' + targetId) || document.getElementById(targetId);
    if (!field) return;
    var update = function () { out.textContent = field.value.length; };
    field.addEventListener('input', update);
    update();
  });

  // ----- Photos: camera, gallery, drag and drop, previews -----
  var input = form.querySelector('input[type="file"].photos-input') || form.querySelector('input[type="file"][name="photos"]');
  var previews = form.querySelector('.previews');
  var msg = form.querySelector('.photo-msg');
  var clear = form.querySelector('.photo-actions [id$="clear"]') || form.querySelector('#photos-clear');
  var zone = form.querySelector('.dropzone');
  var pickCamera = form.querySelector('input[capture="environment"]');
  var pickGallery = form.querySelector('#pick-gallery, #modal-pick-gallery');
  var MAX = form.id === 'modal-report-form' || form.id === 'report-form' ? 1 : 6;
  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  var files = [];
  var canEdit = (function () { try { return !!new DataTransfer(); } catch (e) { return false; } })();
  if (!canEdit) form.classList.add('no-dt');

  // Prefer a live camera preview, then fall back to the device's native
  // camera picker when getUserMedia is unavailable (for example on HTTP).
  function openLiveCamera() {
    var media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
      if (pickCamera) pickCamera.click();
      return;
    }
    var overlay = document.createElement('div');
    overlay.className = 'camera-capture-overlay';
    overlay.innerHTML = '<div class="camera-capture-card" role="dialog" aria-modal="true" aria-label="Take a photo"><video autoplay playsinline></video><div class="camera-capture-actions"><button type="button" class="camera-capture-cancel">Cancel</button><button type="button" class="camera-capture-shot" aria-label="Take photo">Take Photo</button></div></div>';
    document.body.appendChild(overlay);
    var video = overlay.querySelector('video');
    var stream = null;
    var closed = false;
    function closeCamera() {
      if (closed) return;
      closed = true;
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
      overlay.remove();
    }
    overlay.querySelector('.camera-capture-cancel').addEventListener('click', closeCamera);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeCamera(); });
    overlay.querySelector('.camera-capture-shot').addEventListener('click', function () {
      if (!video.videoWidth || !video.videoHeight) return;
      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        if (blob) add([new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' })]);
        closeCamera();
      }, 'image/jpeg', 0.92);
    });
    media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (cameraStream) {
      if (closed) { cameraStream.getTracks().forEach(function (track) { track.stop(); }); return; }
      stream = cameraStream;
      video.srcObject = stream;
      return video.play();
    }).catch(function () {
      closeCamera();
      if (pickCamera) pickCamera.click();
    });
  }

  var galleryButton = form.querySelector('.photo-gallery-trigger');
  if (galleryButton) galleryButton.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (pickGallery) pickGallery.click();
  });
  if (zone) {
    zone.addEventListener('click', function (e) {
      if (e.target.closest('.photo-gallery-trigger')) return;
      openLiveCamera();
    });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLiveCamera(); }
    });
  }

  function sync() {
    if (canEdit && input) {
      var dt = new DataTransfer();
      files.forEach(function (f) { dt.items.add(f); });
      input.files = dt.files;
    }
    if (previews) {
      previews.innerHTML = '';
      files.forEach(function (f, i) {
        var fig = document.createElement('figure');
        var img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.alt = f.name;
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'rm';
        rm.setAttribute('aria-label', 'Remove ' + f.name);
        rm.textContent = '×';
        rm.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); files.splice(i, 1); sync(); });
        fig.appendChild(img);
        fig.appendChild(rm);
        previews.appendChild(fig);
      });
    }
    if (zone) zone.hidden = files.length > 0;
    var count = form.querySelector('[data-photo-count]');
    if (count) count.textContent = files.length;
  }

  function add(list) {
    var problems = [];
    Array.prototype.forEach.call(list || [], function (f) {
      if (TYPES.indexOf(f.type) === -1 && !/^image\//.test(f.type)) problems.push(f.name + ' is not a photo.');
      else if (f.size > MAX_BYTES) problems.push(f.name + ' is larger than 5 MB.');
      else if (files.length >= MAX) problems.push('Only ' + MAX + ' photos can be attached.');
      else files.push(f);
    });
    if (msg) msg.textContent = problems.join(' ');
    sync();
  }

  [pickCamera, pickGallery].forEach(function (picker) {
    if (!picker) return;
    picker.addEventListener('change', function () { add(picker.files); picker.value = ''; });
  });
  if (clear) clear.addEventListener('click', function () {
    if (files.length && typeof window.confirm === 'function' && !window.confirm('Remove all selected photos?')) return;
    files = [];
    if (msg) msg.textContent = '';
    sync();
  });

  if (zone) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer) add(e.dataTransfer.files); });
  }

  form.__showStep = show;
  form.__setSubmittingState = setSubmittingState;
  show(1);

  // ----- Review step -----
  function setText(key, text) {
    var el = form.querySelector('[data-review="' + key + '"]');
    if (el) el.textContent = text || '—';
  }
  function fillReview() {
    var locSelect = form.querySelector('select[name="location"]');
    var catSelect = form.querySelector('select[name="categoryId"]');
    var sev = form.querySelector('input[name="severity"]:checked');
    var titleInput = form.querySelector('input[name="title"]');
    var descInput = form.querySelector('textarea[name="description"]');

    setText('title', titleInput ? titleInput.value.trim() : '');
    setText('location', locSelect && locSelect.value && locSelect.selectedIndex >= 0 ? locSelect.options[locSelect.selectedIndex].textContent.trim() : '');
    setText('category', catSelect && catSelect.value && catSelect.selectedIndex >= 0 ? catSelect.options[catSelect.selectedIndex].textContent.trim() : '');
    var sevOut = form.querySelector('[data-review="severity"]');
    if (sevOut) {
      sevOut.innerHTML = '';
      if (sev) {
        var label = sev.closest('.sev');
        var chip = document.createElement('span');
        chip.className = 'chip sev-chip-' + sev.value;
        chip.textContent = label.querySelector('strong').textContent + ' – ' + label.querySelector('small').textContent;
        sevOut.appendChild(chip);
      } else {
        sevOut.textContent = '—';
      }
    }
    setText('description', descInput ? descInput.value.trim() : '');
    var ph = form.querySelector('[data-review="photos"]');
    if (ph) {
      ph.innerHTML = '';
      var list = canEdit ? files : Array.prototype.slice.call((input && input.files) || []);
      if (!list.length) ph.textContent = 'No photo attached';
      list.forEach(function (f) {
        var img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.alt = f.name;
        ph.appendChild(img);
      });
    }
  }

}

// Prevent horizontal swipe/trackpad gestures from triggering browser back/forward navigation.
(function () {
  try {
    window.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
      }
    }, { passive: false });
  } catch (err) {}

  try {
    document.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length) {
        window.__educareTouchStartX = e.touches[0].clientX;
      }
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches.length && typeof window.__educareTouchStartX === 'number') {
        var dx = e.touches[0].clientX - window.__educareTouchStartX;
        if (Math.abs(dx) > 10) {
          e.preventDefault();
        }
      }
    }, { passive: false });
  } catch (err) {}

  // Keep the current page stable so back/swipe navigation does not leave the page.
  try {
    history.replaceState({ educare: true }, document.title, location.href);
    history.pushState({ educare: true }, document.title, location.href);
    window.addEventListener('popstate', function () {
      history.pushState({ educare: true }, document.title, location.href);
    });
  } catch (err) {}
})();

// Reusable EduCare confirmation/alert modal
(function () {
  var overlay = null;
  var lastFocus = null;
  var resolver = null;
  var ICONS = {
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 12l3 3 5-5"></path></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M15 9l-6 6"></path><path d="M9 9l6 6"></path></svg>'
  };

  function ensureModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'ec-confirm-overlay';
    overlay.innerHTML =
      '<div class="ec-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ec-confirm-title" aria-describedby="ec-confirm-message">' +
        '<div class="ec-confirm-icon is-danger" data-ec-confirm="icon" aria-hidden="true"></div>' +
        '<h2 class="ec-confirm-title" id="ec-confirm-title"></h2>' +
        '<p class="ec-confirm-message" id="ec-confirm-message"></p>' +
        '<div class="ec-confirm-actions">' +
          '<button type="button" class="btn ec-confirm-btn-cancel" data-ec-confirm="cancel">Cancel</button>' +
          '<button type="button" class="btn ec-confirm-btn-danger" data-ec-confirm="ok">Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && !overlay.classList.contains('is-alert')) close(false);
      if (e.target === overlay && overlay.classList.contains('is-alert')) close(true);
    });
    overlay.querySelector('[data-ec-confirm="cancel"]').addEventListener('click', function () { close(false); });
    overlay.querySelector('[data-ec-confirm="ok"]').addEventListener('click', function () { close(true); });
    document.addEventListener('keydown', function (e) {
      if (!overlay || !overlay.classList.contains('is-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(overlay.classList.contains('is-alert')); }
      if (e.key === 'Tab') {
        var focusable = overlay.querySelectorAll('button:not([disabled]):not([style*="display: none"])');
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    return overlay;
  }

  function close(result) {
    if (!overlay || !overlay.classList.contains('is-open')) return;
    overlay.classList.remove('is-open', 'is-alert');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ec-confirm-open');
    var resolve = resolver;
    resolver = null;
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
    lastFocus = null;
    if (resolve) resolve(!!result);
  }

  function toneToIcon(tone) {
    if (tone === 'success') return 'check';
    if (tone === 'warning') return 'warning';
    if (tone === 'info') return 'info';
    return 'trash';
  }

  window.ecConfirm = function (options) {
    var opts = options || {};
    var el = ensureModal();
    var isAlert = !!opts.alert;
    var tone = opts.tone || (opts.danger === false ? 'primary' : 'danger');
    var icon = opts.icon || toneToIcon(tone);
    var iconTone = tone === 'primary' ? 'info' : tone;

    el.querySelector('#ec-confirm-title').textContent = opts.title || (isAlert ? 'Notice' : 'Confirm');
    el.querySelector('#ec-confirm-message').textContent = opts.message || '';

    var iconEl = el.querySelector('[data-ec-confirm="icon"]');
    iconEl.className = 'ec-confirm-icon is-' + iconTone;
    iconEl.innerHTML = ICONS[icon] || ICONS.info;

    var cancelBtn = el.querySelector('[data-ec-confirm="cancel"]');
    var okBtn = el.querySelector('[data-ec-confirm="ok"]');
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    okBtn.textContent = opts.confirmLabel || (isAlert ? 'OK' : 'Confirm');

    var okClass = 'ec-confirm-btn-danger';
    if (opts.okClass) okClass = opts.okClass;
    else if (tone === 'success') okClass = 'ec-confirm-btn-success';
    else if (tone === 'primary') okClass = 'ec-confirm-btn-primary';
    else if (tone === 'info' || tone === 'warning') okClass = 'ec-confirm-btn-primary';
    else okClass = 'ec-confirm-btn-danger';
    okBtn.className = 'btn ' + okClass;
    cancelBtn.className = 'btn ec-confirm-btn-cancel';

    if (resolver) { resolver(false); resolver = null; }
    lastFocus = document.activeElement;
    el.classList.toggle('is-alert', isAlert);
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-open');
    document.body.classList.add('ec-confirm-open');

    return new Promise(function (resolve) {
      resolver = resolve;
      setTimeout(function () { (isAlert ? okBtn : cancelBtn).focus(); }, 0);
    });
  };

  window.ecAlert = function (message, options) {
    var opts = options || {};
    return window.ecConfirm({
      title: opts.title || 'Notice',
      message: message || '',
      confirmLabel: opts.confirmLabel || 'OK',
      alert: true,
      tone: opts.tone || 'info',
      icon: opts.icon || 'info'
    });
  };

  window.ecConfirmPhotoRemove = function () {
    return window.ecConfirm({
      title: 'Remove Photo?',
      message: 'Are you sure you want to remove this photo? This action cannot be undone.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Remove Photo',
      tone: 'danger',
      icon: 'trash'
    });
  };
})();
