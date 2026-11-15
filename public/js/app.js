// Small UI helpers.
document.addEventListener('DOMContentLoaded', function () {
  // ---------- Light / Dark Mode Toggle ----------
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    var updateThemeBtn = function (dark) {
      themeToggle.setAttribute('title', dark ? 'Current: Dark Mode (Click for Light Mode)' : 'Current: Light Mode (Click for Dark Mode)');
      themeToggle.setAttribute('aria-label', dark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      themeToggle.setAttribute('aria-checked', dark ? 'true' : 'false');
    };
    updateThemeBtn(document.documentElement.getAttribute('data-theme') === 'dark');

    themeToggle.addEventListener('click', function (e) {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var targetBtn = e.target.closest('.theme-switch-btn');
      var nextTheme;
      if (targetBtn) {
        if (targetBtn.classList.contains('theme-btn-light')) nextTheme = 'light';
        else if (targetBtn.classList.contains('theme-btn-dark')) nextTheme = 'dark';
      }
      if (!nextTheme) {
        nextTheme = isDark ? 'light' : 'dark';
      }
      if (nextTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      updateThemeBtn(nextTheme === 'dark');
      try {
        localStorage.setItem('educare-theme', nextTheme);
      } catch (err) {}
    });
  }

  // Ask before destructive actions: <form data-confirm="Are you sure?">
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
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
  document.querySelectorAll('table').forEach(function (table) {
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
  window.openSubmitRequestModal = function (equipmentId) {
    var modal = document.getElementById('submit-request-modal');
    if (!modal) {
      window.location.href = '/requests/new' + (equipmentId ? '?equipmentId=' + equipmentId : '');
      return;
    }
    var form = document.getElementById('modal-report-form');
    if (form && equipmentId) {
      var eqSelect = form.querySelector('select[name="equipmentId"]');
      if (eqSelect) {
        eqSelect.value = equipmentId;
        var opt = eqSelect.options[eqSelect.selectedIndex];
        if (opt) {
          var catSelect = form.querySelector('select[id$="equipment-category"]');
          if (catSelect && opt.getAttribute('data-category')) {
            catSelect.value = opt.getAttribute('data-category');
          }
          var locSelect = form.querySelector('select[id$="equipment-location"]');
          if (locSelect && opt.getAttribute('data-location')) {
            locSelect.value = opt.getAttribute('data-location');
          }
        }
      }
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
      var eqMatch = href.match(/equipmentId=(\d+)/);
      var eqId = eqMatch ? eqMatch[1] : null;
      window.openSubmitRequestModal(eqId);
    }
  });

  // Auto-open modal if requested via URL query param (?openModal=1)
  try {
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openModal') === '1' || urlParams.get('new') === '1') {
      window.openSubmitRequestModal(urlParams.get('equipmentId'));
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

  // ---------- Equipment Details Quick View Modal Controller ----------
  var currentSelectedEqId = null;

  window.openEquipmentDetailsModal = function (eqId) {
    var modal = document.getElementById('equipment-details-modal');
    if (!modal) {
      window.location.href = '/equipment/' + eqId;
      return;
    }
    currentSelectedEqId = eqId;
    var data = window.EQUIPMENT_MAP ? window.EQUIPMENT_MAP[eqId] : null;
    if (!data) {
      window.location.href = '/equipment/' + eqId;
      return;
    }

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
      if (data.schedule && data.schedule.nextDue) {
        nextPmEl.textContent = data.schedule.nextDue + (data.schedule.status && data.schedule.status !== 'Scheduled' ? ' (' + data.schedule.status + ')' : '');
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
    if (window.openSubmitRequestModal && currentSelectedEqId) {
      window.openSubmitRequestModal(currentSelectedEqId);
    } else if (currentSelectedEqId) {
      window.location.href = '/requests/new?equipmentId=' + currentSelectedEqId;
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

  // ---------- Profile password visibility toggle & real-time rules ----------
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

  // ---------- Topbar profile dropdown ----------
  var profileWrap = document.getElementById('topbar-profile');
  var profileBtn = document.getElementById('topbar-profile-btn');
  var profileMenu = document.getElementById('topbar-profile-menu');
  if (profileWrap && profileBtn && profileMenu) {
    function closeProfile() {
      profileWrap.classList.remove('open');
      profileBtn.setAttribute('aria-expanded', 'false');
      profileMenu.hidden = true;
    }
    function openProfile() {
      profileWrap.classList.add('open');
      profileBtn.setAttribute('aria-expanded', 'true');
      profileMenu.hidden = false;
    }
    profileBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (profileWrap.classList.contains('open')) closeProfile(); else openProfile();
    });
    document.addEventListener('click', function (e) {
      if (!profileWrap.contains(e.target)) closeProfile();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeProfile();
    });
  }
});

function setupWizard(form) {
  var steps = form.querySelectorAll('.wstep');
  var marks = form.querySelectorAll('[data-step-ind]');
  var btn = function (name) { return form.querySelector('[data-nav="' + name + '"]'); };
  var current = 1;
  var last = steps.length;
  form.classList.add('wizard-on');

  function show(n) {
    current = n;
    steps.forEach(function (s) { s.classList.toggle('current', Number(s.getAttribute('data-step')) === n); });
    marks.forEach(function (li) {
      var k = Number(li.getAttribute('data-step-ind'));
      li.classList.toggle('current', k === n);
      li.classList.toggle('done', k < n);
    });
    if (btn('cancel')) btn('cancel').hidden = n !== 1;
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

  // Checks only the fields of one step and shows the browser's message.
  function stepValid(n) {
    var fields = steps[n - 1].querySelectorAll('input, select, textarea');
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.willValidate && !f.checkValidity()) {
        f.reportValidity();
        return false;
      }
    }
    return true;
  }

  if (btn('next')) btn('next').addEventListener('click', function () { if (stepValid(current)) show(current + 1); });
  if (btn('back')) btn('back').addEventListener('click', function () { show(current - 1); });
  form.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { show(Number(b.getAttribute('data-go'))); });
  });
  // Enter in a text field moves to the next step instead of submitting early.
  form.addEventListener('submit', function (e) {
    if (current < last) {
      e.preventDefault();
      if (stepValid(current)) show(current + 1);
    }
  });

  // Room/Location & Category filters with auto-sync
  var locFilter = form.querySelector('select[id$="equipment-location"]');
  var catFilter = form.querySelector('select[id$="equipment-category"]');
  var eqSelect = form.querySelector('select[name="equipmentId"]');
  if (eqSelect) {
    var filterEquipment = function () {
      var cat = catFilter ? catFilter.value : '';
      var loc = locFilter ? locFilter.value : '';
      Array.prototype.forEach.call(eqSelect.options, function (opt) {
        if (!opt.value) return;
        var matchCat = !cat || opt.getAttribute('data-category') === cat;
        var matchLoc = !loc || opt.getAttribute('data-location') === loc;
        opt.hidden = !(matchCat && matchLoc);
      });
      var selected = eqSelect.options[eqSelect.selectedIndex];
      if (selected && selected.hidden) eqSelect.value = '';
    };

    if (locFilter) locFilter.addEventListener('change', filterEquipment);
    if (catFilter) catFilter.addEventListener('change', filterEquipment);

    eqSelect.addEventListener('change', function () {
      var opt = eqSelect.options[eqSelect.selectedIndex];
      if (opt && opt.value) {
        var optLoc = opt.getAttribute('data-location');
        var optCat = opt.getAttribute('data-category');
        if (locFilter && optLoc && locFilter.value !== optLoc) {
          locFilter.value = optLoc;
        }
        if (catFilter && optCat && catFilter.value !== optCat) {
          catFilter.value = optCat;
        }
        filterEquipment();
      }
    });
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
  var pickGallery = form.querySelector('input[multiple]:not(.photos-input)');
  var MAX = 6;
  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  var files = [];
  var canEdit = (function () { try { return !!new DataTransfer(); } catch (e) { return false; } })();
  if (!canEdit) form.classList.add('no-dt');

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
        rm.addEventListener('click', function () { files.splice(i, 1); sync(); });
        fig.appendChild(img);
        fig.appendChild(rm);
        previews.appendChild(fig);
      });
    }
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
  if (clear) clear.addEventListener('click', function () { files = []; if (msg) msg.textContent = ''; sync(); });

  if (zone) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer) add(e.dataTransfer.files); });
  }

  // ----- Review step -----
  function setText(key, text) {
    var el = form.querySelector('[data-review="' + key + '"]');
    if (el) el.textContent = text || '—';
  }
  function fillReview() {
    var eq = form.querySelector('select[name="equipmentId"]');
    var opt = eq && eq.selectedIndex >= 0 ? eq.options[eq.selectedIndex] : null;
    var sev = form.querySelector('input[name="severity"]:checked');
    var titleInput = form.querySelector('input[name="title"]');
    var descInput = form.querySelector('textarea[name="description"]');

    setText('title', titleInput ? titleInput.value.trim() : '');
    setText('equipment', opt && opt.value ? opt.getAttribute('data-name') + ' (' + opt.getAttribute('data-code') + ')' : '');
    setText('location', opt && opt.value ? opt.getAttribute('data-location') : '');
    setText('category', opt && opt.value ? opt.getAttribute('data-category-name') : '');
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
